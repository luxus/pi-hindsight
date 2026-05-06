---
title: "Configure memory profiles"
description: Choose a memory scope and map it to Pi Hindsight configuration.
---

Use the narrowest memory route that fits the repository. Start with `project-only` unless you intentionally want cross-project user memory.

## Choose a profile

| Profile          | Recall reads                                  | Automatic retain writes | Best for                                   |
| ---------------- | --------------------------------------------- | ----------------------- | ------------------------------------------ |
| `project-only`   | Project Bank                                  | Project Bank            | client work, sensitive repos, shared repos |
| `project+global` | Project Bank plus configured Global/User Bank | Project Bank            | personal coding with durable preferences   |
| `global-only`    | Global/User Bank                              | disabled by default     | intentional user-only memory               |

## Configure through `/hindsight`

1. Run `/hindsight`.
2. Open guided setup if prompted, or rerun it from the TUI.
3. Set the Hindsight base URL.
4. Choose the memory profile.
5. Confirm the project and user/global bank IDs.
6. Save the project config when the profile should travel with the repo.

## Configure by file

A minimal project config points at a Hindsight server:

```json
{
  "hindsight": {
    "baseUrl": "http://localhost:8888"
  }
}
```

Pin a human-chosen Project Bank when stability matters:

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

## Verify

Run `/hindsight` and confirm:

- expected profile is active
- expected Project Bank is selected
- Global/User Bank only appears when explicitly configured
- automatic retain is enabled only where expected
- retain queue path is visible

See [Memory profiles](../start/memory-profiles/) for profile semantics and [Configuration reference](../reference/configuration/) for exact fields.
