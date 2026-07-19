---
title: "Memory profiles"
---

A **profile** picks which banks this repo uses. It is not a second product.

## Recommended: Coding

**Use this for almost every personal coding repo.**

- One **shared coding bank** across repos
- Soft isolation with `project:<id>` tags (see [project identity](/pi-hindsight/concepts/project-identity/))
- Automatic retain → coding bank only
- Coding bank id is saved in **user/global** config so new repos prefill it

In guided setup this is the first option (**Coding — recommended**).

## Coding + Life

Same as **Coding**, plus an optional **Life / User bank** for durable personal memory (prefs, people, goals).

- Recall can read both banks (separate token budgets)
- Automatic retain still **only** hits the coding bank
- Life writes stay explicit (`hindsight_retain_global` / hub)

## Isolated project

Hard wall: dedicated bank for **this repo only** (`scope.mode: isolated-bank`).

Use for client work, sensitive repos, or anything that must not share the coding bank.

## Life only

No coding bank. Only the personal Life / User bank.

- Automatic retain is off
- Explicit tools write life memory when you ask

Use when you are not doing repo work.

## Recall only

Same bank topology as coding (or whatever you configure), but **automatic retain is off**.

Use when you want injected memory and do not want this session written automatically.

## One-line chooser

| If you want…                   | Pick                 |
| ------------------------------ | -------------------- |
| Normal coding memory (default) | **Coding**           |
| Coding + personal life memory  | **Coding + Life**    |
| This repo fully sealed         | **Isolated project** |
| Personal memory only           | **Life only**        |
| Read memory, don’t auto-save   | **Recall only**      |

## Banks vs profiles

- **Bank** = where memory lives (hard wall). See [Memory banks](/pi-hindsight/concepts/memory-banks/).
- **Profile** = which banks this repo turns on.

“Project Bank” in older docs means the coding (or isolated) bank path. “User / global bank” means the Life bank.

## Terminology note

Older config keys and tool aliases may still say `global` for the Life / User bank. That alias remains supported.
