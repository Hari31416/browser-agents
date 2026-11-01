# Phase 04: Build the reusable agent runtime

Status: completed. Package `@browser-agents/runtime` provides the headless AgentRuntime orchestrating model adapter, planning middleware, workspace tools, Python execution, structured events, limits, and cancellation. Verified with comprehensive test suites.

## Outcome

A headless TypeScript runtime performs multi-step work using a model adapter,
planning tools, workspace tools, and local Python. A React component is not
required to use it.

## Work

- [x] Integrate the tested Deep Agents browser adapter behind explicit model,
  workspace, executor, and event interfaces. Keep relay authentication inside
  the trusted model adapter and outside messages or generated-code workers.
- [x] Define run states and ordered events for response deltas, plan updates,
  tool start/result/error, usage when available, cancellation, and completion.
  Give events stable run and tool-call identifiers for persistence.
- [x] Configure Deep Agents' planning middleware to create/update todo items with
  pending, in-progress, and completed states. Planning is recorded agent data,
  not a promise that every task needs a plan or a subagent. Use the framework's
  loop and planning state rather than building a parallel application loop.
- [x] Register file listing, reading, writing, editing, and Python tools with
  validated schemas. Enforce workspace boundaries inside tools independently
  of the system prompt. Reject invalid calls as structured tool errors.
- [x] Keep workspace state explicit in tool runtimes. Adapt zero-argument state
  backends per tool invocation without mutating shared objects; reject stale
  runtime-bound backends. Do not rely on ambient getConfig or browser tracing.
- [x] Handle streamed tool arguments, tool-call IDs, multiple calls in a response,
  and complete result messages. Serialize mutating workspace/Python calls to
  avoid races. Never execute partially streamed arguments.
- [x] Add limits for model steps, execution time, tool output, and concurrent
  runs. Retry only appropriate transient model failures within a fixed budget.
  Do not blindly retry writes or automatically replay an interrupted tool call.
- [x] Reject malformed model JSON before invoking tools. Parsing feedback may
  request regeneration within a fixed budget, with no tool side effects for an
  invalid response. Never silently repair arguments or swap providers/models.
  Exercise nested todo objects, not only the earlier flat planning schema.
- [x] Feed Python errors back to the model for bounded correction. Cap and label
  truncated file contents and output; do not silently send entire uploaded files.
- [x] Propagate cancellation through the model request, queued tool calls, and
  Python execution. Prevent late responses from continuing a cancelled run.
- [x] Define context limits and a visible stop behavior when context is full.
  Evaluate summarization only if needed; do not silently discard tool history
  that is necessary for a valid model conversation.
- [x] Keep local inference possible through the model contract. Do not implement
  subagents, durable interpreter snapshots, or unattended execution here.

## Verification

The test suite in `packages/runtime/test/agent-runtime.test.mjs` verifies:
- Multi-step headless plan, read fixture, execute Python, write output, and complete plan sequence.
- Output file persistence in `ChatWorkspace` and execution records in `RecordStore`.
- Compatibility with alternative endpoint configuration without changing runtime loop.
- Step-limit stop behavior with `StepLimitExceededError`.
- Context limit stop behavior with `ContextLimitExceededError`.
- Concurrent run rejection with `ConcurrentRunError`.
- Python error feedback loop enabling model self-correction.
- Output text truncation with explicit labels when exceeding `maxOutputChars`.
- Cancellation propagation stopping model, queued tool calls, and Python execution.
- Security boundary rejecting path traversal attempts with structured tool error messages.
- Malformed tool JSON rejection before tool execution, with regeneration feedback.
- Separation of model token streaming (`text:delta`) from graph state updates (`plan:update`, `tool:*`).

## Exit check

A headless example accepts an uploaded fixture, records a plan, executes Python,
and produces a result file. It can use a second compatible endpoint without
changes to the loop. Error, cancellation, and bounded-run behavior pass with
recorded events and persisted state consistent with the actual outcome.
