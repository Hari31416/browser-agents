import { getMimeType, type ChatWorkspace, type RecordStore } from '@browser-agents/workspace'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import { ToolMessage } from '@langchain/core/messages'
import { Command, StateSchema } from '@langchain/langgraph'
import { createBrowserDeepAgent, filesValue, StateBackend } from './agent.js'
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
  PythonExecutionOutput,
  PythonExecutor,
  RuntimeLimits,
  TodoItem,
  ToolExecutionSummary,
} from './types.js'

function fileBytes(record: FileRecord): Uint8Array {
  const content = record.content as string | Uint8Array
  if (content instanceof Uint8Array) return content
  if (record.encoding === 'base64') {
    return Uint8Array.from(atob(content), char => char.charCodeAt(0))
  }
  return new TextEncoder().encode(content)
}

function fileRecord(data: Uint8Array, mimeType: string): FileRecord {
  const text = mimeType.startsWith('text/') || mimeType === 'application/json'
  const now = new Date().toISOString()
  let binary = ''
  if (!text) {
    for (let offset = 0; offset < data.length; offset += 0x8000) {
      binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
    }
  }
  return {
    content: text ? new TextDecoder().decode(data) : btoa(binary),
    mimeType,
    encoding: text ? 'utf-8' : 'base64',
    created_at: now,
    modified_at: now,
  }
}

function cloneFileState(files: Record<string, FileRecord | null>): Record<string, FileRecord> {
  return Object.fromEntries(
    Object.entries(files).flatMap(([path, record]) => record ? [[path, { ...record }]] : []),
  )
}

