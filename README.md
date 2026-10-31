# Browser agents

Status: Phase 0 feasibility validated on desktop Chrome; MVP implementation pending. Working name: browser-agents.

## What we want to build

An agent runtime that executes inside the browser, with a small application
that demonstrates useful multi-step work. The browser should own the agent
loop, tool execution, workspace files, and execution history.

The long-term goal is fully local operation, including model inference.
Remote models and selected server services may be useful along the way.
We expect local models to improve, but will measure their suitability for
our tasks rather than depend on a predicted release or capability level.

## Why build it

- Use the user's machine for useful tool execution and, eventually, inference.
- Reduce the amount of private data sent to remote services.
- Explore what useful agents can do without an installed desktop runtime.
- Measure the tradeoffs against hosted agent execution.

## Confirmed requirements

- Build a reusable browser agent runtime with a small demo application.
- Use general-purpose chat with files and code execution as the first demo.
- Run orchestration and supported tool execution in the browser.
- Include planning and file tools in the first version; defer subagents.
- Execute Python automatically for analysis and file processing inside the
  uploaded workspace, with external network access blocked.
- Provide NumPy, pandas, and matplotlib initially. Add other packages explicitly
  later; generated Python cannot install arbitrary packages.
- Preserve chat history and workspace files locally across app restarts.
  Python variables and live interpreter state reset on reopening.
- Upload files into browser storage and download generated outputs.
- Access remote models through a locally run relay using the user's API key.
- Let users enter an OpenAI-compatible endpoint and API key, discover models,
  and select an LLM. Do not require a specific provider.
- Support remote models first and keep local inference pluggable.
- Keep fully local operation as a future goal, not a first-milestone dependency.

The runtime must be usable independently of the demo UI. Its public interfaces
should cover model access, tool registration and execution, workspace storage,
and execution events. Provider-specific behavior belongs in model adapters.
The local model interface must support the agent's tool-calling contract;
local models should not need a separate agent implementation.

## First demo

The user configures a model endpoint, uploads files, and chats with an agent.
The agent can create and update a plan, inspect and edit workspace files, and
run Python automatically. The interface shows streaming responses, plan state,
tool activity, execution output, errors, and generated files. The user can
cancel a run and download its outputs.

### Provider setup

1. Enter a display name, OpenAI-compatible base URL, and API key. Endpoints
   that do not require a key may leave it empty.
2. Register the configuration with the local relay. The trusted setup UI may
   handle the key transiently; workspace files, chat records, agent prompts,
   and generated Python must never receive it.
3. Test the connection and request the model list through the relay.
4. Select an LLM. Provide manual model ID entry when model listing is absent.
5. Start chatting. Expose authentication, connection, and model errors clearly.

OpenAI-compatible means the required chat, streaming, and tool-call behavior
matches the supported protocol. A model listing alone does not establish tool
support. Detect and explain unsupported behavior without silently selecting
another provider. Exact provider quirks remain a compatibility-testing task.

### Tools and packages

Initial tools should cover planning, listing and reading files, writing and
editing files, and executing Python. Search tools may be added if the file
workflow needs them. All file operations stay inside the chat workspace.
Generated Python runs without per-execution approval, subject to execution
limits and the enforced network boundary.

The application may download its approved runtime and package assets. Generated
Python must not make external network requests, including through JavaScript
interop. Disabling Python's requests library alone is insufficient. Credentials
and the model relay must be inaccessible from the execution environment.

### Persistence

Persist chat history, visible plan and tool records, and workspace files locally.
Reopening a chat creates a fresh Python interpreter. Explain that variables do
not survive. An interrupted run must be marked interrupted rather than silently
replaying tool calls. Automatic continuation from a checkpoint is deferred.

### Acceptance scenarios

- Configure two different compatible endpoints without changing agent code.
- Select a model from discovery or enter a model ID manually.
- Upload a CSV, ask for a multi-step analysis, and see a plan, Python tool
  output, an explanation, and a downloadable chart or result file.
- Transform a JSON or text file and download the result.
- Expose a Python error to the agent and let it retry within a bounded run.
- Cancel an infinite loop and confirm execution stops and the UI remains usable.
- Block external network attempts from Python and JavaScript interop.
- Confirm generated code cannot read credentials or access another chat's files.
- Reopen the app and recover chat history and files with a fresh interpreter.
- Confirm subagents and arbitrary package installation are absent initially.

## Defaults and remaining design choices

