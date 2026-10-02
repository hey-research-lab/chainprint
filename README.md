# chainprint

**What is this?** A local, offline command-line tool that inspects a source tree and reports the evidence it finds that the code targets Robinhood Chain (chain id 4663), with a deterministic, documented confidence.

[![CI](https://github.com/hey-research-lab/chainprint/actions/workflows/ci.yml/badge.svg)](https://github.com/hey-research-lab/chainprint/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)
![Robinhood Chain 4663](https://img.shields.io/badge/Robinhood%20Chain-4663-informational.svg)

## Why it exists

Builders, reviewers and research tools often need a quick, explainable answer to "does this repository build for Robinhood Chain, and on what evidence?". chainprint answers it from the files alone: chain ids in toolchain configs, deployment records, the public RPC and explorer hostnames, known public infrastructure addresses, env templates, package metadata and documentation. Every marker comes with its file and line, and the confidence is a sum anyone can recompute by hand.

## Why Robinhood Chain only

chainprint looks for one chain: Robinhood Chain, chain id `4663` (`0x1237`), CAIP-2 `eip155:4663`. It has no network option and no chain list. Other chain ids are simply not markers (a config for chain `1` scores 0); the Robinhood Chain testnet (`46630`) is reported in its own labelled section and never counted.

## Install

```sh
npm i -g @hey-research-lab/chainprint
# or, without installing
npx @hey-research-lab/chainprint .
```

Node.js 22 or later. One runtime dependency: [`zod`](https://zod.dev), used to check the structure of the JSON files it parses.

## Smallest working example

```sh
mkdir demo && cd demo
cat > hardhat.config.js <<'EOF'
module.exports = {
  networks: { robinhood: { url: 'https://rpc.mainnet.chain.robinhood.com', chainId: 4663 } },
};
EOF
npx @hey-research-lab/chainprint .
```

```text
Robinhood Chain evidence found
Confidence: HIGH (score 60; with a config- or deployment-level marker)

Evidence:
  - chain id 4663 in a toolchain config [chain-id-config, config, +40]
      hardhat.config.js:2  networks: { robinhood: { url: 'https://rpc.mainnet.chain.robinhood.com', chainId: 4663 } },
        matched "chainId: 4663"
  - Robinhood Chain public RPC hostname [rpc-host, code, +20]
      hardhat.config.js:2  networks: { robinhood: { url: 'https://rpc.mainnet.chain.robinhood.com', chainId: 4663 } },
        matched "rpc.mainnet.chain.robinhood.com"

Read 1 file.
A marker is evidence, not identity proof. It shows that code targets Robinhood Chain; it does not show who owns the code or any contract, that the repository is a project, or that a project is legitimate.
Run `chainprint explain` for the rules, weights and confidence bands.
```

## Usage

```text
chainprint [path] [options]   scan a local directory (default: .)
chainprint explain [--json]   print the rules, weights and confidence bands

--json          one JSON document (schema chainprint/v1) on stdout
--quiet         only the confidence and score, e.g. "HIGH 60"
--limit <n>     evidence items listed per rule (default 20, max 1000)
--no-color      no emphasis (NO_COLOR is honoured too)
--help, --version
```

To scan a directory literally named `explain`, pass `./explain`.

| Exit code | Meaning                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| 0         | the scan ran, whatever the confidence (NONE included)                                                          |
| 1         | the tree could not be read                                                                                     |
| 2         | usage error: unknown flag, more than one path, bad `--limit`, a path that does not exist or is not a directory |

As a library:

```ts
import { scanDirectory, computeConfidence, RULES } from '@hey-research-lab/chainprint';

const report = scanDirectory('./my-repo');
console.log(report.confidence, report.score, report.evidence.length);
```

### The rules

Each rule has a fixed name, weight and tier. `chainprint explain` prints this table from the code itself.

| Rule                  | Weight | Tier        | Reads                                                                                                                          | Matches                                                                                                                                                                                                        |
| --------------------- | -----: | ----------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `foundry-broadcast`   |     45 | deployment  | `broadcast/<script>/4663/run-*.json`                                                                                           | parses as JSON with a `transactions` array; a `chain` field, if present, must say 4663. `dry-run/` is not a record.                                                                                            |
| `hardhat-deploy`      |     45 | deployment  | `deployments/<network>/.chainId`                                                                                               | the file's whole content is `4663`                                                                                                                                                                             |
| `ignition-deployment` |     45 | deployment  | `ignition/deployments/chain-4663/deployed_addresses.json`                                                                      | parses as a JSON object                                                                                                                                                                                        |
| `chain-id-config`     |     40 | config      | `hardhat.config.*`, `foundry.toml`, `truffle-config.js`, `truffle.js`, `wagmi.config.*`, any JS/TS file calling `defineChain(` | a chain-id key (`chainId`, `chain_id`, `chainID`, `networkId`, `network_id`, `chain`) set to `4663` or `0x1237`; in a `defineChain` file also `id: 4663`                                                       |
| `chain-id-code`       |     20 | code        | other source and data files                                                                                                    | an identifier or key containing `chainid`/`chain_id` compared with or assigned 4663 (`CHAIN_ID = 4663`, `block.chainid == 4663`, `chainId: '0x1237'`), or an ethers provider/network built with 4663           |
| `caip2`               |     20 | code        | source, data, config                                                                                                           | `eip155:4663` not followed by a digit                                                                                                                                                                          |
| `rpc-host`            |     20 | code        | source, data, config                                                                                                           | `rpc.mainnet.chain.robinhood.com` as a whole hostname                                                                                                                                                          |
| `known-address`       |     20 | code        | every file except documentation                                                                                                | an address listed in [`data/known-addresses.json`](data/known-addresses.json)                                                                                                                                  |
| `env-template`        |     15 | environment | `.env.example`, `.env.sample`, `.env.template`, `.env.dist`, `.env.defaults`, `.env.<name>.example`, `example.env`             | a key containing `ROBINHOOD`; a `CHAIN_ID` key set to 4663; a value naming the RPC or explorer host or `eip155:4663`                                                                                           |
| `explorer-host`       |     10 | code        | source, data, config                                                                                                           | `robinhoodchain.blockscout.com` as a whole hostname                                                                                                                                                            |
| `package-metadata`    |     10 | package     | `package.json`                                                                                                                 | a keyword `robinhood-chain` / `robinhoodchain` / `robinhood chain` / `eip155:4663`; a dependency whose name contains `robinhood-chain` or `robinhoodchain`; a name or description containing "Robinhood Chain" |
| `chain-name`          |      5 | mention     | source, data, config (not `package.json`)                                                                                      | "Robinhood Chain" in any case, joined by a space, `-`, `_` or nothing (`robinhoodChain`, `ROBINHOOD_CHAIN`), but not as a hostname label                                                                       |
| `doc-mention`         |      5 | mention     | `*.md`, `*.mdx`, `*.markdown`, `*.rst`, `*.adoc`, `*.txt`                                                                      | the name, `eip155:4663`, either hostname, or "chain id" followed by 4663. The weakest marker: anyone can write a README.                                                                                       |
| `testnet-marker`      |      0 | context     | every file except documentation                                                                                                | `46630` / `0xb626` / `eip155:46630` where the mainnet rules look for 4663, and testnet deployment folders. **Reported, never counted.**                                                                        |

A number only matches as a whole number: `46630`, `14663` and `4663.5` are not 4663.

**One class per file.** Each file is given one class, which decides the rules that read it:

| Class                                                                                                                                        | Rules                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| deployment record (the three layouts above, not under `test/`, `tests/`, `fixtures/`, `mocks/`, `examples/`, `samples/` and similar folders) | its deployment rule (or the testnet marker) and `known-address`                                        |
| env template                                                                                                                                 | `env-template`, `testnet-marker`, `known-address`                                                      |
| documentation                                                                                                                                | `doc-mention` only                                                                                     |
| `package.json`                                                                                                                               | `package-metadata`, and the code rules except `chain-name`                                             |
| toolchain config                                                                                                                             | `chain-id-config` instead of `chain-id-code`, plus the other code rules                                |
| anything else                                                                                                                                | `chain-id-code`, `caip2`, `rpc-host`, `explorer-host`, `chain-name`, `known-address`, `testnet-marker` |

A deploy record under a test, fixture, mock, example or sample folder is someone's test data, not this repository's deployment, so it is read as an ordinary file.

### The confidence formula

```text
score  = the sum of the weights of the distinct counted rules that matched
         (a rule counts once, however many files or lines it matched)

HIGH   score >= 60 and at least one config- or deployment-tier marker
MEDIUM score >= 25
LOW    score >= 1
NONE   score = 0
```

The bands are checked from the top; the first whose conditions hold is the confidence. Without a config or deployment marker, even a large score stays MEDIUM: a repository can mention the chain in many places without ever configuring or deploying to it. Testnet markers have weight 0. Changing a weight, band or pattern changes the rules version (`chainprint-rules/1`), which every report carries.

Worked examples (all in `test/fixtures/`):

| Tree                                                                                        | Rules matched                      | Score | Confidence         |
| ------------------------------------------------------------------------------------------- | ---------------------------------- | ----: | ------------------ |
| Hardhat config with `chainId: 4663` and the RPC URL                                         | chain-id-config 40 + rpc-host 20   |    60 | HIGH               |
| Foundry broadcast for 4663, RPC in `foundry.toml`                                           | foundry-broadcast 45 + rpc-host 20 |    65 | HIGH               |
| hardhat-deploy `deployments/robinhood/.chainId` only                                        | hardhat-deploy 45                  |    45 | MEDIUM             |
| ethers provider with 4663, RPC host, Uniswap V2 factory address, a comment naming the chain | 20 + 20 + 20 + 5                   |    65 | MEDIUM (no anchor) |
| `.env.example` only                                                                         | env-template 15                    |    15 | LOW                |
| README only                                                                                 | doc-mention 5                      |     5 | LOW                |
| Config for chain 1                                                                          | —                                  |     0 | NONE               |
| Testnet 46630 only                                                                          | testnet-marker (not counted)       |     0 | NONE               |

### Known addresses

[`data/known-addresses.json`](data/known-addresses.json) lists 50 public Robinhood Chain infrastructure contracts — the Uniswap V2 and V3 factories, the Uniswap v4 PoolManager, Doppler's Airlock, and public launch factories and one launch router. Every entry cites the public page that names it (`sources`) and the public HEY Research Lab registry that lists it with its on-chain check (`listedIn`, in [hey-research-open](https://github.com/hey-research-lab/hey-research-open)). Contracts deployed at the same address on many chains (Multicall3, Uniswap's CREATE2 Liquidity Launcher) are listed under `excluded` and never match, because finding them says nothing about Robinhood Chain. An address can still exist on more than one chain; a match shows the code refers to that address, nothing more. chainprint compares addresses lowercase and does not validate EIP-55 checksums.

### JSON output (`chainprint/v1`)

```json
{
  "schema": "chainprint/v1",
  "ok": true,
  "tool": { "name": "chainprint", "version": "0.1.0", "rules": "chainprint-rules/1" },
  "chain": { "name": "Robinhood Chain", "chainId": 4663, "caip2": "eip155:4663" },
  "root": ".",
  "result": "evidence_found",
  "confidence": "HIGH",
  "score": 65,
  "anchored": true,
  "rules": [
    {
      "rule": "foundry-broadcast",
      "tier": "deployment",
      "weight": 45,
      "counted": true,
      "items": 1,
      "shown": 1
    },
    { "rule": "rpc-host", "tier": "code", "weight": 20, "counted": true, "items": 1, "shown": 1 }
  ],
  "evidence": [
    {
      "rule": "foundry-broadcast",
      "tier": "deployment",
      "weight": 45,
      "counted": true,
      "file": "broadcast/Deploy.s.sol/4663/run-latest.json",
      "line": 27,
      "excerpt": "\"chain\": 4663,",
      "detail": "Foundry broadcast for chain 4663 with 1 transaction"
    }
  ],
  "scan": {
    "filesRead": 4,
    "complete": true,
    "incomplete": [],
    "skipped": {
      "total": 1,
      "byReason": { "foundry-library": 1 },
      "shown": [{ "path": "lib/", "reason": "foundry-library" }]
    },
    "limits": {
      "maxFiles": 10000,
      "maxFileBytes": 1048576,
      "maxTotalBytes": 268435456,
      "maxDepth": 12,
      "itemsPerRule": 20
    }
  },
  "notice": "A marker is evidence, not identity proof. …"
}
```

- `result` is `evidence_found` when the score is above 0, else `no_evidence_found` — a reading of the files chainprint read, never a statement about the world.
- `rules[].items` is the total found; `shown` is how many are listed in `evidence` (`--limit`).
- `scan.complete: false` means a limit stopped the walk (`incomplete` says which). Markers in files chainprint did not read are **not measured**: unknown, not absent.
- On an error, `--json` prints `{ "schema": "chainprint/v1", "ok": false, "error": { "code", "message" } }`.
- The output carries no timestamp, so the same tree always gives byte-identical output.

## How it relates to HEY Research Lab

chainprint is an independent, standalone tool from [HEY Research Lab](https://heyresearch.xyz), the builder-evidence layer for Robinhood Chain. It uses no HEY API and sends nothing anywhere. Its rules are its own, written from public chain facts; they are not HEY's discovery or qualification logic, and a chainprint result does not put a repository on HEY or change anything there. HEY's own review stays authoritative for what HEY publishes. The known-address list is taken from HEY's public factory registry in [hey-research-open](https://github.com/hey-research-lab/hey-research-open). Developer docs: <https://heyresearch.xyz/developers>.

## What it does NOT prove

A Robinhood Chain marker shows that a codebase targets the chain. It does not prove who owns the code or any contract, that the repository is a project, or that a project is legitimate. Confidence measures the markers found, not the project.

HEY Research Lab is an independent research project and is not affiliated with, endorsed by or partnered with Robinhood Markets, Inc. or Robinhood Chain.

## Security

See [SECURITY.md](SECURITY.md). In short, chainprint:

- makes **no network connection** of any kind and has no networking code;
- **never executes** anything from the scanned tree — config files are read as text, never `require`d or imported;
- **never follows symbolic links**, inside or outside the root, and confines every path under the root;
- never enters `.git`, `node_modules`, `vendor`, `vendored`, `third_party`, `build`, `dist`, `out`, `artifacts`, `cache`, `coverage`, `target`, `typechain(-types)`, framework caches, virtualenvs, or `lib/` beside `foundry.toml`;
- never opens real `.env` files (only templates such as `.env.example`), lockfiles, minified files or binaries (a NUL byte in the first 8 KB);
- reads at most 10,000 files, 1 MiB per file, 256 MiB in total, 12 directory levels deep, and opens only regular files (no FIFOs or devices);
- parses JSON with prototype keys (`__proto__`, `constructor`, `prototype`) dropped;
- prints only the matched line, redacted (URL credentials and query strings, long tokens, 64+ hex digit strings) and cut to 120 characters, with control and bidi characters removed. Env template values are never printed unless the value is the public marker itself;
- writes nothing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `pnpm install`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm scan` (leak and attribution scan). Tests run offline against the fixture repositories in `test/fixtures/`; network access is blocked in the test runner. A new rule, weight or known address needs a public citation, a fixture and a test, and bumps the rules version.

## Licence

[MIT](LICENSE) © 2026 HEY Research Lab
