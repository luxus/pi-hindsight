---
title: "Document IDs and update modes"
---

# Document IDs and update modes

A **Document ID** is the stable Hindsight document identifier for retained content. A stable ID prevents duplicate memory documents and makes deletion/reimport behavior inspectable.

## Live sessions

Live Pi sessions use stable document IDs and `update_mode: "append"`.

Append mode lets Pi Hindsight retain new session deltas over time without replacing earlier evidence. A Retain Cursor records which transcript boundary was already retained so retries and restarts do not duplicate content.

## Historical imports

Historical imports use deterministic document IDs.

Curated imports include session identity, branch/leaf identity, import profile, projection version, chunk index, and message range. This makes reimports idempotent and lets the importer resume from checkpoints.

Raw and forensic import modes preserve legacy raw IDs and payload shape for audit/debug use.

## Update modes

Use `append` for:

- ongoing live sessions
- incremental logs
- queue retries for the same live source

Use `replace` for:

- deterministic historical reimports
- full rebuilds
- one-shot explicit documents where replacement is intended

## Deletion

Deletion requires the exact bank ID and exact Document ID. Pi Hindsight exposes retain receipts and import manifests/checkpoints so document identity remains inspectable.
