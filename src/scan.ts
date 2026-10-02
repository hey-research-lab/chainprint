/**
 * The scanner: read a tree with `walkTree`, give each file one class, apply
 * the rules that read that class line by line, and fold the matches into a
 * deterministic report.
 *
 * A marker is evidence, not identity proof: the report says which markers
 * were found where, never who owns the code or which project it is.
 */
import { realpathSync, statSync } from 'node:fs';
import { z } from 'zod';
import { CAIP2, CHAIN_ID, CHAIN_NAME } from './chain';
import { knownAddress } from './known-addresses';
import {
  computeConfidence,
  isChainIdValue,
  isTestnetChainIdValue,
  OUTPUT_SCHEMA,
  PATTERNS,
  RULE_BY_ID,
  ruleOrder,
  RULES_VERSION,
  TESTNET_CHAIN_ID,
  type Confidence,
  type RuleId,
  type Tier,
} from './rules';
import { cleanPath, excerpt } from './text';
import { VERSION } from './version';
import {
  DEFAULT_LIMITS,
  ENV_TEMPLATE_NAME,
  walkTree,
  type SkipReason,
  type WalkedFile,
  type WalkLimits,
} from './walk';

export const NOTICE =
  'A marker is evidence, not identity proof. It shows that code targets Robinhood Chain; it does not show who owns the code or any contract, that the repository is a project, or that a project is legitimate.';

export type EvidenceItem = {
  rule: RuleId;
  tier: Tier;
  weight: number;
  counted: boolean;
  /** Root-relative path, `/`-separated. */
  file: string;
  /** 1-based line of the match. */
  line: number;
  /** The matched line, redacted and truncated; never more of the file. */
  excerpt: string;
  /** What was matched, in words. */
  detail: string;
};

export type RuleSummary = {
  rule: RuleId;
  tier: Tier;
  weight: number;
  counted: boolean;
  /** Evidence items found for the rule. */
  items: number;
  /** Items listed in `evidence` (at most the item limit). */
  shown: number;
};

export type ScanReport = {
  schema: typeof OUTPUT_SCHEMA;
  ok: true;
  tool: { name: 'chainprint'; version: string; rules: typeof RULES_VERSION };
  chain: { name: typeof CHAIN_NAME; chainId: typeof CHAIN_ID; caip2: typeof CAIP2 };
  /** The path as it was given to chainprint. */
  root: string;
  result: 'evidence_found' | 'no_evidence_found';
  confidence: Confidence;
  score: number;
  anchored: boolean;
  rules: RuleSummary[];
  evidence: EvidenceItem[];
  scan: {
    filesRead: number;
    /** False when a limit stopped the walk: markers in unread files are unknown, not absent. */
    complete: boolean;
    incomplete: ('file-limit' | 'byte-limit')[];
    skipped: {
      total: number;
      byReason: Partial<Record<SkipReason, number>>;
      shown: { path: string; reason: SkipReason }[];
    };
    limits: WalkLimits & { itemsPerRule: number };
  };
  notice: string;
};

export type ScanOptions = {
  limits?: Partial<WalkLimits>;
  /** Evidence items listed per rule (the summary still counts all of them). Default 20. */
  itemsPerRule?: number;
  /** How the root is shown in the report. Defaults to the argument as given. */
  displayRoot?: string;
};

export const DEFAULT_ITEMS_PER_RULE = 20;
export const MAX_ITEMS_PER_RULE = 1000;
const MAX_SKIPPED_SHOWN = 50;
/** Skip reasons worth listing path by path; the rest (file types never read) are only counted. */
const LISTED_SKIP_REASONS: ReadonlySet<SkipReason> = new Set<SkipReason>([
  'ignored-directory',
  'foundry-library',
  'depth-limit',
  'symlink',
  'not-a-regular-file',
  'env-file',
  'too-large',
  'binary',
  'unreadable',
  'file-limit',
  'byte-limit',
]);

