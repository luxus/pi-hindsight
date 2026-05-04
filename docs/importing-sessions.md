# Importing Pi sessions

Historical import is for seeding or rebuilding Hindsight memory from Pi session JSONL files.

## What can be imported

The extension supports:

- current Pi session
- explicit JSONL session file
- all repo-scoped JSONL sessions in the current session directory
- explicit gateway/chat transcript JSONL files for user memory

Pi session imports write deterministic document IDs and update an import manifest summarized in `/hindsight`. Gateway transcript imports use a separate explicit tool path and do not share the repo-session import flow.

## Preview first

Preview imports before writing memory:

```text
/hindsight:import-current --dry-run
/hindsight:import-file /path/to/session.jsonl --dry-run
/hindsight:import-project-sessions --dry-run
```

Tool equivalents:

```text
hindsight_import({ dryRun: true })
hindsight_import_gateway({ sourceFile: "/path/to/gateway.jsonl", dryRun: true })
```

Pi session preview output includes document count, import mode, raw message count, curated projection count, dropped non-error tool-result count, kept tool-error count, estimated chunk count, byte counts, update mode, target bank, checkpoint path, and manifest path. Curated projection metrics show likely import noise without replacing the raw structured source payload.

Gateway preview output includes kept event count, retained user-turn count, dropped event count/type totals, malformed-line count, target user bank, content hash, and byte count.

## Guided setup import prompt

Guided setup offers historical import after config/template setup. It always previews first. Project/coding setup offers repo-scoped Pi session import; user/assistant setup offers gateway transcript import. After a successful setup import, Pi can explicitly refresh the target mental models from the selected bank template and shows returned operation IDs/status. You can skip import or refresh and run the tools later.

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

## Gateway transcript import

Gateway import is explicit and separate from Pi session import:

```text
hindsight_import_gateway({ sourceFile: "/path/to/gateway.jsonl", dryRun: true })
```

By default it targets the configured user bank. Pass `bank` only when intentionally importing into a different bank.

Accepted event type keys are `type`, `event`, `event_type`, and `kind`. High-signal events retained as source material are:

- `user_message`
- `assistant_reply`
- `process_end`

Streaming/UI/process noise such as `message_update` and `extension_ui_request` is dropped by default and counted in dry-run metrics. Gateway provenance is preserved with tags/metadata when present: `channel`, `channel_id`, `session_id`, `sessionId`, `conversation_id`, `conversationId`, and `thread_id`. Raw provenance values stay in metadata; tag values are normalized.

If no high-signal events are found, gateway import skips writing instead of creating an empty memory document.

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

## Import modes

The default import mode is `curated`. It keeps deterministic raw historical documents as the retained source payload, then computes projection metrics using the live retain filter so previews show how much successful tool-output noise is likely irrelevant.

Use `raw` when you want the previous branch-document behavior without curated drop metrics. Raw mode still filters Hindsight recall blocks to avoid re-retaining injected memory.

Use `forensic` only for audit/recovery. It preserves recall blocks and other normally filtered records, so preview output includes an explicit warning.

## Safety

Imports retain structured raw conversation content, not summaries. Secret redaction still applies. Recalled memory blocks injected by this extension are filtered in `curated` and `raw` modes so they are not retained back into Hindsight. Import previews compute curated projection metrics using the live retain filter.
