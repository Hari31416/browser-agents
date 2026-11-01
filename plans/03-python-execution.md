# Phase 03: Implement isolated Python execution

Status: completed. Package `@browser-agents/python` implements an isolated execution boundary with Pyodide, verified package manifests, network denial CSP, workspace staging integration, multi-session management, and runaway code cancellation.

## Outcome

Python runs automatically inside the browser with approved packages, controlled workspace access, no external network access, and reliable cancellation.

## Work

- [x] Implement the execution boundary selected in phase 00. Keep Python and JavaScript interop outside the trusted application origin and credential context. Validate sender identity and message shape at every bridge.
- [x] Load pinned Pyodide, NumPy, pandas, and matplotlib assets through the application-controlled bootstrap. Lock execution down before accepting code. Do not expose an installation tool or arbitrary package download path.
- [x] Keep the Python iframe/worker separate from Deep Agents' trusted worker. Browser process/Buffer utilities and relay session tokens belong only to orchestration; do not transfer them into generated-code execution.
- [x] Define request IDs and typed responses for initialization, execution, stdout/stderr, errors, generated files, cancellation, and reset. Ignore stale responses from terminated workers.
- [x] Synchronize the current workspace snapshot into Python before execution. Return validated changed files using phase 02's commit contract. Protect the application workspace from traversal and unauthorized bridge requests.
- [x] Preserve variables within a live chat session. Give another chat a fresh interpreter, and reset variables when reopening or replacing a terminated interpreter. Document any resource-driven interpreter disposal.
- [x] Use a noninteractive matplotlib backend and return PNG files. Limit captured output, returned file sizes, and execution duration. Distinguish Python exceptions from initialization, storage, and interpreter failures.
- [x] Stop runaway code by terminating the execution worker if cooperative interruption is unavailable. Recreate it on the next request, with persisted files restored and variables reset. A timeout must stop work, not only stop waiting for a response.
- [x] Enforce the network policy against Python libraries and JavaScript interop, including relay access. Do not rely on a Python import denylist or API patches as the sole boundary. Report browser memory limits honestly; worker placement does not promise protection from every tab-wide out-of-memory condition.

## Verification

- Execution protocol, path safety, and error hierarchy verified in `packages/python/test/protocol.test.mjs`:
  - Path traversal attempts (`..`, `/.`, `/..`, `/../outside`, `/data/../../etc/passwd`) and null bytes are rejected.
  - Output files validation rejects malformed objects, non-Uint8Array data, single-file quota excess (> 5MB), and total quota excess (> 10MB).
  - Explicit error hierarchy: `PythonExecutionError`, `PythonTimeoutError`, `PythonCancelledError`, `PythonInitializationError`, `PythonSecurityError`, `PythonStorageError`.
  - Asset loader SHA-256 integrity verification and in-memory caching.
- Workspace snapshot synchronization and staging commit contract verified in `packages/python/test/staging-integration.test.mjs`:
  - File snapshots taken before execution and synced to virtual `/workspace`.
  - Generated output files diffed against snapshot to stage writes for modified/new files and deletes for removed files.
  - Atomic commit to `ChatWorkspace` with version incrementing and stale revision conflict handling.
- Full browser runtime verification with desktop Chrome in `packages/python/test/browser.test.mjs`:
  - Pyodide, NumPy 2.4.6, pandas 3.0.2, matplotlib 3.10.8 loaded and pinned via asset manifest.
  - CSV parsing, pandas dataframe analysis, NumPy calculations, and non-interactive matplotlib PNG chart rendering with valid header bytes `[137, 80, 78, 71, 13, 10, 26, 10]`.
  - Python HTTP (`pyfetch`), JavaScript `fetch`, `XMLHttpRequest`, `WebSocket`, `WebTransport`, `EventSource`, dynamic import, worker creation, `indexedDB`, `localStorage`, and relay POST egress probes all blocked with zero egress network leakage.
  - Variable persistence preserved across runs in the same chat session.
  - Cross-chat isolation verified: chat B cannot access variables from chat A.
  - Session reset clears variables while preserving persisted files.
  - Infinite-loop runaway execution (`while True: pass`) terminated cleanly via worker termination without locking the UI event loop.
  - Python exceptions captured and surfaced cleanly with tracebacks without crashing host.
  - Stdout output capping verified at 64,000 characters.

## Exit check

The Python service works independently of the agent. The approved packages produce downloadable results; errors and cancellation are bounded and visible. Network and credential isolation checks pass under the chosen browser setup. Persisted files survive execution termination, while interpreter state resets.
