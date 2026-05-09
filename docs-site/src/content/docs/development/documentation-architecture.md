---
title: "Documentation architecture"
---

This note defines the target information architecture for Pi Hindsight documentation. It is the migration map for documentation-site work and future docs reviews.

## Goals

Docs should help readers answer six questions quickly:

1. How do I install and configure Pi Hindsight?
2. What memory concepts and safety rules do I need to understand?
3. How do I use the TUI, setup, imports, diagnostics, tools, and commands?
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

Use the project glossary in `CONTEXT.md`. In user-facing docs and TUI copy, prefer:

- **Memory Bank** for isolated Hindsight storage.
- **Project Bank** for repository-scoped memory.
- **User Bank** for configured cross-project user memory.
- **Retain**, **Recall**, and **Reflect** for Hindsight operations.
- **Retain Queue**, **Retain Job**, **Document ID**, **Import Manifest**, and **Import Checkpoint** for durability and import behavior.
- **Pi session import** for repo/coding session history.
- **Chat transcript import** for non-repo conversation history routed to User memory.

Keep legacy `global` and `gateway` names only where they are exact config aliases, historical document IDs, or internal compatibility details.

## Section roles

### Start

Audience: first-time users.

Purpose: shortest path to a working setup. Start pages can mention concepts, but should link out instead of fully explaining them.

### Concepts

Audience: users who need the mental model before changing behavior.

Purpose: stable memory model, bank boundaries, Retain/Recall/Reflect, imports, queue durability, session modes, and safety invariants. Concepts should not duplicate command syntax or exact config schemas.

### Guides

Audience: users performing tasks.

Purpose: task workflows. Guides should start from `/hindsight` and guided setup when those are the normal product paths. Command examples belong here only when they are the best way to repeat, script, or explicitly target a workflow.

### Reference

Audience: users and maintainers checking exact names and schemas.

Purpose: concise reference for tools, commands, config, hooks, import controls, and generated surface output. Reference pages should link to guides for procedures.

### Architecture

Audience: contributors and maintainers.

Purpose: design seams and invariants: lifecycle hooks, operation service, Hindsight adapter, queue durability, import architecture, setup TUI architecture, and ADRs.

### Development

Audience: contributors and agents.

Purpose: repository workflow, checks, releases, docs pipeline, issue discipline, and agent guidance.

### Internal and archive

Audience: maintainers.

Purpose: keep historical plans available without presenting them as current user docs. Archive/delete scratch plans after actionable content moves into issues or stable docs.

## Duplication rules

- One page owns each explanation.
- Other pages link to the owner and add only local context.
- Start pages own happy-path onboarding.
- Concepts own why/mental model.
- Guides own procedures.
- Reference owns exact names and schemas.
- Generated pages own exhaustive generated listings.

Examples:

- Memory profile semantics live in [Memory profiles](/pi-hindsight/start/memory-profiles/). Guides may summarize the profile names but should link there for details.
- Import concepts live in [Historical Import](/pi-hindsight/concepts/imports/). The [Importing sessions](/pi-hindsight/guides/importing-sessions/) guide owns task steps.
- Exact import flags/tools live in [Import controls](/pi-hindsight/reference/import-controls/).

## Mermaid rendering pipeline

The docs site uses [`astro-mermaid`](https://github.com/joesaby/astro-mermaid). The pipeline is hybrid:

1. Markdown keeps normal `mermaid` fenced code blocks.
2. `astro-mermaid` must run before Starlight in `astro.config.mjs`.
3. During `astro build`, Remark/Rehype transforms convert fences into `<pre class="mermaid">`.
4. Built HTML still contains `<pre class="mermaid">`; that is expected.
5. Browser-side Mermaid renders SVG client-side.

Do not expect build-time SVG output. Build logs saying a Mermaid block was transformed mean the block was prepared for client-side rendering.

## Hand-authored versus generated

Hand-authored docs explain intent, invariants, and workflows.

Generated docs must stay reproducible from scripts:

- `docs/surface-reference.md` and the docs-site surface reference from `scripts/generate-surface-reference.ts`.
- `docs-site/src/content/docs/development/code-map.md` from `scripts/generate-code-map.mjs`.
- `CHANGELOG.md` from release/changelog automation.

Do not manually patch generated content as source of truth. Change the generator, source schema, or release metadata instead.

## Review checklist

Use this checklist when adding or moving docs:

- Does the page belong to Start, Concepts, Guides, Reference, Architecture, Development, or Internal/Archive?
- Does it use glossary terms from `CONTEXT.md`?
- Does it distinguish Hindsight behavior from Pi Hindsight policy?
- Does it link to the owning page instead of repeating long explanations?
- Is generated content clearly marked as generated?
- Are TUI/guided setup surfaces linked to the relevant docs page when users need context?
- Are outdated roadmap or scratch notes converted to issues before removal?
