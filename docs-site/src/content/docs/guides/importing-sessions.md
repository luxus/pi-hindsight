---
title: "Importing Pi sessions"
---

Historical import is optional backfill. It reads old Pi session JSONL files or chat transcripts and writes deterministic Hindsight documents. Pi session imports also record checkpoint/manifest state so they can resume safely.

Live memory does not need import. After setup, normal retain starts from new completed agent turns.

## Start with guided setup

For first-time setup, prefer the `/hindsight` guided import prompt. It appears after config/template setup when import makes sense.

Guided import:

1. chooses the source type from the selected profile/template
2. previews first
3. shows counts and target bank for single-root imports
4. requires reviewed source-cwd to target-bank mappings for approved-root imports
5. asks before writing memory
6. can refresh mental models after successful import

Project/coding setup offers repo-scoped Pi session import. User/assistant setup offers chat transcript import into User memory.

## What can be imported

Pi Hindsight supports:

- current Pi session
- explicit Pi session JSONL file
- repo-scoped Pi sessions from the current session directory
- approved Pi session JSONL roots, grouped by each session header's canonical `cwd`
- explicit chat transcript JSONL files for User memory

Pi session imports and chat transcript imports are separate paths. They do not silently mix repo history with user conversation history.

## Use the TUI hub

Open `/hindsight` and press `i` (import always dry-runs before write). Guided setup can also offer import after profile selection.

There are no import tools and no public `/hindsight:import*` slash commands. Project imports target Pi session JSONL. Chat transcript import is available through guided setup / hub import and defaults to the configured User Bank.

For broader backfills, choose the approved-roots import option and enter only roots you want scanned. Discovery groups sessions by each canonical source `cwd`, reports invalid-header/unreadable counts, and marks missing or temporary worktree cwd groups as stale/transient. Every group defaults to **Skip**. Add target bank IDs explicitly with one mapping line per group, for example:

```text
/repos/app=coding-bank
/repos/archive=coding-bank, archive-bank
/private/tmp/old-worktree=skip
```

Target bank IDs are resolved only from configured/current aliases or explicit IDs. Pi Hindsight does not silently create banks during import planning. When a group maps to multiple banks, the final plan marks that intentional fan-out. The write path preflights every selected `(source cwd, target bank)` pair again and starts real imports only if all preflights succeed.

## Preview output

Pi session dry-run shows document count, import mode/profile, raw and projected message counts, dropped successful tool output, kept tool errors, estimated chunks, byte counts, target bank, checkpoint path, and manifest path.

Chat dry-run shows kept event count, retained user-turn count, dropped event totals, malformed lines, target User Bank, content hash, and byte count.

Use these numbers to catch noisy imports before writing memory.

## Project session discovery

Project session discovery avoids broad history imports. It scans only the current session file's directory and keeps `.jsonl` files whose parsed `cwd` resolves to the current repo/cwd.

Equivalent path forms are treated as the same project, including trailing separators, `.` segments, `..` traversal that resolves back to the repo, and resolved absolute paths.

Approved-root discovery scans only the roots entered by the user, reads only a bounded JSONL prefix needed to parse the first nonblank session header, groups sessions by canonical `cwd`, classifies missing or known temporary worktree cwd groups as stale/transient, and canonically deduplicates files reached through overlapping approved roots.

## Document IDs and rebuilds

Imports use deterministic document IDs based on session, branch leaf, chunk profile, and projection namespace. Reimporting the same document updates the same Hindsight document instead of appending duplicates.

Changing chunking or another document-ID namespace input creates a new deterministic set. Treat that as a rebuild:

1. dry-run first
2. decide whether old and new imported docs should coexist
3. clear or move checkpoint/manifest only when you want a fresh import namespace
4. flush or clear stale queued retain jobs before reimporting if old IDs should not deliver later

Default files:

```text
.pi/hindsight/import-manifest.json
.pi/hindsight/import-checkpoint.json
```

## Import modes

- `curated` is the default. It keeps filtered structured source evidence and drops obvious transcript noise.
- `raw` is a compatibility/debug escape hatch.
- `forensic` is for audit/recovery and can preserve normally filtered artifacts such as recalled memory blocks.

Curated import defaults to `import.qualityProfile: "compatible"` and `import.toolResults: "errors-only"`. Use `strict` only when you want stronger noise filtering. Use successful tool-result `summary` or `content` only for deliberate low-noise imports.

## Safety

Imports retain structured raw conversation content, not summaries. Secret redaction still applies. Curated and raw imports filter Pi Hindsight recall blocks so recalled memory is not retained back into Hindsight as new source truth.