Use the following working defaults unless testing or user feedback changes them:

- Desktop Chrome and Chromium browsers for the first compatibility test.
- An ordinary webpage, without an extension or installed tool executor.
- A run may stop when the page closes; no unattended server execution.
- Each chat gets an isolated workspace and Python session.
- Begin with CSV, JSON, and text inputs, plus generated files and image previews.
- Do not upload whole source files to the model automatically. File tools may
  return selected content to the model as needed, and Python may return summaries.
- Keep API keys in relay memory for the session, with no browser persistence.
  Any future durable credential storage needs an explicit design.

The agent framework, execution isolation, file synchronization, provider protocol
coverage, and concrete size/time limits require technical validation. They do
not need further product decisions before an initial compatibility prototype.

## Proposed technical direction

- TypeScript for the agent runtime; React, Vite, and pnpm for the demo UI.
- Run orchestration outside the UI thread in a Web Worker.
- Use the explicit browser-worker loop selected in Phase 0. The tested Deep
  Agents browser bundle failed on Node dependencies; see the technical findings.
- Keep model access, tool execution, storage, and UI behind separate interfaces.
- Evaluate OPFS for workspace files and IndexedDB for chat and run records.
- Use Pyodide with approved assets supplied to an isolated iframe/worker,
  preserving the no-network boundary validated in Phase 0.
  Node execution and WebContainers are outside the initial Python scope.
- Evaluate a WebGPU model backend when local inference enters scope.
- Use a small local model relay. Accept endpoint configuration from the trusted
  setup UI and keep active credentials on the relay, outside the browser
  workspace and generated Python environment.
- The relay forwards model requests and streams responses. The browser owns
  the agent loop, file processing, and Python execution.
- FastAPI, Pydantic, uv, Black, and standard logging are the proposed relay stack.
- Retain Testbed's provider setup interaction as a reference. See the
  [reference notes](docs/testbed-reference.md) and
  [Phase 0 technical findings](docs/technical-findings.md).

## Boundaries to resolve

A browser workspace is not unrestricted access to the host filesystem.
A normal webpage cannot control arbitrary tabs or bypass cross-origin rules.
Background execution may stop when a tab freezes, closes, or is discarded.
Browser storage has quotas and possible eviction; exports and recovery matter.
A Web Worker is not sufficient isolation for untrusted generated code.
Tool execution must not inherit application credentials or unrestricted access
to the workspace and network.

Local execution does not by itself make remote model calls private. Inputs,
selected excerpts, and tool results included in a request leave the device.
Fully offline operation also requires locally available model assets and tools,
and an application that can start without contacting a server.

## First milestones

The [phase-by-phase implementation plan](plans/README.md) breaks these milestones
into work items, dependencies, and completion checks.

1. Validate browser execution of the candidate agent framework, including
   planning, file tools, and one streamed tool-call round trip through the relay.
2. Validate Python isolation with approved packages, workspace file exchange,
   denied network access, credential isolation, and cancellation.
3. Build the reusable runtime and chat demo with provider setup, planning,
   uploaded files, Python execution, output previews, and downloads.
4. Verify persistence across reopen and the full acceptance scenarios.
5. Evaluate a local model adapter using the same runtime contracts.

A short technical findings note should explain framework and isolation choices
before implementation expands. If an isolation approach cannot enforce the
network requirement, revise it before treating automatic Python as ready.

## Evidence to collect

- Completion quality on a small set of representative tasks.
- Cold startup and model download time, where applicable.
- Time to first response, total task time, and peak memory.
- Model usage and server work per completed task.
- Data sent off the device and the reason for each network operation.
- Behavior during cancellation, reload, offline use, and tab interruption.
- Browser and device compatibility.

## Current scope

This repository contains planning documents and executable Phase 0 experiments.
The explicit browser-worker loop, isolated Python execution, streaming relay,
real-provider round trip, and recovery probes have passed on the declared target.
See [experiment commands and evidence](experiments/phase0/README.md).

The MVP chat UI, workspace database, provider setup, reusable TypeScript package,
and production relay remain to be implemented. Subagents, arbitrary package
installation, and local inference are deferred.

Useful references:

- [Deep Agents TypeScript](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Pyodide limitations](https://pyodide.org/en/stable/usage/wasm-constraints.html)
- [WebContainers browser support](https://webcontainers.io/guides/browser-support)
- [WebLLM](https://webllm.mlc.ai/docs/user/get_started.html)
