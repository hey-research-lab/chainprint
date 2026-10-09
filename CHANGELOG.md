# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 0.2.0 — 2026-10-09

- Rules version `chainprint-rules/2`: a new uncounted rule, `chain-listing` (weight 0, tier
  `context`). A marker in a chain list (`chains*.json`, a `*chain-registry*` file, `chainlist/`),
  in vendored chain definitions (`chains/definitions/`) or in an agent instruction file (agent tool
  folders such as `.agents/` or `.cursor/`, `SKILL.md`, `AGENTS.md`, `GEMINI.md`) is reported
  under `chain-listing` with what kind of file it was in, and never counted. Such a file says the
  code knows the chain, not that it targets it: a vendored `defineChain` for Robinhood Chain alone
  used to score HIGH. This follows HEY's own code-search reading as of 2026-10-09; the README
  names the two places chainprint deliberately differs.
- Every other rule, weight and confidence band is unchanged. The `chainprint/v1` output gains one
  possible `rule` value; nothing is removed or renamed.

## 0.1.1 — 2026-10-02

- Hardhat 3 configs: a `4663: { … }` entry under `chainDescriptors` is a toolchain chain id (`chain-id-config`); it was missed.
- HEY's own declaration files (`hey-project.json`, `hey-ship.json`) are read like documentation (`doc-mention`), never as code: what a builder writes about itself added 20 points per file.
- A known infrastructure address inside a testnet (46630) or other-chain broadcast record no longer counts toward mainnet confidence.
- Testnet-only repositories: an env-template key naming `TESTNET` and the words "Robinhood Chain testnet" are testnet markers (never counted), not mainnet settings or mentions.
- Issue templates (bug, idea) with private security reporting and HEY corrections linked.

## 0.1.0 — 2026-10-02

- `chainprint [path]`: an offline scan of a local source tree for Robinhood Chain (4663) markers,
  with each evidence item's file, line and redacted, truncated matched line.
- `chainprint [path] --json`: one `chainprint/v1` JSON document, byte-identical for the same tree.
- `chainprint explain`: the rules, weights, tiers, confidence bands and limits, printed from the code.
- Rules `chainprint-rules/1`: Foundry broadcast, hardhat-deploy and Hardhat Ignition records;
  chain id 4663 in toolchain configs and in code; `eip155:4663`; the public RPC and explorer
  hostnames; 50 cited public infrastructure addresses; env templates; `package.json` metadata;
  the chain name in code and in documentation; testnet 46630 reported and never counted.
- Confidence NONE / LOW / MEDIUM / HIGH from a documented additive score; HIGH needs a config- or
  deployment-level marker.
- Safety: no network, no execution, no writes, no symlink following, path confinement, file
  count, size, total-byte and depth limits, binary and lockfile skipping, `.env` files never
  opened, prototype keys dropped from parsed JSON.
- Library exports: `scanDirectory`, `computeConfidence`, `RULES`, `CONFIDENCE_BANDS`,
  `KNOWN_ADDRESSES`, formatters and types.
