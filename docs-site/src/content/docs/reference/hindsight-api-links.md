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

When this documentation conflicts with official Hindsight behavior, follow official Hindsight docs and fix Pi Hindsight documentation or implementation.
