# Phase 01: Establish the workspace and model relay

Status: completed. Deep Agents adapter promoted to typed package `@browser-agents/runtime`. Local FastAPI model relay running in `backend/`. Locked dependencies pinned and verified.

## Outcome

A reproducible development setup and a local relay supporting the user's endpoint, API key, and selected model, without a provider hardcoded into the agent runtime.

## Work

- [x] Create a pnpm workspace with `packages/runtime`, `packages/workspace`, `packages/python`, and `apps/demo`. Keep Python relay code in `backend/`. Adjust this proposed layout if phase 00 gives a concrete reason.
- [x] Configure strict TypeScript, React and Vite for the demo, and a uv-managed FastAPI/Pydantic relay. Pin compatible dependencies and commit lockfiles. Use Black and standard logging for Python.
- [x] Promote the tested Deep Agents adapter to the typed runtime package. Preserve the pinned LangSmith patches in the workspace lock/configuration, browser utilities in both main and worker builds, explicit runtime injection, planning middleware, and the worker-ready handshake. Keep tracing and subagent/shell capabilities disabled. Do not introduce a no-op async-hooks shim.
- [x] Verify a fresh locked install reapplies patches, native Node context still works, and browser planning/files/concurrent state checks pass after promotion.
- [x] Define shared protocol schemas for provider registration, model discovery, generation, cancellation, and typed errors. Keep provider credentials out of model messages and runtime events.
- [x] Register endpoint configurations through the trusted setup UI. Store API keys in relay memory and return a session-scoped provider ID. Support keyless endpoints. Clear active credentials when the relay session ends.
- [x] Fetch models through the relay and support manual model IDs when the endpoint lacks discovery. Normalize base URLs without guessing a provider.
- [x] Forward streamed chat and tool-call responses, abort on cancellation or client disconnect, and expose authentication, timeout, unsupported-protocol, and upstream errors without leaking keys.
- [x] Bind to loopback and restrict allowed UI origins. Protect provider setup and generation with a trusted-session mechanism; CORS alone is insufficient. Isolated generated code must not obtain that mechanism. Permit intentionally configured local endpoints, while preventing arbitrary per-request forwarding and unsafe redirect behavior.
- [x] Keep request bodies and credentials out of logs. Provide `.env.example` only for applicable nonsecret defaults and document transient key handling.
- [x] Add root commands for setup, dev, format, typecheck, test, and check. Add relevant pinned pre-commit hooks. Keep external model checks separate from deterministic local checks.

## Verification

- Local fake endpoints verified for model discovery, missing discovery fallback, fragmented SSE streams, tool-call responses, 401 authentication errors, and cancellation aborts via `packages/runtime/test/relay-protocol.test.mjs`.
- Second base URL verification passed without changing runtime code.
- Untrusted origins rejected with HTTP 403; unauthorized or missing session tokens rejected with HTTP 401/403.
- Sensitive credentials verified absent from logs, returned records, and error messages (`backend/tests/test_security_and_origins.py`).
- Native Node context isolation, snapshots, and untraced async generators verified (`packages/runtime/test/node-context.test.mjs`).
- Clean root check passes: Black format check, full TypeScript compiler project references (`tsc -b`), and pytest test suite.

## Exit check

A clean checkout can install locked dependencies and start the demo and relay with documented commands (`pnpm setup`, `pnpm dev`, `pnpm check`). Endpoint registration, discovery/manual selection, streaming, and cancellation pass local protocol checks. The runtime depends on a model adapter contract rather than React or a specific remote provider.
