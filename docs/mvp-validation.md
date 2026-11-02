# MVP validation and delivery report

Status: verified on macOS arm64 with desktop Google Chrome.  
Delivery corresponds to Phase 06 completion of the implementation roadmap.

## Executive summary

The browser-agents Minimum Viable Product (MVP) has been implemented, validated, and packaged for reproducible delivery. The system executes agent orchestration, tool coordination, local file management, and sandboxed Python code directly inside the client browser. Model access is mediated through a dedicated local relay that enforces origin verification, per-session authentication tokens, and strict transient credential storage in server memory without persisting API keys to disk or exposing them to generated code.

All automated test suites pass deterministically across backend, workspace storage, sandboxed Python runtime, agent coordination, and UI demo components. Playwright-driven browser verification confirms complete network denial for generated Python code, cross-chat isolation, and full recovery across page reloads.

## Verification suite results

All checks were executed from committed clean-checkout configurations using committed lockfiles.

### Summary of test suites

- Format check: `pnpm format:check` (Black 24.8.0 on Python backend) - Passed with 0 violations.
- TypeScript compiler checks: `pnpm typecheck` (`tsc -b` on all workspaces and demo application) - Passed with 0 errors.
- Backend relay suite: `pnpm test:backend` (`pytest` on FastAPI service) - 6 passed in 0.17s.
  - `tests/test_chat_and_stream.py`: Multi-turn chat streaming, SSE chunking, error handling.
  - `tests/test_security_and_origins.py`: Loopback binding, origin verification, upstream URL safety.
  - `tests/test_session_and_providers.py`: Session tokens, provider registration, memory credential purging.
- Workspace storage suite: `pnpm test:workspace` - 6 test files passed.
  - `test/path.test.mjs`: Path normalization, directory traversal rejection (`..`, root escapes).
  - `test/records.test.mjs`: Memory and IndexedDB record stores, revision incrementing, metadata reconciliation.
  - `test/workspace.test.mjs`: File operations, text and binary storage, OPFS compatibility.
  - `test/staging.test.mjs`: Python execution atomic file staging, rollback on error, commit on success.
  - `test/concurrency.test.mjs`: Tab locking, stale revision detection, multi-tab write conflict prevention.
  - `test/storage-detection.test.mjs`: Detection of OPFS and IndexedDB capabilities with fallback.
- Python execution suite: `pnpm test:python` - 2 test files passed.
  - `test/protocol.test.mjs`: Worker message protocol, input/output serialization, error encoding.
  - `test/staging-integration.test.mjs`: Staging integration with Python file generation.
- Python browser isolation suite: `pnpm test:python:browser` (Playwright with Chrome) - Passed.
  - Pyodide runtime bootstrap and diagnostics verification (Python 3.14, NumPy 2.4, pandas 3.0, matplotlib 3.10).
  - Isolation probes: direct fetch, XHR, WebSockets, WebTransport, EventSource, dynamic imports, parent DOM access, and storage APIs all verified blocked.
  - Network egress sentinel check: 0 egress requests leaked during execution.
  - Execution of pandas CSV processing and Matplotlib PNG chart generation.
  - Infinite loop execution interrupted cleanly via worker termination.
  - Output truncation verified when stdout exceeds limits.
- Agent runtime suite: `pnpm test:runtime` - 10 verification scenarios passed.
  - Multi-step plan, file, and Python execution sequence.
  - Second compatible endpoint without changing orchestration loop.
  - Step limit enforcement (runaway loop protection).
  - Context message limit enforcement.
  - Concurrent run rejection per chat session.
  - Python error feedback and bounded correction attempt.
  - Tool output capping and truncation.
  - Cancellation signal propagation.
  - Security boundary enforcement on tool file paths.
  - Malformed tool argument rejection and recovery.
