/**
 * A bounded, read-only walk of a local source tree.
 *
 * - Symbolic links are never followed, inside or outside the root: a link is
 *   reported as skipped and its target is never opened.
 * - Every path is confined under the root (`path.relative` never starts with `..`).
 * - Vendored, dependency and build directories are skipped by name.
 * - Only regular files are opened, with O_NOFOLLOW where the platform has it,
 *   and never more than `maxFileBytes + 1` bytes are read from one file.
 * - Caps on depth, on files read and on total bytes read; hitting a cap marks
 *   the scan incomplete instead of failing.
 * - Real `.env` files are never opened: they hold secrets, not markers.
 *
 * Entries are visited in a fixed order (code-unit order of names), so the
 * same tree always produces the same walk.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export type WalkLimits = {
  /** Most files opened and read. */
  maxFiles: number;
  /** Largest file read, in bytes; a larger one is skipped as too large. */
  maxFileBytes: number;
  /** Most bytes read across the whole scan. */
  maxTotalBytes: number;
  /** Deepest directory level entered below the root (the root is depth 0). */
  maxDepth: number;
};

export const DEFAULT_LIMITS: WalkLimits = Object.freeze({
  maxFiles: 10_000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxDepth: 12,
});

/** Directory names never entered, at any depth. */
export const SKIPPED_DIRECTORIES: readonly string[] = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'vendored',
  'third_party',
  'third-party',
  'build',
  'dist',
  'out',
  'artifacts',
  'cache',
  'coverage',
  'target',
  'typechain',
  'typechain-types',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.yarn',
  '.pnpm-store',
  '.venv',
  'venv',
  '__pycache__',
];
const SKIPPED_DIRECTORY_SET = new Set(SKIPPED_DIRECTORIES);

/** Lockfiles: dependency metadata, not the repository's own code, and often large. */
export const SKIPPED_FILES: readonly string[] = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
];
const SKIPPED_FILE_SET = new Set(SKIPPED_FILES);

/** Extensions chainprint reads as text. Anything else is not read. */
export const TEXT_EXTENSIONS: readonly string[] = [
  // JavaScript / TypeScript and front-end components
  'js', 'cjs', 'mjs', 'jsx', 'ts', 'cts', 'mts', 'tsx', 'vue', 'svelte', 'astro',
  // contracts
  'sol', 'vy', 'move', 'cairo',
  // other languages
  'py', 'rs', 'go', 'java', 'kt', 'swift', 'rb', 'php', 'cs', 'scala', 'sh', 'bash', 'zsh',
  // data and configuration
  'json', 'jsonc', 'json5', 'toml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'properties', 'xml',
  'html', 'graphql', 'gql',
  // documentation
  'md', 'mdx', 'markdown', 'rst', 'adoc', 'txt',
]; // prettier-ignore
const TEXT_EXTENSION_SET = new Set(TEXT_EXTENSIONS);
/** Extension-less names chainprint reads as text. */
export const TEXT_NAMES: readonly string[] = ['.chainId', 'Dockerfile', 'Makefile', 'justfile'];
const TEXT_NAME_SET = new Set(TEXT_NAMES);

/** `.env.example`, `.env.sample`, `.env.local.example`, `example.env`, … — templates, read. */
export const ENV_TEMPLATE_NAME =
  /^(?:\.env(?:\.[\w-]+)*\.(?:example|sample|template|dist|defaults)|(?:example|sample|template)\.env)$/i;
/** `.env`, `.env.local`, `.env.production`, … — real environment files, never read. */
const SECRET_ENV_NAME = /^\.env(?:\.[\w-]+)*$/i;

export type SkipReason =
  | 'ignored-directory'
  | 'foundry-library'
  | 'depth-limit'
  | 'symlink'
  | 'not-a-regular-file'
  | 'env-file'
  | 'lockfile'
  | 'minified'
  | 'not-text'
  | 'too-large'
  | 'binary'
  | 'unreadable'
  | 'file-limit'
  | 'byte-limit';

export const SKIP_REASONS: readonly SkipReason[] = [
  'ignored-directory',
  'foundry-library',
  'depth-limit',
  'symlink',
  'not-a-regular-file',
  'env-file',
  'lockfile',
  'minified',
  'not-text',
  'too-large',
  'binary',
  'unreadable',
  'file-limit',
  'byte-limit',
];

export type Skipped = { path: string; reason: SkipReason };

export type WalkedFile = {
  /** Root-relative path with `/` separators. */
  path: string;
  /** Base name. */
  name: string;
  text: string;
};

export type WalkResult = {
  files: WalkedFile[];
  skipped: Skipped[];
  /** Why the walk stopped early, if it did. */
  incomplete: ('file-limit' | 'byte-limit')[];
  bytesRead: number;
};

