import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, type Io } from '../src/cli';
import { formatExplain, formatReport } from '../src/format';
import { RULES } from '../src/rules';
import { scanDirectory } from '../src/scan';
import { cleanText, excerpt, redactLine } from '../src/text';
import { VERSION } from '../src/version';
import { FIXTURES, fixture, scanFixture, tempDir } from './helpers';

const FIXTURE_NAMES = [
  'env-only',
  'ethers',
  'foundry-broadcast',
  'hardhat',
  'hardhat-deploy',
  'ignition',
  'negative-mainnet',
  'never-executed',
  'package-meta',
  'readme-only',
  'records-in-tests',
  'testnet',
  'viem',
  'wagmi',
];

function capture(argv: string[], env: Record<string, string | undefined> = {}) {
  let stdout = '';
  let stderr = '';
  const io: Io = {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    env,
    isTTY: false,
  };
  const code = run(argv, io);
  return { code, stdout, stderr };
}

describe('determinism', () => {
  it('gives byte-identical JSON for the same tree', () => {
    for (const name of FIXTURE_NAMES) {
      const a = JSON.stringify(scanFixture(name));
      const b = JSON.stringify(scanFixture(name));
      expect(a, name).toBe(b);
    }
  });

  it('does not depend on the order files were created in', () => {
    const files: [string, string][] = [
      ['z.ts', 'export const a = { chainId: 4663 };\n'],
      ['a.ts', "export const rpc = 'https://rpc.mainnet.chain.robinhood.com';\n"],
      ['m/b.ts', 'export const chainId = 4663;\nexport const x = "eip155:4663";\n'],
      ['README.md', 'Robinhood Chain\n'],
    ];
    const build = (order: [string, string][]) => {
      const root = tempDir();
      mkdirSync(join(root, 'm'));
      for (const [name, body] of order) writeFileSync(join(root, name), body);
      return JSON.stringify(scanDirectory(root, { displayRoot: 'repo' }));
    };
    expect(build(files)).toBe(build([...files].reverse()));
  });

  it('orders evidence by rule, then file, then line', () => {
    const report = scanFixture('viem');
    const order = report.evidence.map(
      (e) => [RULES.findIndex((r) => r.id === e.rule), e.file, e.line] as const,
    );
    const sorted = [...order].sort(
      (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2],
    );
    expect(order).toEqual(sorted);
  });

  it('carries no timestamp or absolute path of its own', () => {
    const json = JSON.stringify(scanFixture('hardhat'));
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(json).not.toContain(FIXTURES);
  });
});

describe('excerpts', () => {
  it('prints only the matched line, redacted and truncated', () => {
    const root = tempDir();
    const secret = 'sk9f8e7d6c5b4a39281706f5e4d3c2b1a0';
    const long = `${'a'.repeat(300)} const rpc = 'https://user:pw@rpc.mainnet.chain.robinhood.com/v2/${secret}?key=${secret}'; ${'b'.repeat(300)}`;
    writeFileSync(
      join(root, 'cfg.ts'),
      `const before = 'not printed';\n${long}\nconst after = 'not printed';\n`,
    );
    const report = scanDirectory(root);
    const item = report.evidence.find((e) => e.rule === 'rpc-host');
    expect(item?.line).toBe(2);
    expect(item?.excerpt.length).toBeLessThanOrEqual(122);
    expect(item?.excerpt).toContain('rpc.mainnet.chain.robinhood.com');
    const json = JSON.stringify(report);
    expect(json).not.toContain(secret);
    expect(json).not.toContain('user:pw');
    expect(json).not.toContain('not printed');
  });

  it('redacts private keys and opaque tokens but keeps addresses', () => {
    const key = `0x${'ab'.repeat(32)}`;
    const line = `accounts: ['${key}'], token: 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6', factory: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f'`;
    const out = redactLine(line);
    expect(out).not.toContain(key);
    expect(out).not.toContain('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6');
    expect(out).toContain('0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f');
  });

  it('strips control and bidi characters', () => {
    expect(cleanText('chainId:‮ 4663\u0007\u001b[31m')).toBe('chainId: 4663[31m');
    expect(excerpt('\tchainId: 4663,\r', 'chainId')).toBe('chainId: 4663,');
  });
});

