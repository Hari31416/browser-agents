# Phase 02: Build persistent workspaces and run records

Status: planned. Depends on phase 01 contracts.

## Outcome

Each chat has persistent files, messages, plan state, and execution records.
Generated code sees only the files granted to its chat.

## Work

- [ ] Define chat, message, plan item, run, tool call, and file metadata schemas.
  Include schema versions, stable identifiers, timestamps, and terminal states
  such as completed, failed, cancelled, and interrupted.
- [ ] Implement a workspace interface for listing, bounded reads, writing,
  editing, deleting, and exporting files. Keep storage implementation details
  outside the agent and demo components.
- [ ] Validate OPFS for file bytes and IndexedDB for structured records. Define
  initialization, schema upgrades, unavailable-storage behavior, and an explicit
  error when a write exceeds quota.
- [ ] Normalize paths and reject traversal and malformed input. Bind workspace
  authority to trusted chat/session state, not a chat ID supplied by the model
  or Python. Decide and test filename collision and overwrite behavior.
- [ ] Import uploads as bytes, preserving text and binary files. Enforce and
  document initial per-file and workspace size limits. Export outputs without
  requiring a model request.
- [ ] Establish one authoritative persisted workspace and versioned file writes.
  Define how Python receives a snapshot and returns staged changes. Persist
  validated results only after execution completes; cancellation must not commit
  a partially transferred set of changes. Make failed-execution file behavior
  explicit before phase 03.
- [ ] Handle multiple open tabs by allowing one active writer per chat or by
  rejecting stale file revisions. Do not silently overwrite concurrent changes.
- [ ] Persist messages, plan changes, and tool lifecycle records without keys.
  Reconcile records marked running at startup to interrupted; do not replay them.
- [ ] Provide storage usage, deletion, and export operations. Warn clearly when
  durable storage is unavailable rather than claiming files will survive reopen.

## Verification

Test byte-for-byte import/export, text edits, path rejection, cross-chat denial,
quota failure, failed writes, concurrent revisions, and schema upgrade using
small local fixtures. Reopen storage and recover chats, plans, and files. Verify
an interrupted run never turns into a completed run or an automatic tool replay.

## Exit check

The workspace can be used without React or an LLM. File and record persistence
works across reopen, authority is scoped to the selected chat, and failure paths
preserve previously committed files. Python synchronization has a documented
contract ready for phase 03.