export class ChainprintError extends Error {
  constructor(
    readonly code: 'invalid_path' | 'not_a_directory' | 'unreadable_root',
    message: string,
  ) {
    super(message);
  }
}

/* ---------------------------------------------------------- file classes */

type FileClass =
  | {
      kind: 'deployment';
      rule: 'foundry-broadcast' | 'hardhat-deploy' | 'ignition-deployment';
      chain: number;
    }
  | { kind: 'env-template' }
  | { kind: 'documentation' }
  | { kind: 'config' }
  | { kind: 'package' }
  | { kind: 'source' };

/** Folders whose deploy records are someone's test data, not this repository's deployments. */
const TEST_DATA_SEGMENT =
  /(?:^|\/)(?:test|tests|__tests__|testdata|test-data|test_data|fixtures?|__fixtures__|mocks?|examples?|samples?)\//i;
const FOUNDRY_BROADCAST = /(?:^|\/)broadcast\/[^/]+\/(\d+)\/run-[^/]+\.json$/;
const HARDHAT_CHAIN_ID = /(?:^|\/)deployments\/[^/]+\/\.chainId$/;
const IGNITION_ADDRESSES = /(?:^|\/)ignition\/deployments\/chain-(\d+)\/deployed_addresses\.json$/;
const CONFIG_NAME =
  /^(?:hardhat\.config\.[cm]?[jt]s|foundry\.toml|truffle-config\.js|truffle\.js|wagmi\.config\.[cm]?[jt]sx?)$/;
const JS_LIKE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i;
const DOC_EXT = /\.(?:md|mdx|markdown|rst|adoc|txt)$/i;
/** HEY's own declaration files: what a builder says about the project, read like a README. */
const HEY_DECLARATION = /^hey-(?:project|ship)\.json$/;

function classify(file: WalkedFile): FileClass {
  const recordable = !TEST_DATA_SEGMENT.test(file.path);
  if (recordable) {
    const broadcast = FOUNDRY_BROADCAST.exec(file.path);
    if (broadcast)
      return { kind: 'deployment', rule: 'foundry-broadcast', chain: Number(broadcast[1]) };
    if (HARDHAT_CHAIN_ID.test(file.path)) {
      const value = file.text.trim();
      return {
        kind: 'deployment',
        rule: 'hardhat-deploy',
        chain: /^\d{1,12}$/.test(value) ? Number(value) : Number.NaN,
      };
    }
    const ignition = IGNITION_ADDRESSES.exec(file.path);
    if (ignition)
      return { kind: 'deployment', rule: 'ignition-deployment', chain: Number(ignition[1]) };
  }
  if (ENV_TEMPLATE_NAME.test(file.name)) return { kind: 'env-template' };
  if (DOC_EXT.test(file.name) || HEY_DECLARATION.test(file.name)) return { kind: 'documentation' };
  if (file.name === 'package.json') return { kind: 'package' };
  if (CONFIG_NAME.test(file.name)) return { kind: 'config' };
  if (JS_LIKE.test(file.name) && PATTERNS.defineChainCall.test(file.text))
    return { kind: 'config' };
  return { kind: 'source' };
}

/* -------------------------------------------------------------- matching */

type Match = {
  rule: RuleId;
  line: number;
  matched: string;
  detail: string;
  excerptOverride?: string;
};

/** Parse untrusted JSON without letting it name prototype keys. */
function parseJson(text: string): unknown {
  return JSON.parse(text, (key, value: unknown) =>
    key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value,
  );
}

const foundryBroadcastSchema = z
  .object({ transactions: z.array(z.unknown()), chain: z.number().optional() })
  .passthrough();
const ignitionSchema = z.record(z.string(), z.unknown());
const packageSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    keywords: z.array(z.unknown()).optional(),
    dependencies: z.record(z.string(), z.unknown()).optional(),
    devDependencies: z.record(z.string(), z.unknown()).optional(),
    peerDependencies: z.record(z.string(), z.unknown()).optional(),
    optionalDependencies: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const lineOf = (lines: readonly string[], needle: RegExp): number => {
  const index = lines.findIndex((line) => needle.test(line));
  return index >= 0 ? index + 1 : 1;
};

