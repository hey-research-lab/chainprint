import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_ADDRESS_DATA, knownAddress, knownAddressFileSchema } from '../src/known-addresses';

const raw = JSON.parse(
  readFileSync(new URL('../data/known-addresses.json', import.meta.url), 'utf8'),
) as unknown;

describe('data/known-addresses.json', () => {
  it('validates against its schema', () => {
    expect(() => knownAddressFileSchema.parse(raw)).not.toThrow();
    expect(KNOWN_ADDRESS_DATA.chainId).toBe(4663);
  });

  it('cites a public https source for every entry and every exclusion', () => {
    for (const entry of [...KNOWN_ADDRESS_DATA.entries, ...KNOWN_ADDRESS_DATA.excluded]) {
      expect(entry.sources.length).toBeGreaterThan(0);
      for (const url of [...entry.sources, entry.listedIn]) expect(url).toMatch(/^https:\/\//);
      expect(entry.listedIn).toMatch(
        /^https:\/\/github\.com\/hey-research-lab\/hey-research-open\//,
      );
    }
  });

  it('holds unique lowercase addresses, none of them excluded, zero or dead', () => {
    const entries = KNOWN_ADDRESS_DATA.entries.map((e) => e.address);
    const excluded = new Set(KNOWN_ADDRESS_DATA.excluded.map((e) => e.address));
    expect(new Set(entries).size).toBe(entries.length);
    expect(new Set(KNOWN_ADDRESS_DATA.entries.map((e) => e.id)).size).toBe(entries.length);
    for (const address of entries) {
      expect(address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(excluded.has(address)).toBe(false);
      expect(address).not.toBe('0x0000000000000000000000000000000000000000');
      expect(address).not.toBe('0x000000000000000000000000000000000000dead');
    }
  });

  it('is sorted by address so diffs stay reviewable', () => {
    const entries = KNOWN_ADDRESS_DATA.entries.map((e) => e.address);
    expect(entries).toEqual([...entries].sort());
  });

  it('looks addresses up case-insensitively and never matches an excluded one', () => {
    expect(knownAddress('0x8BCEAA40B9ACDFAEDF85ADF4FF01F5AD6517937F')?.id).toBe(
      'uniswap-v2-factory',
    );
    expect(knownAddress('0x8366a39cc670b4001a1121b8f6a443a643e40951')?.kind).toBe('pool-manager');
    expect(knownAddress('0xca11bde05977b3631167028862be2a173976ca11')).toBeUndefined();
  });
});
