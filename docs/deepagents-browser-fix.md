# Deep Agents browser compatibility fix

Status: the supported planning and file workflow passes in Chrome 156.0.8078.74.
This is a tested compatibility adapter in the Phase 0 experiment, not a released
runtime package. The configured remote model still has a separate invalid-tool-
arguments limitation described below.

## What changed

- Added reproducible pnpm patches for the locked LangSmith 0.9.0 and 0.11.5 ESM
  implementations. Browser mapping selects helpers that report native async
  context unavailable. Node keeps actual AsyncLocalStorage and snapshots.
- Guarded tracing initialization and stream snapshots. Browser tracing requests
  fail explicitly rather than pretending a no-op storage class preserves context.
- Added browser process, path, util, and Buffer implementations. Process env is
  empty in the trusted agent worker; no provider keys are compiled into it.
- Added real synchronous SHA-256 for Deep Agents' binary offload code, using
  `@noble/hashes`. Only the required algorithm and digest encodings are supported.
- Added `createBrowserDeepAgent`, which configures planning and passes execution
  state explicitly to file backends. Zero-argument StateBackend objects become
  per-tool runtime-bound instances without mutating the shared object.
- Rejects stale runtime-bound backends, hides and rejects subagent/shell tools,
  and waits for a worker-ready handshake before sending requests.

There is no async-hooks mock in the supported build. Browser ambient context is
still unavailable. The fix avoids needing it for the tested workflow; it does
not implement Node async context in a browser. The historical diagnostic mock
remains confined to the separate investigation build.

## Use and reproduce

From `experiments/phase0`:

```sh
pnpm install --frozen-lockfile
pnpm test:deepagents-fix
pnpm test:langsmith-node
```

The fix test builds `vite.fixed.config.js`, starts its own fixture, checks the
compiled worker, and closes it. Port 5173 must be free. Its compatible-endpoint
fixture also uses port 8765 temporarily. No real model credentials are needed.

The patches live in `patches/` and are registered in `pnpm-workspace.yaml` and
`pnpm-lock.yaml`. A fresh offline locked install reapplied them successfully;
this does not depend on hand-edited node_modules.

A worker integrating the adapter can use:

```js
import { createBrowserDeepAgent, StateBackend } from './browser-compat/agent.mjs';

const agent = createBrowserDeepAgent({
  model, // an explicitly configured browser/relay model adapter
  backend: new StateBackend(),
});
```

Use the resolver configuration from `browser-compat/vite.mjs` in both Vite's main
and worker builds, as shown by `vite.fixed.config.js`. Follow the ready-message
protocol in `browser-compat/main.mjs`; asynchronous module loading can otherwise
lose an early request. The adapter itself must run in the trusted worker.
Generated Python stays in its separate isolated execution environment.

## Verified behavior

The retained report is `experiments/phase0/evidence/deepagents-fix.json`.

- Plan creation/completion and write, edit, read, glob, grep, list, and delete.
- PNG read with preserved base64 bytes and a standard SHA-256 test vector.
- Runtime-factory and zero-argument backend forms.
- Two interleaved agents sharing a zero-argument backend object, with independent
  results. A backend captured from a different tool invocation is rejected.
- Graph value streaming with 36 observed state updates. The relay-model fixture
  currently buffers model text before returning; token streaming is later work.
- Cancellation propagated to the model and explicit subagent/shell denial.
- Browser tracing rejected and an empty process environment.
- A full OpenAI-compatible SSE round trip through the relay and Deep Agents.
  The fixture first returns malformed arguments, then valid ones after feedback.
  No tool executes for the malformed response; the subsequent plan/file workflow
  completes and the output is exact.
- Native Node async-context isolation and snapshots for both patched versions,
  plus untraced async-generator behavior.

The normal `pnpm test` suite includes the fix and Node checks after the earlier
Python isolation and relay regression checks. The raw-import baseline is still
expected to fail because it deliberately omits the compatibility adapter.

## Current real-provider limitation

`pnpm test:deepagents-fix:provider` reads the ignored project-root OPENAI_* settings
and sends the synthetic planning/file-copy task. This check has not passed for
Deep Agents with the current configured endpoint/model. It returns invalid JSON
for the nested `write_todos` arguments, including illegal backslash escapes.
The earlier explicit loop's simpler plan schema passed its provider check.

The relay model rejects malformed arguments before executing tools and permits
at most two regeneration attempts with ordinary parsing feedback. It never
repairs JSON or executes a malformed call. The deterministic compatible-endpoint
check proves this recovery path; the configured model continued to return
invalid arguments after feedback. Raw malformed calls are not replayed to strict
endpoints. The retained failure report contains no key, endpoint URL, or raw
response text.

This is separate from the browser startup/context fix. Validate another model
that emits valid arguments, or investigate this endpoint's tool-call encoding,
before claiming a complete real-model Deep Agents demo. Do not mark this optional
provider check passed based on the scripted fixture.

## Scope and maintenance

LangSmith browser tracing and ambient `getConfig()` helpers remain unsupported.
Custom tools must use explicit runtime/config inputs. Native Node semantics are
preserved; unsupported browser features fail explicitly.

The fixed build still reports a Node filesystem import in the SDK's remote
sandbox implementation. That implementation is outside the supported browser
backend and is not invoked by these checks. This is not a general Node emulator.
Remote sandboxes, skills, long-context summarization, deployment, and a broader
browser matrix require their own validation before they are advertised.

Keep the patches pinned and re-run Node, browser, binary-file, concurrency,
streaming, and cancellation checks on dependency upgrades. The existing Python
isolation design and its limits are unchanged. No upstream issue or pull request
was published as part of this change.
