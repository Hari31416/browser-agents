# Phase 02: Build persistent workspaces and run records

Status: completed. Package `@browser-agents/workspace` implements scoped file stores, structured record storage, path security, quotas, concurrency locking, and Python execution staging. Verified with comprehensive test suites.

## Outcome

Each chat has persistent files, messages, plan state, and execution records.
Generated code sees only the files granted to its chat.

## Work

- [x] Define chat, message, plan item, run, tool call, and file metadata schemas.
  Include schema versions, stable identifiers, timestamps, and terminal states
  such as completed, failed, cancelled, and interrupted.
- [x] Implement a workspace interface for listing, bounded reads, writing,
  editing, deleting, and exporting files. Keep storage implementation details
  outside the agent and demo components.
- [x] Validate OPFS for file bytes and IndexedDB for structured records. Define
  initialization, schema upgrades, unavailable-storage behavior, and an explicit
  error when a write exceeds quota.
- [x] Normalize paths and reject traversal and malformed input. Bind workspace
  authority to trusted chat/session state, not a chat ID supplied by the model
  or Python. Decide and test filename collision and overwrite behavior.
- [x] Import uploads as bytes, preserving text and binary files. Enforce and
  document initial per-file and workspace size limits. Export outputs without
  requiring a model request.
- [x] Establish one authoritative persisted workspace and versioned file writes.
  Define how Python receives a snapshot and returns staged changes. Persist
  validated results only after execution completes; cancellation must not commit
  a partially transferred set of changes. Make failed-execution file behavior
  explicit before phase 03.
- [x] Handle multiple open tabs by allowing one active writer per chat or by
  rejecting stale file revisions. Do not silently overwrite concurrent changes.
- [x] Persist messages, plan changes, and tool lifecycle records without keys.
  Reconcile records marked running at startup to interrupted; do not replay them.
- [x] Provide storage usage, deletion, and export operations. Warn clearly when
  durable storage is unavailable rather than claiming files will survive reopen.

## Verification

- Path validation verified in `packages/workspace/test/path.test.mjs`: relative POSIX paths, rejection of traversal (`..`, `../`), null bytes, control characters, Windows drive letters, and UNC paths.
- Records and startup reconciliation verified in `packages/workspace/test/records.test.mjs`: chat CRUD, message sequencing, plan item tracking, run and tool call lifecycle, and automatic reconciliation of `running` runs and `running`/`pending` tool calls to `interrupted`.
- File operations and cross-chat isolation verified in `packages/workspace/test/workspace.test.mjs`: byte-for-byte fidelity for binary and text files, bounded reads with truncation flags, text search-and-replace editing, cross-chat access denial, and per-file (50MB default) and workspace (200MB default) quota enforcement.
- Python staging and atomic commit verified in `packages/workspace/test/staging.test.mjs`: execution snapshot creation, isolated staging of writes and deletes, conflict rejection on stale revision, rollback of partial writes on failure, and clean discard on cancellation without touching committed files.
- Optimistic locking and multi-tab safety verified in `packages/workspace/test/concurrency.test.mjs`: `expectedVersion` tracking and stale revision rejection on writes, edits, and deletions.
- Storage capability detection and warning verified in `packages/workspace/test/storage-detection.test.mjs`: automatic fallback to memory store with durable storage warnings when OPFS and IndexedDB are unavailable.

## Exit check

The workspace can be used without React or an LLM. File and record persistence works across reopen, authority is scoped to the selected chat, and failure paths preserve previously committed files. Python synchronization has a documented contract ready for phase 03.
