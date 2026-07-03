---
title: "Configure memory profiles"
description: Choose a memory scope and map it to Pi Hindsight configuration.
---

Use the narrowest memory route that fits the repository. Start with **Project Only** for strict isolation or **Project + User** for personal coding with durable cross-repo preferences.

## Choose a profile

| Profile        | Recall reads                | Automatic retain writes | Best for                                   |
| -------------- | --------------------------- | ----------------------- | ------------------------------------------ |
| Project + User | Project Bank plus User Bank | Project Bank            | personal coding with durable preferences   |
| Project Only   | Project Bank                | Project Bank            | client work, sensitive repos, shared repos |
| User Only      | User Bank                   | disabled                | intentional user-only memory               |
| Recall Only    | configured memory banks     | disabled                | cautious adoption and read-only sessions   |

Automatic retain never writes to the User Bank in any profile; use `hindsight_retain_global` or a command for explicit User Bank writes.

## Configure through `/hindsight`

1. Run `/hindsight`.
2. Open guided setup if prompted, or rerun it from the TUI.
3. Set the Hindsight base URL.
4. Choose the memory profile.
5. Confirm the project and/or user bank IDs.
6. Review whether setup will write project config, global Pi config, or both.

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
- expected Project Bank is selected only when project memory is intended
- User Bank appears only when explicitly configured
- automatic retain is enabled only where expected
- retain queue path is visible

See [Memory profiles](../start/memory-profiles/) for profile semantics and [Configuration reference](../reference/configuration/) for exact fields.
