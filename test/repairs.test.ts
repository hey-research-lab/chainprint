import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanDirectory } from '../src/scan';
import { countedRules, matchedRules, tempDir } from './helpers';

const KNOWN = '0x0889b4cbbb5a8ca2a722734c147fd5a8d956d863';

function repo(files: Record<string, string>): string {
  const root = tempDir();
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

describe('repairs from outside use (0.1.1)', () => {
  it('reads a Hardhat 3 chainDescriptors entry as a toolchain chain id', () => {
    const root = repo({
      'hardhat.config.ts': [
        'export default defineConfig({',
        '  chainDescriptors: {',
        '    4663: {',
        '      name: "Robinhood Chain",',
        '    },',
        '    46630: { name: "testnet" },',
        '  },',
        '});',
      ].join('\n'),
    });
    const report = scanDirectory(root);
    const config = report.evidence.filter((e) => e.rule === 'chain-id-config');
    expect(config.map((e) => e.line)).toEqual([3]);
    expect(matchedRules(report)).toContain('testnet-marker');
  });

  it('does not read a numeric key as a chain id outside chainDescriptors', () => {
    const root = repo({ 'hardhat.config.ts': 'const gas = {\n  4663: { limit: 1 },\n};\n' });
    expect(countedRules(scanDirectory(root))).toEqual([]);
  });

  it("reads HEY's own declaration files like a README, never as code", () => {
    const root = repo({
      'hey-project.json': '{ "chainId": 4663, "caip2": "eip155:4663" }\n',
      'hey-ship.json': '{ "chain": { "chainId": 4663 } }\n',
    });
    expect(countedRules(scanDirectory(root))).toEqual(['doc-mention']);
  });

  it('does not count a known address found in a testnet broadcast record', () => {
    const root = repo({
      'broadcast/Deploy.s.sol/46630/run-latest.json': JSON.stringify(
        { transactions: [{ contractAddress: KNOWN }], chain: 46630 },
        null,
        2,
      ),
    });
    const report = scanDirectory(root);
    expect(countedRules(report)).toEqual([]);
    expect(matchedRules(report)).toEqual(['testnet-marker']);
  });
});

describe('testnet-only repositories (0.1.1)', () => {
  it('a testnet env key and a "Robinhood Chain testnet" mention are testnet markers, never counted', () => {
    const root = repo({
      '.env.example': 'ROBINHOOD_TESTNET_RPC_URL=\nTESTNET_CHAIN_ID=46630\n',
      'README.md': '# Arb guardian\n\nDeployed on Robinhood Chain testnet.\n',
      'src/net.ts': 'export const NAME = "Robinhood Chain Testnet";\n',
    });
    const report = scanDirectory(root);
    expect(countedRules(report)).toEqual([]);
    expect(report.confidence).toBe('NONE');
    expect(matchedRules(report)).toEqual(['testnet-marker']);
  });

  it('still counts a mainnet mention next to a testnet one', () => {
    const root = repo({
      'README.md': 'Live on Robinhood Chain; tested on Robinhood Chain testnet first.\n',
    });
    expect(countedRules(scanDirectory(root))).toEqual(['doc-mention']);
  });
});
