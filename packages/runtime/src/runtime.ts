import type { ChatWorkspace, RecordStore } from '@browser-agents/workspace'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import { createBrowserDeepAgent, StateBackend } from './agent.js'
import {
  ConcurrentRunError,
  ContextLimitExceededError,
  RunCancelledError,
  StepLimitExceededError,
} from './errors.js'
import {
  AgentEventEmitter,
  createCallId,
  createRunId,
} from './events.js'
import { AsyncMutex, createPythonTool } from './tools.js'
import type {
  AgentEventHandler,
  AgentRunOptions,
  AgentRunResult,
  AgentRunState,
  AgentRunSummary,
  AgentRuntimeOptions,
  FileRecord,
  PythonExecutor,
  RuntimeLimits,
  TodoItem,
  ToolExecutionSummary,
} from './types.js'

export const DEFAULT_LIMITS: Required<RuntimeLimits> = {
  maxSteps: 30,
  timeoutMs: 120_000,
  maxOutputChars: 64_000,
  maxContextMessages: 50,
  concurrency: 'reject',
}

export class AgentRuntime {
  readonly chatId: string
  readonly model: BaseChatModel
  readonly workspace?: ChatWorkspace
  readonly pythonExecutor?: PythonExecutor
  readonly recordStore?: RecordStore
  readonly systemPrompt: string
  readonly limits: Required<RuntimeLimits>
  readonly emitter: AgentEventEmitter

  private currentState: AgentRunState = 'idle'
  private activeAbortController?: AbortController
  private activeRunId?: string
  private readonly mutex = new AsyncMutex()

  constructor(options: AgentRuntimeOptions) {
    this.chatId = options.chatId
    this.model = options.model
    this.workspace = options.workspace
    this.pythonExecutor = options.pythonExecutor
    this.recordStore = options.recordStore
    this.systemPrompt =
      options.systemPrompt ??
      'You are a helpful agent executing in a sandboxed browser environment with local workspace files and Python WebAssembly runtime.\n' +
        'File and path rules:\n' +
        '- All workspace files are located in the current working directory.\n' +
        '- ALWAYS use relative file paths (e.g., "data.csv", "./output.png"). NEVER use absolute paths starting with "/" (e.g., "/data.csv" or "/output.png"); absolute paths are strictly disallowed and will fail.\n' +
        '- When writing Python code, always read and save files in the current working directory using relative paths (e.g., pd.read_csv("data.csv"), plt.savefig("plot.png")). All generated files in the working directory are automatically saved to the workspace.\n' +
        '- Use write_todos to maintain a plan. Complete your plan before finishing.'

    this.limits = {
      ...DEFAULT_LIMITS,
      ...(options.limits ?? {}),
    }

    this.emitter = new AgentEventEmitter(this.recordStore)
    if (options.onEvent) {
      this.emitter.subscribe(options.onEvent)
    }
  }

  getState(): AgentRunState {
    return this.currentState
  }

  getActiveRunId(): string | undefined {
    return this.activeRunId
  }

  onEvent(handler: AgentEventHandler): () => void {
    return this.emitter.subscribe(handler)
  }

  async cancel(reason = 'Run cancelled by user'): Promise<void> {
    if (this.currentState !== 'running') {
      return
    }

    this.currentState = 'cancelled'

    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }

    if (this.pythonExecutor?.cancel) {
      try {
        await this.pythonExecutor.cancel()
      } catch (err) {
        console.warn('Failed to cancel python executor:', err)
      }
    }

