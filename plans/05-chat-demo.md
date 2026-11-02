# Phase 05: Assemble the chat demo

Status: completed. The browser demo application in `apps/demo` provides the full interactive user workflow: provider setup, model selection, chat sessions, file uploads, sanitized markdown, plan displays, tool execution cards with stdout/stderr and download buttons, request inspection, data flow transparency, and startup reconciliation. Verified with `apps/demo/test/chat-demo.test.mjs`.

## Outcome

Users can configure an endpoint, select a model, upload files, ask for work, inspect the plan and tool outputs, download results, and return to their chats.

## Work

- [x] Build provider setup using Testbed's interaction pattern: name, base URL, API key, connection test, discovered models, and manual model ID fallback. Use the local relay throughout. Clear key input after registration and never persist it with chat or provider display metadata.
- [x] Separate connection/model-list success from agent tool compatibility. Explain malformed planning/tool arguments clearly and let the user select another model. Do not present the current failed nested-JSON check as passed.
- [x] Show relay disconnection and session expiry. After relay restart, retain nonsecret endpoint/model preferences but request credentials again as needed.
- [x] Provide a chat list, streaming conversation, composer, file upload control, workspace file list, and useful plan/tool displays. Include stdout/stderr, Python code, errors, and generated-file downloads without decorative controls.
- [x] Render model text as sanitized Markdown. Preview only supported output types; keep generated HTML/SVG or other active content from executing in the trusted application origin. Prefer downloads for unsupported content.
- [x] Show Python readiness and approved-package loading, active execution, cancellation, failure, and interrupted runs. Explain variable reset when reopening a chat or recovering from a terminated interpreter.
- [x] Connect chat selection and app startup to persistent records and files. Restore visible history without rerunning model or tool calls. Keep one active run per chat and apply the chosen workspace concurrency rules.
- [x] Provide clear data-flow information: uploads remain in browser storage, while messages and selected tool outputs go to the configured model endpoint. Allow inspection of the assembled model request without exposing credentials.
- [x] Handle unavailable storage, quota errors, unsupported browsers, and runtime startup failures with an actionable explanation. Preserve export access where possible. Include keyboard access and accessible labels for actual actions.

## Verification

The verification suite in `apps/demo/test/chat-demo.test.mjs` verifies:
- Active content isolation and sanitizer checks: blocking `javascript:` and `data:` URLs, confining HTML and SVG previews to sandboxed non-executing frames, and verifying safe preview categorizations.
- Credential protection: nonsecret preferences (relay URL, base URL, model name) are saved while API keys are never persisted to storage or revealed in request inspection.
- Workspace file and history survival across reloads: files, chats, messages, plans, and tool calls persist in local storage while Python variables reset and interrupted runs reconcile properly.
- Chat archive export: complete export containing chats, messages, plans, runs, tool calls, and workspace files with contents.
- Concurrency rejection: enforcing a single active run per workspace and rejecting concurrent runs.
- Complete end-to-end workflow: file upload, plan generation, Python WebAssembly execution with pandas, output file production, and download.

## Exit check

The demo completes the agreed analysis and file-transformation scenarios through its interface. Users can understand what the agent did, stop it, retrieve files, and reopen history. The same runtime remains usable outside the demo.
