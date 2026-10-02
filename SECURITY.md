# Security policy

## Reporting a vulnerability
Please report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this
repository, or email hi@heyresearch.xyz with "security" in the subject. Do not open a public issue.
We aim to acknowledge within 3 working days. There is no bug bounty for this repository.

## Scope
chainprint reads an untrusted local source tree and prints what it finds. It treats every file,
file name and directory name in that tree as hostile:

- **No network.** chainprint has no networking code and opens no connection. The known-address
  data is bundled at build time.
- **No execution.** Config files (`hardhat.config.*`, `foundry.toml`, `wagmi.config.*`, …) are read
  as text and never imported, required or evaluated. chainprint starts no child process.
- **No writes.** chainprint never writes to the scanned tree or anywhere else.
- **Path confinement.** Symbolic links are never followed (they are reported as skipped), every
  path is checked to stay under the root, files are opened with `O_NOFOLLOW` where the platform
  has it, and only regular files are read (FIFOs, sockets and devices are skipped).
- **Resource limits.** At most 10,000 files, 1 MiB per file, 256 MiB in total and 12 directory
  levels; hitting a limit marks the scan incomplete. Vendored, dependency and build directories
  are skipped; binaries, lockfiles and minified files are not read.
- **Parsing.** JSON is parsed only from size-capped files, with `__proto__`, `constructor` and
  `prototype` keys dropped, then shape-checked with zod. No YAML, no `eval`, no `new Function`.
- **Output.** Only the matched line is printed, redacted (URL user-info and query strings, long
  opaque tokens, hex strings of 64 or more digits) and truncated to 120 characters, with control,
  bidi and zero-width characters removed. Real `.env` files are never opened; env template values
  are never printed unless the value is the public marker itself.

Out of scope: the accuracy of a marker. A marker is evidence, not identity proof.

## Handling secrets
This project never needs HEY credentials or any other token, reads none from the environment
(apart from `NO_COLOR`), and logs nothing but its report. Never commit a `.env` with values.

## Supported versions
The latest 0.x minor receives fixes.
