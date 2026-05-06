# Pi Hindsight Extension

Persistent memory for [Pi](https://github.com/mariozechner/pi) backed by [Hindsight](https://hindsight.vectorize.io/).

**Documentation:** <https://luxus.github.io/pi-hindsight/>

Pi Hindsight recalls relevant project memory before model calls, retains structured session deltas after completed agent runs, and exposes explicit memory tools for direct retain/recall/reflect operations.

The extension is inspired by [`noctuid/pi-hindsight`](https://github.com/noctuid/pi-hindsight). This version keeps the same useful idea, then tightens project isolation, queue durability, diagnostics, and release hardening.

## Compatibility

Supported runtime and package ranges are declared in `package.json` and enforced in CI with `npm ci --engine-strict`.

- Node.js: `>=24 <25`
- npm: `>=11 <12`
- Pi peer package: `@mariozechner/pi-coding-agent >=0.72.1 <0.73.0`
- TypeBox peer package: `typebox >=1.1.24 <2`

## Install

Install from GitHub:

```bash
pi install https://github.com/luxus/pi-hindsight
```

For local development, install a checkout path instead:

```bash
pi install /path/to/pi-hindsight
```

Package name: `@luxusai/pi-hindsight`.

## Quick start

1. Start or choose a Hindsight server:
   - [Hindsight Cloud signup](https://ui.hindsight.vectorize.io/signup)
   - [Local Hindsight installation](https://hindsight.vectorize.io/developer/installation)
2. Open Pi in your repo and run `/hindsight`.
3. Configure the Hindsight API URL. The default local URL is `http://localhost:8888`.
4. Choose the narrowest memory profile that fits the repo: `project-only`, `project+global`, or `global-only`.
5. Start coding. Recall happens before provider calls; retain happens after completed agent runs.

See the [getting started guide](https://luxus.github.io/pi-hindsight/start/getting-started/) for setup details.

## Safety defaults

- Project memory stays in a project bank by default.
- Global/user memory is opt-in and explicitly configured.
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

Run Pi with the local extension:

```bash
pi -e ./extensions/index.ts
```

For maintainer details, see [Development setup](https://luxus.github.io/pi-hindsight/development/development/) and [Release process](https://luxus.github.io/pi-hindsight/development/release/).
