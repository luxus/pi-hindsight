---
title: "Configure memory profiles"
description: Choose a memory scope and map it to Pi Hindsight configuration.
---

**Recommended default: Coding** — one shared coding bank, repos separated by tags.

Add **Life** only if you want a separate personal bank. Use **Isolated** only when a repo must never share the coding bank.

## Choose a profile

| Profile                  | Recall reads               | Automatic retain | Best for                         |
| ------------------------ | -------------------------- | ---------------- | -------------------------------- |
| **Coding** (recommended) | Coding bank                | Coding bank      | Normal day-to-day coding         |
| **Coding + Life**        | Coding + Life banks        | Coding bank only | Coding plus personal prefs/goals |
| **Isolated project**     | That repo’s hard-wall bank | That bank        | Client / sensitive repos         |
| **Life only**            | Life bank                  | Off              | Non-repo personal memory         |
| **Recall only**          | Configured banks           | Off              | Cautious / read-mostly use       |

Automatic retain never writes the Life / User bank. Use `hindsight_retain_global` (or a command) for explicit life writes.

## Configure through `/hindsight`

1. Run `/hindsight`.
2. Open guided setup if prompted, or press `g`.
3. Confirm the Hindsight server.
4. Choose **Coding** unless you know you need another profile.
5. Confirm bank ids (shared coding bank is stored in user/global config and prefilled next time).
6. Optional: starter mental models and historical import.

## Configure by file

Minimal project config:

```json
{
  "hindsight": {
    "baseUrl": "http://localhost:8888"
  }
}
```

Shared coding bank (prefer user/global config so every repo inherits it):

```json
{
  "banks": {
    "project": {
      "derive": "manual",
      "bankId": "pi-coding"
    }
  },
  "setupComplete": true
}
```

## Verify

In `/hindsight` confirm:

- profile is **Coding** (or the intentional alternative)
- coding bank id is set for domain-tagged mode
- Life bank appears only when you enabled it
- automatic retain matches the profile
- retain queue path is visible

Details: [Memory profiles](/pi-hindsight/start/memory-profiles/), [Memory banks](/pi-hindsight/concepts/memory-banks/), [Configuration](/pi-hindsight/reference/configuration/).
