# Documentation architecture

This note defines the target information architecture for Pi Hindsight documentation. It is the stable migration map for documentation-site work and for future documentation reviews.

## Goals

The documentation should help readers answer six questions quickly:

1. How do I install and configure Pi Hindsight?
2. What memory concepts and safety rules do I need to understand?
3. How do I use tools, commands, setup, imports, and diagnostics?
4. How is the extension designed internally?
5. How do I contribute, test, release, and review changes?
6. Which material is generated, authoritative, or internal-only?

## Source-of-truth boundaries

Documentation must keep these sources distinct:

1. **Official Hindsight docs and API behavior** define Memory Bank behavior, Retain, Recall, Reflect, bank templates, mental models, directives, and request/response shapes.
2. **Official Pi extension/session/package docs** define extension lifecycle hooks, command/tool registration, setup UI behavior, and package integration.
3. **Repository design docs, ADRs, plans, and issue decisions** define Pi Hindsight policy and implementation choices when they do not contradict Hindsight or Pi.
4. **Generated repository references** describe the current shipped surface. Generated files must not become the source of truth for product decisions.
5. **User notes and exploratory research** are hypotheses until converted into issues, ADRs, or stable docs.

When these sources conflict, follow `AGENTS.md` and `CONTRIBUTING.md` source-of-truth order.

## Naming rules

Use the project glossary in `CONTEXT.md`. In documentation navigation and page titles, prefer:

- **Memory Bank** for isolated Hindsight storage.
- **Project Bank** for repository-scoped memory.
- **Global Bank** for configured cross-project user memory, while UI copy may also say **User** where the product surface has migrated from older `global` wording.
- **Retain**, **Recall**, and **Reflect** for Hindsight operations.
- **Retain Queue**, **Retain Job**, **Document ID**, **Import Manifest**, and **Import Checkpoint** for durability and import behavior.
- **Import** for historical session ingestion, not generic file upload.

Avoid introducing synonyms such as “memory bucket,” “cache,” “sync,” or “summarization import” unless the page explicitly explains why the term is not part of the product vocabulary.

## Target sections

### Start

Audience: first-time users.

Purpose: get a working setup with minimal conceptual load.

Pages:

- Overview
- Getting started
- Installation and Hindsight server options
- Guided setup
- First checks and troubleshooting

### Concepts

Audience: users who need the mental model before changing configuration.

Purpose: explain memory behavior, bank boundaries, and safety invariants.

Pages:

- Memory model overview
- Project Bank and Global/User Bank
- Retain, Recall, and Reflect
- Retain Queue and outage behavior
- Session Memory Modes
- Historical Import concepts
- Bank templates, mental models, and directives
- Safety and secret redaction

### Guides

Audience: users performing tasks.

Purpose: task-oriented instructions with examples.

Pages:

- Configure memory profiles
- Use `/hindsight` setup and status
- Import historical Pi sessions
- Import gateway transcripts
- Export and import bank templates
- Inspect recalls and retain receipts
- Recover from outages or failed queue jobs
- Run local smoke tests

### Reference

Audience: users and maintainers checking exact names and schemas.

Purpose: stable reference, with generated content clearly marked.

Pages:

- Tools and commands
- Generated surface reference
- Configuration reference
- Bank template manifest reference
- Memory modes reference
- Hindsight API links

### Architecture

Audience: contributors and maintainers.

Purpose: explain design seams and invariants.

Pages:

- System architecture overview
- Memory lifecycle hooks
- Memory Operation Service and Operation Catalog
- Hindsight Adapter and REST shim policy
- Retain Queue durability
- Import architecture
- Setup TUI architecture
- ADR index

### Development

Audience: contributors and agents.

Purpose: repository workflow, checks, releases, and issue discipline.

Pages:

- Development setup
- Testing and verification
- GitHub Issues workflow
- Continuous issue iteration
- Release process
- Agent guidance
- Documentation architecture

### Internal and archive

Audience: maintainers.

Purpose: keep historical plans available without presenting them as current user docs.

Pages should be hidden from primary navigation or clearly marked as internal when they are research notes, roadmaps, scratch plans, or superseded design material.

## Migration map

