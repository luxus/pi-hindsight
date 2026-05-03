# Getting started

Pi Hindsight gives Pi durable project memory through Hindsight. The default setup keeps memory scoped to the current repository.

## 1. Install

```bash
pi install https://github.com/luxus/pi-hindsight
```

For a local checkout:

```bash
pi install /path/to/pi-hindsight
```

## 2. Choose a Hindsight server

Use one of these paths:

- [Hindsight Cloud signup](https://ui.hindsight.vectorize.io/signup)
- [Local Hindsight installation](https://hindsight.vectorize.io/developer/installation)

For local development, the expected default URL is:

```text
http://localhost:8888
```

## 3. Open the setup TUI

In Pi, run:

```text
/hindsight
```

The setup TUI shows memory status, selected banks, retain queue state, import state, recent retain receipts, and editable configuration fields.

Current keyboard controls:

- `h`/`l` or `<`/`>`: switch tabs
- `j`/`k`: move between settings
- `Enter`: edit selected setting
- `r`: remove the selected setting's active override
- `d`: deployment setup

## 4. Pick a memory profile

Choose the narrowest route that fits the repository.

### `project-only`

Safest default. Project recall and automatic retain use the selected project bank. Use this for sensitive repos, client code, work projects, or any repository where memory should stay isolated.

### `project+global`

Best for most personal coding. Project facts stay in the project bank. Durable preferences and cross-project habits can be recalled from the global bank. Automatic retain still writes project transcript deltas to the project bank by default.

### `global-only`

Broad shared recall. The project bank is disabled, and automatic retain is disabled because there is no project-scoped write route. Use explicit retain when you intentionally want global memory.

## 5. Minimal config

A minimal project-local config points at your Hindsight server:

```json
{
  "hindsight": {
    "baseUrl": "http://localhost:8888"
  }
}
```

To pin the project bank ID:

```json
{
  "hindsight": {
    "baseUrl": "http://localhost:8888"
  },
  "banks": {
    "project": {
      "derive": "manual",
      "bankId": "pi-project-my-repo"
    }
  }
}
```

## 6. First checks

After setup, use `/hindsight` to confirm:

- memory is enabled
- the expected profile is active
- the project bank is selected
- the Hindsight server is reachable
- the retain queue path is visible

You can preview imports before writing memory:

```text
/hindsight:import-current --dry-run
/hindsight:import-project-sessions --dry-run
```
