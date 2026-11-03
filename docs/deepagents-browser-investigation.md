# Deep Agents browser investigation

Status: reproduced with a five-build diagnostic matrix on Chrome 156.0.8078.74.
The original Phase 0 implementation was committed first as `f50861b`.

## Browser fix follow-up

A [supported browser adapter](deepagents-browser-fix.md) now addresses the
initialization and required file/planning workflow without the diagnostic
async-hooks alias. The matrix below records the original unpatched findings.
Its original evidence remains in `docs/evidence/deepagents-diagnostics.json`.
The diagnostic command now runs against patched dependencies and writes
`docs/evidence/deepagents-diagnostics-after-fix.json`; its globals-only variant passes.

## Result

The initial failure is a combination of browser packaging/dependency problems
and an incomplete planning probe. Deep Agents' basic plan/write/read workflow
can execute in a browser worker after diagnostic adjustments. This is narrower
than a supported, reliable browser integration.

The explicit loop was the original Phase 0 fallback. The subsequent supported
adapter is now the selected Deep Agents path for later phases. It uses explicit
runtime state. Do not promote the historical
no-op async storage shim to the application runtime.

## Reproduce

From `experiments/phase0`:

```sh
pnpm install --frozen-lockfile
pnpm test:deepagents-diagnostics
```

The command builds five variants, starts its own loopback fixture, runs Chrome
assertions, saves `evidence/deepagents-diagnostics.json`, and stops its services.
Port 5173 must be free. No provider configuration, API key, or network model call
is used. Builds and source maps stay in the ignored `dist-investigation/` folder.
Build logs stay in ignored `results/`.

Versions are Deep Agents 1.16.2, LangChain 1.6.0, LangChain core 1.3.2,
LangGraph 1.5.3, and the original Deep Agents LangSmith peer 0.9.0. Core and
LangChain also resolve their own newer LangSmith dependency. Declaring the
planning middleware as a direct dependency briefly caused pnpm to deduplicate
Deep Agents' peer to an incompatible newer version. Explicitly pinning its
original 0.9.0 peer restored the original combination before the final matrix.
The evidence includes the resolved versions.

## Observed matrix

| Build | Adjustment | Actual result |
| --- | --- | --- |
| `baseline` | Original browser configuration | Startup fails: `process is not defined` |
| `globals` | Define platform/version constants in addition to the existing empty environment | Startup fails: `AsyncLocalStorage is not a constructor` |
| `mock-context` | Also alias async hooks to a diagnostic no-op | File write/read pass; planning calls return tool errors |
| `mock-planning` | Also explicitly add `todoListMiddleware()` | Plan creation/completion and file write/read pass |
| `mock-ambient` | Same adjustments, but construct `new StateBackend()` | Fails reading `configurable` from missing execution context |

The test checks tool errors, resulting file content, and completed plan state.
An invocation returning normally is insufficient: the planning-free variant
returns an agent result while its `write_todos` calls are errors.

## First failure: file matching assumes a Node global

The import chain includes `deepagents/browser`, its shared implementation chunk,
`micromatch`, and `picomatch/lib/utils.js`. Picomatch evaluates this at module
load time:

```js
const win32 = process.platform === 'win32';
```

It also reads `process.version` for regex feature detection. Browsers do not
provide `process`. Our Vite configuration defined only `process.env`, which
cannot satisfy these other property accesses.

The diagnostic build substitutes `process.platform` and `process.version` with
browser constants. This removes the first failure without exposing the host
process environment. It is deliberately limited to this experiment; a maintained
browser-compatible matcher or reviewed build adapter is preferable to pretending
the browser is a complete Node process.

## Second failure: tracing initializes Node async storage eagerly

The Deep Agents browser export still imports a shared chunk that references
`langsmith/traceable`. LangSmith's tracing implementation imports
`AsyncLocalStorage` from `node:async_hooks` and constructs it during module
initialization. The dependency graph includes similar tracing imports through
LangChain/core as well.

Vite externalizes that Node module for the browser. Its replacement does not
implement `AsyncLocalStorage`, so the constructor fails before agent invocation.
Disabling tracing through an environment flag does not avoid this unconditional
module initialization in the tested code.

`investigation/mock-async-hooks.mjs` provides only `getStore() => undefined` and
callback execution to get beyond initialization. It proves that this import is
a blocker. It does not implement async context propagation, tracing, or nested
run semantics, and is labelled diagnostic-only in the source and evidence.

The remaining Node crypto, filesystem, path, and util build warnings are not
all equivalent to an observed startup failure. The narrow planning/file test
passes while some of these imports are still externalized. Unexercised skills,
matching options, hashing, and sandbox integrations would need separate checks.

## Third failure: the fake model did not receive a planning tool

The original fake model identifies itself as `phase0-fake`. In the tested
Deep Agents version, planning middleware is not in its common default stack;
some registered model profiles add it through extra middleware. Our unknown
fake model did not select such a profile.

Calling `write_todos` therefore produced an invalid-tool result. Adding
`middleware: [todoListMiddleware()]` explicitly supplies it. The corrected fake
model records a plan, writes `/result.txt`, reads its contents, and marks the
plan complete. This is a probe configuration correction, not evidence that
planning is inherently incompatible with a browser.

## Fourth failure: ambient execution context is unavailable

There are two relevant file backend forms:

```js
backend: runtime => new StateBackend(runtime)
backend: new StateBackend()
```

The first receives state explicitly and passes the diagnostic workflow. It is
also the tested version's default factory form, although its implementation
labels the backend mode legacy. The second reads state through LangGraph's
ambient `getConfig()` helper. The browser build does not initialize Node async
storage, and the diagnostic shim supplies no context. `getConfig()` returns
undefined, after which the backend reads `getConfig().configurable` and fails.

This demonstrates why getting past the constructor with a no-op alias is not a
complete fix. A custom browser workspace backend should use explicit runtime
inputs rather than depending on implicit Node execution context.

## Implications for this project

A maintained integration would need browser-safe tracing initialization, reviewed
file-matching dependencies, explicit planning configuration, and a workspace
backend that works without ambient context. It must also test cancellation,
streaming, concurrent runs, and the actual tool adapter contracts before replacing
the selected runtime. The diagnostic matrix uses a fake model and in-memory
files; it does not claim Deep Agents' real-provider or Python integration passes.

The observed bound tools also include `task` despite `subagents: []`. The library
creates a general-purpose subagent by default. An adopted configuration would
need to disable/exclude that capability to preserve the agreed first-version
scope; an empty custom subagent array alone is insufficient.

Related upstream reports provide context, not substitutes for these local tests:
[browser build imports](https://github.com/langchain-ai/deepagentsjs/issues/292)
and [browser StateBackend context](https://github.com/langchain-ai/deepagentsjs/issues/834).
The latter reports the same explicit-runtime versus ambient-context distinction
on an earlier dependency combination. Neither report establishes that every
current version has the exact behavior of our pinned experiment.
