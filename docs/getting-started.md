# Getting started

Pi Hindsight gives Pi durable memory through Hindsight. For normal use, install the published package, run `/hindsight`, choose a memory profile, and let the TUI guide setup.

## 1. Install

Install the npm package:

```bash
pi install npm:@luxusai/pi-hindsight
```

If you need unreleased source from GitHub:

```bash
pi install https://github.com/luxus/pi-hindsight
```

Local checkout installs are for contributors; see the development docs.

## 2. Choose a Hindsight server

Use either:

- [Hindsight Cloud signup](https://ui.hindsight.vectorize.io/signup)
- [Self-hosted Hindsight installation](https://hindsight.vectorize.io/developer/installation)
- **Embedded local server (no Docker):** Install [`@vectorize-io/hindsight-all`](https://github.com/vectorize-io/hindsight/tree/main/hindsight-all-npm) and use `HindsightServer` to start a local daemon programmatically. Requires `uv`/`uvx` and Python on the host. Pairs with the existing `@vectorize-io/hindsight-client` used by this extension.

The default local URL is:

```text
http://localhost:8888
```

For a fully private setup without external LLM API keys, use Hindsight's built-in llama.cpp/local-LLM path.

## 3. Run `/hindsight`

Open Pi in your repository and run:

```text
/hindsight
```

If no project config exists, guided setup starts automatically. You can rerun it later from the TUI with `g`.

**Setup gate:** until a bank is chosen (guided setup, `banks.project.bankId` / `PI_HINDSIGHT_PROJECT_BANK_ID`, or an existing install with prior config/runtime state), automatic bank ensure, recall, and retain stay off. Status warns that setup is required. Existing upgrades with config files or queue/cursor state continue to work without re-onboarding.

Guided setup handles:

1. Hindsight server URL
2. memory profile
3. project and/or user bank
4. optional dry-run-first historical import

Starter mental models can be applied from setup/templates. Ongoing mental-model and mission maintenance is agent-first (ADR-005); the Hindsight web UI remains available for control-plane browsing.

## 4. Pick the narrowest profile

- **Project + User**: best personal-coding default. Project facts stay repo-scoped; user memory carries durable preferences across repos.
- **Project Only**: best for strict isolation, client work, sensitive repos, and team projects.
- **User Only**: best for non-repo assistance where project memory would be noise.
- **Recall Only**: best cautious start. Recall works; automatic retain is off.

## 5. Check status

After setup, `/hindsight` should show:

- reachable Hindsight server
- expected memory profile
- expected Project Bank and/or User Bank
- automatic recall/retain state
- retain queue path
- import checkpoint/manifest state when imports have run

If automatic recall injects irrelevant noise, see [Recall quality](memory-behavior.md#recall-quality) for always-on filters and optional score floors (off by default).

## 6. Import old sessions only when useful

Live retain starts after setup. Historical import is optional backfill. Use guided setup's import prompt first when it appears; it previews before writing memory.

For later imports, use the importing sessions guide. Commands and tools remain available for advanced or scripted imports.