const toPosix = (p: string): string => (sep === '/' ? p : p.split(sep).join('/'));
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const BINARY_SNIFF_BYTES = 8000;
const O_NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Whether chainprint reads a file of this name at all (before size and content checks). */
export function fileNameDecision(name: string): 'read' | SkipReason {
  if (ENV_TEMPLATE_NAME.test(name)) return 'read';
  if (SECRET_ENV_NAME.test(name)) return 'env-file';
  if (SKIPPED_FILE_SET.has(name)) return 'lockfile';
  if (/\.min\.(?:js|mjs|cjs|css)$/i.test(name)) return 'minified';
  if (TEXT_NAME_SET.has(name)) return 'read';
  return TEXT_EXTENSION_SET.has(extensionOf(name)) ? 'read' : 'not-text';
}

type ReadOutcome = { text: string; bytes: number } | { skip: SkipReason; bytes: number };

function readBounded(absolute: string, maxBytes: number): ReadOutcome {
  let fd: number;
  try {
    fd = openSync(absolute, constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    return { skip: 'unreadable', bytes: 0 };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { skip: 'not-a-regular-file', bytes: 0 };
    if (stat.size > maxBytes) return { skip: 'too-large', bytes: 0 };
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buffer, total, buffer.length - total, null);
      if (n === 0) break;
      total += n;
      if (total > maxBytes) return { skip: 'too-large', bytes: total };
    }
    const body = buffer.subarray(0, total);
    if (body.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { skip: 'binary', bytes: total };
    return { text: body.toString('utf8'), bytes: total };
  } catch {
    return { skip: 'unreadable', bytes: 0 };
  } finally {
    closeSync(fd);
  }
}

/**
 * Walk `root` (already resolved to a real directory path). Pure reads; never
 * writes, executes or follows anything.
 */
export function walkTree(root: string, limits: WalkLimits = DEFAULT_LIMITS): WalkResult {
  const files: WalkedFile[] = [];
  const skipped: Skipped[] = [];
  const incomplete: WalkResult['incomplete'] = [];
  let bytesRead = 0;
  let stopped = false;

  const confined = (absolute: string): string | undefined => {
    const rel = relative(root, absolute);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
    return toPosix(rel);
  };

  const visit = (dir: string, depth: number): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort(byCodeUnit);
    } catch {
      const rel = confined(dir);
      if (rel !== undefined) skipped.push({ path: `${rel}/`, reason: 'unreadable' });
      return;
    }
    // Foundry keeps its dependencies (git submodules) in lib/ beside foundry.toml.
    const foundryProject = names.includes('foundry.toml');
    for (const name of names) {
      const absolute = join(dir, name);
      const rel = confined(absolute);
      if (rel === undefined) continue;
      if (stopped) {
        skipped.push({ path: rel, reason: incomplete[0] ?? 'file-limit' });
        continue;
      }
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch {
        skipped.push({ path: rel, reason: 'unreadable' });
        continue;
      }
      if (stat.isSymbolicLink()) {
        skipped.push({ path: rel, reason: 'symlink' });
        continue;
      }
      if (stat.isDirectory()) {
        if (SKIPPED_DIRECTORY_SET.has(name)) {
          skipped.push({ path: `${rel}/`, reason: 'ignored-directory' });
        } else if (foundryProject && name === 'lib') {
          skipped.push({ path: `${rel}/`, reason: 'foundry-library' });
        } else if (depth + 1 > limits.maxDepth) {
          skipped.push({ path: `${rel}/`, reason: 'depth-limit' });
        } else {
          visit(absolute, depth + 1);
        }
        continue;
      }
      if (!stat.isFile()) {
        skipped.push({ path: rel, reason: 'not-a-regular-file' });
        continue;
      }
      const decision = fileNameDecision(name);
      if (decision !== 'read') {
        // Files of a type chainprint never reads are counted, not listed one by one.
        skipped.push({ path: rel, reason: decision });
        continue;
      }
      if (stat.size > limits.maxFileBytes) {
        skipped.push({ path: rel, reason: 'too-large' });
        continue;
      }
      if (files.length >= limits.maxFiles) {
        incomplete.push('file-limit');
        stopped = true;
        skipped.push({ path: rel, reason: 'file-limit' });
        continue;
      }
      if (bytesRead + stat.size > limits.maxTotalBytes) {
        incomplete.push('byte-limit');
        stopped = true;
        skipped.push({ path: rel, reason: 'byte-limit' });
        continue;
      }
      const outcome = readBounded(absolute, limits.maxFileBytes);
      bytesRead += outcome.bytes;
      if ('skip' in outcome) {
        skipped.push({ path: rel, reason: outcome.skip });
        continue;
      }
      files.push({ path: rel, name, text: outcome.text });
    }
  };

  visit(root, 0);
  return { files, skipped, incomplete, bytesRead };
}
