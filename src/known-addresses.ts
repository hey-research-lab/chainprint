/**
 * Public Robinhood Chain infrastructure addresses (data/known-addresses.json).
 *
 * The data file is bundled into the build, so chainprint never reads it from
 * disk or the network at run time. Every entry cites the public page that
 * names the contract and the public HEY Research Lab registry that lists it.
 */
import { z } from 'zod';
import data from '../data/known-addresses.json';

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), 'sources must be https URLs');
const lowercaseAddress = z.string().regex(/^0x[0-9a-f]{40}$/, 'addresses are stored lowercase');

export const KNOWN_ADDRESS_KINDS = [
  'dex-factory',
  'pool-manager',
  'launch-factory',
  'launch-router',
  'launch-protocol',
] as const;
export type KnownAddressKind = (typeof KNOWN_ADDRESS_KINDS)[number];

export const knownAddressEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    address: lowercaseAddress,
    name: z.string().min(1).max(80),
    kind: z.enum(KNOWN_ADDRESS_KINDS),
    sources: z.array(httpsUrl).min(1),
    listedIn: httpsUrl,
  })
  .strict();

export const excludedAddressSchema = z
  .object({
    address: lowercaseAddress,
    name: z.string().min(1),
    reason: z.string().min(1),
    sources: z.array(httpsUrl).min(1),
    listedIn: httpsUrl,
  })
  .strict();

export const knownAddressFileSchema = z
  .object({
    $comment: z.string(),
    schemaVersion: z.literal(1),
    chainId: z.literal(4663),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entries: z.array(knownAddressEntrySchema).min(1),
    excluded: z.array(excludedAddressSchema),
  })
  .strict();

export type KnownAddressEntry = z.infer<typeof knownAddressEntrySchema>;
export type KnownAddressFile = z.infer<typeof knownAddressFileSchema>;

export const KNOWN_ADDRESS_DATA: KnownAddressFile = knownAddressFileSchema.parse(data);

export const KNOWN_ADDRESSES: ReadonlyMap<string, KnownAddressEntry> = new Map(
  KNOWN_ADDRESS_DATA.entries.map((entry) => [entry.address, entry]),
);

/** The entry for an address, compared lowercase; checksums are not validated. */
export const knownAddress = (address: string): KnownAddressEntry | undefined =>
  KNOWN_ADDRESSES.get(address.toLowerCase());
