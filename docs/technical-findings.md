# Phase 0 technical findings

Status: feasibility complete for the tested desktop Chrome configuration.
The experiments establish a route to the agreed MVP. They are not production
application components or a security audit. The historical feasibility
evidence is preserved in [docs/evidence](evidence/validated.json).

## Decisions

The original fallback was a small explicit browser-worker loop, which completed
planning and file operations against both a deterministic endpoint and the user's
configured real model. Following the compatibility fix, Deep Agents through the
tested browser adapter is the selected harness for later phases. Keep the explicit
loop as a protocol control. Its provider success does not prove that the same
model can produce Deep Agents' nested planning arguments.

Keep model access, file tools, and Python execution separate when promoting the
adapter into the TypeScript runtime. Phase 01 remains planned and unimplemented.

Use an opaque-origin iframe containing a disposable worker for the Python
execution experiment. The trusted page prepares and validates the approved
assets, then supplies bytes to the worker. The worker never receives model
credentials, relay tokens, other-chat files, or a general network/file bridge.

Keep the production relay in the planned Python stack. The Node relay here is
a disposable protocol experiment; it does not select the application's backend
language, add a server-side agent, or execute Python remotely.

## Environment and reproduction

Tested on 2026-10-31 with macOS arm64, Chrome 156.0.8078.74, Node 26.12.0,
pnpm 11.1.3, Vite 8.3.5, Deep Agents 1.16.2, LangChain core 1.3.2,
LangGraph 1.5.3, LangSmith 0.9.0, Playwright 1.64.1, and Pyodide 314.0.7.
Python packages were Python 3.14.2, NumPy 2.4.6, pandas 3.0.2, and
matplotlib 3.10.8. Dependency resolution is pinned by the experiment lockfile.

From `experiments/phase0`, run `pnpm install --frozen-lockfile`, `pnpm assets`,
`pnpm build`, and `pnpm test`. `pnpm test:all` additionally reads the ignored
root `.env` using `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_API_KEY` and
runs the real-provider check. Keys and provider URLs are omitted from reports.
See the experiment README for ports, individual commands, and platform limits.

## Framework comparison

The production build of the `deepagents/browser` probe produced a
1,650,995-byte uncompressed worker. Vite externalized Node dependencies including
crypto, async hooks, path, filesystem APIs, and util. The built worker failed
with `process is not defined`. The earlier development probe, after substituting
`process.env`, reached `AsyncLocalStorage is not a constructor`. Its fake model
therefore never exercised Deep Agents' planning and file tools.

This rejects this dependency/build configuration for the initial prototype,
not all possible browser integrations of Deep Agents. Further polyfills or
bundler-specific dependency substitutions would need their own correctness
checks. The bounded explicit loop satisfied the original feasibility gate without
those dependencies. The later compatibility fix provides the selected Deep
Agents path described below.

The chosen loop executes in a dedicated browser worker. It validates planning
and file-call arguments, preserves call IDs and tool results, limits tool steps
and stream sizes, and serializes mutations. Production persistence, full runtime
schemas, context management, and Python-tool integration remain in later phases.

## Follow-up Deep Agents diagnosis

A [five-build investigation](deepagents-browser-investigation.md) now separates
the initial Node-global failure, eager tracing async-storage initialization,
missing planning middleware in the fake-model probe, and ambient file-backend
context. With diagnostic globals/storage substitutions, explicit planning, and
the runtime-injected backend, basic Deep Agents planning and file operations
pass. The no-op storage alias does not implement async context, and zero-argument
StateBackend still fails. This corrects any interpretation that the initial
failure proves the core workflow cannot run in a browser. The original vanilla
configuration remains rejected. The supported adapter described below is now
the selected path, with its patches and limitations carried into the plans.

## Browser compatibility fix

The [browser adapter and pinned package patches](deepagents-browser-fix.md) now
pass planning, file operations, PNG reads, graph updates, cancellation, and
interleaved chat state without the diagnostic async-hooks alias. A deterministic
compatible endpoint also passes. The configured real model still emits malformed
nested planning arguments; that separate validation remains failed. The original
raw-import rejection remains reproducible, and full MVP runtime integration has
not been performed.

## Integrated Python isolation

An ordinary Pyodide worker could reach loopback through native fetch, Python
HTTP, and Python-to-JavaScript interop. That approach is rejected.

The integrated experiment uses `sandbox="allow-scripts"` without
`allow-same-origin`, so the frame and worker have an opaque origin. Its CSP
denies default resources and all network connections; only in-memory `blob:`
and `data:` connections are permitted. Script execution is limited to inline
bootstrap code, blobs, and the evaluation needed by this runtime. The policy
applies before startup and remains unchanged while generated code runs.

