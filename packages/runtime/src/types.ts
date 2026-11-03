import type { ChatWorkspace, RecordStore } from '@browser-agents/workspace'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

export interface CreateSessionResponse {
  session_token: string
}

export interface ProviderRegisterRequest {
  base_url: string
  api_key?: string
  models?: string[]
}

export interface ProviderResponse {
  provider_id: string
  base_url: string
  has_api_key: boolean
  discovered_models: string[]
}

export interface ModelDiscoveryResponse {
  provider_id: string
  models: string[]
  supports_discovery: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

export interface ToolCallDelta {
  index: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

export interface ToolCallAccumulator {
  id: string
  name: string
  args: string
}

export interface ChatRequest {
  provider_id: string
  model: string
  messages: ChatMessage[]
  tools?: unknown[]
  stream?: boolean
}

export interface RelayError {
  error: string
  message: string
}

export interface TodoItem {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface FileRecord {
  content: string
  encoding?: string
  mimeType?: string
  created_at: string
  modified_at: string
}

export interface ToolExecutionSummary {
  id?: string
  name: string
  args?: Record<string, unknown>
  content: unknown
  status?: string
  durationMs?: number
}

export interface AgentExecutionSummary {
  boundTools: string[]
  todos: TodoItem[]
  files: Record<string, FileRecord>
  toolResults: ToolExecutionSummary[]
  streamEvents?: number
}

export interface RelayConnectionConfig {
  relayUrl: string
  sessionToken: string
  providerId: string
  model: string
}

export interface WorkerInitMessage {
  type: 'init'
  config: RelayConnectionConfig
}

export interface WorkerRunMessage {
  type: 'run'
  prompt: string
  files?: Record<string, FileRecord>
  systemPrompt?: string
}

export interface WorkerReadyMessage {
  type: 'ready'
}

export interface WorkerProgressMessage {
  type: 'progress'
  todos?: TodoItem[]
  stepCount: number
}

export interface WorkerResultMessage {
  type: 'result'
  ok: boolean
  summary?: AgentExecutionSummary
  error?: string
}

export type WorkerInboundMessage = WorkerInitMessage | WorkerRunMessage
export type WorkerOutboundMessage = WorkerReadyMessage | WorkerProgressMessage | WorkerResultMessage

// ---------------------------------------------------------------------------
// Phase 04: Agent Runtime States, Events, Limits, and Interfaces
// ---------------------------------------------------------------------------

export type AgentRunState = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface AgentRunStartEvent {
  type: 'run:start'
  runId: string
  chatId: string
  prompt: string
  timestamp: string
}

export interface AgentRunStepEvent {
  type: 'run:step'
  runId: string
  stepNumber: number
  timestamp: string
}

export interface AgentTextDeltaEvent {
  type: 'text:delta'
  runId: string
  delta: string
  text: string
  timestamp: string
}

export interface AgentPlanUpdateEvent {
  type: 'plan:update'
  runId: string
  todos: TodoItem[]
  timestamp: string
}

export interface AgentToolStartEvent {
  type: 'tool:start'
  runId: string
  callId: string
  name: string
  args: Record<string, unknown>
  timestamp: string
}

export interface AgentToolResultEvent {
  type: 'tool:result'
  runId: string
  callId: string
  name: string
  result: unknown
  durationMs: number
  timestamp: string
}

export interface AgentToolErrorEvent {
  type: 'tool:error'
  runId: string
  callId: string
  name: string
  error: string
  durationMs: number
  timestamp: string
}

export interface AgentUsageEvent {
  type: 'usage'
  runId: string
  usage: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  timestamp: string
}

export interface AgentRunCancelEvent {
  type: 'run:cancel'
  runId: string
  reason?: string
  timestamp: string
}

export interface AgentRunCompleteEvent {
  type: 'run:complete'
  runId: string
  summary: AgentRunSummary
  durationMs: number
  timestamp: string
}

export interface AgentRunErrorEvent {
  type: 'run:error'
  runId: string
  error: string
  durationMs: number
  timestamp: string
}

export type AgentEvent =
  | AgentRunStartEvent
  | AgentRunStepEvent
  | AgentTextDeltaEvent
  | AgentPlanUpdateEvent
  | AgentToolStartEvent
  | AgentToolResultEvent
  | AgentToolErrorEvent
  | AgentUsageEvent
  | AgentRunCancelEvent
  | AgentRunCompleteEvent
  | AgentRunErrorEvent

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>

export interface AgentRunSummary {
  runId: string
  chatId: string
  state: AgentRunState
  todos: TodoItem[]
  files: Record<string, FileRecord>
  toolCalls: ToolExecutionSummary[]
  totalSteps: number
  outputText: string
  durationMs: number
  truncated?: boolean
  error?: string
}

export interface RuntimeLimits {
  maxSteps?: number
  timeoutMs?: number
  maxOutputChars?: number
  maxContextMessages?: number
  concurrency?: 'reject' | 'serialize'
}

export interface PythonExecuteOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputChars?: number
}

export interface PythonExecutionOutput {
  ok: boolean
  exitCode?: number
  stdout: string
  stderr: string
  files?: Record<string, Uint8Array>
  /** True when `files` is the executor's complete resulting workspace snapshot. */
  filesAreSnapshot?: boolean
  artifacts?: Array<{
    path: string
    mimeType: string
    dataBase64: string
    size?: number
  }>
  durationMs?: number
  error?: string
}

export interface PythonExecutor {
  execute(code: string, options?: PythonExecuteOptions): Promise<PythonExecutionOutput>
  cancel?(): Promise<void>
}

export interface AgentRuntimeOptions {
  chatId: string
  model: BaseChatModel
  workspace?: ChatWorkspace
  pythonExecutor?: PythonExecutor
  recordStore?: RecordStore
  systemPrompt?: string
  limits?: RuntimeLimits
  onEvent?: AgentEventHandler
}

export interface AgentRunOptions {
  signal?: AbortSignal
  initialFiles?: Record<string, FileRecord>
  onEvent?: AgentEventHandler
}

export interface AgentRunResult {
  ok: boolean
  runId: string
  state: AgentRunState
  summary: AgentRunSummary
  error?: string
}
