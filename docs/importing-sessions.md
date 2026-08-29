# Importing Pi sessions

Historical import is optional backfill. It reads old Pi session JSONL files or chat transcripts and writes deterministic Hindsight documents. Pi session imports also record checkpoint/manifest state so they can resume safely.

Live memory does not need import. After setup, normal retain starts from new completed agent turns.

## Start with guided setup

For first-time setup, prefer the `/hindsight` guided import prompt. It appears after config/template setup when import makes sense.

Guided import:

1. chooses the source type from the selected profile/template
2. previews first
3. shows counts and target bank
4. asks before writing memory
5. can refresh mental models after successful import

Project/coding setup offers repo-scoped Pi session import. User/assistant setup offers chat transcript import into User memory.

## What can be imported

Pi Hindsight supports:

- current Pi session
- explicit Pi session JSONL file
- repo-scoped Pi sessions from the current session directory
- approved Pi session JSONL roots, grouped by each session header's canonical `cwd`
- explicit chat transcript JSONL files for User memory

Pi session imports and chat transcript imports are separate paths. They do not silently mix repo history with user conversation history.

## Use commands when you need control

Command shortcuts are useful after setup, for repeat imports, or for explicit files:

```text
Open `/hindsight` and press `i` (import always dry-runs before write). Guided setup can also offer import after profile selection.
```

If the preview looks right, rerun without `--dry-run`. Non-dry-run imports announce the start and require confirmation because they write memory plus local checkpoint/manifest files.

For broader backfills, choose the approved-roots import option and enter only roots you want scanned. The hub previews first; after confirmation the write path preflights every discovered project group again and starts real imports only if all preflights succeed.

Use `--all-leaves` only when you intentionally want every fork leaf from a session file. Default import follows the current branch.

## Use commands for script workflows

Imports run through the `/hindsight` TUI hub and guided setup; there are no import tools. Project imports target Pi session JSONL. Chat transcript import is available through guided setup / hub import and defaults to the configured User Bank.

## Preview output

Pi session dry-run shows document count, import mode/profile, raw and projected message counts, dropped successful tool output, kept tool errors, estimated chunks, byte counts, target bank, checkpoint path, and manifest path.

Chat dry-run shows kept event count, retained user-turn count, dropped event totals, malformed lines, target User Bank, content hash, and byte count.

Use these numbers to catch noisy imports before writing memory.

## Project session discovery

Project session discovery avoids broad history imports. It scans only the current session file's directory and keeps `.jsonl` files whose parsed `cwd` resolves to the current repo/cwd.

Equivalent path forms are treated as the same project, including trailing separators, `.` segments, `..` traversal that resolves back to the repo, and resolved absolute paths.

Approved-root discovery scans only the roots entered by the user, reads only a bounded JSONL prefix needed to parse the first nonblank session header, groups sessions by canonical `cwd`, and canonically deduplicates files reached through overlapping approved roots.

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