Chromium failed to start a module worker from this opaque frame. A classic
bootstrap worker can start and dynamically import the supplied module blobs.
The pinned Pyodide loader's classic-worker check required making
`globalThis.importScripts` unavailable before loading it. This is a tested
compatibility adjustment, not a network control. It needs reevaluation on
runtime/browser upgrades, and is a reason to retain startup regression tests.
No Pyodide source is rewritten.

The parent fetches a fixed manifest and validates SHA-256 hashes before transfer.
Wheel hashes come from Pyodide's lockfile; core assets come from the locked npm
package. The worker creates its own blob URLs and maps only fixed virtual asset
paths to those bytes. The CSP remains the network boundary even if generated
Python bypasses or replaces this asset resolver. Approved dependency packages
load successfully under that policy; arbitrary package installation is absent.

The design follows the browser's [worker CSP inheritance rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)
and uses Pyodide's [loader configuration](https://pyodide.org/en/stable/usage/api/js-api.html).
The tests establish the observed behavior for this configuration; those platform
documents alone do not establish that an application sandbox is secure.

## Passing checks

- Network denial before and after interpreter/package startup for loopback,
  the model relay, and an external endpoint.
- Network denial through Python HTTP, Python-to-JavaScript fetch, JavaScript
  functions, XHR, WebSocket, EventSource, WebTransport, dynamic script import,
  direct remote-worker creation, and a nested blob worker. Unsupported APIs
  cannot provide access; inconclusive timeouts fail the probe.
- No trusted localStorage/parent global, denied IndexedDB and origin storage,
  and separate files/variables across two chat interpreters.
- Trusted-side rejection of malicious output paths even when generated Python
  replaces its worker message handler and fabricates a response.
- CSV import, calculated mean 4.0, text output, and a valid 19,819-byte PNG.
- Path rejection, surfaced Python exceptions, infinite-loop termination with a
  responsive parent UI, and cancellation acknowledged by the trusted frame.
- Result-file persistence in the trusted origin's OPFS, page reload, and a fresh
  interpreter with old Python variables absent. This is a file recovery probe,
  not the later complete chat database.
- Fragmented UTF-8/CRLF/multiline SSE with complete tool calls and result replay;
  authentication errors, unexpected content type, malformed/truncated streams,
  upstream timeouts, session/origin rejection, and browser-abort propagation.
- A real model round trip using the user's `OPENAI_*` settings. The browser
  worker recorded two plan items, read the synthetic input, wrote an exact copy,
  and finished through four relay requests. No private user files were sent.

## Measurements

The scientific runtime asset closure contains 18 files totaling 30,975,885 bytes,
about 29.5 MiB. Three fresh browser contexts fetch these from a local fixture
with browser caching disabled by the response. The host filesystem and installed
runtime assets are warm. These are cold browser-session measurements, not a
first-download benchmark over a CDN.

Latest browser-session startup samples were 2836, 2864, 2865 ms.
Asset fetch and validation took 37–39 ms on the local fixture.
Actual samples and memory observations are stored in
[the sanitized evidence](evidence/validated.json).
WebAssembly buffer capacity is about 108 MiB after loading and chart generation.
It excludes JavaScript heaps, asset copies, browser overhead, and rendering.
The RSS sample sums the test browser's own processes after multiple interpreter
experiments. It includes shared-memory double counting and retained allocations,
so it is not a per-agent memory budget. Multi-chat memory use and asset-copy
lifetime need attention before enabling concurrent interpreters in the MVP.

## Limits and work for later phases

The tested isolation is a feasibility result on desktop Chrome, not proof against
every browser API, side channel, browser bug, denial of service, or memory
exhaustion. Browser/tab memory exhaustion is not isolated by a worker. Validate
this boundary again under the final application headers and production build.

The trusted frame accepts requests only from its parent and the host accepts
results only from that frame/channel and an active request ID. Generated-code
output remains untrusted. The current bridge demonstrates path/output checks;
complete schema, allocation, aggregate file limits, and protocol hardening belong
in the production executor. Outputs may intentionally become model context, so
blocked direct network access does not mean remote model calls are private.

There is no general workspace database, user-facing provider setup, production
FastAPI relay, durable chat history, model selector, or integrated agent Python
tool yet. Those are phases 01–05. The full MVP acceptance suite, browser matrix,
and deployment checks remain phase 06. Subagents and local inference stay deferred.

Phase 0 has no remaining required feasibility check for the declared target.
Implementation must preserve the tested boundary rather than reusing the
original unrestricted worker or treating these probes as a production release.
