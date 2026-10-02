import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_BANDS,
  PATTERNS,
  RULE_IDS,
  RULES,
  computeConfidence,
  isChainIdValue,
  type RuleId,
} from '../src/rules';

describe('rule table', () => {
  it('lists every rule id once, in the documented order, with a fixed weight', () => {
    expect(RULES.map((r) => r.id)).toEqual([...RULE_IDS]);
    expect(Object.fromEntries(RULES.map((r) => [r.id, r.weight]))).toEqual({
      'foundry-broadcast': 45,
      'hardhat-deploy': 45,
      'ignition-deployment': 45,
      'chain-id-config': 40,
      'chain-id-code': 20,
      caip2: 20,
      'rpc-host': 20,
      'known-address': 20,
      'env-template': 15,
      'explorer-host': 10,
      'package-metadata': 10,
      'chain-name': 5,
      'doc-mention': 5,
      'testnet-marker': 0,
    });
  });

  it('counts every rule except the testnet marker', () => {
    expect(RULES.filter((r) => !r.counted).map((r) => r.id)).toEqual(['testnet-marker']);
  });

  it('documents what every rule reads and matches', () => {
    for (const rule of RULES) {
      expect(rule.title.length).toBeGreaterThan(5);
      expect(rule.reads.length).toBeGreaterThan(5);
      expect(rule.matches.length).toBeGreaterThan(10);
    }
  });
});

describe('computeConfidence', () => {
  const conf = (...ids: RuleId[]) => computeConfidence(ids);

  it('is NONE with no counted marker', () => {
    expect(conf()).toEqual({ confidence: 'NONE', score: 0, anchored: false });
    expect(conf('testnet-marker')).toEqual({ confidence: 'NONE', score: 0, anchored: false });
  });

  it('is LOW for a single weak marker', () => {
    expect(conf('doc-mention')).toMatchObject({ confidence: 'LOW', score: 5 });
    expect(conf('env-template')).toMatchObject({ confidence: 'LOW', score: 15 });
    expect(conf('rpc-host')).toMatchObject({ confidence: 'LOW', score: 20 });
  });

  it('is MEDIUM from 25', () => {
    expect(conf('rpc-host', 'doc-mention')).toMatchObject({ confidence: 'MEDIUM', score: 25 });
    expect(conf('foundry-broadcast')).toMatchObject({
      confidence: 'MEDIUM',
      score: 45,
      anchored: true,
    });
  });

  it('is HIGH only from 60 with a config or deployment marker', () => {
    expect(conf('chain-id-config', 'rpc-host')).toMatchObject({ confidence: 'HIGH', score: 60 });
    expect(conf('foundry-broadcast', 'known-address')).toMatchObject({
      confidence: 'HIGH',
      score: 65,
    });
    // 125 points of code-level markers without an anchor stay MEDIUM.
    expect(
      conf(
        'chain-id-code',
        'caip2',
        'rpc-host',
        'known-address',
        'env-template',
        'explorer-host',
        'package-metadata',
        'chain-name',
        'doc-mention',
      ),
    ).toEqual({ confidence: 'MEDIUM', score: 125, anchored: false });
  });

  it('counts a rule once however often it is given', () => {
    expect(conf('rpc-host', 'rpc-host', 'rpc-host')).toMatchObject({ score: 20 });
  });

  it('has bands from HIGH down to NONE', () => {
    expect(CONFIDENCE_BANDS.map((b) => b.level)).toEqual(['HIGH', 'MEDIUM', 'LOW', 'NONE']);
  });
});

