# Phase 03: Implement isolated Python execution

Status: planned. Depends on phases 00 and 02.

## Outcome

Python runs automatically inside the browser with approved packages, controlled
workspace access, no external network access, and reliable cancellation.

## Work

- [ ] Implement the execution boundary selected in phase 00. Keep Python and
  JavaScript interop outside the trusted application origin and credential
  context. Validate sender identity and message shape at every bridge.
- [ ] Load pinned Pyodide, NumPy, pandas, and matplotlib assets through the
  application-controlled bootstrap. Lock execution down before accepting code.
  Do not expose an installation tool or arbitrary package download path.
- [ ] Keep the Python iframe/worker separate from Deep Agents' trusted worker.
  Browser process/Buffer utilities and relay session tokens belong only to
  orchestration; do not transfer them into generated-code execution.
- [ ] Define request IDs and typed responses for initialization, execution,
  stdout/stderr, errors, generated files, cancellation, and reset. Ignore stale
  responses from terminated workers.
- [ ] Synchronize the current workspace snapshot into Python before execution.
  Return validated changed files using phase 02's commit contract. Protect the
  application workspace from traversal and unauthorized bridge requests.
- [ ] Preserve variables within a live chat session. Give another chat a fresh
  interpreter, and reset variables when reopening or replacing a terminated
  interpreter. Document any resource-driven interpreter disposal.
- [ ] Use a noninteractive matplotlib backend and return PNG files. Limit
  captured output, returned file sizes, and execution duration. Distinguish
  Python exceptions from initialization, storage, and interpreter failures.
- [ ] Stop runaway code by terminating the execution worker if cooperative
  interruption is unavailable. Recreate it on the next request, with persisted
  files restored and variables reset. A timeout must stop work, not only stop
  waiting for a response.
- [ ] Enforce the network policy against Python libraries and JavaScript interop,
  including relay access. Do not rely on a Python import denylist or API patches
  as the sole boundary. Report browser memory limits honestly; worker placement
  does not promise protection from every tab-wide out-of-memory condition.

## Verification

Run CSV analysis, JSON transformation, chart generation, Unicode paths, binary
output, Python exceptions, repeated execution, and a fresh-session reset.
Exercise infinite-loop cancellation, excessive output, staged file interruption,
and runtime-load failure. Verify denied network attempts with local observation
and test that ordinary user Python code cannot invoke trusted bridge operations
to access another workspace or provider configuration.

## Exit check

The Python service works independently of the agent. The approved packages
produce downloadable results; errors and cancellation are bounded and visible.
Network and credential isolation checks pass under the chosen browser setup.
Persisted files survive execution termination, while interpreter state resets.