- Demo UI workflow suite: `pnpm test:demo` - 6 verification scenarios passed.
  - Markdown sanitizer and active content (`<script>`, `<iframe>`, inline event handler) isolation.
  - Nonsecret preference persistence and credential redaction in request inspector.
  - History and workspace file persistence across simulated reload with Python interpreter reset.
  - Chat archive export integrity (JSON format with messages, files, and plans).
  - Concurrency rejection during active execution.
  - End-to-end multi-step analysis workflow with plan tracking and output generation.
- Production build: `pnpm build` (`tsc` and Vite production bundle) - Generated minified, tree-shaken static assets.

## Acceptance scenarios matrix

| Acceptance scenario | Test evidence / verification mechanism | Result |
| - | - | - |
| Configure compatible endpoints without changing agent code | `packages/runtime/test/agent-runtime.test.mjs` (Test 2) and `backend/tests/test_session_and_providers.py` | Verified. Switching endpoint configuration operates through identical runtime contracts. |
| Select model from discovery or enter manually | `apps/demo/src/components/ProviderModal.tsx` and `backend/src/relay/client.py` | Verified. Dynamic model listing with text input fallback. |
| Multi-step CSV analysis with plan, Python, and downloadable chart | `packages/python/test/browser.test.mjs`, `apps/demo/test/chat-demo.test.mjs` (Test 6) | Verified. CSV processed by pandas, matplotlib PNG saved and downloadable. |
| Transform JSON/text file and download result | `packages/workspace/test/workspace.test.mjs` and `packages/runtime/test/agent-runtime.test.mjs` | Verified. File read, modified, written, and retrievable via UI download. |
| Expose Python error to agent for bounded retry | `packages/runtime/test/agent-runtime.test.mjs` (Test 6) | Verified. Python syntax/runtime errors returned to model for retry within step limit. |
| Cancel infinite loop and maintain usable UI | `packages/python/test/browser.test.mjs` and `packages/runtime/test/agent-runtime.test.mjs` (Test 8) | Verified. Worker terminated immediately, UI state transitions to cancelled. |
| Block network from Python and JS interop | `packages/python/test/browser.test.mjs` and `evidence/validated.json` | Verified. 0 egress requests detected at sentinel proxy; opaque iframe origin enforces policy. |
| Confirm code cannot read credentials or access other chats | `packages/workspace/test/workspace.test.mjs` and `packages/python/test/browser.test.mjs` | Verified. Credentials stored in relay memory only; chat files separated by chatId namespace. |
| Reopen app and recover history with fresh interpreter | `apps/demo/test/chat-demo.test.mjs` (Test 3) and `packages/workspace/test/records.test.mjs` | Verified. Chat messages and workspace files restored; Python session reinitialized from scratch. |
| Confirm subagents and arbitrary package installation absent | `packages/runtime/src/agent.ts` and `packages/python/src/session.ts` | Verified. Explicit check rejects subagent configurations; Pyodide environment pinned to preloaded wheels. |

## External provider smoke-testing results

Smoke tests were conducted using user-configured credentials in `.env` against the live endpoint.

### Tested endpoint

- Base URL: `https://cloud.olakrutrim.com/v1` (OpenAI-compatible)
- Date: 2026-11-02
- Auth: Bearer token registered transiently through local relay session

### Observed model behaviors

