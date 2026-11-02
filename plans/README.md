# Implementation plan

Status: All initial MVP phases complete (Phase 00 feasibility, Phase 01 foundation and relay, Phase 02 workspace and records, Phase 03 Python execution, Phase 04 agent runtime, Phase 05 chat demo, and Phase 06 acceptance and delivery).
The MVP is verified, documented, and delivered. Follow-up work proceeds to local inference and subagent milestones.

The [project outline](../README.md) defines the agreed scope. The
[Testbed notes](../docs/testbed-reference.md) describe useful reference patterns.
Keep those requirements authoritative when adjusting the implementation.

## Phase order

| Phase | Result | Depends on |
| --- | --- | --- |
| [00: Feasibility](00-feasibility.md) | Evidence for the framework and execution boundary | Agreed requirements |
| [01: Foundation and relay](01-foundation-and-relay.md) | Reproducible workspace and configurable model connection | 00 |
| [02: Workspace and records](02-workspace-and-records.md) | Persistent files, chats, plans, and run records | 01 contracts |
| [03: Python execution](03-python-execution.md) | Isolated, cancellable Python with the approved packages | 00 isolation decision, 02 |
| [04: Agent runtime](04-agent-runtime.md) | Reusable planning, file, and Python agent | 01, 02, 03 |
| [05: Chat demo](05-chat-demo.md) | Complete user workflow and recovery behavior | 04 |
| [06: Acceptance and delivery](06-acceptance-and-delivery.md) | Verified MVP with documented limits and setup | 05 |

Each phase has work items and an exit check. Record actual commands, results,
versions, and limitations when a phase is implemented. Do not mark a phase
complete based on design documents alone. Update dependent plans when an
experiment changes the architecture.

## MVP scope

- Browser-side agent orchestration with visible planning and file tools.
- Automatic Python execution with NumPy, pandas, and matplotlib.
- Uploaded files and downloadable outputs in an isolated workspace per chat.
- No external network access from generated Python, including JavaScript interop.
- A local relay for user-configured OpenAI-compatible endpoints and API keys.
- Model discovery and selection, with manual model ID entry as a fallback.
- Persistent chats and files; fresh Python variables after reopening.
- Streaming, cancellation, bounded execution, and clear failure states.

## Working defaults

Start with desktop Chromium. Keep agent code independent of React. Use the
existing TypeScript, React, Vite, pnpm, and Python relay preferences.

Use Deep Agents through the [tested browser adapter](../docs/deepagents-browser-fix.md).
Carry its pinned LangSmith browser patches, browser utility configuration,
explicit runtime state, planning middleware, and worker-ready protocol into the
workspace. Keep the smaller explicit loop as a protocol reference, not a second
application harness. Browser tracing and ambient context helpers are unsupported.

The configured endpoint currently returns malformed JSON for nested planning
arguments. This is an open model/protocol compatibility check, not a reason to
replace the harness silently. Preserve fail-closed behavior and validate a real
model's planning/file/Python workflow before declaring the MVP complete.

The model relay forwards requests. It does not run the agent or execute Python.
Provider keys remain outside agent context, file storage, and generated code.
Package asset downloads are application-controlled; they do not grant network
access to generated Python. A failure to enforce this boundary blocks automatic
Python execution rather than silently weakening the requirement.

## Work after the MVP

Local inference is the next model-adapter experiment. Test a suitable browser
model against the same streaming, tool-call, and cancellation contracts. Measure
download size, startup, memory, and task success before promising offline use.
Offline startup also requires cached application and runtime assets.

Subagents come later. They will need explicit context, workspace access,
concurrency, cancellation, and usage limits. Do not add them to the MVP loop.
Arbitrary package installation, host-folder access, extensions, unattended
execution, and automatic interrupted-run continuation are also deferred.
