/**
 * Human output for a scan and for `chainprint explain`. Plain text; emphasis
 * is optional and never carries meaning on its own.
 */
import { CAIP2, CHAIN_ID, CHAIN_NAME, PUBLIC_RPC_HOST } from './chain';
import { KNOWN_ADDRESS_DATA } from './known-addresses';
import {
  ANCHOR_TIERS,
  CONFIDENCE_BANDS,
  EXPLORER_HOST,
  OUTPUT_SCHEMA,
  RULES,
  RULES_VERSION,
  TESTNET_CHAIN_ID,
} from './rules';
import { NOTICE, type ScanReport } from './scan';
import { VERSION } from './version';
import {
  DEFAULT_LIMITS,
  SKIPPED_DIRECTORIES,
  SKIPPED_FILES,
  TEXT_EXTENSIONS,
  TEXT_NAMES,
  type SkipReason,
} from './walk';

export type Style = { bold: (s: string) => string };
export const PLAIN: Style = { bold: (s) => s };
export const ANSI: Style = { bold: (s) => `\u001b[1m${s}\u001b[22m` };

const SKIP_WORDS: Record<SkipReason, [string, string]> = {
  'ignored-directory': ['ignored directory', 'ignored directories'],
  'foundry-library': ['Foundry library folder', 'Foundry library folders'],
  'depth-limit': ['entry below the depth limit', 'entries below the depth limit'],
  symlink: ['symbolic link (not followed)', 'symbolic links (not followed)'],
  'not-a-regular-file': ['special file', 'special files'],
  'env-file': ['.env file (never read)', '.env files (never read)'],
  lockfile: ['lockfile', 'lockfiles'],
  minified: ['minified file', 'minified files'],
  'not-text': ['file of a type not read', 'files of a type not read'],
  'too-large': ['file over the size limit', 'files over the size limit'],
  binary: ['binary file', 'binary files'],
  unreadable: ['unreadable entry', 'unreadable entries'],
  'file-limit': ['entry after the file limit', 'entries after the file limit'],
  'byte-limit': ['entry after the byte limit', 'entries after the byte limit'],
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function formatReport(report: ScanReport, style: Style = PLAIN): string {
  const out: string[] = [];
  const counted = report.evidence.filter((e) => e.counted);
  const context = report.evidence.filter((e) => !e.counted);
  const summary = new Map(report.rules.map((r) => [r.rule, r]));

  out.push(
    report.result === 'evidence_found'
      ? style.bold(`${CHAIN_NAME} evidence found`)
      : style.bold(
          `No ${CHAIN_NAME} marker found in the ${plural(report.scan.filesRead, 'file')} chainprint read`,
        ),
  );
  const why =
    report.confidence === 'HIGH'
      ? 'with a config- or deployment-level marker'
      : report.score >= 60 && !report.anchored
        ? 'no config- or deployment-level marker, so not HIGH'
        : '';
  out.push(
    `Confidence: ${style.bold(report.confidence)} (score ${report.score}${why ? `; ${why}` : ''})`,
  );
  out.push('');

  const section = (title: string, items: typeof report.evidence): void => {
    if (items.length === 0) return;
    out.push(title);
    let current = '';
    for (const item of items) {
      if (item.rule !== current) {
        current = item.rule;
        const rule = RULES.find((r) => r.id === item.rule);
        const s = summary.get(item.rule);
        const more = s && s.items > s.shown ? ` (showing ${s.shown} of ${s.items})` : '';
        const weight = item.counted ? `+${item.weight}` : 'not counted';
        out.push(`  - ${rule?.title ?? item.rule} [${item.rule}, ${item.tier}, ${weight}]${more}`);
      }
      out.push(`      ${item.file}:${item.line}  ${item.excerpt}`);
      out.push(`        ${item.detail}`);
    }
    out.push('');
  };
  section('Evidence:', counted);
  section('Reported, not counted:', context);

  const skipped = Object.entries(report.scan.skipped.byReason)
    .map(([reason, n]) => {
      const [one, many] = SKIP_WORDS[reason as SkipReason];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(', ');
  out.push(
    `Read ${plural(report.scan.filesRead, 'file')}` +
      (report.scan.skipped.total > 0
        ? `; skipped ${report.scan.skipped.total} (${skipped}).`
        : '.'),
  );
  if (!report.scan.complete) {
    out.push(
      `The scan stopped at the ${report.scan.incomplete.join(' and ')}: markers in files chainprint did not read are not measured — unknown, not absent.`,
    );
  }
  out.push(NOTICE);
  out.push('Run `chainprint explain` for the rules, weights and confidence bands.');
  return `${out.join('\n')}\n`;
}

export function formatQuiet(report: ScanReport): string {
  return `${report.confidence} ${report.score}\n`;
}

/** Everything `explain` prints, as data. */
export function explainData() {
  return {
    schema: OUTPUT_SCHEMA,
    ok: true as const,
    command: 'explain' as const,
    tool: { name: 'chainprint' as const, version: VERSION, rules: RULES_VERSION },
    chain: { name: CHAIN_NAME, chainId: CHAIN_ID, caip2: CAIP2 },
    formula:
      'score = sum of the weights of the distinct counted rules that matched (each rule counts once, however many files it matched); the confidence is the first band, from the top, whose conditions hold.',
    anchorTiers: [...ANCHOR_TIERS],
    bands: CONFIDENCE_BANDS.map((b) => ({ ...b })),
    rules: RULES.map((r) => ({ ...r })),
    publicFacts: {
      chainId: CHAIN_ID,
      chainIdHex: '0x1237',
      caip2: CAIP2,
      rpcHost: PUBLIC_RPC_HOST,
      explorerHost: EXPLORER_HOST,
      testnetChainId: TESTNET_CHAIN_ID,
      knownAddresses: {
        entries: KNOWN_ADDRESS_DATA.entries.length,
        excluded: KNOWN_ADDRESS_DATA.excluded.length,
        asOf: KNOWN_ADDRESS_DATA.asOf,
        file: 'data/known-addresses.json',
      },
    },
    limits: { ...DEFAULT_LIMITS },
    skippedDirectories: [...SKIPPED_DIRECTORIES],
    skippedFiles: [...SKIPPED_FILES],
    textExtensions: [...TEXT_EXTENSIONS],
    textNames: [...TEXT_NAMES],
    notice: NOTICE,
  };
}

export function formatExplain(style: Style = PLAIN): string {
  const d = explainData();
  const out: string[] = [];
  out.push(style.bold(`chainprint ${VERSION} — rules ${RULES_VERSION}`));
  out.push(`Detects markers that a source tree targets ${CHAIN_NAME} (${CHAIN_ID}, ${CAIP2}).`);
  out.push('');
  out.push(style.bold('Rules'));
  const idWidth = Math.max(...RULES.map((r) => r.id.length));
  for (const r of RULES) {
    const weight = r.counted ? `+${r.weight}` : '  0';
    out.push(`  ${r.id.padEnd(idWidth)}  ${weight.padStart(3)}  ${r.tier}`);
    out.push(`      reads:   ${r.reads}`);
    out.push(`      matches: ${r.matches}`);
  }
  out.push('');
  out.push(style.bold('Confidence'));
  out.push(`  ${d.formula}`);
  for (const b of CONFIDENCE_BANDS) out.push(`  ${b.level.padEnd(6)}  ${b.description}`);
  out.push(`  Anchor tiers: ${ANCHOR_TIERS.join(', ')}.`);
  out.push('  Testnet markers (46630) are listed and never counted.');
  out.push('');
  out.push(style.bold('Public facts used'));
  out.push(
    `  chain id ${CHAIN_ID} (0x1237), ${CAIP2}, RPC ${PUBLIC_RPC_HOST}, explorer ${EXPLORER_HOST}`,
  );
  out.push(
    `  ${d.publicFacts.knownAddresses.entries} infrastructure addresses (as of ${d.publicFacts.knownAddresses.asOf}), each with its public source, in data/known-addresses.json; ${d.publicFacts.knownAddresses.excluded} cross-chain addresses deliberately excluded.`,
  );
  out.push('');
  out.push(style.bold('What chainprint reads'));
  out.push('  Each file gets one class, which decides the rules that read it:');
  out.push('    deployment record  its deployment rule (or the testnet marker) and known-address');
  out.push('    env template       env-template, testnet-marker and known-address');
  out.push('    documentation      doc-mention only');
  out.push('    package.json       package-metadata, and the code rules except chain-name');
  out.push('    toolchain config   chain-id-config instead of chain-id-code, plus the code rules');
  out.push(
    '    anything else      chain-id-code, caip2, rpc-host, explorer-host, chain-name, known-address',
  );
  out.push(
    '  Deploy records under test, fixture, mock, example or sample folders are read as ordinary files.',
  );
  out.push(
    `  Limits: ${DEFAULT_LIMITS.maxFiles} files, ${DEFAULT_LIMITS.maxFileBytes} bytes per file, ${DEFAULT_LIMITS.maxTotalBytes} bytes in all, depth ${DEFAULT_LIMITS.maxDepth}.`,
  );
  out.push(`  Never entered: ${SKIPPED_DIRECTORIES.join(', ')}, and lib/ beside foundry.toml.`);
  out.push(
    '  Never read: symbolic links, .env files (templates such as .env.example are read), lockfiles, minified files, binaries.',
  );
  out.push(
    '  No network, no code execution, no writes. Output shows the matched line only, redacted and truncated.',
  );
  out.push('');
  out.push(NOTICE);
  return `${out.join('\n')}\n`;
}
