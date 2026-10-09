import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countedRules, fixture, matchedRules, scanFixture } from './helpers';

describe('fixture repositories', () => {
  it('hardhat: network chainId, explorer in customChains, package keyword → HIGH', () => {
    const report = scanFixture('hardhat');
    expect(countedRules(report)).toEqual(['chain-id-config', 'explorer-host', 'package-metadata']);
    expect(report).toMatchObject({
      confidence: 'HIGH',
      score: 60,
      anchored: true,
      result: 'evidence_found',
    });
    const config = report.evidence.filter((e) => e.rule === 'chain-id-config');
    expect(config.map((e) => `${e.file}:${e.line}`)).toEqual([
      'hardhat.config.ts:9',
      'hardhat.config.ts:17',
    ]);
    expect(config[0]?.excerpt).toBe('chainId: 4663,');
  });

  it('foundry: a broadcast record counts; the dry run and lib/ do not', () => {
    const report = scanFixture('foundry-broadcast');
    expect(countedRules(report)).toEqual(['foundry-broadcast', 'rpc-host']);
    expect(report).toMatchObject({ confidence: 'HIGH', score: 65 });
    const records = report.evidence.filter((e) => e.rule === 'foundry-broadcast');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      file: 'broadcast/Deploy.s.sol/4663/run-latest.json',
      line: 27,
      excerpt: '"chain": 4663,',
      detail: 'Foundry broadcast for chain 4663 with 1 transaction',
    });
    expect(report.evidence.some((e) => e.file.startsWith('lib/'))).toBe(false);
    expect(report.scan.skipped.shown).toContainEqual({ path: 'lib/', reason: 'foundry-library' });
  });

  it('hardhat-deploy: the network .chainId decides; localhost is ignored', () => {
    const report = scanFixture('hardhat-deploy');
    expect(countedRules(report)).toEqual(['hardhat-deploy']);
    expect(report.evidence[0]).toMatchObject({ file: 'deployments/robinhood/.chainId', line: 1 });
    expect(report).toMatchObject({ confidence: 'MEDIUM', score: 45, anchored: true });
  });

  it('ignition: a chain-4663 deployed_addresses.json', () => {
    const report = scanFixture('ignition');
    expect(countedRules(report)).toEqual(['ignition-deployment']);
    expect(report.evidence[0]?.detail).toBe(
      'Ignition deployment for chain 4663 listing 1 contract',
    );
    expect(report.confidence).toBe('MEDIUM');
  });

  it('viem: defineChain with id 4663, RPC, explorer and name → HIGH', () => {
    const report = scanFixture('viem');
    expect(countedRules(report)).toEqual([
      'chain-id-config',
      'rpc-host',
      'explorer-host',
      'chain-name',
    ]);
    expect(report).toMatchObject({ confidence: 'HIGH', score: 75 });
    // client.ts names robinhoodChain but holds no chain id.
    expect(report.evidence.filter((e) => e.file === 'src/client.ts').map((e) => e.rule)).toEqual([
      'chain-name',
      'chain-name',
    ]);
  });

  it('wagmi: a hex chain id in defineChain and a CAIP-2 namespace → HIGH', () => {
    const report = scanFixture('wagmi');
    expect(countedRules(report)).toEqual(['chain-id-config', 'caip2', 'rpc-host', 'chain-name']);
    expect(report.evidence.find((e) => e.rule === 'chain-id-config')?.excerpt).toBe('id: 0x1237,');
    expect(report.confidence).toBe('HIGH');
  });

  it('ethers: provider network and a known factory address, but no anchor → MEDIUM', () => {
    const report = scanFixture('ethers');
    // The comment naming Robinhood Chain adds a mention; without an anchor it stays MEDIUM.
    expect(countedRules(report)).toEqual([
      'chain-id-code',
      'rpc-host',
      'known-address',
      'chain-name',
    ]);
    expect(report).toMatchObject({ confidence: 'MEDIUM', score: 65, anchored: false });
    const address = report.evidence.find((e) => e.rule === 'known-address');
    expect(address?.detail).toContain('Uniswap V2 factory');
    expect(address?.detail).toContain('https://');
  });

  it('env-only: an env template alone is LOW, and values are not printed', () => {
    const report = scanFixture('env-only');
    expect(countedRules(report)).toEqual(['env-template']);
    expect(report).toMatchObject({ confidence: 'LOW', score: 15 });
    expect(report.evidence.map((e) => e.excerpt)).toEqual(['ROBINHOOD_RPC_URL=', 'CHAIN_ID=4663']);
    expect(JSON.stringify(report)).not.toContain('DEPLOYER_KEY');
  });

  it('readme-only: a README mention is the weakest marker', () => {
    const report = scanFixture('readme-only');
    expect(countedRules(report)).toEqual(['doc-mention']);
    expect(report).toMatchObject({ confidence: 'LOW', score: 5 });
  });

  it('package metadata: keyword, dependency name and description', () => {
    const report = scanFixture('package-meta');
    expect(matchedRules(report)).toEqual(['package-metadata']);
    expect(report.evidence.map((e) => `${e.line} ${e.detail}`)).toEqual([
      '3 description mentions Robinhood Chain',
      '4 keyword "RobinhoodChain"',
      '6 dependencies names example-robinhood-chain-utils',
    ]);
    expect(report.confidence).toBe('LOW');
  });

  it('another chain (1) and look-alike numbers are not markers → NONE', () => {
    const report = scanFixture('negative-mainnet');
    expect(report.rules).toEqual([]);
    expect(report.evidence).toEqual([]);
    expect(report).toMatchObject({ confidence: 'NONE', score: 0, result: 'no_evidence_found' });
    expect(report.scan.filesRead).toBe(3);
  });

  it('testnet 46630 is reported, labelled and never counted', () => {
    const report = scanFixture('testnet');
    expect(matchedRules(report)).toEqual(['testnet-marker']);
    expect(report).toMatchObject({ confidence: 'NONE', score: 0, result: 'no_evidence_found' });
    expect(report.evidence.every((e) => !e.counted && e.weight === 0)).toBe(true);
    expect(report.evidence.map((e) => e.file).sort()).toEqual([
      '.env.example',
      'broadcast/Deploy.s.sol/46630/run-latest.json',
      'hardhat.config.js',
    ]);
  });

  it('a deploy record under test fixtures is not a deployment', () => {
    const report = scanFixture('records-in-tests');
    expect(countedRules(report)).toEqual(['chain-id-code']);
    expect(report.anchored).toBe(false);
  });

  it('never executes a config file', () => {
    const report = scanFixture('never-executed');
    expect(countedRules(report)).toEqual(['chain-id-config']);
    expect(existsSync(join(fixture('never-executed'), 'EXECUTED'))).toBe(false);
  });

  it('listings (rules v2): a chain list, vendored chain definitions and agent files are shown, never counted', () => {
    const report = scanFixture('listings');
    // Only the document named for the chain counts; before rules v2 the vendored defineChain alone was HIGH.
    expect(countedRules(report)).toEqual(['doc-mention']);
    expect(report).toMatchObject({ confidence: 'LOW', score: 5, anchored: false });
    expect(report.evidence.filter((e) => e.rule === 'doc-mention').map((e) => e.file)).toEqual([
      'docs/ROBINHOOD.md',
      'docs/ROBINHOOD.md',
    ]);
    const listed = report.evidence.filter((e) => e.rule === 'chain-listing');
    expect(new Set(listed.map((e) => e.file))).toEqual(
      new Set([
        '.cursor/rules/networks.json',
        'AGENTS.md',
        'src/data/chain-registry.json',
        'src/vendor-viem/chains/definitions/robinhood.ts',
      ]),
    );
    expect(listed.every((e) => !e.counted && e.weight === 0 && e.tier === 'context')).toBe(true);
    expect(
      listed.some((e) => e.detail.startsWith('vendored chain definitions: chain-id-config, ')),
    ).toBe(true);
    expect(
      listed.some((e) => e.detail.startsWith('chain list: caip2, ') && e.file.endsWith('.json')),
    ).toBe(true);
    expect(listed.find((e) => e.file === 'AGENTS.md')?.detail).toMatch(
      /^agent instructions: doc-mention, /,
    );
  });
});
