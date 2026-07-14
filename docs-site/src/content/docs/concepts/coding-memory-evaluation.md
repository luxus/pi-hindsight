---
title: "Coding memory evaluation"
---

What Vectorize’s own evaluation surface implies for **pi-hindsight** defaults. Not a harness in this repo—alignment notes for agents and maintainers.

## Sources

| Source                                   | What it measures                                                                                                                 | Link                                                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hindsight continuous perf monitor        | Retain throughput, recall p95, recall+obs, temporal recall, consolidation throughput, graph maintenance                          | [dashboard](https://vectorize-io.github.io/hindsight-continuous-performance-monitor)                                                                                                                                                               |
| AMB (Agent Memory Benchmark)             | Accuracy **and** latency/token cost; modes `rag` / `agentic-rag` / `agent` (native reflect); datasets include PersonaMem (prefs) | [repo](https://github.com/vectorize-io/agent-memory-benchmark), [leaderboard](https://agentmemorybenchmark.ai)                                                                                                                                     |
| sde-bench                                | Does a **coding agent** benefit from memory on non-guessable project decisions? `conversation` vs `history` source               | [repo](https://github.com/vectorize-io/sde-bench)                                                                                                                                                                                                  |
| Best practices / oh-my-pi / MM deep dive | Retain/recall/reflect hygiene; MM seeds; delta refresh                                                                           | [best practices](https://hindsight.vectorize.io/best-practices), [oh-my-pi post](https://hindsight.vectorize.io/blog/2026/06/08/oh-my-pi-hindsight-memory), [MM deep dive](https://hindsight.vectorize.io/blog/2026/06/05/mental-models-deep-dive) |

## Implications → pi-hindsight defaults

| Learning                                                                             | Extension implication                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Conversation-only decisions are the hard discriminator for strong models (sde-bench) | Auto-**retain** of real Pi sessions is the product; do not rely on git alone                                 |
| Ranking amid noise is the problem                                                    | Prefer observations + **narrow** mental models over dumping raw facts every turn                             |
| Cost is co-equal with accuracy (AMB)                                                 | Cap MM `max_tokens` (600–800 seeds); keep recall budgets mid/low unless deep context is required             |
| Consolidation is a server hot path (perf monitor)                                    | Client should not re-synthesize every turn: inject cached MMs; use **delta** + `refresh_after_consolidation` |
| Prefs applied to multi-step work (PersonaMem / AMB)                                  | Bank-global prefs MM + explicit retain of durable prefs (not probe harness noise)                            |
| Retain then same-turn recall is an anti-pattern                                      | Retain at `agent_end`; recall at `context` (already)                                                         |
| One MM for everything is an anti-pattern                                             | One model per knowledge dimension (architecture / conventions / decisions / prefs)                           |

## What we intentionally do **not** do

- Auto-`reflect` every turn (expensive; tools already expose reflect).
- Mega bank-global “everything about the user” models.
- Pre-summarizing before retain.
- Silent background MM create on every boot (setup / hub `t` is explicit).

## Related issues

- Setup ensure project + bank-global starters: #528
- Delta MM triggers on templates: #529
- MM size discipline: #530
- Mission wording vs best practices: #531
