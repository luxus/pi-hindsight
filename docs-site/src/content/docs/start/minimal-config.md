---
title: "Minimal configuration"
---

A minimal project-local config points Pi Hindsight at your Hindsight server:

```json
{
  "hindsight": {
    "baseUrl": "http://localhost:8888"
  }
}
```

To pin the Project Bank ID:

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

## Bank-owned settings

Pi JSON selects banks and local behavior. Hindsight bank config owns bank settings such as:

- Retain mission
- Reflect mission
- observations mission
- disposition traits
- mental models
- directives
- bank template overrides

Use Pi Hindsight tools and setup flow to inspect or apply bank-owned settings. Do not treat local Pi JSON as the source of truth for missions, mental models, or directives.

## Environment override

For local development or temporary testing, set:

```bash
export HINDSIGHT_BASE_URL=http://localhost:8888
```

If your Hindsight server requires authentication, set the configured API key variable for your environment.
