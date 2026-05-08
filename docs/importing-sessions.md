# Importing Pi sessions

Historical import is optional backfill. It reads old Pi session JSONL files or gateway transcripts and writes deterministic Hindsight documents. Pi session imports also record checkpoint/manifest state so they can resume safely.

Live memory does not need import. After setup, normal retain starts from new completed agent turns.

## Start with guided setup

For first-time setup, prefer the `/hindsight` guided import prompt. It appears after config/template setup when import makes sense.

Guided import:

1. chooses the source type from the selected profile/template
2. previews first
3. shows counts and target bank
4. asks before writing memory
5. can refresh mental models after successful import

Project/coding setup offers repo-scoped Pi session import. User/assistant setup offers gateway transcript import into User memory.

## What can be imported

Pi Hindsight supports:

- current Pi session
- explicit Pi session JSONL file
- repo-scoped Pi sessions from the current session directory
- explicit gateway/chat transcript JSONL files for User memory

Pi session imports and gateway transcript imports are separate paths. They do not silently mix repo history with user conversation history.

## Use commands when you need control

Command shortcuts are useful after setup, for repeat imports, or for explicit files:

```text
/hindsight:import-current --dry-run
/hindsight:import-file /path/to/session.jsonl --dry-run
/hindsight:import-project-sessions --dry-run
```

If the preview looks right, rerun without `--dry-run`. Non-dry-run imports announce the start and require confirmation because they write memory plus local checkpoint/manifest files.

Use `--all-leaves` only when you intentionally want every fork leaf from a session file. Default import follows the current branch.

## Use tools for agent/script workflows

Tool equivalents:

```text
hindsight_import({ dryRun: true })
hindsight_import_gateway({ sourceFile: "/path/to/gateway.jsonl", dryRun: true })
```

`hindsight_import` targets Pi session JSONL. `hindsight_import_gateway` targets gateway/chat transcript JSONL and defaults to the configured User Bank.

## Preview output

Pi session dry-run shows document count, import mode/profile, raw and projected message counts, dropped successful tool output, kept tool errors, estimated chunks, byte counts, target bank, checkpoint path, and manifest path.

Gateway dry-run shows kept event count, retained user-turn count, dropped event totals, malformed lines, target User Bank, content hash, and byte count.

Use these numbers to catch noisy imports before writing memory.

## Project session discovery

Project session discovery avoids broad history imports. It scans only the current session file's directory and keeps `.jsonl` files whose parsed `cwd` resolves to the current repo/cwd.

Equivalent path forms are treated as the same project, including trailing separators, `.` segments, `..` traversal that resolves back to the repo, and resolved absolute paths.

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
