# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 0.1.0 — initial release

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
