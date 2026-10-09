# Contributing

Thank you for helping. chainprint is small on purpose: every rule must be simple enough to
recompute by hand, and every public fact it relies on must be cited.

## Setup

```sh
corepack enable
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm scan            # leak and attribution scan; must print "scan clean"
```

Node.js 22 or later, pnpm 9.15.1. Tests never touch the network: `vitest.setup.ts` makes `fetch`
and socket connections throw.

## Changing the rules

A rule change is a change to what every report means. A pull request that adds or changes a
rule, weight, band or pattern must:

1. cite the public source of the chain fact it relies on;
2. add or update a fixture repository under `test/fixtures/` and a test for the positive and the
   negative case;
3. bump `RULES_VERSION` in `src/rules.ts` and update the rules table and formula in the README
   (`chainprint explain` reads the table from the code, so it stays in step by itself);
4. keep the language of evidence: a marker is evidence, never identity, ownership or legitimacy.

Rules are written from public chain facts only. Do not contribute heuristics copied from a
private or proprietary detector.

## Known addresses

`data/known-addresses.json` is sorted by address and holds lowercase addresses. Each entry needs a
public `https` source that names the contract on Robinhood Chain, and `listedIn` pointing at a
public registry that records how it was checked. An address deployed identically on many chains
belongs under `excluded` with its reason. `pnpm test` validates the file.

## Fixtures

Fixtures are tiny synthetic repositories. Use documentation-style values only: addresses such as
`0x0000000000000000000000000000000000000001`, `example.org` hosts, no real keys. Files that must
not be committed (symbolic links, `.env`, `node_modules/`, huge files) are created by the tests in
a temporary directory instead.

## Commits

Small conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`). No secrets, no
`.env` with values.

## Maintainers: provenance

chainprint is a new detector, not an extraction: its rules were written for this repository from
public chain facts and are not HEY Research Lab's discovery or qualification logic. Two inputs
come from HEY's public material:

- the chain constants (`src/chain.ts`, `src/evm.ts`) follow the shared HEY ecosystem conventions;
- `data/known-addresses.json` was taken from the public factory registry in
  [hey-research-open](https://github.com/hey-research-lab/hey-research-open)
  (`packages/sources/src/factories/registry.ts` and `dex-pools.ts`), extracted from HEY Research
  Lab's production contract at `21775391f6c0fb4494575e0b4463df535c65cb96` (as of 2026-10-02).
  Re-checked against production as of 2026-10-09: that registry is unchanged.
- rules version 2's `chain-listing` follows HEY's public description of its own code-search
  reading as of 2026-10-09 (README, "Compared with HEY's own code-search rules"); the patterns are
  chainprint's own.

When that registry changes, refresh the data file from the public repository and keep the
citations. A future `rhchain-registry` package may become the source of this list.
