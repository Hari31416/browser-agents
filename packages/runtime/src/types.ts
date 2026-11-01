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
  name: string
  content: unknown
  status?: string
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
