# Browser agents

Status: MVP implementation verified on desktop Google Chrome.  
Orchestration, planning, file tools, and sandboxed Python code run inside the browser.  
Model access connects directly from the browser by default, with an optional local relay.

## Overview

Browser agents is an in-browser agent runtime and chat application. The browser directly owns the orchestration loop, tool execution, persistent workspace storage, and execution history. Python data analysis and visualization run locally in the browser via Pyodide in a zero-network sandbox. Remote LLMs are reached directly from the browser or through an optional origin-verified relay. API keys stay in memory unless you opt into saving them in browser local storage. Generated Python cannot access either.

For detailed test evidence and benchmarks, refer to the [MVP validation report](docs/mvp-validation.md).

## Core capabilities

- Browser orchestration: Runs the Deep Agents loop in client-side TypeScript, maintaining plan and task state.
- Automated Python execution: Sandboxed Pyodide execution preloaded with NumPy, pandas, and matplotlib.
- Zero network leakage: Generated Python and JavaScript cannot access network sockets, HTTP, or browser credentials.
- Isolated workspace storage: Files stored in Origin Private File System (OPFS) and records in IndexedDB per chat session.
- Direct connections and optional relay: OpenAI-compatible endpoints with opt-in browser key storage; relay mode adds origin checks.
- File staging and previews: Upload files, inspect data, download artifacts, and preview charts directly in the chat UI.
- Cancellation and limits: Immediate cancellation of long-running or infinite code loops and bounded execution steps.

## Repository structure

- `packages/workspace`: File storage (OPFS), record stores (IndexedDB), path validation, and atomic staging.
- `packages/python`: Sandboxed Pyodide execution within an opaque-origin iframe and Web Worker.
- `packages/runtime`: Deep Agents browser adapter, relay client, LangChain chat model integration, and event bus.
- `apps/demo`: Modern React UI built with Vite, Tailwind CSS, Lucide icons, and sanitized markdown rendering.
- `backend`: FastAPI model relay service handling origin validation, session management, and upstream model streaming.

## Getting started

### Prerequisites

- Node.js 22+
- pnpm 11+
- Python 3.11+ and uv only if using the optional relay

### Installation

Install browser application dependencies:

```sh
make setup
```

### Running development servers

Start the frontend on port 5173 without a backend:

```sh
make dev
```

Alternatively, run services in the background:

```sh
make start        # Starts frontend
make status       # Check status and running PIDs
make stop         # Stop all services
```

Visit `http://127.0.0.1:5173` in desktop Chrome or Chromium.

In settings, choose **Direct from browser**, enter your endpoint and API key, then discover models or enter a model ID manually and save. The endpoint must allow requests from the frontend origin via CORS. Network/CORS errors offer guidance to choose **Local relay** instead.

Enable **Remember API key on this browser** to reconnect after reload without re-entering credentials. Keys are saved unencrypted in this site's local storage. Uncheck the option and save to remove the saved key. Changing the endpoint clears the key field to avoid sending the previous provider's key to a different host. Keys never enter chat exports or the Python sandbox.

For endpoints requiring a relay:

```sh
pnpm setup:relay
make start-relay
# Or run both services in the foreground:
pnpm dev:with-relay
```

Select **Local relay** in settings. No automatic fallback sends requests through a different route.


### Quality and testing

For the full checks, install the optional backend test dependencies with `pnpm setup:relay`, then run:

```sh
make check
```

Or run individual suites:

```sh
make format-check         # Verify Python formatting with black
make typecheck            # Check TypeScript packages and demo app
make test-backend         # Run FastAPI relay pytest suite
make test-workspace       # Run workspace storage tests
make test-python          # Run Python protocol and staging tests
make test-python-browser  # Run Playwright browser isolation tests
make test-runtime         # Run agent runtime test suite
make test-demo            # Run chat demo workflow test suite
pnpm test:demo:browser    # Chrome settings verification after make build
```

### Production build

Compile and bundle all TypeScript packages and the demo frontend application:

```sh
make build
```

### Containerized execution

Build and run both the relay and frontend using Docker:

```sh
make docker-build
make docker-up                     # Frontend only
docker compose --profile relay up -d # Include optional relay
```

To stop containers:

```sh
make docker-down
```

## Security and isolation architecture

The browser runtime enforces strict boundaries:

- Opaque frame isolation: Python executes inside a Web Worker spawned from an opaque-origin iframe (`sandbox="allow-scripts"`).
- Strict CSP: `default-src 'none'; script-src 'unsafe-eval' blob:; connect-src blob: data:`. Network requests from Python or JavaScript are blocked.
- Credential boundary: API keys stay outside prompts and generated code. Browser persistence is opt-in; otherwise keys remain in memory.
- Origin protection: The relay rejects requests from origins other than the configured frontend addresses.
- File path validation: File tools restrict access strictly within the chat's workspace path root.

## Verified compatible models

Models tested against the Deep Agents function-calling schema:

- `gpt-oss-120b`: Compatible. Generates valid nested arguments for planning and Python tools.
- `gpt-oss-20b`: Compatible. Completes full multi-step planning and Python execution loops.
- `gemma-4-26B-A4B-it`: Emits malformed escape tokens in tool call JSON; requires compliant model selection.

## Roadmap and future milestones

- WebGPU local inference: Pluggable browser LLMs without contacting a model endpoint.
- Subagents: Multi-agent coordination with hierarchical task execution.
- Dynamic package wheels: Support for loading additional pure-Python wheels at runtime.
