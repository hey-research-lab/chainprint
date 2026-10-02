import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanDirectory } from '../src/scan';
import { DEFAULT_LIMITS } from '../src/walk';
import { tempDir } from './helpers';

const MARKER = 'export const config = { chainId: 4663 };\n';

describe('symbolic links', () => {
  it('never follows a link out of the root, to a file or a directory', () => {
    const base = tempDir();
    const outside = join(base, 'outside');
    const root = join(base, 'repo');
    mkdirSync(outside);
    mkdirSync(root);
    writeFileSync(join(outside, 'secret.ts'), MARKER);
    symlinkSync(join(outside, 'secret.ts'), join(root, 'linked.ts'));
    symlinkSync(outside, join(root, 'linked-dir'));
    symlinkSync('../outside/secret.ts', join(root, 'relative.ts'));

    const report = scanDirectory(root);
    expect(report.evidence).toEqual([]);
    expect(report.confidence).toBe('NONE');
    expect(report.scan.skipped.byReason.symlink).toBe(3);
    expect(report.scan.skipped.shown.map((s) => s.path)).toEqual([
      'linked-dir',
      'linked.ts',
      'relative.ts',
    ]);
  });

  it('does not follow a link inside the root either', () => {
    const root = tempDir();
    writeFileSync(join(root, 'real.ts'), MARKER);
    symlinkSync(join(root, 'real.ts'), join(root, 'alias.ts'));
    const report = scanDirectory(root);
    expect(report.evidence.map((e) => e.file)).toEqual(['real.ts']);
  });

  it('accepts a root given as a link to a directory', () => {
    const base = tempDir();
    mkdirSync(join(base, 'repo'));
    writeFileSync(join(base, 'repo', 'a.ts'), MARKER);
    symlinkSync(join(base, 'repo'), join(base, 'repo-link'));
    expect(scanDirectory(join(base, 'repo-link')).evidence.map((e) => e.file)).toEqual(['a.ts']);
  });
});

describe('limits', () => {
  it('skips a file over the size limit without reading it', () => {
    const root = tempDir();
    writeFileSync(join(root, 'huge.ts'), MARKER + 'x'.repeat(DEFAULT_LIMITS.maxFileBytes));
    writeFileSync(join(root, 'small.ts'), MARKER);
    const report = scanDirectory(root);
    expect(report.evidence.map((e) => e.file)).toEqual(['small.ts']);
    expect(report.scan.skipped.shown).toContainEqual({ path: 'huge.ts', reason: 'too-large' });
  });

  it('honours a smaller size limit', () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.ts'), MARKER);
    const report = scanDirectory(root, { limits: { maxFileBytes: 10 } });
    expect(report.evidence).toEqual([]);
    expect(report.scan.skipped.byReason['too-large']).toBe(1);
  });

  it('stops at the file limit and says the scan is incomplete', () => {
    const root = tempDir();
    for (const name of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) writeFileSync(join(root, name), MARKER);
    const report = scanDirectory(root, { limits: { maxFiles: 2 } });
    expect(report.scan.filesRead).toBe(2);
    expect(report.scan.complete).toBe(false);
    expect(report.scan.incomplete).toEqual(['file-limit']);
    expect(report.evidence.map((e) => e.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('stops at the byte limit', () => {
    const root = tempDir();
    for (const name of ['a.ts', 'b.ts']) writeFileSync(join(root, name), MARKER);
    const report = scanDirectory(root, { limits: { maxTotalBytes: MARKER.length + 1 } });
    expect(report.scan.incomplete).toEqual(['byte-limit']);
    expect(report.scan.filesRead).toBe(1);
  });

  it('does not descend below the depth limit', () => {
    const root = tempDir();
    let dir = root;
    for (let i = 0; i < 4; i += 1) {
      dir = join(dir, `d${i}`);
      mkdirSync(dir);
    }
    writeFileSync(join(dir, 'deep.ts'), MARKER);
    expect(scanDirectory(root, { limits: { maxDepth: 3 } }).evidence).toEqual([]);
    expect(scanDirectory(root, { limits: { maxDepth: 4 } }).evidence).toHaveLength(1);
  });
});

describe('what is never read', () => {
  it('skips dependency, vendored and build directories', () => {
    const root = tempDir();
    for (const dir of [
      'node_modules/pkg',
      '.git',
      'vendor',
      'build',
      'dist',
      'out',
      'artifacts',
      'cache',
      'typechain-types',
    ]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'x.ts'), MARKER);
    }
    const report = scanDirectory(root);
    expect(report.evidence).toEqual([]);
    expect(report.scan.skipped.byReason['ignored-directory']).toBe(9);
  });

  it('skips lib/ only beside foundry.toml', () => {
    const root = tempDir();
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'x.ts'), MARKER);
    expect(scanDirectory(root).evidence).toHaveLength(1);
    writeFileSync(join(root, 'foundry.toml'), '[profile.default]\n');
    expect(scanDirectory(root).evidence).toEqual([]);
  });

  it('never opens a real .env file, but reads an .env template', () => {
    const root = tempDir();
    writeFileSync(
      join(root, '.env'),
      'ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com\n',
    );
    writeFileSync(join(root, '.env.local'), 'CHAIN_ID=4663\n');
    writeFileSync(join(root, '.env.sample'), 'CHAIN_ID=4663\n');
    const report = scanDirectory(root);
    expect(report.evidence.map((e) => e.file)).toEqual(['.env.sample']);
    expect(report.scan.skipped.byReason['env-file']).toBe(2);
  });

  it('skips binary content, lockfiles, minified files and unknown types', () => {
    const root = tempDir();
    writeFileSync(
      join(root, 'blob.json'),
      Buffer.concat([Buffer.from(MARKER), Buffer.from([0, 1, 2])]),
    );
    writeFileSync(join(root, 'package-lock.json'), '{"chainId": 4663}');
    writeFileSync(join(root, 'bundle.min.js'), MARKER);
    writeFileSync(join(root, 'image.png'), MARKER);
    const report = scanDirectory(root);
    expect(report.evidence).toEqual([]);
    expect(report.scan.skipped.byReason).toEqual({
      binary: 1,
      lockfile: 1,
      minified: 1,
      'not-text': 1,
    });
  });

  it('never writes into the scanned tree', () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.ts'), MARKER);
    scanDirectory(root);
    expect(readdirSync(root)).toEqual(['a.ts']);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe(MARKER);
  });
});

