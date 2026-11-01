import { createBrowserDeepAgent, StateBackend } from './agent.js'
import { RelayChatModel } from './model-adapter.js'
import { RelayClient } from './relay-client.js'
import type {
  AgentExecutionSummary,
  FileRecord,
  TodoItem,
  ToolExecutionSummary,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './types.js'

let relayClient: RelayClient | undefined
let relayModel: RelayChatModel | undefined

function post(msg: WorkerOutboundMessage): void {
  postMessage(msg)
}

function summarizeState(
  state: {
    todos?: TodoItem[]
    files?: Record<string, FileRecord>
    messages?: Array<{
      _getType(): string
      name?: string
      content?: unknown
      status?: string
    }>
  },
  boundTools: string[] = [],
  streamEvents?: number,
): AgentExecutionSummary {
  const toolResults: ToolExecutionSummary[] = (state.messages || [])
    .filter(m => m._getType() === 'tool')
    .map(m => ({
      name: m.name ?? 'unknown',
      content: m.content,
      status: m.status,
    }))

  return {
    boundTools,
    todos: state.todos || [],
    files: state.files || {},
    toolResults,
    streamEvents,
  }
}

self.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const data = event.data

  try {
    if (data.type === 'init') {
      relayClient = new RelayClient(data.config.relayUrl, data.config.sessionToken)
      relayModel = new RelayChatModel(relayClient, data.config)
      return
    }

    if (data.type === 'run') {
      if (!relayModel) {
        post({
          type: 'result',
          ok: false,
          error: 'Relay connection not initialized before running agent',
        })
        return
      }

      const agent = createBrowserDeepAgent({
        model: relayModel,
        backend: new StateBackend(),
        systemPrompt:
          'You are an agent executing in the user browser workspace. Use write_todos to plan your steps before taking actions. Always record and complete todos.',
      })

      const initialFiles = data.files || {}
      const input = {
        messages: [{ role: 'user', content: data.prompt }],
        files: initialFiles,
      }

      let lastState: Parameters<typeof summarizeState>[0] = {}
      let stepCount = 0

      // Stream state updates
      const agentStreamable = agent as unknown as {
        stream: (
          inp: unknown,
          opt: unknown,
        ) => Promise<AsyncIterable<Record<string, unknown>>>
      }
      for await (const chunk of await agentStreamable.stream(input, {
        recursionLimit: 30,
        streamMode: 'values',
      })) {
        lastState = chunk as typeof lastState
        stepCount++
        post({
          type: 'progress',
          todos: lastState.todos,
          stepCount,
        })
      }

      const summary = summarizeState(lastState, [], stepCount)
      post({
        type: 'result',
        ok: true,
        summary,
      })
    }
  } catch (err) {
    post({
      type: 'result',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Ready handshake: Notify host that worker is ready to receive messages
post({ type: 'ready' })
