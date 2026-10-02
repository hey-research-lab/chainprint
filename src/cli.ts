/**
 * chainprint CLI.
 *
 *   chainprint [path]           scan a directory (default: .)
 *   chainprint [path] --json    one JSON document (chainprint/v1) on stdout
 *   chainprint explain          the rules, weights and confidence bands
 *
 * Exit codes: 0 success (whatever the confidence), 1 the tree could not be
 * read, 2 usage error. chainprint never opens a network connection.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { OUTPUT_SCHEMA } from './rules';
import { ChainprintError, DEFAULT_ITEMS_PER_RULE, MAX_ITEMS_PER_RULE, scanDirectory } from './scan';
import { ANSI, PLAIN, explainData, formatExplain, formatQuiet, formatReport } from './format';
import { VERSION } from './version';

export type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Record<string, string | undefined>;
  isTTY: boolean;
};

const HELP = `chainprint ${VERSION} — Robinhood Chain (4663) markers in a source tree

Usage:
  chainprint [path] [options]   scan a local directory (default: .)
  chainprint explain [--json]   print the rules, weights and confidence bands

Options:
  --json          print one JSON document (schema chainprint/v1) on stdout
  --quiet         print only the confidence and score
  --limit <n>     evidence items listed per rule (default ${DEFAULT_ITEMS_PER_RULE}, max ${MAX_ITEMS_PER_RULE})
  --no-color      no emphasis (NO_COLOR is honoured too)
  --help          show this help
  --version       print the version

To scan a directory named "explain", pass ./explain.
chainprint is offline: it reads files, never runs them, never follows
symbolic links and never connects to a network.
A marker is evidence, not identity proof.
`;

class UsageError extends Error {}

export function run(argv: readonly string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        limit: { type: 'string' },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    return usage(
      io,
      argv.includes('--json'),
      error instanceof Error ? error.message : String(error),
    );
  }
  const { values, positionals } = parsed;
  const json = values.json === true;

  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  const color = io.isTTY && !values['no-color'] && !io.env.NO_COLOR && !json;
  const style = color ? ANSI : PLAIN;

  try {
    if (positionals.length > 1) throw new UsageError('Give at most one path.');
    if (positionals[0] === 'explain') {
      if (values.limit !== undefined) throw new UsageError('explain takes no --limit.');
      io.stdout(json ? `${JSON.stringify(explainData(), null, 2)}\n` : formatExplain(style));
      return 0;
    }
    let itemsPerRule = DEFAULT_ITEMS_PER_RULE;
    if (values.limit !== undefined) {
      if (!/^\d{1,4}$/.test(values.limit)) throw new UsageError('--limit takes a whole number.');
      itemsPerRule = Number(values.limit);
      if (itemsPerRule < 1 || itemsPerRule > MAX_ITEMS_PER_RULE) {
        throw new UsageError(`--limit must be between 1 and ${MAX_ITEMS_PER_RULE}.`);
      }
    }
    const root = positionals[0] ?? '.';
    const report = scanDirectory(root, { itemsPerRule });
    if (json) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    else if (values.quiet) io.stdout(formatQuiet(report));
    else io.stdout(formatReport(report, style));
    return 0;
  } catch (error) {
    if (error instanceof UsageError) return usage(io, json, error.message);
    if (error instanceof ChainprintError) {
      const exit = error.code === 'unreadable_root' ? 1 : 2;
      fail(io, json, error.code, error.message);
      return exit;
    }
    fail(io, json, 'internal_error', error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function fail(io: Io, json: boolean, code: string, message: string): void {
  if (json) {
    io.stdout(
      `${JSON.stringify({ schema: OUTPUT_SCHEMA, ok: false, error: { code, message } }, null, 2)}\n`,
    );
  } else {
    io.stderr(`chainprint: ${message}\n`);
  }
}

function usage(io: Io, json: boolean, message: string): number {
  fail(io, json, 'usage', message);
  if (!json) io.stderr('Run `chainprint --help` for usage.\n');
  return 2;
}

const isMain = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) {
  process.exitCode = run(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    isTTY: process.stdout.isTTY === true,
  });
}