function deploymentMatches(
  file: WalkedFile,
  cls: Extract<FileClass, { kind: 'deployment' }>,
  lines: readonly string[],
): Match[] {
  const isMainnet = cls.chain === CHAIN_ID;
  const isTestnet = cls.chain === TESTNET_CHAIN_ID;
  if (!isMainnet && !isTestnet) return [];
  if (cls.rule === 'hardhat-deploy') {
    const line = 1;
    return [
      isMainnet
        ? { rule: 'hardhat-deploy', line, matched: String(CHAIN_ID), detail: '.chainId is 4663' }
        : {
            rule: 'testnet-marker',
            line,
            matched: String(TESTNET_CHAIN_ID),
            detail: 'hardhat-deploy .chainId is 46630 (testnet)',
          },
    ];
  }
  let parsed: unknown;
  try {
    parsed = parseJson(file.text);
  } catch {
    return [];
  }
  if (cls.rule === 'foundry-broadcast') {
    const record = foundryBroadcastSchema.safeParse(parsed);
    if (!record.success) return [];
    if (record.data.chain !== undefined && record.data.chain !== cls.chain) return [];
    const line = record.data.chain !== undefined ? lineOf(lines, /"chain"\s*:/) : 1;
    const txs = record.data.transactions.length;
    return [
      isMainnet
        ? {
            rule: 'foundry-broadcast',
            line,
            matched: '"chain"',
            detail: `Foundry broadcast for chain 4663 with ${txs} transaction${txs === 1 ? '' : 's'}`,
          }
        : {
            rule: 'testnet-marker',
            line,
            matched: '"chain"',
            detail: 'Foundry broadcast for chain 46630 (testnet)',
          },
    ];
  }
  const record = ignitionSchema.safeParse(parsed);
  if (!record.success || Array.isArray(parsed)) return [];
  const count = Object.keys(record.data).length;
  return [
    isMainnet
      ? {
          rule: 'ignition-deployment',
          line: 1,
          matched: '{',
          detail: `Ignition deployment for chain 4663 listing ${count} contract${count === 1 ? '' : 's'}`,
        }
      : {
          rule: 'testnet-marker',
          line: 1,
          matched: '{',
          detail: 'Ignition deployment for chain 46630 (testnet)',
        },
  ];
}

function knownAddressMatches(lines: readonly string[]): Match[] {
  const out: Match[] = [];
  lines.forEach((text, i) => {
    const seen = new Set<string>();
    for (const m of text.matchAll(PATTERNS.address)) {
      const entry = knownAddress(m[0]);
      if (!entry || seen.has(entry.address)) continue;
      seen.add(entry.address);
      out.push({
        rule: 'known-address',
        line: i + 1,
        matched: m[0],
        detail: `${entry.name} (${entry.address}; source: ${entry.sources[0]})`,
      });
    }
  });
  return out;
}

const firstMatch = (re: RegExp, text: string): string | undefined => re.exec(text)?.[0];
const shortMatch = (matched: string): string => {
  const clean = cleanPath(matched.trim());
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
};

