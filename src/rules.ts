/**
 * chainprint's rules: what counts as a Robinhood Chain marker, how much it
 * weighs, and how the weights become a confidence.
 *
 * Everything here is built from public chain facts only: the chain id 4663
 * (hex 0x1237), its CAIP-2 id `eip155:4663`, the public RPC and explorer
 * hostnames, the file layouts public deploy tools write, and the public
 * infrastructure addresses listed in `data/known-addresses.json`.
 *
 * The formula is deliberately simple so that anyone can recompute it by hand:
 *
 *   score = the sum of the weights of the distinct counted rules that matched
 *           (a rule counts once, however many files it matched)
 *   HIGH   score >= 60 and at least one config- or deployment-tier marker
 *   MEDIUM score >= 25
 *   LOW    score >= 1
 *   NONE   score = 0
 *
 * Changing a weight, a band or a pattern is a change of `RULES_VERSION`.
 */
import { CAIP2, CHAIN_ID, PUBLIC_RPC_HOST } from './chain';

export const RULES_VERSION = 'chainprint-rules/1' as const;
export const OUTPUT_SCHEMA = 'chainprint/v1' as const;

/** The explorer's hostname (from `EXPLORER_URL`). */
export const EXPLORER_HOST = 'robinhoodchain.blockscout.com' as const;
/** 4663 in hexadecimal, as EIP-155 / EIP-3085 tooling writes it. */
export const CHAIN_ID_HEX = '0x1237' as const;
/**
 * Robinhood Chain's public testnet. Sourcify's chain list carries it as a
 * separate chain; chainprint reports it, labelled, and never counts it.
 */
export const TESTNET_CHAIN_ID = 46630 as const;
export const TESTNET_CHAIN_ID_HEX = '0xb626' as const;

export const TIERS = [
  'deployment',
  'config',
  'code',
  'environment',
  'package',
  'mention',
  'context',
] as const;
export type Tier = (typeof TIERS)[number];

/** Tiers that can anchor a HIGH confidence. */
export const ANCHOR_TIERS: readonly Tier[] = ['deployment', 'config'];

