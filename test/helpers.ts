import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { scanDirectory, type ScanOptions, type ScanReport } from '../src/scan';
import type { RuleId } from '../src/rules';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const fixture = (name: string): string => join(FIXTURES, name);

export const scanFixture = (name: string, options: ScanOptions = {}): ScanReport =>
  scanDirectory(fixture(name), { displayRoot: name, ...options });

export const matchedRules = (report: ScanReport): RuleId[] => report.rules.map((r) => r.rule);

export const countedRules = (report: ScanReport): RuleId[] =>
  report.rules.filter((r) => r.counted).map((r) => r.rule);

const temps: string[] = [];

/** A fresh directory under the OS temp dir, removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chainprint-test-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});
