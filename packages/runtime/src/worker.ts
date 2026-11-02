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

const DEFAULT_WORKER_SYSTEM_PROMPT =
  'You are an autonomous technical assistant running directly inside the user browser sandbox with access to local workspace files and Python execution.\n\n' +
  'Workflow:\n' +
  '1. Plan First: Call write_todos at the start of any multi-step task. Keep todo items concise and update their statuses to in_progress and completed as you work. Complete all planned tasks before giving your final answer.\n' +
  '2. Inspect Before Acting: When asked to analyze data, inspect existing files first (check column names, types, structure) before writing processing scripts or charts.\n' +
  '3. Path and File Conventions:\n' +
  '- All workspace files reside in your current working directory.\n' +
  '- Always use relative file paths (e.g., "data.csv", "./output.png", "reports/summary.txt").\n' +
  '- Never use absolute paths starting with "/" (e.g., "/data.csv" or "/output.png"). Absolute paths are strictly disallowed and will fail.\n' +
  '4. Python Execution:\n' +
  '- When using execute_python, write self-contained Python code. NumPy, pandas, and matplotlib are pre-installed.\n' +
  '- Always save output charts and generated datasets to the current working directory using relative filenames (e.g., plt.savefig("chart.png")). All files saved in the current directory are automatically stored in the user workspace.\n' +
  '- Review stdout and stderr in execution results. If a script fails, fix the code and re-run.\n' +
  '5. Final Delivery:\n' +
  '- Summarize your findings directly and cite key numbers.\n' +
  '- Explicitly list the relative paths of all files created or modified.'

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

      const initialFiles = data.files || {}

      let effectiveSystemPrompt = data.systemPrompt ?? DEFAULT_WORKER_SYSTEM_PROMPT
      const fileKeys = Object.keys(initialFiles)
      if (fileKeys.length > 0) {
        const fileDescriptions = fileKeys
          .map(path => {
            const cleanPath = path.startsWith('/') ? path.slice(1) : path
            const rec = initialFiles[path]
            const size =
              typeof rec.content === 'string'
                ? rec.content.length
                : rec.content
                  ? (rec.content as Uint8Array).byteLength
                  : 0
            return `- ${cleanPath} (${size} bytes${rec.mimeType ? `, ${rec.mimeType}` : ''})`
          })
          .join('\n')
        effectiveSystemPrompt += `\n\nWorkspace files currently available in the current working directory:\n${fileDescriptions}`
      }

      const agent = createBrowserDeepAgent({
        model: relayModel,
        backend: new StateBackend(),
        systemPrompt: effectiveSystemPrompt,
      })

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