    if (this.activeRunId) {
      await this.emitter.emit({
        type: 'run:cancel',
        runId: this.activeRunId,
        reason,
        timestamp: new Date().toISOString(),
      })
    }
  }

  async run(prompt: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    if (this.currentState === 'running') {
      if (this.limits.concurrency === 'reject') {
        throw new ConcurrentRunError(this.chatId)
      }
      // If serialize, wait for previous run to complete
      await this.mutex.runExclusive(async () => {})
    }

    return await this.mutex.runExclusive(async () => {
      return await this._executeRun(prompt, options)
    })
  }

  private async _executeRun(
    prompt: string,
    options: AgentRunOptions,
  ): Promise<AgentRunResult> {
    const runId = createRunId()
    this.activeRunId = runId
    this.currentState = 'running'

    const startTime = Date.now()
    const abortController = new AbortController()
    this.activeAbortController = abortController

    // Link optional caller signal
    let callerAbortListener: (() => void) | undefined
    if (options.signal) {
      if (options.signal.aborted) {
        this.currentState = 'cancelled'
        throw new RunCancelledError()
      }
      callerAbortListener = () => {
        abortController.abort()
        this.cancel('Cancelled via abort signal')
      }
      options.signal.addEventListener('abort', callerAbortListener)
    }

    // Set timeout timer
    const timeoutTimer = setTimeout(() => {
      abortController.abort()
      this.cancel(`Timeout exceeded (${this.limits.timeoutMs}ms)`)
    }, this.limits.timeoutMs)

    // Unsubscribe helper for turn event handler
    const turnUnsubscribe = options.onEvent
      ? this.emitter.subscribe(options.onEvent)
      : undefined

    await this.emitter.emit({
      type: 'run:start',
      runId,
      chatId: this.chatId,
      prompt,
      timestamp: new Date().toISOString(),
    })

    // Load initial files from workspace if present
    const initialFiles: Record<string, FileRecord> = { ...(options.initialFiles ?? {}) }
    if (this.workspace) {
      try {
        const wsFiles = await this.workspace.listFiles()
        const now = new Date().toISOString()
        for (const f of wsFiles) {
          const normKey = f.path.startsWith('/') ? f.path : '/' + f.path
          initialFiles[normKey] = {
            content: f.content,
            encoding: f.encoding,
            mimeType: f.mimeType,
            created_at: f.createdAt || now,
            modified_at: f.updatedAt || now,
          }
        }
      } catch (err) {
        console.warn('Failed to load initial workspace files:', err)
      }
    }

    // Prepare custom tools
    const customTools: unknown[] = []
    const fileMutex = new AsyncMutex()

    if (this.pythonExecutor) {
      const pyTool = createPythonTool({
        executor: this.pythonExecutor,
        mutex: fileMutex,
        limits: this.limits,
        signal: abortController.signal,
        onFileGenerated: async (path, data, mimeType) => {
          if (this.workspace) {
            try {
              await this.workspace.writeFile(path, data, { mimeType })
            } catch (err) {
              console.warn(`Failed to commit generated Python file '${path}' to workspace:`, err)
            }
          }
          // Also update files in state
          const normKey = path.startsWith('/') ? path : '/' + path
          const isText = mimeType.startsWith('text/') || mimeType === 'application/json'
          const content = isText ? new TextDecoder().decode(data) : btoa(String.fromCharCode(...data))
          const now = new Date().toISOString()
          initialFiles[normKey] = {
            content,
            mimeType,
            encoding: isText ? 'utf-8' : 'base64',
            created_at: now,
            modified_at: now,
          }
        },
      })
      customTools.push(pyTool)
    }

    // Prepare effective system prompt including workspace files if present
    let effectiveSystemPrompt = this.systemPrompt
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

    effectiveSystemPrompt +=
      `\n\nFile & Path Execution Rules:\n` +
      `- All workspace files reside in the current working directory.\n` +
      `- ALWAYS use relative paths (e.g., 'data.csv', './plot.png'). NEVER use absolute paths (e.g., '/data.csv', '/plot.png') as absolute paths are strictly disallowed and will be rejected.\n` +
      `- When executing Python code with execute_python, always save generated charts and output files using relative paths in the current working directory (e.g., plt.savefig('plot.png')) so they are preserved in the workspace.`

    // Create Deep Agent instance
    const agent = createBrowserDeepAgent({
      model: this.model,
      backend: new StateBackend(),
      tools: customTools,
      systemPrompt: effectiveSystemPrompt,
    })

    const initialMessages: Array<{ role: string; content: string }> = [
      { role: 'user', content: prompt },
    ]

    // Context message limit check
    if (initialMessages.length > this.limits.maxContextMessages) {
      clearTimeout(timeoutTimer)
      this.currentState = 'failed'
      const err = new ContextLimitExceededError(
        initialMessages.length,
        this.limits.maxContextMessages,
      )
      await this.emitter.emit({
        type: 'run:error',
        runId,
        error: err.message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      })
      throw err
    }

    let lastState: {
      todos?: TodoItem[]
      files?: Record<string, FileRecord>
      messages?: BaseMessage[]
    } = { files: initialFiles }

    let totalSteps = 0
    let accumulatedText = ''
    const processedToolCallIds = new Set<string>()
    const processedToolResultIds = new Set<string>()
    const toolSummaries: ToolExecutionSummary[] = []
    let hasError: string | undefined

    try {
      const streamInput = {
        messages: initialMessages,
        files: initialFiles,
      }

      const agentStreamable = agent as unknown as {
        stream: (
          inp: unknown,
          opt: unknown,
        ) => Promise<AsyncIterable<[string, unknown]>>
      }

      const streamIterator = await agentStreamable.stream(streamInput, {
        recursionLimit: this.limits.maxSteps,
        streamMode: ['messages', 'values'],
        signal: abortController.signal,
      })

      for await (const [mode, chunk] of streamIterator) {
        if (abortController.signal.aborted || this.getState() === 'cancelled') {
          break
        }

        if (mode === 'messages') {
          // Token streaming: only emit deltas from AI / model messages
          const messageArray = Array.isArray(chunk) ? chunk : [chunk]
          for (const msg of messageArray) {
            const isAi =
              (typeof (msg as { _getType?: () => string })._getType === 'function' &&
                (msg as { _getType: () => string })._getType() === 'ai') ||
              (msg as { constructor?: { name?: string } }).constructor?.name === 'AIMessageChunk'
            if (!isAi) continue

            const content = (msg as { content?: string }).content
            if (typeof content === 'string' && content.length > 0) {
              accumulatedText += content
              await this.emitter.emit({
                type: 'text:delta',
                runId,
                delta: content,
                text: accumulatedText,
                timestamp: new Date().toISOString(),
              })
            }
          }
        } else if (mode === 'values') {
          // Graph state update
          totalSteps++
          lastState = chunk as typeof lastState

          if (totalSteps > this.limits.maxSteps) {
            throw new StepLimitExceededError(this.limits.maxSteps)
          }

          await this.emitter.emit({
            type: 'run:step',
            runId,
            stepNumber: totalSteps,
            timestamp: new Date().toISOString(),
          })

          // Check for plan updates
          if (lastState.todos) {
            await this.emitter.emit({
              type: 'plan:update',
              runId,
              todos: lastState.todos,
              timestamp: new Date().toISOString(),
            })
          }

          // Inspect messages for tool invocations and completions
          const messages = lastState.messages ?? []

          // Check context limits during multi-turn loop
          if (messages.length > this.limits.maxContextMessages) {
            throw new ContextLimitExceededError(
              messages.length,
              this.limits.maxContextMessages,
            )
          }

          for (const msg of messages) {
            const type = msg._getType()

            // Tool call start
            if (type === 'ai') {
              const aiMsg = msg as {
                tool_calls?: Array<{
                  id?: string
                  name: string
                  args?: Record<string, unknown>
                }>
              }
              for (const tc of aiMsg.tool_calls ?? []) {
                const callId = tc.id || createCallId()
                if (!processedToolCallIds.has(callId)) {
                  processedToolCallIds.add(callId)
                  await this.emitter.emit({
                    type: 'tool:start',
                    runId,
                    callId,
                    name: tc.name,
                    args: tc.args ?? {},
                    timestamp: new Date().toISOString(),
                  })
                }
              }
            }

            // Tool call result/error
            if (type === 'tool') {
              const toolMsg = msg as {
                tool_call_id?: string
                name?: string
                content?: unknown
                status?: string
              }
              const callId = toolMsg.tool_call_id || createCallId()
              if (!processedToolResultIds.has(callId)) {
                processedToolResultIds.add(callId)
                const name = toolMsg.name ?? 'unknown'
                const isError =
                  toolMsg.status === 'error' ||
                  (typeof toolMsg.content === 'string' &&
                    toolMsg.content.startsWith('Error:'))

                toolSummaries.push({
                  id: callId,
                  name,
                  content: toolMsg.content,
                  status: isError ? 'error' : 'success',
                })

                if (isError) {
                  await this.emitter.emit({
                    type: 'tool:error',
                    runId,
                    callId,
                    name,
                    error:
                      typeof toolMsg.content === 'string'
                        ? toolMsg.content
                        : JSON.stringify(toolMsg.content),
                    durationMs: 0,
                    timestamp: new Date().toISOString(),
                  })
                } else {
                  await this.emitter.emit({
                    type: 'tool:result',
                    runId,
                    callId,
                    name,
                    result: toolMsg.content,
                    durationMs: 0,
                    timestamp: new Date().toISOString(),
                  })
                }
              }
            }
          }
        }
      }

      // Check if cancelled during stream
      if (abortController.signal.aborted || this.getState() === 'cancelled') {
        this.currentState = 'cancelled'
        return {
          ok: false,
          runId,
          state: 'cancelled',
          summary: {
            runId,
            chatId: this.chatId,
            state: 'cancelled',
            todos: lastState.todos ?? [],
            files: lastState.files ?? {},
            toolCalls: toolSummaries,
            totalSteps,
            outputText: accumulatedText,
            durationMs: Date.now() - startTime,
            error: 'Run cancelled',
          },
          error: 'Run cancelled',
        }
      }

      // Persist final files to workspace if workspace exists
      if (this.workspace && lastState.files) {
        for (const [filePath, fileData] of Object.entries(lastState.files)) {
          try {
            const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath
            await this.workspace.writeFile(cleanPath, fileData.content, {
              encoding: fileData.encoding === 'base64' ? 'binary' : 'utf-8',
              mimeType: fileData.mimeType,
            })
          } catch (err) {
            console.warn(`Failed to persist file '${filePath}' to workspace:`, err)
          }
        }
      }

      // Persist user and assistant messages to recordStore
      if (this.recordStore) {
        try {
          const now = new Date().toISOString()
          await this.recordStore.addMessage({
            id: `msg_${Math.random().toString(36).slice(2)}_${Date.now()}`,
            chatId: this.chatId,
            role: 'user',
            content: prompt,
            createdAt: now,
          })
          if (accumulatedText) {
            await this.recordStore.addMessage({
              id: `msg_${Math.random().toString(36).slice(2)}_${Date.now()}`,
              chatId: this.chatId,
              role: 'assistant',
              content: accumulatedText,
              createdAt: now,
            })
          }
        } catch (err) {
          console.warn('Failed to record chat messages:', err)
        }
      }

      this.currentState = 'completed'
      const durationMs = Date.now() - startTime

      const summary: AgentRunSummary = {
        runId,
        chatId: this.chatId,
        state: 'completed',
        todos: lastState.todos ?? [],
        files: lastState.files ?? {},
        toolCalls: toolSummaries,
        totalSteps,
        outputText: accumulatedText,
        durationMs,
      }

      await this.emitter.emit({
        type: 'run:complete',
        runId,
        summary,
        durationMs,
        timestamp: new Date().toISOString(),
      })

      return {
        ok: true,
        runId,
        state: 'completed',
        summary,
      }
    } catch (err) {
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        abortController.signal.aborted ||
        this.getState() === 'cancelled'

      if (isAbort) {
        this.currentState = 'cancelled'
        return {
          ok: false,
          runId,
          state: 'cancelled',
          summary: {
            runId,
            chatId: this.chatId,
            state: 'cancelled',
            todos: lastState.todos ?? [],
            files: lastState.files ?? {},
            toolCalls: toolSummaries,
            totalSteps,
            outputText: accumulatedText,
            durationMs: Date.now() - startTime,
            error: 'Run cancelled',
          },
          error: 'Run cancelled',
        }
      }

      this.currentState = 'failed'
      const errorMsg = err instanceof Error ? err.message : String(err)
      hasError = errorMsg
      const durationMs = Date.now() - startTime

      await this.emitter.emit({
        type: 'run:error',
        runId,
        error: errorMsg,
        durationMs,
        timestamp: new Date().toISOString(),
      })

      return {
        ok: false,
        runId,
        state: 'failed',
        summary: {
          runId,
          chatId: this.chatId,
          state: 'failed',
          todos: lastState.todos ?? [],
          files: lastState.files ?? {},
          toolCalls: toolSummaries,
          totalSteps,
          outputText: accumulatedText,
          durationMs,
          error: errorMsg,
        },
        error: errorMsg,
      }
    } finally {
      clearTimeout(timeoutTimer)
      if (options.signal && callerAbortListener) {
        options.signal.removeEventListener('abort', callerAbortListener)
      }
      turnUnsubscribe?.()
      this.activeAbortController = undefined
    }
  }
}
