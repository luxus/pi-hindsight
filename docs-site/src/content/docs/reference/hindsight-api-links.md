---
title: "Hindsight API links"
description: Official Hindsight docs and API references for behavior that Pi Hindsight must not redefine.
---

Official Hindsight documentation and API behavior are the source of truth for Hindsight concepts and request/response shapes.

## Official docs

- [Hindsight documentation](https://hindsight.vectorize.io/)
- [Hindsight developer installation](https://hindsight.vectorize.io/developer/installation)
- [Hindsight Cloud signup](https://ui.hindsight.vectorize.io/signup)

## Pi Hindsight policy

Pi Hindsight defines repository-specific policy around Hindsight:

- default Project Bank derivation
- optional Global/User Bank config
- automatic Recall injection through Pi context hooks
- queue-first automatic Retain
- deterministic import document IDs
- local diagnostics and setup commands

Pi Hindsight should use newer Hindsight request fields when they improve the core Retain/Recall/Reflect/Import loop. It should not chase every Hindsight administration or exploration API before the core loop is release-ready.

Deferred Hindsight surfaces need a new design issue before implementation:

- audit logs
- webhooks
- graph/entity/document browsers
- memory-unit or operation-management tools
- destructive bank administration UI

When this documentation conflicts with official Hindsight behavior, follow official Hindsight docs and fix Pi Hindsight documentation or implementation.
