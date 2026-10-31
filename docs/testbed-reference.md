# Testbed reference notes

Reviewed [Hari31416/Testbed](https://github.com/Hari31416/Testbed) at commit
`e78bc0fc6d02a19448dbbef95f1f21ae585d1a44` during requirements discovery.
This is a reference project, not a selected dependency or approved code import.

## Useful patterns

- [Provider adapters](https://github.com/Hari31416/Testbed/blob/e78bc0fc6d02a19448dbbef95f1f21ae585d1a44/src/lib/providers.ts)
  use the AI SDK OpenAI-compatible client, configurable base URLs, model listing,
  and provider-specific request normalization.
- [Chat UI](https://github.com/Hari31416/Testbed/blob/e78bc0fc6d02a19448dbbef95f1f21ae585d1a44/src/components/ChatView.tsx)
  uses the AI SDK's ToolLoopAgent and DirectChatTransport with streaming chat.
- [Tool definitions](https://github.com/Hari31416/Testbed/blob/e78bc0fc6d02a19448dbbef95f1f21ae585d1a44/src/lib/test-tools.ts)
  combine schemas and client-side execution functions. These are small test
  tools, not an isolated Python execution environment.
- [Local database](https://github.com/Hari31416/Testbed/blob/e78bc0fc6d02a19448dbbef95f1f21ae585d1a44/src/lib/db.ts)
  uses Dexie for providers, models, chats, and messages.

## Differences for this project

Testbed's model client makes requests directly from the browser. This project
will initially use a local relay, as selected by the user. Model credentials
are entered through the trusted setup UI and passed to the local relay. They
must not enter workspace storage, chat records, or Python execution. Testbed's browser credential persistence is not the planned
credential design here.

Keep the reusable agent runtime independent of React and the demo's storage
and rendering choices. Evaluate whether Deep Agents or a smaller AI SDK loop
best meets the required planning and file behavior. Subagents are deferred. The reference
shows useful browser patterns but does not establish Deep Agents compatibility.

## Proposed request and execution flow

1. The user uploads files into a chat workspace in browser storage.
2. The browser agent sends messages and tool definitions to the local relay.
3. The relay authenticates to the selected model endpoint and streams back its
   response. It does not choose or execute tools.
4. The browser validates tool arguments and applies the selected permission
   policy before executing file operations or Python.
5. Python receives workspace files through a controlled bridge. The design
   must enforce the chosen network policy; a worker alone does not enforce it.
6. Selected tool results return to the model through the relay. Generated files
   stay in the browser workspace until the user downloads them.

The relay should bind to loopback by default, restrict accepted browser origins
and upstream destinations, redact credentials, and avoid logging message bodies.
Accept user-chosen endpoints through a trusted provider setup operation. Register
them as session configurations and use their identifiers for model requests.
The agent and Python must not be able to register providers or choose arbitrary
relay destinations. Permit explicitly configured local model endpoints as well
as remote endpoints. Default to relay-memory credential storage for the session.

Model requests can still contain private excerpts and tool outputs. The relay
is local, but the model endpoint may be remote. Package and runtime downloads
also need to be distinguished from network requests made by generated Python.

## Compatibility work before implementation choices

- Bundle a minimal candidate agent into a browser worker and identify Node-only
  dependencies or unsupported imports.
- Test one streamed model response and a complete tool-call round trip through
  the local relay, including cancellation and a provider error.
- Test Pyodide with uploaded files, a generated output, an execution error,
  and cancellation of an infinite loop.
- Prove generated Python cannot read relay credentials or bypass the selected
  file and network policies, including through Python-to-JavaScript interop.
- Determine how a terminated Python worker affects session state and recovery.

## Confirmed adaptation of Testbed's setup flow

The user enters an endpoint and API key, tests the connection, and selects an
LLM from the available models. Route model discovery and generation through
the local relay. Support manual model ID entry when discovery is unavailable.
Reuse the interaction pattern without importing browser key persistence or
coupling the runtime to the React chat component.

Python runs automatically with NumPy, pandas, and matplotlib. The application
may fetch approved runtime assets, but generated code has no external network
access. Persist chat history and workspace files; reset Python variables when
the app reopens.
