# Phase 01: Establish the workspace and model relay

Status: planned, not started. Deep Agents is the selected harness; see the
[adapter and limits](../docs/deepagents-browser-fix.md).

## Outcome

A reproducible development setup and a local relay supporting the user's
endpoint, API key, and selected model, without a provider hardcoded into the
agent runtime.

## Work

- [ ] Create a pnpm workspace with `packages/runtime`, `packages/workspace`,
  `packages/python`, and `apps/demo`. Keep Python relay code in `backend/`.
  Adjust this proposed layout if phase 00 gives a concrete reason.
- [ ] Configure strict TypeScript, React and Vite for the demo, and a uv-managed
  FastAPI/Pydantic relay. Pin compatible dependencies and commit lockfiles.
  Use Black and standard logging for Python.
- [ ] Promote the tested Deep Agents adapter to the typed runtime package.
  Preserve the pinned LangSmith patches in the workspace lock/configuration,
  browser utilities in both main and worker builds, explicit runtime injection,
  planning middleware, and the worker-ready handshake. Keep tracing and
  subagent/shell capabilities disabled. Do not introduce a no-op async-hooks shim.
- [ ] Verify a fresh locked install reapplies patches, native Node context still
  works, and browser planning/files/concurrent state checks pass after promotion.
- [ ] Define shared protocol schemas for provider registration, model discovery,
  generation, cancellation, and typed errors. Keep provider credentials out of
  model messages and runtime events.
- [ ] Register endpoint configurations through the trusted setup UI. Store API
  keys in relay memory and return a session-scoped provider ID. Support keyless
  endpoints. Clear active credentials when the relay session ends.
- [ ] Fetch models through the relay and support manual model IDs when the
  endpoint lacks discovery. Normalize base URLs without guessing a provider.
- [ ] Forward streamed chat and tool-call responses, abort on cancellation or
  client disconnect, and expose authentication, timeout, unsupported-protocol,
  and upstream errors without leaking keys.
- [ ] Bind to loopback and restrict allowed UI origins. Protect provider setup
  and generation with a trusted-session mechanism; CORS alone is insufficient.
  Isolated generated code must not obtain that mechanism. Permit intentionally
  configured local endpoints, while preventing arbitrary per-request forwarding
  and unsafe redirect behavior.
- [ ] Keep request bodies and credentials out of logs. Provide `.env.example`
  only for applicable nonsecret defaults and document transient key handling.
- [ ] Add root commands for setup, dev, format, typecheck, test, and check.
  Add relevant pinned pre-commit hooks. Keep external model checks separate
  from deterministic local checks.

## Verification

Use local fake endpoints for model discovery, missing discovery, fragmented
streams, tool-call responses, authentication errors, disconnects, and aborts.
Verify a second base URL works without changing runtime code. Confirm invalid
sessions and untrusted browser origins cannot register or use providers.
Check that API keys are absent from logs, returned records, and error messages.
Retain the configured model's invalid planning-argument failure as explicit
compatibility evidence. Model discovery alone does not prove valid tool calling;
full Deep Agents/Python provider acceptance belongs to phases 04 and 06.

## Exit check

A clean checkout can install locked dependencies and start the demo and relay
with documented commands. Endpoint registration, discovery/manual selection,
streaming, and cancellation pass local protocol checks. The runtime depends on
a model adapter contract rather than React or a specific remote provider.
