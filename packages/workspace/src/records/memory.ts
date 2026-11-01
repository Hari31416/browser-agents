import { NotFoundError } from '../errors.js'
import type {
  ChatMessageRecord,
  ChatSession,
  FileMetadata,
  PlanItemRecord,
  RunRecord,
  ToolCallRecord,
} from '../types.js'
import type { ReconciliationResult, RecordStore } from './types.js'

export class MemoryRecordStore implements RecordStore {
  private chats = new Map<string, ChatSession>()
  private messages = new Map<string, ChatMessageRecord[]>()
  private plans = new Map<string, PlanItemRecord[]>()
  private runs = new Map<string, RunRecord>()
  private toolCalls = new Map<string, ToolCallRecord>()
  private fileMetadata = new Map<string, Map<string, FileMetadata>>()

  async createChat(chat: ChatSession): Promise<ChatSession> {
    this.chats.set(chat.id, { ...chat })
    if (!this.messages.has(chat.id)) {
      this.messages.set(chat.id, [])
    }
    if (!this.plans.has(chat.id)) {
      this.plans.set(chat.id, [])
    }
    if (!this.fileMetadata.has(chat.id)) {
      this.fileMetadata.set(chat.id, new Map())
    }
    return { ...chat }
  }

  async getChat(id: string): Promise<ChatSession | null> {
    const chat = this.chats.get(id)
    return chat ? { ...chat } : null
  }

  async listChats(): Promise<ChatSession[]> {
    return Array.from(this.chats.values()).map(c => ({ ...c }))
  }

  async updateChat(id: string, updates: Partial<ChatSession>): Promise<ChatSession> {
    const existing = this.chats.get(id)
    if (!existing) {
      throw new NotFoundError(`Chat '${id}' not found`)
    }
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    this.chats.set(id, updated)
    return { ...updated }
  }

  async deleteChat(id: string): Promise<boolean> {
    const existed = this.chats.delete(id)
    this.messages.delete(id)
    this.plans.delete(id)
    this.fileMetadata.delete(id)

    // Remove runs and tool calls for this chat
    for (const [runId, run] of this.runs.entries()) {
      if (run.chatId === id) {
        this.runs.delete(runId)
      }
    }
    for (const [tcId, tc] of this.toolCalls.entries()) {
      if (tc.chatId === id) {
        this.toolCalls.delete(tcId)
      }
    }

    return existed
  }

  async addMessage(message: ChatMessageRecord): Promise<void> {
    let list = this.messages.get(message.chatId)
    if (!list) {
      list = []
      this.messages.set(message.chatId, list)
    }
    list.push({ ...message })
  }

  async getMessages(chatId: string): Promise<ChatMessageRecord[]> {
    const list = this.messages.get(chatId) || []
    return list.map(m => ({ ...m }))
  }

  async deleteMessages(chatId: string): Promise<void> {
    this.messages.set(chatId, [])
  }

  async setPlan(chatId: string, items: PlanItemRecord[]): Promise<void> {
    this.plans.set(chatId, items.map(item => ({ ...item })))
  }

  async getPlan(chatId: string): Promise<PlanItemRecord[]> {
    const list = this.plans.get(chatId) || []
    return list.map(item => ({ ...item }))
  }

  async updatePlanItem(chatId: string, itemId: string, status: PlanItemRecord['status']): Promise<void> {
    const list = this.plans.get(chatId)
    if (!list) return
    const item = list.find(i => i.id === itemId)
    if (item) {
      item.status = status
      item.updatedAt = new Date().toISOString()
    }
  }

  async createRun(run: RunRecord): Promise<RunRecord> {
    this.runs.set(run.id, { ...run })
    return { ...run }
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const run = this.runs.get(id)
    return run ? { ...run } : null
  }

  async updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord> {
    const existing = this.runs.get(id)
    if (!existing) {
      throw new NotFoundError(`Run '${id}' not found`)
    }
    const updated = {
      ...existing,
      ...updates,
    }
    this.runs.set(id, updated)
    return { ...updated }
  }

  async listRuns(chatId: string): Promise<RunRecord[]> {
    const result: RunRecord[] = []
    for (const run of this.runs.values()) {
      if (run.chatId === chatId) {
        result.push({ ...run })
      }
    }
    return result
  }

  async createToolCall(tc: ToolCallRecord): Promise<ToolCallRecord> {
    this.toolCalls.set(tc.id, { ...tc })
    return { ...tc }
  }

  async getToolCall(id: string): Promise<ToolCallRecord | null> {
    const tc = this.toolCalls.get(id)
    return tc ? { ...tc } : null
  }

  async updateToolCall(id: string, updates: Partial<ToolCallRecord>): Promise<ToolCallRecord> {
    const existing = this.toolCalls.get(id)
    if (!existing) {
      throw new NotFoundError(`Tool call '${id}' not found`)
    }
    const updated = {
      ...existing,
      ...updates,
    }
    this.toolCalls.set(id, updated)
    return { ...updated }
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    const result: ToolCallRecord[] = []
    for (const tc of this.toolCalls.values()) {
      if (tc.runId === runId) {
        result.push({ ...tc })
      }
    }
    return result
  }

  async listToolCallsForChat(chatId: string): Promise<ToolCallRecord[]> {
    const result: ToolCallRecord[] = []
    for (const tc of this.toolCalls.values()) {
      if (tc.chatId === chatId) {
        result.push({ ...tc })
      }
    }
    return result
  }

  async saveFileMetadata(meta: FileMetadata): Promise<void> {
    let files = this.fileMetadata.get(meta.chatId)
    if (!files) {
      files = new Map()
      this.fileMetadata.set(meta.chatId, files)
    }
    files.set(meta.path, { ...meta })
  }

  async getFileMetadata(chatId: string, path: string): Promise<FileMetadata | null> {
    const files = this.fileMetadata.get(chatId)
    if (!files) return null
    const meta = files.get(path)
    return meta ? { ...meta } : null
  }

  async listFileMetadata(chatId: string): Promise<FileMetadata[]> {
    const files = this.fileMetadata.get(chatId)
    if (!files) return []
    return Array.from(files.values()).map(f => ({ ...f }))
  }

  async deleteFileMetadata(chatId: string, path: string): Promise<boolean> {
    const files = this.fileMetadata.get(chatId)
    if (!files) return false
    return files.delete(path)
  }

  async deleteChatFileMetadata(chatId: string): Promise<void> {
    this.fileMetadata.delete(chatId)
  }

  async reconcileStartup(): Promise<ReconciliationResult> {
    const now = new Date().toISOString()
    const interruptedRuns: string[] = []
    const interruptedToolCalls: string[] = []

    for (const [runId, run] of this.runs.entries()) {
      if (run.status === 'running') {
        run.status = 'interrupted'
        run.endedAt = now
        run.error = { message: 'Run interrupted by application restart' }
        interruptedRuns.push(runId)
      }
    }

    const interruptedRunSet = new Set(interruptedRuns)
    for (const [tcId, tc] of this.toolCalls.entries()) {
      if ((tc.status === 'running' || tc.status === 'pending') && (interruptedRunSet.has(tc.runId) || tc.status === 'running')) {
        tc.status = 'interrupted'
        tc.endedAt = now
        tc.error = 'Tool call interrupted by application restart'
        interruptedToolCalls.push(tcId)
      }
    }

    return { interruptedRuns, interruptedToolCalls }
  }

  isDurable(): boolean {
    return false
  }

  async close(): Promise<void> {
    // No-op for memory store
  }
}