export const RULE_IDS = [
  'foundry-broadcast',
  'hardhat-deploy',
  'ignition-deployment',
  'chain-id-config',
  'chain-id-code',
  'caip2',
  'rpc-host',
  'known-address',
  'env-template',
  'explorer-host',
  'package-metadata',
  'chain-name',
  'doc-mention',
  'testnet-marker',
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type RuleDefinition = {
  id: RuleId;
  weight: number;
  tier: Tier;
  /** Whether the rule contributes to the score. Only the testnet marker does not. */
  counted: boolean;
  /** One line, used as the evidence label. */
  title: string;
  /** Which files the rule reads. */
  reads: string;
  /** What it matches, precisely enough to recompute by hand. */
  matches: string;
};

/** The rule table, in output order. */
export const RULES: readonly RuleDefinition[] = [
  {
    id: 'foundry-broadcast',
    weight: 45,
    tier: 'deployment',
    counted: true,
    title: 'Foundry broadcast record for chain 4663',
    reads: 'broadcast/<script>/4663/run-*.json',
    matches:
      'A Foundry broadcast file in a chain-4663 folder that parses as JSON with a "transactions" array and, when it carries a "chain" field, says 4663. Dry runs (dry-run/) are not deployment records.',
  },
  {
    id: 'hardhat-deploy',
    weight: 45,
    tier: 'deployment',
    counted: true,
    title: 'hardhat-deploy network folder for chain 4663',
    reads: 'deployments/<network>/.chainId',
    matches: 'A hardhat-deploy .chainId file whose whole content is 4663.',
  },
  {
    id: 'ignition-deployment',
    weight: 45,
    tier: 'deployment',
    counted: true,
    title: 'Hardhat Ignition deployment for chain 4663',
    reads: 'ignition/deployments/chain-4663/deployed_addresses.json',
    matches:
      'An Ignition deployed_addresses.json in the chain-4663 folder that parses as a JSON object.',
  },
  {
    id: 'chain-id-config',
    weight: 40,
    tier: 'config',
    counted: true,
    title: 'chain id 4663 in a toolchain config',
    reads:
      'hardhat.config.*, foundry.toml, truffle-config.js, truffle.js, wagmi.config.*, and any JS/TS file that calls defineChain(',
    matches:
      'A chain-id key (chainId, chain_id, chainID, networkId, network_id, chain) assigned 4663 or 0x1237; in a defineChain file also `id: 4663`; in a Hardhat 3 config with chainDescriptors also a `4663: {` entry.',
  },
  {
    id: 'chain-id-code',
    weight: 20,
    tier: 'code',
    counted: true,
    title: 'chain id 4663 in source or data',
    reads:
      'source and data files that are not toolchain configs, deployment records or env templates',
    matches:
      'An identifier or key containing "chainid" or "chain_id" compared with or assigned 4663 or 0x1237 (chainId: 4663, CHAIN_ID = 4663, block.chainid == 4663), or an ethers provider/network built with 4663.',
  },
  {
    id: 'caip2',
    weight: 20,
    tier: 'code',
    counted: true,
    title: 'CAIP-2 chain id eip155:4663',
    reads: 'source, data and config files',
    matches: 'The string eip155:4663 not followed by another digit.',
  },
  {
    id: 'rpc-host',
    weight: 20,
    tier: 'code',
    counted: true,
    title: 'Robinhood Chain public RPC hostname',
    reads: 'source, data and config files',
    matches: `The hostname ${PUBLIC_RPC_HOST}.`,
  },
  {
    id: 'known-address',
    weight: 20,
    tier: 'code',
    counted: true,
    title: 'known Robinhood Chain infrastructure address',
    reads: 'every file chainprint reads except documentation',
    matches:
      'A 0x-prefixed 40-hex-digit address equal (case-insensitively) to an entry in data/known-addresses.json: public factories, the Uniswap v4 PoolManager, a launch router. Each entry cites its public source.',
  },
  {
    id: 'env-template',
    weight: 15,
    tier: 'environment',
    counted: true,
    title: 'Robinhood Chain setting in an env template',
    reads:
      '.env.example, .env.sample, .env.template, .env.dist, .env.defaults (and .env.<name>.example), example.env',
    matches:
      'A KEY=value line whose key contains ROBINHOOD, or whose key contains CHAIN_ID / CHAINID with the value 4663 or 0x1237, or whose value names the public RPC or explorer host or eip155:4663. Values are never printed unless they are the public marker itself.',
  },
  {
    id: 'explorer-host',
    weight: 10,
    tier: 'code',
    counted: true,
    title: 'Robinhood Chain explorer hostname',
    reads: 'source, data and config files',
    matches: `The hostname ${EXPLORER_HOST}.`,
  },
  {
    id: 'package-metadata',
    weight: 10,
    tier: 'package',
    counted: true,
    title: 'Robinhood Chain in package.json metadata',
    reads: 'package.json',
    matches:
      'A keyword equal to robinhood-chain, robinhoodchain, robinhood chain or eip155:4663; a dependency whose name contains robinhood-chain or robinhoodchain; or a name/description containing "Robinhood Chain".',
  },
  {
    id: 'chain-name',
    weight: 5,
    tier: 'mention',
    counted: true,
    title: 'the name Robinhood Chain in code',
    reads: 'source, data and config files except package.json',
    matches:
      'The words "Robinhood Chain" (any case, joined by a space, "-", "_" or nothing, as in robinhoodChain or ROBINHOOD_CHAIN).',
  },
  {
    id: 'doc-mention',
    weight: 5,
    tier: 'mention',
    counted: true,
    title: 'Robinhood Chain mentioned in documentation',
    reads:
      'documentation: *.md, *.mdx, *.markdown, *.rst, *.adoc, *.txt, and HEY declaration files (hey-project.json, hey-ship.json)',
    matches:
      'The name Robinhood Chain, eip155:4663, the public RPC or explorer hostname, or "chain id" followed by 4663. The weakest marker: anyone can write a README.',
  },
  {
    id: 'testnet-marker',
    weight: 0,
    tier: 'context',
    counted: false,
    title: 'Robinhood Chain testnet (46630)',
    reads: 'every file chainprint reads except documentation',
    matches:
      'The testnet chain id 46630 / 0xb626 where the mainnet rules would look for 4663 (chain-id keys, eip155:46630, broadcast/<script>/46630/, deployments/<network>/.chainId, ignition chain-46630), an env-template key naming TESTNET, or the words "Robinhood Chain testnet". A testnet is not Robinhood Chain mainnet; it never changes the score.',
  },
];

export const RULE_BY_ID: ReadonlyMap<RuleId, RuleDefinition> = new Map(
  RULES.map((rule) => [rule.id, rule]),
);

export const ruleOrder = (id: RuleId): number => RULE_IDS.indexOf(id);

export const CONFIDENCE_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export type ConfidenceBand = {
  level: Confidence;
  minScore: number;
  requiresAnchor: boolean;
  description: string;
};

/** Checked from the top; the first band whose conditions hold is the confidence. */
export const CONFIDENCE_BANDS: readonly ConfidenceBand[] = [
  {
    level: 'HIGH',
    minScore: 60,
    requiresAnchor: true,
    description: 'score >= 60 and at least one config- or deployment-tier marker',
  },
  { level: 'MEDIUM', minScore: 25, requiresAnchor: false, description: 'score >= 25' },
  { level: 'LOW', minScore: 1, requiresAnchor: false, description: 'score >= 1' },
  {
    level: 'NONE',
    minScore: 0,
    requiresAnchor: false,
    description: 'score = 0 (no counted marker)',
  },
];

export type ConfidenceResult = {
  confidence: Confidence;
  score: number;
  /** At least one counted marker of a deployment or config tier matched. */
  anchored: boolean;
};

/** The whole formula: distinct counted rules, summed once each, then the bands. */
export function computeConfidence(matchedRules: Iterable<RuleId>): ConfidenceResult {
  const distinct = new Set(matchedRules);
  let score = 0;
  let anchored = false;
  for (const id of distinct) {
    const rule = RULE_BY_ID.get(id);
    if (!rule || !rule.counted) continue;
    score += rule.weight;
    if (ANCHOR_TIERS.includes(rule.tier)) anchored = true;
  }
  for (const band of CONFIDENCE_BANDS) {
    if (score >= band.minScore && (!band.requiresAnchor || anchored)) {
      return { confidence: band.level, score, anchored };
    }
  }
  /* c8 ignore next */
  return { confidence: 'NONE', score, anchored };
}

/* -------------------------------------------------------------- patterns */

const N = `(?:${CHAIN_ID}|${CHAIN_ID_HEX})`;
const TN = `(?:${TESTNET_CHAIN_ID}|${TESTNET_CHAIN_ID_HEX})`;
/** A number ends where no digit, letter, dot or underscore follows (so 4663 never matches 46630 or 4663.5). */
const END = '(?![\\w.])';
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keys a toolchain config uses for a chain id. */
const configKey = (value: string): RegExp =>
  new RegExp(
    `(?<![\\w$])(?:chainId|chain_id|chainID|networkId|network_id|chain)["'\\]]?\\s*[:=]\\s*["']?${value}n?${END}`,
    'i',
  );
/** `id: 4663` inside a viem/wagmi `defineChain` file. */
const defineChainId = (value: string): RegExp =>
  new RegExp(`(?<![\\w$.])id["']?\\s*:\\s*["']?${value}n?${END}`, 'i');
/** Any identifier or key containing chainid / chain_id, compared or assigned. */
const codeKey = (value: string): RegExp =>
  new RegExp(
    `[\\w$.]*chain[_-]?id[\\w$]*["'\\]]?\\s*(?:===?|!==?|:=|=|:)\\s*["']?${value}n?${END}`,
    'i',
  );
/** A numeric object key `4663: {` — a Hardhat 3 `chainDescriptors` entry. */
const descriptorKey = (value: string): RegExp =>
  new RegExp(`(?<![\\w$.'"])["']?${value}["']?\\s*:\\s*\\{`);
/** ethers: new JsonRpcProvider(url, 4663), Network.from(4663), getDefaultProvider(4663). */
const ethersNetwork = (value: string): RegExp =>
  new RegExp(
    `(?:JsonRpcProvider|WebSocketProvider|StaticJsonRpcProvider|Network\\.from|getDefaultProvider)\\s*\\([^)]*?(?<![\\w.])${value}${END}`,
  );

/** A hostname as a whole label sequence: not a suffix of a longer name, not the prefix of a look-alike. */
const hostPattern = (host: string): RegExp =>
  new RegExp(`(?<![\\w.-])${escapeRe(host)}(?![\\w-]|\\.[\\w-])`, 'i');

export const PATTERNS = {
  configChainId: configKey(N),
  defineChainCall: /\bdefineChain\s*\(/,
  defineChainId: defineChainId(N),
  chainDescriptors: /\bchainDescriptors\s*:/,
  descriptorKey: descriptorKey(N),
  codeChainId: codeKey(N),
  ethersNetwork: ethersNetwork(N),
  caip2: new RegExp(`${escapeRe(CAIP2)}(?!\\d)`, 'i'),
  rpcHost: hostPattern(PUBLIC_RPC_HOST),
  explorerHost: hostPattern(EXPLORER_HOST),
  /** Not when it is a hostname label (robinhoodchain.blockscout.com is the explorer rule's). */
  chainName: /robinhood[\s_-]?chain(?![\w-]*\.[a-z])(?![\s_-]*testnet)/i,
  docChainId: new RegExp(`chain[\\s_-]?id\\W{0,4}${N}${END}`, 'i'),
  /** Any 0x address not embedded in a longer hex string. */
  address: /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-zA-Z])/g,
  testnet: {
    configChainId: configKey(TN),
    defineChainId: defineChainId(TN),
    descriptorKey: descriptorKey(TN),
    codeChainId: codeKey(TN),
    ethersNetwork: ethersNetwork(TN),
    caip2: new RegExp(`eip155:${TESTNET_CHAIN_ID}(?!\\d)`, 'i'),
    /** "Robinhood Chain testnet", ROBINHOOD_CHAIN_TESTNET. */
    chainName: /robinhood[\s_-]?chain[\s_-]*testnet/i,
  },
} as const;

/** Values an env template may carry for the chain id. */
export const isChainIdValue = (value: string): boolean => new RegExp(`^${N}$`, 'i').test(value);
export const isTestnetChainIdValue = (value: string): boolean =>
  new RegExp(`^${TN}$`, 'i').test(value);
