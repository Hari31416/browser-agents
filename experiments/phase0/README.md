# Phase 0 experiments

These are executable feasibility probes using synthetic data. They are not the
MVP, a production relay, or a general-purpose security sandbox.

## Run the current suite

Requirements: Node with `--env-file` support, pnpm, and desktop Chrome. Set
`CHROME_PATH` if Chrome is not at its standard macOS location. Run from this
directory:

```sh
pnpm install --frozen-lockfile
pnpm assets
pnpm build
pnpm test
```

Asset preparation downloads the approved package dependency closure from the
pinned Pyodide distribution and verifies wheel hashes from its lockfile. Runtime
core files come from the locked npm package. Prepared assets total about 30 MB
and are ignored by Git. The browser verifies the generated manifest before
transferring bytes into execution. Re-run preparation after dependency changes.

`pnpm test` starts and stops its own static fixture on port 5173, runs the
production-built framework comparison, the integrated isolated Python checks,
and the deterministic relay protocol suite. Port 8765 is used temporarily for
the relay. An occupied port is an error; the runner does not kill other services.

On macOS the measurement probe samples RSS for processes belonging to its own
Chrome instance using `/bin/ps`. This is an approximate sum, not unique memory.
Adapt this measurement if running the probe on another operating system.

## Real-provider check

Create the ignored project-root `.env`, using the root `.env.example` as a guide:

```dotenv
OPENAI_BASE_URL=https://your-compatible-endpoint.example/v1
OPENAI_API_KEY=your-key
OPENAI_MODEL=your-model-id
```

Keep the key empty for a keyless endpoint. A base URL is extended with
`/chat/completions`; an already complete chat-completions URL also works.
The real check sends only a fixed synthetic planning and file-copy task.
It uses the configured endpoint and can incur provider usage.

```sh
pnpm test:all
```

This runs the deterministic suite and then the real-provider worker check. It
never prints the configured endpoint or key. The key stays in the Node relay
process; the browser receives an ephemeral relay-session token. No provider
configuration is stored with files or generated Python.

## Current experiment files

- `prepare-assets.mjs`: trusted fixed-asset preparation and hash manifest.
- `serve.mjs`: plain loopback HTTP fixture, with an egress request counter.
- `isolated-host.mjs`: asset validation, opaque iframe setup, request tracking,
  output checks, and acknowledged worker termination.
- `isolated-worker.mjs`: offline Pyodide startup and per-session Python execution.
- `model-client.mjs` and `model-worker.mjs`: bounded model/tool loop owned by a
  dedicated browser worker, with planning and in-memory file tools.
- `relay-core.mjs`: disposable authenticated streaming relay with abort/timeout
  propagation and sanitized failures.
- `test-framework.mjs`, `test-isolated.mjs`, `test-protocol.mjs`, and
  `test-provider.mjs`: assertion-based checks. Reports are written to ignored
  `results/`; a sanitized snapshot is recorded in `evidence/validated.json`.

For individual checks, run `pnpm serve` in a separate terminal, then use
`pnpm test:framework`, `pnpm test:isolated`, `pnpm test:protocol`, or
`pnpm test:provider`. The framework check requires `pnpm build` first and the
isolated check requires prepared assets.

## Historical probes

The original `python.html`, `cancel.html`, `boundary.html`, `loop.html`,
`relay.html`, associated `src/` workers, `relay.mjs`, and `test-*.mjs` scripts
outside the current suite remain as records of the first investigation.
Some require Vite and deliberately demonstrate unrestricted worker network
access. They are excluded from `pnpm test`. Do not use the original Python
worker to execute untrusted code or give historical pages private files.

The current Deep Agents build uses `src/agent.js` and `src/main.js` only to
record the rejected candidate. The selected model loop is the separate,
tested explicit worker. There are no competing production runtimes.

See [technical findings](../../docs/technical-findings.md) for the decision,
actual measurements, security limits, and remaining application work.