| Current file                               | Target section                                                          | Action                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `README.md`                                | Start / Overview                                                        | Keep as repository landing page. Later mirror core overview into docs site.                              |
| `docs/getting-started.md`                  | Start / Getting started                                                 | Keep. Refresh setup text when site navigation exists.                                                    |
| `docs/configuration.md`                    | Reference / Configuration reference; Guides / Configure memory profiles | Split later: reference stays exact, guide becomes task-oriented.                                         |
| `docs/memory-behavior.md`                  | Concepts / Memory model overview                                        | Keep and align with glossary.                                                                            |
| `docs/hindsight-core-functions.md`         | Concepts / Retain, Recall, Reflect                                      | Keep as concept page; link to official Hindsight docs for authoritative API behavior.                    |
| `docs/risky-memory-modes.md`               | Concepts / Session Memory Modes                                         | Keep; may merge with `docs/adr/003-tui-memory-mode-vocabulary.md` summary.                               |
| `docs/importing-sessions.md`               | Guides / Import historical sessions and gateway transcripts             | Keep as task guide. Later split Pi sessions vs gateway transcripts if it grows.                          |
| `docs/tools-and-commands.md`               | Reference / Tools and commands                                          | Keep hand-authored overview. Link to generated surface reference.                                        |
| `docs/surface-reference.md`                | Reference / Generated surface reference                                 | Keep generated. Mark as generated and do not edit by hand.                                               |
| `docs/core-vs-companion-adapters.md`       | Architecture / System architecture overview                             | Keep. Link from architecture section.                                                                    |
| `docs/adr/*.md`                            | Architecture / ADR index                                                | Keep as authoritative decision records. Add index/navigation later.                                      |
| `docs/development.md`                      | Development / Development setup and verification                        | Keep. Link this documentation architecture note.                                                         |
| `docs/release.md`                          | Development / Release process                                           | Keep.                                                                                                    |
| `docs/starter-mental-model-suggestions.md` | Concepts / Bank templates, mental models, directives                    | Keep as concept/reference seed material; clarify relationship to built-in templates if copied into site. |
| `docs/next-opt-out-design.md`              | Internal and archive                                                    | Keep internal unless next opt-out becomes user-facing guide.                                             |
| `docs/post-mvp-roadmap.md`                 | Internal and archive                                                    | Keep internal roadmap, not primary user navigation.                                                      |
| `docs/pr-roadmap.md`                       | Internal and archive                                                    | Keep internal roadmap or archive after issues carry remaining work.                                      |
| `docs/architecture-todos.md`               | Internal and archive                                                    | Convert actionable items to issues, then archive or remove.                                              |
| `docs/agents/*.md`                         | Development / Agent guidance                                            | Keep as contributor/agent support docs.                                                                  |
| `CONTEXT.md`                               | Development / Glossary and invariants                                   | Keep at repository root as shared vocabulary. Link from docs site.                                       |
| `AGENTS.md`                                | Development / Agent guidance                                            | Keep at repository root. Link from docs site but do not duplicate all rules.                             |
| `CONTRIBUTING.md`                          | Development / Contributing                                              | Keep at repository root. Link from docs site.                                                            |
| `SECURITY.md`                              | Start / Security and support; Development / Security policy             | Keep at repository root and link from docs site.                                                         |
| `CHANGELOG.md`                             | Reference / Changelog                                                   | Keep generated/release-owned. Do not hand-edit release entries.                                          |

## Hand-authored versus generated

Hand-authored documentation:

- Overview, concepts, guides, architecture notes, ADRs, contributing guidance, and troubleshooting.
- These pages explain intent, invariants, and user workflows.

Generated documentation:

- `docs/surface-reference.md` from `scripts/generate-surface-reference.ts`.
- `CHANGELOG.md` from release/changelog automation.
- Future generated API tables should remain clearly labeled and reproducible from scripts.

Do not manually patch generated content as the source of truth. Change the generator, source schema, or release metadata instead.

## Migration order

1. Define this information architecture and link it from development docs.
2. Add documentation site scaffolding and navigation.
3. Move getting-started and concept pages into the site structure.
4. Move reference pages, including generated surface output.
5. Move architecture and development pages.
6. Add quality checks for links, generated docs freshness, and navigation coverage.
7. Archive or delete superseded roadmap/scratch notes after their content is represented in issues or stable docs.

## Review checklist for documentation changes

Use this checklist when adding or moving docs:

- Does the page belong to Start, Concepts, Guides, Reference, Architecture, Development, or Internal/Archive?
- Does it use glossary terms from `CONTEXT.md`?
- Does it distinguish Hindsight behavior from Pi Hindsight policy?
- Is generated content clearly marked as generated?
- Are outdated roadmap or scratch notes converted to issues before removal?
- Are links from contributor-facing docs updated if the documentation workflow changes?