1. Model: `gemma-4-26B-A4B-it`
   - Model listing and chat streaming: Supported.
   - Tool calling: Emitted malformed JSON argument payloads containing raw template tokens (`<|\` and `<|\"`), resulting in `SyntaxError: Bad escaped character in JSON at position 27`.
   - Classification: Incompatible with strict JSON function calling schemas without model-side tokenizer repairs.

2. Model: `gpt-oss-120b`
   - Model listing and chat streaming: Supported.
   - Tool calling: Fully supported.
   - Planning and Python execution: Generated valid nested JSON arguments for `write_todos` and `execute_python`.
   - Workflow: Successfully executed multi-step planning, Python computation (`15 * 4 = 60`), plan progression to completed status, and final streaming explanation.
   - Classification: Compatible. Fully validated with Deep Agents runtime.

3. Model: `gpt-oss-20b`
   - Model listing and chat streaming: Supported.
   - Tool calling: Fully supported.
   - Planning and Python execution: Generated valid nested JSON arguments for `write_todos` and `execute_python`.
   - Workflow: Successfully executed multi-step planning, Python computation, and final response.
   - Classification: Compatible.

### Note on second distinct endpoint

Only a single external provider (`cloud.olakrutrim.com`) was configured with active API credentials in the environment. In accordance with delivery guidelines, synthetic or mock endpoints are not substituted to claim second-provider validation. Verification on a second distinct external commercial endpoint (e.g., OpenAI or Groq) remains an unrun check pending user credential provisioning.

## System boundaries and limits

### Execution limits

- Maximum tool execution steps per run: 25 steps (configurable via `RuntimeLimits.maxSteps`).
- Maximum context history messages: 50 messages (configurable via `RuntimeLimits.maxContextMessages`).
- Maximum Python execution timeout: 60,000 ms (60 seconds).
- Maximum tool output length: 64,000 characters (truncated with trailing notice if exceeded).
- Upstream relay stream payload limit: 2,000,000 bytes (2 MB).
- Upstream relay request timeout: 60.0 seconds.

### Storage limits

- Maximum single file size: 50 MB (`DEFAULT_STORAGE_LIMITS.maxFileBytes`).
- Maximum workspace quota: 200 MB (`DEFAULT_STORAGE_LIMITS.maxWorkspaceBytes`).
- Storage engines: Origin Private File System (OPFS) with in-memory fallback for files; IndexedDB with in-memory fallback for chat and plan records.

### Network and security isolation boundary

- Generated Python runs within an isolated Web Worker instantiated inside an opaque-origin iframe (`sandbox="allow-scripts"` without `allow-same-origin`).
- Content Security Policy (CSP): `default-src 'none'; script-src 'unsafe-eval' blob:; connect-src blob: data:`.
- Relay origin verification: Requests to `http://127.0.0.1:8765` require `Origin` header matching allowed UI origins (`http://127.0.0.1:5173`, `http://localhost:5173`, `http://127.0.0.1:4173`, `http://localhost:4173`).
- Relay session tokens: 32-byte cryptographically random token passed via `X-Relay-Session` header.
- Credential lifetime: API keys are stored exclusively in relay memory associated with the active session and wiped on session delete, relay restart, or application shutdown.

## Performance and resource measurements

Measurements collected on macOS arm64 with Chrome 156.0:

- Pyodide asset load time: 37 ms - 39 ms (from warm local static server).
- Python runtime initialization: 2,744 ms - 2,776 ms (~2.7 seconds).
- Total Pyodide package size: ~30.9 MB (core wasm, python stdlib, numpy, pandas, matplotlib wheels).
- WebAssembly memory capacity: ~113 MB.
- Production bundle size: Frontend assets total ~1.6 MB minified, ~500 KB gzip compressed.

## Deployment and containerization

The application supports local containerized execution preserving all security boundaries:

- `backend/Dockerfile`: Minimal Python 3.12-slim image running FastAPI via Uvicorn.
- `apps/demo/Dockerfile`: Multi-stage build compiling TypeScript packages and Vite demo app, served via Nginx.
- `apps/demo/nginx.conf`: Configured with mandatory isolation headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- `docker-compose.yml`: Coordinates frontend on port 5173 and relay on port 8765 with network linkage and origin permissions.

## Follow-up milestones

- Local inference adapter: Integration of WebGPU-based browser models (e.g., WebLLM) implementing the existing `BaseChatModel` contract.
- Subagents: Multi-agent coordination with explicit context isolation and resource budgeting.
- User package additions: Dynamic runtime wheel loading for user-specified pure-Python libraries.
