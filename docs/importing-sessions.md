# Importing Pi sessions

Historical import is for seeding or rebuilding Hindsight memory from Pi session JSONL files.

## What can be imported

The extension supports:

- current Pi session
- explicit JSONL session file
- all repo-scoped JSONL sessions in the current session directory

Imports write deterministic document IDs and update an import manifest summarized in `/hindsight`.

## Preview first

Preview imports before writing memory:

```text
/hindsight:import-current --dry-run
/hindsight:import-file /path/to/session.jsonl --dry-run
/hindsight:import-project-sessions --dry-run
```

Tool equivalent:

```text
hindsight_import({ dryRun: true })
```

Preview output includes document count, raw message count, curated projection count, dropped non-error tool-result count, byte counts, update mode, target bank, checkpoint path, and manifest path. The curated projection metrics show likely import noise without replacing the raw structured source payload.

## Import commands

```text
# Import current session, current branch only.
/hindsight:import-current

# Import every fork leaf in an explicit session file.
/hindsight:import-file /path/to/session.jsonl --all-leaves

# Import sessions in the active session directory whose parsed cwd belongs to this repo.
/hindsight:import-project-sessions
```

Use `--all-leaves` only when you explicitly want every fork leaf. The default imports only the current branch.

Non-dry-run import commands announce the start and require confirmation because they write memory and update local checkpoint/manifest files.

## Project session discovery

Project session discovery intentionally avoids broad history imports. It scans only the current session file's directory and keeps only `.jsonl` files whose parsed `cwd` normalizes to the current repo/cwd.

Equivalent path forms are treated as the same project:

- same absolute path
- trailing separators
- `.` segments
- `..` traversal that resolves back to the repo
- resolved absolute paths

## Document IDs and update modes

Imports use deterministic document IDs based on session and branch leaf identity.

Historical imports default to deterministic replace semantics so reimporting the same document updates the same Hindsight document instead of appending duplicates.

Live sessions still use stable live-session document IDs with `updateMode: "append"`.

## Manifest and checkpoint files

Default paths:

```text
.pi/hindsight/import-manifest.json
.pi/hindsight/import-checkpoint.json
```

The checkpoint records document delivery state so interrupted imports can resume. When `import.resume` is enabled, completed documents are skipped instead of retained again.

If an import is queued but not delivered because Hindsight is unavailable, the checkpoint records the document as `queued` and the retain queue keeps the job for later flushing.

## Rebuilding a cleared bank

To rebuild from historical sessions after clearing a Hindsight bank, remove or move:

```text
.pi/hindsight/import-checkpoint.json
.pi/hindsight/import-manifest.json
```

Then rerun the import. Use `--dry-run` first.

## Safety

Imports retain structured raw conversation content, not summaries. Secret redaction still applies. Recalled memory blocks injected by this extension are filtered so they are not retained back into Hindsight. Import previews also compute curated projection metrics using the live retain filter so you can see how much tool-output noise future curated import modes could drop.
