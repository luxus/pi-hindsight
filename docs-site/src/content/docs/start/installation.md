---
title: "Installation"
---

Pi Hindsight is published as an npm Pi package.

## Install from npm

```bash
pi install npm:@luxusai/pi-hindsight
```

Use a version when you want a pinned install:

```bash
pi install npm:@luxusai/pi-hindsight@0.3.0
```

## Install from GitHub source

Use GitHub source only when you intentionally want the repository state instead of the latest npm release:

```bash
pi install https://github.com/luxus/pi-hindsight
```

Local checkout installs are for contributors and test builds. See [Development](/pi-hindsight/development/development/).

## Choose a Hindsight server

Use Hindsight Cloud or a self-hosted Hindsight API server:

- [Hindsight Cloud signup](https://ui.hindsight.vectorize.io/signup)
- [Self-hosted Hindsight installation](https://hindsight.vectorize.io/developer/installation)

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