describe('untrusted JSON', () => {
  it('does not let package.json pollute prototypes', () => {
    const root = tempDir();
    writeFileSync(
      join(root, 'package.json'),
      '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}, "keywords": ["robinhood-chain"]}',
    );
    const report = scanDirectory(root);
    expect(report.rules.map((r) => r.rule)).toEqual(['package-metadata']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('ignores a malformed deployment record', () => {
    const root = tempDir();
    mkdirSync(join(root, 'broadcast', 'D.s.sol', '4663'), { recursive: true });
    writeFileSync(join(root, 'broadcast', 'D.s.sol', '4663', 'run-latest.json'), '{ not json');
    expect(scanDirectory(root).evidence).toEqual([]);
  });

  it('does not count a broadcast whose chain field contradicts its folder', () => {
    const root = tempDir();
    mkdirSync(join(root, 'broadcast', 'D.s.sol', '4663'), { recursive: true });
    writeFileSync(
      join(root, 'broadcast', 'D.s.sol', '4663', 'run-latest.json'),
      '{"transactions": [], "chain": 1}',
    );
    expect(scanDirectory(root).evidence).toEqual([]);
  });
});

describe('root argument', () => {
  it('rejects a missing path and a file', () => {
    const root = tempDir();
    writeFileSync(join(root, 'file.ts'), MARKER);
    expect(() => scanDirectory(join(root, 'missing'))).toThrow(/No such directory/);
    expect(() => scanDirectory(join(root, 'file.ts'))).toThrow(/Not a directory/);
  });
});

describe('no network, no processes', () => {
  it('imports no networking or process module and calls no fetch', () => {
    const dir = fileURLToPath(new URL('../src', import.meta.url));
    for (const name of readdirSync(dir)) {
      const source = readFileSync(join(dir, name), 'utf8');
      expect(source, name).not.toMatch(
        /from 'node:(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads|vm)'/,
      );
      expect(source, name).not.toMatch(
        /\bfetch\s*\(|\beval\s*\(|new Function\s*\(|\brequire\s*\(|\bimport\s*\(/,
      );
    }
  });
});