function lineRules(cls: FileClass['kind'], lines: readonly string[]): Match[] {
  const out: Match[] = [];
  const isConfig = cls === 'config';
  /** Hardhat 3 declares chains as numeric keys of `chainDescriptors: { 4663: { … } }`. */
  const descriptors = isConfig && lines.some((l) => PATTERNS.chainDescriptors.test(l));
  const nameRule = cls !== 'package';
  lines.forEach((text, i) => {
    const line = i + 1;
    const push = (rule: RuleId, matched: string | undefined, _label: string): void => {
      if (matched !== undefined)
        out.push({ rule, line, matched, detail: `matched "${shortMatch(matched)}"` });
    };
    if (isConfig) {
      push(
        'chain-id-config',
        firstMatch(PATTERNS.configChainId, text) ??
          firstMatch(PATTERNS.defineChainId, text) ??
          (descriptors ? firstMatch(PATTERNS.descriptorKey, text) : undefined),
        'chain id 4663 in a toolchain config',
      );
      push(
        'testnet-marker',
        firstMatch(PATTERNS.testnet.configChainId, text) ??
          firstMatch(PATTERNS.testnet.defineChainId, text) ??
          (descriptors ? firstMatch(PATTERNS.testnet.descriptorKey, text) : undefined),
        'chain id 46630 (testnet) in a toolchain config',
      );
    } else {
      push(
        'chain-id-code',
        firstMatch(PATTERNS.codeChainId, text) ?? firstMatch(PATTERNS.ethersNetwork, text),
        'chain id 4663 in code or data',
      );
      push(
        'testnet-marker',
        firstMatch(PATTERNS.testnet.codeChainId, text) ??
          firstMatch(PATTERNS.testnet.ethersNetwork, text),
        'chain id 46630 (testnet) in code or data',
      );
    }
    push('caip2', firstMatch(PATTERNS.caip2, text), 'CAIP-2 id eip155:4663');
    push(
      'testnet-marker',
      firstMatch(PATTERNS.testnet.caip2, text),
      'CAIP-2 id eip155:46630 (testnet)',
    );
    push('rpc-host', firstMatch(PATTERNS.rpcHost, text), 'public RPC hostname');
    push('explorer-host', firstMatch(PATTERNS.explorerHost, text), 'explorer hostname');
    if (nameRule) {
      push('chain-name', firstMatch(PATTERNS.chainName, text), 'the name Robinhood Chain');
      push(
        'testnet-marker',
        firstMatch(PATTERNS.testnet.chainName, text),
        'Robinhood Chain testnet',
      );
    }
  });
  return out;
}

