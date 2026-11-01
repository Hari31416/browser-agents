import type {
  ChatMessageRecord,
  ChatSession,
  FileMetadata,
  PlanItemRecord,
  RunRecord,
  ToolCallRecord,
} from '../types.js'

export interface ReconciliationResult {
  interruptedRuns: string[]
  interruptedToolCalls: string[]
}

export interface RecordStore {
  // Chats
  createChat(chat: ChatSession): Promise<ChatSession>
  getChat(id: string): Promise<ChatSession | null>
  listChats(): Promise<ChatSession[]>
  updateChat(id: string, updates: Partial<ChatSession>): Promise<ChatSession>
  deleteChat(id: string): Promise<boolean>

  // Messages
  addMessage(message: ChatMessageRecord): Promise<void>
  getMessages(chatId: string): Promise<ChatMessageRecord[]>
  deleteMessages(chatId: string): Promise<void>

  // Plan
  setPlan(chatId: string, items: PlanItemRecord[]): Promise<void>
  getPlan(chatId: string): Promise<PlanItemRecord[]>
  updatePlanItem(chatId: string, itemId: string, status: PlanItemRecord['status']): Promise<void>

  // Runs
  createRun(run: RunRecord): Promise<RunRecord>
  getRun(id: string): Promise<RunRecord | null>
  updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord>
  listRuns(chatId: string): Promise<RunRecord[]>

  // Tool calls
  createToolCall(tc: ToolCallRecord): Promise<ToolCallRecord>
  getToolCall(id: string): Promise<ToolCallRecord | null>
  updateToolCall(id: string, updates: Partial<ToolCallRecord>): Promise<ToolCallRecord>
  listToolCalls(runId: string): Promise<ToolCallRecord[]>
  listToolCallsForChat(chatId: string): Promise<ToolCallRecord[]>

  // File metadata
  saveFileMetadata(meta: FileMetadata): Promise<void>
  getFileMetadata(chatId: string, path: string): Promise<FileMetadata | null>
  listFileMetadata(chatId: string): Promise<FileMetadata[]>
  deleteFileMetadata(chatId: string, path: string): Promise<boolean>
  deleteChatFileMetadata(chatId: string): Promise<void>

  // Lifecycle
  reconcileStartup(): Promise<ReconciliationResult>
  isDurable(): boolean
  close(): Promise<void>
}
