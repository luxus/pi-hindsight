---
title: "Installation"
---

Pi Hindsight is a Pi package. Install it into Pi, then point it at a Hindsight server.

## Install from GitHub

```bash
pi install https://github.com/luxus/pi-hindsight
```

## Install from a local checkout

```bash
git clone https://github.com/luxus/pi-hindsight
pi install /path/to/pi-hindsight
```

## Choose a Hindsight server

Use Hindsight Cloud or a self-hosted Hindsight API server:

- [Hindsight Cloud signup](https://ui.hindsight.vectorize.io/signup)
- [Self-hosted Hindsight installation](https://hindsight.vectorize.io/developer/installation)

For self-hosted setup, prefer Hindsight's built-in llama.cpp/local-LLM option when you want a private setup without an external LLM API key. That path requires Hindsight's `local-llm` extra; otherwise configure a normal LLM provider and API key as described in the Hindsight installation and model docs.

The conventional self-hosted URL is:

```text
http://localhost:8888
```

Pi Hindsight treats official Hindsight API behavior as the source of truth. Local Pi config selects banks and behavior; Hindsight owns Memory Bank storage, Retain, Recall, Reflect, bank config, mental models, and directives.

## Next step

Open Pi in a repository and run:

```text
/hindsight
```

If the repository has no project config yet, guided setup starts first.
