# Browser agents

Status: MVP implementation verified on desktop Google Chrome.  
Orchestration, planning, file tools, and sandboxed Python code run inside the browser.  
Model access is routed through a local lightweight relay.

## Overview

Browser agents is an in-browser agent runtime and chat application. The browser directly owns the orchestration loop, tool execution, persistent workspace storage, and execution history. Python data analysis and visualization run locally in the browser via Pyodide in a zero-network sandbox. Remote LLMs are reached via an origin-verified local relay that keeps API keys in transient memory away from generated code and browser storage.

For detailed test evidence and benchmarks, refer to the [MVP validation report](docs/mvp-validation.md).

## Core capabilities

- Browser orchestration: Runs the Deep Agents loop in client-side TypeScript, maintaining plan and task state.
- Automated Python execution: Sandboxed Pyodide execution preloaded with NumPy, pandas, and matplotlib.
- Zero network leakage: Generated Python and JavaScript cannot access network sockets, HTTP, or browser credentials.
- Isolated workspace storage: Files stored in Origin Private File System (OPFS) and records in IndexedDB per chat session.
- Local relay with credential security: OpenAI-compatible endpoints with transient in-memory credential management and origin checks.
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
- Python 3.11+
- uv (Python package installer)

### Installation

Install dependencies and set up the Python backend virtual environment:

```sh
make setup
```

### Running development servers

Start both the backend relay (port 8765) and the demo frontend (port 5173) in foreground mode:

```sh
make dev
```

Alternatively, run services in the background:

```sh
make start        # Starts relay and frontend
make status       # Check status and running PIDs
make health       # Verify relay health check
make stop         # Stop all services
```

Visit `http://127.0.0.1:5173` in desktop Chrome or Chromium.

### Quality and testing

Run all linters, compiler checks, and automated test suites:

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
make docker-up
```

To stop containers:

```sh
make docker-down
```

## Security and isolation architecture

The browser runtime enforces strict boundaries:

- Opaque frame isolation: Python executes inside a Web Worker spawned from an opaque-origin iframe (`sandbox="allow-scripts"`).
- Strict CSP: `default-src 'none'; script-src 'unsafe-eval' blob:; connect-src blob: data:`. Network requests from Python or JavaScript are blocked.
- Credential boundary: API keys never enter browser storage or prompts; they exist only transiently in relay process memory.
- Origin protection: The relay rejects requests from origins other than the configured frontend addresses.
- File path validation: File tools restrict access strictly within the chat's workspace path root.

## Verified compatible models

Models tested against the Deep Agents function-calling schema:

- `gpt-oss-120b`: Compatible. Generates valid nested arguments for planning and Python tools.
- `gpt-oss-20b`: Compatible. Completes full multi-step planning and Python execution loops.
- `gemma-4-26B-A4B-it`: Emits malformed escape tokens in tool call JSON; requires compliant model selection.

## Roadmap and future milestones

- WebGPU local inference: Pluggable browser LLMs without requiring a local relay.
- Subagents: Multi-agent coordination with hierarchical task execution.
- Dynamic package wheels: Support for loading additional pure-Python wheels at runtime.
