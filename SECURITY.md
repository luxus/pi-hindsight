# Security Policy

## Supported versions

Security fixes target the current `main` branch and the latest published npm package version when a package has been released. Runtime compatibility is defined in `package.json`.

## Reporting a vulnerability

Please report security issues privately. Do not open a public GitHub issue for vulnerabilities involving secrets, credential exposure, unsafe memory retention, Hindsight API misuse, or release-token handling.

Send a private report through GitHub Security Advisories if available for this repository. If advisories are not available, contact the repository owner privately and include enough detail to reproduce the issue.

A useful report includes:

- affected version or commit
- operating system and Node/npm versions
- relevant configuration with secrets removed
- steps to reproduce
- expected and actual behavior
- impact assessment
- whether Hindsight, Pi, or this extension appears to be the vulnerable component

## Security scope

Security-sensitive areas include:

- secret redaction before Retain, diagnostics, logs, or Last-Recall Snapshot writes
- Project Bank and Global Bank isolation
- Retain Queue durability and malformed queue handling
- exact document deletion behavior
- import of historical Pi JSONL sessions
- Hindsight API key handling and `SecretRef` behavior
- release workflow, provenance, and npm publishing credentials
- debug modes that write local sidecars or extra diagnostics

## Memory safety expectations

`pi-hindsight` must not retain secrets in normal operation. The extension redacts common API keys, bearer tokens, GitHub tokens, password-style environment assignments, and credentials embedded in URLs before automatic retain.

When working on security-sensitive memory paths:

- retain raw rich content, not summaries, but sanitize it first
- keep Recall Blocks ephemeral
- do not persist recalled memory into transcript history
- keep Last-Recall Snapshot and failure diagnostics opt-in
- redact errors before writing debug sidecars
- do not log raw retained payloads in normal mode
- require exact document IDs and explicit confirmation for destructive deletion

## Maintainer response

Maintainers should acknowledge private vulnerability reports promptly, reproduce the issue on a private branch or fork, add a regression test when feasible, and publish a fix with a clear security note. If a report affects upstream Hindsight or Pi behavior, coordinate with the relevant upstream project rather than inventing undocumented request shapes or lifecycle assumptions.
