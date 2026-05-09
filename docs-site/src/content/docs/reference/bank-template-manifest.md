---
title: "Bank template manifest reference"
description: Bank template import/export expectations and safety rules.
---

Bank template manifests describe Hindsight bank setup that can be exported, reviewed, dry-run, and applied through guided setup or the public `hindsight_import_bank_template` tool.

## Where manifests are used

Pi Hindsight can use manifests through:

- guided setup in `/hindsight`, where pasted manifests are dry-run before confirmation
- `hindsight_get_bank_template_schema` to inspect the Hindsight JSON Schema
- `hindsight_export_bank_template` to save a portable manifest
- `hindsight_import_bank_template` to dry-run or apply a local/inline manifest explicitly
- Hindsight control plane workflows or REST endpoints outside Pi Hindsight

## Public surface

`hindsight_import_bank_template` defaults to `dryRun: true`. To apply changes, pass `dryRun: false` and `confirmApply: true`. Provide exactly one source:

- `sourceFile`: local JSON file path, relative to the Pi working directory
- `manifestJson`: inline manifest JSON

Project and User Bank aliases resolve the same way as other bank tools. Prefer dry-run output in PRs/issues; apply only after reviewing config, mental-model, directive, and operation summaries.

## Rules

- Treat official Hindsight docs and API behavior as source of truth for manifest shape.
- Dry-run manifests before applying them.
- Keep manifests reviewable as JSON.
- Do not treat generated or exported manifests as product-design source of truth.
- Do not paste manifests containing private bank identifiers into public issues without review.

## Typical workflow

1. Export or obtain a manifest.
2. Review bank name, mental models, directives, and metadata.
3. In Pi Hindsight, run `hindsight_import_bank_template({ sourceFile, dryRun: true })` or paste the manifest during guided setup.
4. Apply only after the result matches the intended bank setup, using `dryRun: false` plus `confirmApply: true` for the tool path.
5. Verify bank status in `/hindsight`.

See [Starter mental model suggestions](../concepts/starter-mental-model-suggestions/) for concept background and [Hindsight API links](./hindsight-api-links/) for official API references.
