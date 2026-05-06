---
title: "Bank template manifest reference"
description: Bank template import/export expectations and safety rules.
---

Bank template manifests describe Hindsight bank setup that can be exported, reviewed, dry-run, and imported.

## Where manifests are used

Pi Hindsight can use manifests through:

- guided setup in `/hindsight`
- explicit bank template import/export tools
- Hindsight control plane workflows
- Hindsight REST endpoints for bank template import

## Rules

- Treat official Hindsight docs and API behavior as source of truth for manifest shape.
- Dry-run manifests before applying them.
- Keep manifests reviewable as JSON.
- Do not treat generated or exported manifests as product-design source of truth.
- Do not paste manifests containing private bank identifiers into public issues without review.

## Typical workflow

1. Export or obtain a manifest.
2. Review bank name, mental models, directives, and metadata.
3. Dry-run import.
4. Apply only after the result matches the intended bank setup.
5. Verify bank status in `/hindsight`.

See [Starter mental model suggestions](../concepts/starter-mental-model-suggestions/) for concept background and [Hindsight API links](./hindsight-api-links/) for official API references.
