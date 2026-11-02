import type { AgentRunState } from '@browser-agents/runtime'

export interface ProviderPreferences {
  relayUrl: string
  providerName: string
  baseUrl: string
  selectedModel: string
  customModel: string
  isFixtureMode: boolean
}

export type PythonRuntimeStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'terminated'
  | 'error'

export interface PythonState {
  status: PythonRuntimeStatus
  packages: string[]
  error?: string
}

export interface ActiveRunInfo {
  runId: string
  chatId: string
  state: AgentRunState
  step: number
  prompt: string
  streamingText: string
  startedAt: string
  error?: string
}

export interface AssembledRequestInspection {
  providerName: string
  baseUrl: string
  model: string
  systemPrompt: string
  messages: Array<{ role: string; content: string }>
  tools: Array<{ name: string; description?: string }>
}