function sameFile(a: FileRecord | null | undefined, b: FileRecord | null | undefined): boolean {
  return a === b || (!!a && !!b && a.content === b.content && a.encoding === b.encoding && a.mimeType === b.mimeType)
}

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
    const trackedVersions = new Map<string, number>()
    const trackedSources = new Map<string, 'user' | 'model'>()
    if (this.workspace) {
      try {
        const wsFiles = await this.workspace.listFiles()
        const now = new Date().toISOString()
        for (const f of wsFiles) {
          const normKey = f.path.startsWith('/') ? f.path : '/' + f.path
          const path = f.path.replace(/^\//, '')
          if (f.version !== undefined) trackedVersions.set(path, f.version)
          if (f.source) trackedSources.set(path, f.source)
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
    const pythonSyncMutex = new AsyncMutex()
    const pythonOutputRef: { current?: PythonExecutionOutput } = {}
    const pythonStateOverlay = new Map<string, { base: FileRecord | null | undefined; value: FileRecord | null }>()
    let pythonBatchId: string | undefined
    let synchronizedGraphFiles: Record<string, FileRecord> = cloneFileState(initialFiles)

    const syncGraphFilesToWorkspace = async (graphFiles: Record<string, FileRecord | null>) => {
      if (!this.workspace) return
      const normGraph = new Map(
        Object.entries(graphFiles).flatMap(([path, record]) => record ? [[path.replace(/^\//, ''), record] as const] : []),
      )
      const priorPaths = new Set(Object.keys(synchronizedGraphFiles).map(path => path.replace(/^\//, '')))
      const graphPaths = new Set(normGraph.keys())
      const changes: Array<{ type: 'write' | 'delete'; path: string; content?: Uint8Array; encoding?: 'binary'; mimeType?: string; source?: 'user' | 'model' }> = []

      for (const path of priorPaths) {
        if (!graphPaths.has(path)) changes.push({ type: 'delete', path })
      }
      for (const [path, record] of normGraph) {
        const prior = synchronizedGraphFiles['/' + path] ?? synchronizedGraphFiles[path]
        if (prior && prior.content === record.content && prior.encoding === record.encoding && prior.mimeType === record.mimeType) continue
        changes.push({
          type: 'write',
          path,
          content: fileBytes(record),
          encoding: 'binary',
          mimeType: record.mimeType,
          source: trackedSources.get(path) ?? 'model',
        })
      }
      if (changes.length === 0) return

      const current = await this.workspace.createExecutionSnapshot()
      for (const change of changes) {
        const expected = trackedVersions.get(change.path)
        const currentRevision = current.baseRevisions[change.path]
        if (expected !== currentRevision) {
          throw new Error(`Workspace conflict for '${change.path}': expected revision ${expected ?? 'missing'}, found ${currentRevision ?? 'missing'}`)
        }
      }
      const staging = this.workspace.stageChanges(current, changes)
      const committed = await this.workspace.commitStagedChanges(staging)
      for (const change of changes) {
        const revision = committed.revisions[change.path]
        if (revision === undefined) trackedVersions.delete(change.path)
        else {
          trackedVersions.set(change.path, revision)
          if (change.type === 'write') trackedSources.set(change.path, change.source ?? 'model')
        }
        if (change.type === 'delete') trackedSources.delete(change.path)
      }
      synchronizedGraphFiles = cloneFileState(graphFiles)
    }

    const refreshTrackedVersions = async () => {
      if (!this.workspace) return
      const snapshot = await this.workspace.createExecutionSnapshot()
      trackedVersions.clear()
      trackedSources.clear()
      for (const [path, version] of Object.entries(snapshot.baseRevisions)) trackedVersions.set(path, version)
      for (const file of snapshot.files) if (file.source) trackedSources.set(file.path, file.source)
    }

    if (this.pythonExecutor) {
      const pyTool = createPythonTool({
        executor: this.pythonExecutor,
        mutex: fileMutex,
        limits: this.limits,
        signal: abortController.signal,
        onExecutionComplete: result => { pythonOutputRef.current = result },
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
      middleware: [
        {
          name: 'PythonWorkspaceSync',
          stateSchema: new StateSchema({ files: filesValue }),
          wrapToolCall: async (
            request: {
              toolCall: { name: string; id?: string }
              state: { files?: Record<string, FileRecord | null>; messages?: BaseMessage[] }
            },
            handler: (request: unknown) => Promise<ToolMessage | Command>,
          ) => {
            if (request.toolCall.name !== 'execute_python') return handler(request)

            return pythonSyncMutex.runExclusive(async () => {
              const latestAiMessage = [...(request.state.messages ?? [])]
                .reverse()
                .find(message => message._getType?.() === 'ai')
              const batchId = latestAiMessage &&
                ((latestAiMessage as { tool_calls?: Array<{ name: string }> }).tool_calls ?? [])
                  .some(call => call.name === 'execute_python')
                ? latestAiMessage.id
                : undefined
              if (batchId !== pythonBatchId) {
                pythonStateOverlay.clear()
                pythonBatchId = batchId
              }

              const incomingFiles = request.state.files ?? initialFiles
              const currentFiles: Record<string, FileRecord | null> = { ...incomingFiles }
              for (const [path, update] of pythonStateOverlay) {
                if (sameFile(incomingFiles[path], update.base)) currentFiles[path] = update.value
                else pythonStateOverlay.delete(path)
              }
              await syncGraphFilesToWorkspace(currentFiles)

              pythonOutputRef.current = undefined
              const result = await handler(request)
              const output = pythonOutputRef.current as PythonExecutionOutput | undefined
              if (!output?.ok || !output.files) return result

              let nextFiles: Record<string, FileRecord | null>
              if (output.filesAreSnapshot) {
                nextFiles = {}
                for (const [path, data] of Object.entries(output.files)) {
                  nextFiles[path.startsWith('/') ? path : '/' + path] = fileRecord(data, getMimeType(path))
                }
                for (const path of Object.keys(currentFiles)) {
                  if (!nextFiles[path] && currentFiles[path]) nextFiles[path] = null
                }
              } else {
                nextFiles = { ...currentFiles }
                for (const [path, data] of Object.entries(output.files)) {
                  nextFiles[path.startsWith('/') ? path : '/' + path] = fileRecord(data, getMimeType(path))
                }
              }

              for (const [path, value] of Object.entries(nextFiles)) {
                if (sameFile(value, currentFiles[path])) continue
                const prior = pythonStateOverlay.get(path)
                pythonStateOverlay.set(path, { base: prior?.base ?? incomingFiles[path], value })
              }
              if (output.filesAreSnapshot) {
                await refreshTrackedVersions()
                synchronizedGraphFiles = cloneFileState(nextFiles)
              } else {
                await syncGraphFilesToWorkspace(nextFiles)
              }

              if (!(result instanceof ToolMessage)) return result
              const changed = Object.fromEntries(
                Object.entries(nextFiles).filter(([path, value]) => {
                  const previous = currentFiles[path]
                  if (value === null) return previous !== undefined && previous !== null
                  return !previous || previous.content !== value.content || previous.encoding !== value.encoding || previous.mimeType !== value.mimeType
                }),
              )
              return new Command({ update: { files: changed, messages: [result] } })
            })
          },
        },
      ],
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

      // Flush any remaining graph file edits with revision checks. Python updates
      // have already synchronized their complete or partial changes above.
      if (lastState.files) await syncGraphFilesToWorkspace(lastState.files)

      // Persist user and assistant messages to recordStore only if not already recorded by caller
      if (this.recordStore) {
        try {
          const existingMsgs = await this.recordStore.getMessages(this.chatId)
          const alreadyRecorded = existingMsgs.some(
            m => m.role === 'user' && (m.content || '').trim() === prompt.trim(),
          )
          if (!alreadyRecorded) {
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
