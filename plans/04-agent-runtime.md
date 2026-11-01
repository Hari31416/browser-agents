# Phase 04: Build the reusable agent runtime

Status: planned. Depends on phases 01, 02, and 03.

## Outcome

A headless TypeScript runtime performs multi-step work using a model adapter,
planning tools, workspace tools, and local Python. A React component is not
required to use it.

## Work

- [ ] Integrate the tested Deep Agents browser adapter behind explicit model,
  workspace, executor, and event interfaces. Keep relay authentication inside
  the trusted model adapter and outside messages or generated-code workers.
- [ ] Define run states and ordered events for response deltas, plan updates,
  tool start/result/error, usage when available, cancellation, and completion.
  Give events stable run and tool-call identifiers for persistence.
- [ ] Configure Deep Agents' planning middleware to create/update todo items with
  pending, in-progress, and completed states. Planning is recorded agent data,
  not a promise that every task needs a plan or a subagent. Use the framework's
  loop and planning state rather than building a parallel application loop.
- [ ] Register file listing, reading, writing, editing, and Python tools with
  validated schemas. Enforce workspace boundaries inside tools independently
  of the system prompt. Reject invalid calls as structured tool errors.
- [ ] Keep workspace state explicit in tool runtimes. Adapt zero-argument state
  backends per tool invocation without mutating shared objects; reject stale
  runtime-bound backends. Do not rely on ambient getConfig or browser tracing.
- [ ] Handle streamed tool arguments, tool-call IDs, multiple calls in a response,
  and complete result messages. Serialize mutating workspace/Python calls to
  avoid races. Never execute partially streamed arguments.
- [ ] Add limits for model steps, execution time, tool output, and concurrent
  runs. Retry only appropriate transient model failures within a fixed budget.
  Do not blindly retry writes or automatically replay an interrupted tool call.
- [ ] Reject malformed model JSON before invoking tools. Parsing feedback may
  request regeneration within a fixed budget, with no tool side effects for an
  invalid response. Never silently repair arguments or swap providers/models.
  Exercise nested todo objects, not only the earlier flat planning schema.
- [ ] Feed Python errors back to the model for bounded correction. Cap and label
  truncated file contents and output; do not silently send entire uploaded files.
- [ ] Propagate cancellation through the model request, queued tool calls, and
  Python execution. Prevent late responses from continuing a cancelled run.
- [ ] Define context limits and a visible stop behavior when context is full.
  Evaluate summarization only if needed; do not silently discard tool history
  that is necessary for a valid model conversation.
- [ ] Keep local inference possible through the model contract. Do not implement
  subagents, durable interpreter snapshots, or unattended execution here.

## Verification

Use deterministic scripted model responses for plan/file/Python sequences,
malformed tool arguments, unsupported tools, multiple tool calls, model errors,
step-limit stops, and cancellation during streaming and execution. Test that
untrusted file contents cannot expand tool permissions or disclose credentials.
Keep real-provider smoke tests explicit and separate from the local suite.
Distinguish graph state streaming from actual model token streaming; the Phase 00
relay adapter buffers model text. Implement and verify token streaming here.

## Exit check

A headless example accepts an uploaded fixture, records a plan, executes Python,
and produces a result file. It can use a second compatible endpoint without
changes to the loop. Error, cancellation, and bounded-run behavior pass with
recorded events and persisted state consistent with the actual outcome.