function docMatches(lines: readonly string[]): Match[] {
  const out: Match[] = [];
  const patterns = [
    PATTERNS.chainName,
    PATTERNS.caip2,
    PATTERNS.rpcHost,
    PATTERNS.explorerHost,
    PATTERNS.docChainId,
  ];
  lines.forEach((text, i) => {
    const testnet = firstMatch(PATTERNS.testnet.chainName, text);
    if (testnet !== undefined)
      out.push({
        rule: 'testnet-marker',
        line: i + 1,
        matched: testnet,
        detail: `"${testnet}" in documentation`,
      });
    for (const re of patterns) {
      const matched = firstMatch(re, text);
      if (matched !== undefined) {
        out.push({
          rule: 'doc-mention',
          line: i + 1,
          matched,
          detail: `"${matched}" in documentation`,
        });
        return;
      }
    }
  });
  return out;
}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/;
const unquote = (value: string): string => value.replace(/^(['"])(.*)\1$/, '$2').trim();

function envMatches(lines: readonly string[]): Match[] {
  const out: Match[] = [];
  lines.forEach((text, i) => {
    const m = ENV_LINE.exec(text);
    if (!m) return;
    const key = m[1] ?? '';
    const value = unquote((m[2] ?? '').replace(/\s+#.*$/, ''));
    const chainKey = /CHAIN_?ID/i.test(key);
    const publicValue =
      PATTERNS.rpcHost.test(value) ||
      PATTERNS.explorerHost.test(value) ||
      PATTERNS.caip2.test(value);
    const shown = (v: string): string => `${key}=${v}`;
    const line = i + 1;
    if (chainKey && isTestnetChainIdValue(value)) {
      out.push({
        rule: 'testnet-marker',
        line,
        matched: key,
        detail: `${key} is 46630 (testnet)`,
        excerptOverride: shown(value),
      });
      return;
    }
    if (PATTERNS.testnet.caip2.test(value)) {
      out.push({
        rule: 'testnet-marker',
        line,
        matched: key,
        detail: `${key} names eip155:46630 (testnet)`,
        excerptOverride: shown('eip155:46630'),
      });
      return;
    }
    if (/TESTNET/i.test(key) && (chainKey || /ROBINHOOD/i.test(key) || publicValue)) {
      out.push({
        rule: 'testnet-marker',
        line,
        matched: key,
        detail: `${key} is a testnet setting`,
        excerptOverride: shown(value === '' ? '' : '<redacted>'),
      });
      return;
    }
    if (chainKey && isChainIdValue(value)) {
      out.push({
        rule: 'env-template',
        line,
        matched: key,
        detail: `${key} is 4663`,
        excerptOverride: shown(value),
      });
    } else if (publicValue) {
      out.push({
        rule: 'env-template',
        line,
        matched: key,
        detail: `${key} names a public Robinhood Chain endpoint`,
        excerptOverride: shown(value),
      });
    } else if (/ROBINHOOD/i.test(key)) {
      out.push({
        rule: 'env-template',
        line,
        matched: key,
        detail: `${key} is a Robinhood Chain setting`,
        excerptOverride: shown(value === '' ? '' : '<redacted>'),
      });
    }
  });
  return out;
}

const PACKAGE_KEYWORDS = new Set([
  'robinhood-chain',
  'robinhoodchain',
  'robinhood chain',
  'eip155:4663',
]);
const PACKAGE_DEPENDENCY = /robinhood-?chain/i;
const jsonKeyLine = (key: string): RegExp =>
  new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);

function packageMatches(file: WalkedFile, lines: readonly string[]): Match[] {
  let parsed: unknown;
  try {
    parsed = parseJson(file.text);
  } catch {
    return [];
  }
  const pkg = packageSchema.safeParse(parsed);
  if (!pkg.success || Array.isArray(parsed)) return [];
  const out: Match[] = [];
  for (const keyword of pkg.data.keywords ?? []) {
    if (typeof keyword === 'string' && PACKAGE_KEYWORDS.has(keyword.trim().toLowerCase())) {
      out.push({
        rule: 'package-metadata',
        line: lineOf(lines, jsonKeyLine(keyword)),
        matched: keyword,
        detail: `keyword "${keyword}"`,
      });
    }
  }
  const groups = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const;
  for (const group of groups) {
    for (const dep of Object.keys(pkg.data[group] ?? {}).sort()) {
      if (PACKAGE_DEPENDENCY.test(dep)) {
        out.push({
          rule: 'package-metadata',
          line: lineOf(lines, jsonKeyLine(dep)),
          matched: dep,
          detail: `${group} names ${dep}`,
        });
      }
    }
  }
  for (const field of ['name', 'description'] as const) {
    const value = pkg.data[field];
    if (typeof value === 'string' && PATTERNS.chainName.test(value)) {
      out.push({
        rule: 'package-metadata',
        line: lineOf(lines, jsonKeyLine(field)),
        matched: 'robinhood',
        detail: `${field} mentions Robinhood Chain`,
      });
    }
  }
  return out;
}

function matchFile(file: WalkedFile, lines: readonly string[]): Match[] {
  const cls = classify(file);
  switch (cls.kind) {
    case 'deployment':
      // A known address in another chain's record (a testnet run) is not a mainnet marker.
      return [
        ...deploymentMatches(file, cls, lines),
        ...(cls.chain === CHAIN_ID ? knownAddressMatches(lines) : []),
      ];
    case 'env-template':
      return [...envMatches(lines), ...knownAddressMatches(lines)];
    case 'documentation':
      return docMatches(lines);
    case 'package':
      return [
        ...packageMatches(file, lines),
        ...lineRules('package', lines),
        ...knownAddressMatches(lines),
      ];
    case 'config':
    case 'source':
      return [...lineRules(cls.kind, lines), ...knownAddressMatches(lines)];
  }
}

/* ---------------------------------------------------------------- report */

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function compareEvidence(a: EvidenceItem, b: EvidenceItem): number {
  return (
    ruleOrder(a.rule) - ruleOrder(b.rule) ||
    byCodeUnit(a.file, b.file) ||
    a.line - b.line ||
    byCodeUnit(a.detail, b.detail)
  );
}

/**
 * Scan a local directory. Synchronous, offline and read-only: it opens files
 * for reading and nothing else.
 */
export function scanDirectory(root: string, options: ScanOptions = {}): ScanReport {
  const limits: WalkLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const itemsPerRule = Math.min(
    MAX_ITEMS_PER_RULE,
    Math.max(1, Math.floor(options.itemsPerRule ?? DEFAULT_ITEMS_PER_RULE)),
  );

  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    throw new ChainprintError('invalid_path', `No such directory: ${cleanPath(root)}`);
  }
  let isDir: boolean;
  try {
    isDir = statSync(real).isDirectory();
  } catch {
    throw new ChainprintError('unreadable_root', `Cannot read ${cleanPath(root)}`);
  }
  if (!isDir) throw new ChainprintError('not_a_directory', `Not a directory: ${cleanPath(root)}`);

  const walked = walkTree(real, limits);

  const all: EvidenceItem[] = [];
  const dedupe = new Set<string>();
  for (const file of walked.files) {
    const lines = file.text.split('\n');
    for (const match of matchFile(file, lines)) {
      const rule = RULE_BY_ID.get(match.rule);
      if (!rule) continue;
      const key = `${match.rule}\u0000${file.path}\u0000${match.line}\u0000${match.detail}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      all.push({
        rule: rule.id,
        tier: rule.tier,
        weight: rule.weight,
        counted: rule.counted,
        file: cleanPath(file.path),
        line: match.line,
        excerpt: excerpt(match.excerptOverride ?? lines[match.line - 1] ?? '', match.matched),
        detail: match.detail,
      });
    }
  }
  all.sort(compareEvidence);

  const perRule = new Map<RuleId, EvidenceItem[]>();
  for (const item of all) {
    const list = perRule.get(item.rule) ?? [];
    list.push(item);
    perRule.set(item.rule, list);
  }
  const rules: RuleSummary[] = [];
  const evidence: EvidenceItem[] = [];
  for (const [id, items] of [...perRule.entries()].sort(
    (a, b) => ruleOrder(a[0]) - ruleOrder(b[0]),
  )) {
    const rule = RULE_BY_ID.get(id);
    if (!rule) continue;
    const shown = items.slice(0, itemsPerRule);
    evidence.push(...shown);
    rules.push({
      rule: id,
      tier: rule.tier,
      weight: rule.weight,
      counted: rule.counted,
      items: items.length,
      shown: shown.length,
    });
  }

  const { confidence, score, anchored } = computeConfidence(rules.map((r) => r.rule));

  const byReason: Partial<Record<SkipReason, number>> = {};
  for (const s of walked.skipped) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
  const orderedReasons = Object.keys(byReason).sort(byCodeUnit) as SkipReason[];
  const sortedByReason: Partial<Record<SkipReason, number>> = {};
  for (const reason of orderedReasons) sortedByReason[reason] = byReason[reason];
  const listed = walked.skipped
    .filter((s) => LISTED_SKIP_REASONS.has(s.reason))
    .map((s) => ({ path: cleanPath(s.path), reason: s.reason }))
    .sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.reason, b.reason))
    .slice(0, MAX_SKIPPED_SHOWN);

  return {
    schema: OUTPUT_SCHEMA,
    ok: true,
    tool: { name: 'chainprint', version: VERSION, rules: RULES_VERSION },
    chain: { name: CHAIN_NAME, chainId: CHAIN_ID, caip2: CAIP2 },
    root: cleanPath(options.displayRoot ?? root),
    result: score > 0 ? 'evidence_found' : 'no_evidence_found',
    confidence,
    score,
    anchored,
    rules,
    evidence,
    scan: {
      filesRead: walked.files.length,
      complete: walked.incomplete.length === 0,
      incomplete: [...new Set(walked.incomplete)],
      skipped: { total: walked.skipped.length, byReason: sortedByReason, shown: listed },
      limits: { ...limits, itemsPerRule },
    },
    notice: NOTICE,
  };
}
