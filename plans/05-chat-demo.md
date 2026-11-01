# Phase 05: Assemble the chat demo

Status: planned. Depends on phase 04.

## Outcome

Users can configure an endpoint, select a model, upload files, ask for work,
inspect the plan and tool outputs, download results, and return to their chats.

## Work

- [ ] Build provider setup using Testbed's interaction pattern: name, base URL,
  API key, connection test, discovered models, and manual model ID fallback.
  Use the local relay throughout. Clear key input after registration and never
  persist it with chat or provider display metadata.
- [ ] Separate connection/model-list success from agent tool compatibility.
  Explain malformed planning/tool arguments clearly and let the user select
  another model. Do not present the current failed nested-JSON check as passed.
- [ ] Show relay disconnection and session expiry. After relay restart, retain
  nonsecret endpoint/model preferences but request credentials again as needed.
- [ ] Provide a chat list, streaming conversation, composer, file upload control,
  workspace file list, and useful plan/tool displays. Include stdout/stderr,
  Python code, errors, and generated-file downloads without decorative controls.
- [ ] Render model text as sanitized Markdown. Preview only supported output
  types; keep generated HTML/SVG or other active content from executing in the
  trusted application origin. Prefer downloads for unsupported content.
- [ ] Show Python readiness and approved-package loading, active execution,
  cancellation, failure, and interrupted runs. Explain variable reset when
  reopening a chat or recovering from a terminated interpreter.
- [ ] Connect chat selection and app startup to persistent records and files.
  Restore visible history without rerunning model or tool calls. Keep one active
  run per chat and apply the chosen workspace concurrency rules.
- [ ] Provide clear data-flow information: uploads remain in browser storage,
  while messages and selected tool outputs go to the configured model endpoint.
  Allow inspection of the assembled model request without exposing credentials.
- [ ] Handle unavailable storage, quota errors, unsupported browsers, and runtime
  startup failures with an actionable explanation. Preserve export access where
  possible. Include keyboard access and accessible labels for actual actions.

## Verification

Exercise the complete workflow through the UI using fake endpoints and local
fixtures. Reopen the app and confirm files and history survive while variables
do not. Verify model errors, connection loss, cancellation, and downloading a
chart. Check that generated active content cannot run in the trusted UI and
that API keys never appear in persisted browser records or inspection views.

## Exit check

The demo completes the agreed analysis and file-transformation scenarios through
its interface. Users can understand what the agent did, stop it, retrieve files,
and reopen history. The same runtime remains usable outside the demo.