describe('patterns', () => {
  const hit = (re: RegExp, text: string) => re.test(text);

  it('config chain id: keys used by hardhat, foundry, truffle and viem', () => {
    for (const text of [
      'chainId: 4663,',
      '"chainId": 4663',
      'chain_id = 4663',
      "chain = 4663, url = 'x'",
      'network_id: 4663',
      'chainId: 0x1237,',
      "chainId: '4663'",
      'chainId: 4663n',
    ]) {
      expect(hit(PATTERNS.configChainId, text), text).toBe(true);
    }
    for (const text of [
      'chainId: 46630',
      'chainId: 14663',
      'chainId: 4663.5',
      'chainId: 1',
      'port: 4663',
    ]) {
      expect(hit(PATTERNS.configChainId, text), text).toBe(false);
    }
    expect(hit(PATTERNS.defineChainId, '  id: 4663,')).toBe(true);
    expect(hit(PATTERNS.defineChainId, '  id: 0x1237,')).toBe(true);
    expect(hit(PATTERNS.defineChainId, '  chain.id: 4663,')).toBe(false);
  });

  it('code chain id: identifiers containing chainid, and ethers networks', () => {
    for (const text of [
      'const CHAIN_ID = 4663;',
      'if (block.chainid == 4663) {',
      'ROBINHOOD_CHAIN_ID: 4663',
      "params: [{ chainId: '0x1237' }]",
      'expectedChainId === 4663',
    ]) {
      expect(hit(PATTERNS.codeChainId, text), text).toBe(true);
    }
    for (const text of ['chainId: 46630', 'const PORT = 4663', 'chainId: 1']) {
      expect(hit(PATTERNS.codeChainId, text), text).toBe(false);
    }
    expect(hit(PATTERNS.ethersNetwork, "new ethers.JsonRpcProvider('https://x', 4663)")).toBe(true);
    expect(hit(PATTERNS.ethersNetwork, 'Network.from(4663)')).toBe(true);
    expect(hit(PATTERNS.ethersNetwork, 'Network.from(46630)')).toBe(false);
  });

  it('CAIP-2, hosts and the chain name', () => {
    expect(hit(PATTERNS.caip2, "chains: ['eip155:4663']")).toBe(true);
    expect(hit(PATTERNS.caip2, 'eip155:46630')).toBe(false);
    expect(hit(PATTERNS.rpcHost, 'https://rpc.mainnet.chain.robinhood.com/')).toBe(true);
    expect(hit(PATTERNS.rpcHost, 'see rpc.mainnet.chain.robinhood.com.')).toBe(true);
    expect(hit(PATTERNS.rpcHost, 'https://rpc.mainnet.chain.robinhood.com.example.org')).toBe(
      false,
    );
    expect(hit(PATTERNS.rpcHost, 'https://x.rpc.mainnet.chain.robinhood.com')).toBe(false);
    expect(hit(PATTERNS.rpcHost, 'https://xrpc.mainnet.chain.robinhood.com')).toBe(false);
    expect(hit(PATTERNS.explorerHost, 'https://robinhoodchain.blockscout.com/tx/0x1')).toBe(true);
    expect(hit(PATTERNS.explorerHost, 'https://notrobinhoodchain.blockscout.com')).toBe(false);
    for (const text of [
      'Robinhood Chain',
      'robinhood-chain',
      'ROBINHOOD_CHAIN_ID',
      'robinhoodChain',
    ]) {
      expect(hit(PATTERNS.chainName, text), text).toBe(true);
    }
    expect(hit(PATTERNS.chainName, 'Robinhood Markets API')).toBe(false);
    expect(hit(PATTERNS.chainName, 'https://robinhoodchain.blockscout.com')).toBe(false);
    expect(hit(PATTERNS.chainName, 'Built for Robinhood Chain.')).toBe(true);
  });

  it('testnet patterns never match mainnet values and vice versa', () => {
    expect(hit(PATTERNS.testnet.configChainId, 'chainId: 46630')).toBe(true);
    expect(hit(PATTERNS.testnet.configChainId, 'chainId: 0xb626')).toBe(true);
    expect(hit(PATTERNS.testnet.configChainId, 'chainId: 4663')).toBe(false);
    expect(hit(PATTERNS.testnet.caip2, 'eip155:46630')).toBe(true);
  });

  it('chain id values for env templates', () => {
    expect(isChainIdValue('4663')).toBe(true);
    expect(isChainIdValue('0x1237')).toBe(true);
    expect(isChainIdValue('46630')).toBe(false);
    expect(isChainIdValue(' 4663')).toBe(false);
  });
});
