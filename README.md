# Pi Hindsight Extension

Persistent memory for [Pi](https://github.com/earendil-works/pi-coding-agent) backed by [Hindsight](https://hindsight.vectorize.io/).

**Documentation:** <https://luxus.github.io/pi-hindsight/>

Pi Hindsight recalls relevant project memory before model calls, retains structured session deltas after completed agent runs, and exposes explicit memory tools for direct retain/recall/reflect operations.

## Install

Install the published npm package:

```bash
pi install npm:@luxusai/pi-hindsight
```

You can still install from GitHub when you want the current repository source instead of the latest npm release:

```bash
pi install https://github.com/luxus/pi-hindsight
```

Package name: `@luxusai/pi-hindsight`.

For local checkout installs, see [Development](#development).

## Quick start

1. Start or choose a Hindsight server:
   - [Hindsight Cloud signup](https://ui.hindsight.vectorize.io/signup)
   - [Self-hosted Hindsight installation](https://hindsight.vectorize.io/developer/installation); use Hindsight's built-in llama.cpp/local-LLM option when you want a no-LLM-API-key private setup
2. Open Pi in your repo and run `/hindsight`.
3. Configure the Hindsight API URL. The default self-hosted URL is `http://localhost:8888`.
4. Choose the narrowest memory profile that fits the repo: **Project + User**, **Project Only**, **User Only**, or **Recall Only**.
5. Start coding. Recall happens before provider calls; retain happens after completed agent runs when the selected profile allows automatic retain.

See the [getting started guide](https://luxus.github.io/pi-hindsight/start/getting-started/) for setup details.

## Safety defaults

- Project memory stays in a project bank by default.
- User memory is opt-in and explicitly configured.
- Recall injection is ephemeral; recalled memory is not written back into transcripts.
- Automatic retain redacts common secrets before writing memory.
- Exact document deletion requires exact bank ID, exact document ID, and `confirm: true`.

See [memory behavior](https://luxus.github.io/pi-hindsight/concepts/memory-behavior/) and [session memory modes](https://luxus.github.io/pi-hindsight/concepts/session-memory-modes/) for details.

## Documentation

- [Start](https://luxus.github.io/pi-hindsight/start/) — install and first setup
- [Concepts](https://luxus.github.io/pi-hindsight/concepts/) — memory model, banks, queue, imports, safety
- [Guides](https://luxus.github.io/pi-hindsight/guides/) — task workflows for setup, diagnostics, imports, and recovery
- [Reference](https://luxus.github.io/pi-hindsight/reference/) — tools, commands, config, hooks, generated surface
- [Development](https://luxus.github.io/pi-hindsight/development/) — contributor setup, checks, release, docs workflow

## Development

```bash
npm install
npm run check
```

`npm run check` includes `npm run docs:check`, which verifies generated surface-reference freshness, generated code-map freshness, internal docs links/sidebar routes, packaged Markdown links, GitHub Pages base-prefixed docs links, and docs-site build.

Run Pi with the local extension:

```bash
pi -e ./extensions/index.ts
```

Install a local checkout into Pi when you need to test package loading from your working tree:

```bash
pi install /path/to/pi-hindsight
```

For maintainer details, see [Development setup](https://luxus.github.io/pi-hindsight/development/development/) and [Release process](https://luxus.github.io/pi-hindsight/development/release/).

## Prior art

Pi Hindsight is inspired by [`noctuid/pi-hindsight`](https://github.com/noctuid/pi-hindsight). This package keeps the same useful idea, then tightens project isolation, queue durability, diagnostics, and release hardening.