describe('human output', () => {
  it('says evidence found, the confidence and the notice', () => {
    const text = formatReport(scanFixture('foundry-broadcast'));
    expect(text).toMatch(/^Robinhood Chain evidence found\nConfidence: HIGH \(score 65;/);
    expect(text).toContain('broadcast/Deploy.s.sol/4663/run-latest.json:27');
    expect(text).toContain('A marker is evidence, not identity proof.');
  });

  it('reads "no marker found in the files read" — never a fact about the world', () => {
    const text = formatReport(scanFixture('negative-mainnet'));
    expect(text).toMatch(
      /^No Robinhood Chain marker found in the 3 files chainprint read\nConfidence: NONE \(score 0\)/,
    );
  });

  it('labels testnet markers as not counted', () => {
    const text = formatReport(scanFixture('testnet'));
    expect(text).toContain('Reported, not counted:');
    expect(text).toContain('not counted]');
    expect(text).not.toContain('Evidence:');
  });

  it('never claims identity, ownership, safety or a recommendation', () => {
    const texts = [...FIXTURE_NAMES.map((n) => formatReport(scanFixture(n))), formatExplain()];
    for (const text of texts) {
      expect(text).not.toMatch(
        /belongs to|owned by|is the project|verified|official|audited|\bsafe\b|unsafe|\bscam\b|\brug\b|\bbuy\b|\bsell\b|partnership|whale|smart money/i,
      );
    }
  });
});

describe('CLI', () => {
  it('scans a path and prints JSON', () => {
    const { code, stdout } = capture([fixture('hardhat'), '--json']);
    expect(code).toBe(0);
    const doc = JSON.parse(stdout);
    expect(doc).toMatchObject({
      schema: 'chainprint/v1',
      ok: true,
      chain: { name: 'Robinhood Chain', chainId: 4663, caip2: 'eip155:4663' },
      confidence: 'HIGH',
    });
  });

  it('prints the human report by default and exits 0 whatever the confidence', () => {
    const { code, stdout } = capture([fixture('negative-mainnet')]);
    expect(code).toBe(0);
    expect(stdout).toContain('Confidence: NONE');
  });

  it('--quiet prints the confidence and score', () => {
    expect(capture([fixture('hardhat-deploy'), '--quiet']).stdout).toBe('MEDIUM 45\n');
  });

  it('--limit caps the items listed per rule and says so', () => {
    const doc = JSON.parse(capture([fixture('hardhat'), '--json', '--limit', '1']).stdout);
    const config = doc.rules.find((r: { rule: string }) => r.rule === 'chain-id-config');
    expect(config).toMatchObject({ items: 2, shown: 1 });
    const text = capture([fixture('hardhat'), '--limit', '1']).stdout;
    expect(text).toContain('(showing 1 of 2)');
  });

  it('explain prints the rules, weights and bands', () => {
    const { code, stdout } = capture(['explain']);
    expect(code).toBe(0);
    for (const rule of RULES) expect(stdout).toContain(rule.id);
    expect(stdout).toContain(
      'HIGH    score >= 60 and at least one config- or deployment-tier marker',
    );
    const doc = JSON.parse(capture(['explain', '--json']).stdout);
    expect(doc.rules).toHaveLength(RULES.length);
    expect(doc.bands.map((b: { level: string }) => b.level)).toEqual([
      'HIGH',
      'MEDIUM',
      'LOW',
      'NONE',
    ]);
  });

  it('usage errors exit 2', () => {
    expect(capture(['--nope']).code).toBe(2);
    expect(capture(['a', 'b']).code).toBe(2);
    expect(capture([fixture('hardhat'), '--limit', '0']).code).toBe(2);
    expect(capture([fixture('hardhat'), '--limit', 'x']).code).toBe(2);
    const missing = capture([join(FIXTURES, 'does-not-exist'), '--json']);
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      ok: false,
      error: { code: 'invalid_path' },
    });
  });

  it('--version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
    expect(capture(['--version']).stdout).toBe(`${pkg.version}\n`);
  });

  it('--help mentions the offline guarantee', () => {
    expect(capture(['--help']).stdout).toContain('never connects to a network');
  });
});
