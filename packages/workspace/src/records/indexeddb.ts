import { NotFoundError, StorageUnavailableError } from '../errors.js'
import type {
  ChatMessageRecord,
  ChatSession,
  FileMetadata,
  PlanItemRecord,
  RunRecord,
  ToolCallRecord,
} from '../types.js'
import type { ReconciliationResult, RecordStore } from './types.js'

const DB_NAME = 'browser_agents_records_v1'
const DB_VERSION = 1

export function isIndexedDBAvailable(): boolean {
  try {
    return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null
  } catch {
    return false
  }
}

export class IndexedDbRecordStore implements RecordStore {
  private db: IDBDatabase | null = null
  private dbName: string
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(dbName: string = DB_NAME) {
    this.dbName = dbName
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }
    if (this.dbPromise) {
      return this.dbPromise
    }

    if (!isIndexedDBAvailable()) {
      throw new StorageUnavailableError('IndexedDB is not available in the current environment')
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(this.dbName, DB_VERSION)

      request.onupgradeneeded = event => {
        const db = request.result
        const oldVersion = event.oldVersion

        if (oldVersion < 1) {
          // Chats store
          if (!db.objectStoreNames.contains('chats')) {
            db.createObjectStore('chats', { keyPath: 'id' })
          }

          // Messages store
          if (!db.objectStoreNames.contains('messages')) {
            const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
            msgStore.createIndex('by_chatId', 'chatId', { unique: false })
          }

          // Plans store
          if (!db.objectStoreNames.contains('plans')) {
            const planStore = db.createObjectStore('plans', { keyPath: 'id' })
            planStore.createIndex('by_chatId', 'chatId', { unique: false })
          }

          // Runs store
          if (!db.objectStoreNames.contains('runs')) {
            const runStore = db.createObjectStore('runs', { keyPath: 'id' })
            runStore.createIndex('by_chatId', 'chatId', { unique: false })
            runStore.createIndex('by_status', 'status', { unique: false })
          }

          // Tool calls store
          if (!db.objectStoreNames.contains('tool_calls')) {
            const tcStore = db.createObjectStore('tool_calls', { keyPath: 'id' })
            tcStore.createIndex('by_runId', 'runId', { unique: false })
            tcStore.createIndex('by_chatId', 'chatId', { unique: false })
            tcStore.createIndex('by_status', 'status', { unique: false })
          }

          // File metadata store
          if (!db.objectStoreNames.contains('file_metadata')) {
            const metaStore = db.createObjectStore('file_metadata', { keyPath: ['chatId', 'path'] })
            metaStore.createIndex('by_chatId', 'chatId', { unique: false })
          }
        }
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onerror = () => {
        reject(new StorageUnavailableError(`Failed to open IndexedDB: ${request.error?.message || 'unknown error'}`))
      }

      request.onblocked = () => {
        reject(new StorageUnavailableError('IndexedDB open request was blocked by an open connection in another tab'))
      }
    })

    return this.dbPromise
  }

  private wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
    })
  }

  async createChat(chat: ChatSession): Promise<ChatSession> {
    const db = await this.getDb()
    const tx = db.transaction('chats', 'readwrite')
    const store = tx.objectStore('chats')
    await this.wrapRequest(store.add(chat))
    return { ...chat }
  }

  async getChat(id: string): Promise<ChatSession | null> {
    const db = await this.getDb()
    const tx = db.transaction('chats', 'readonly')
    const store = tx.objectStore('chats')
    const result = await this.wrapRequest(store.get(id))
    return result || null
  }

  async listChats(): Promise<ChatSession[]> {
    const db = await this.getDb()
    const tx = db.transaction('chats', 'readonly')
    const store = tx.objectStore('chats')
    const result = await this.wrapRequest(store.getAll())
    return result || []
  }

  async updateChat(id: string, updates: Partial<ChatSession>): Promise<ChatSession> {
    const db = await this.getDb()
    const tx = db.transaction('chats', 'readwrite')
    const store = tx.objectStore('chats')
    const existing = await this.wrapRequest<ChatSession | undefined>(store.get(id))
    if (!existing) {
      throw new NotFoundError(`Chat '${id}' not found`)
    }
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }
    await this.wrapRequest(store.put(updated))
    return updated
  }

  async deleteChat(id: string): Promise<boolean> {
    const db = await this.getDb()
    const tx = db.transaction(
      ['chats', 'messages', 'plans', 'runs', 'tool_calls', 'file_metadata'],
      'readwrite',
    )

    // Delete chat
    const chatStore = tx.objectStore('chats')
    await this.wrapRequest(chatStore.delete(id))

    // Delete messages for chat
    const msgStore = tx.objectStore('messages')
    const msgIndex = msgStore.index('by_chatId')
    const msgKeys = await this.wrapRequest(msgIndex.getAllKeys(id))
    for (const key of msgKeys) {
      await this.wrapRequest(msgStore.delete(key))
    }

    // Delete plan items for chat
    const planStore = tx.objectStore('plans')
    const planIndex = planStore.index('by_chatId')
    const planKeys = await this.wrapRequest(planIndex.getAllKeys(id))
    for (const key of planKeys) {
      await this.wrapRequest(planStore.delete(key))
    }

    // Delete runs and their tool calls
    const runStore = tx.objectStore('runs')
    const runIndex = runStore.index('by_chatId')
    const runKeys = await this.wrapRequest(runIndex.getAllKeys(id))
    for (const key of runKeys) {
      await this.wrapRequest(runStore.delete(key))
    }

    const tcStore = tx.objectStore('tool_calls')
    const tcIndex = tcStore.index('by_chatId')
    const tcKeys = await this.wrapRequest(tcIndex.getAllKeys(id))
    for (const key of tcKeys) {
      await this.wrapRequest(tcStore.delete(key))
    }

    // Delete file metadata
    const metaStore = tx.objectStore('file_metadata')
    const metaIndex = metaStore.index('by_chatId')
    const metaKeys = await this.wrapRequest(metaIndex.getAllKeys(id))
    for (const key of metaKeys) {
      await this.wrapRequest(metaStore.delete(key))
    }

    return true
  }

  async addMessage(message: ChatMessageRecord): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction('messages', 'readwrite')
    const store = tx.objectStore('messages')
    await this.wrapRequest(store.put(message))
  }

  async getMessages(chatId: string): Promise<ChatMessageRecord[]> {
    const db = await this.getDb()
    const tx = db.transaction('messages', 'readonly')
    const store = tx.objectStore('messages')
    const index = store.index('by_chatId')
    const result = await this.wrapRequest<ChatMessageRecord[]>(index.getAll(chatId))
    return (result || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async deleteMessages(chatId: string): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction('messages', 'readwrite')
    const store = tx.objectStore('messages')
    const index = store.index('by_chatId')
    const keys = await this.wrapRequest(index.getAllKeys(chatId))
    for (const key of keys) {
      await this.wrapRequest(store.delete(key))
    }
  }

  async setPlan(chatId: string, items: PlanItemRecord[]): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction('plans', 'readwrite')
    const store = tx.objectStore('plans')
    const index = store.index('by_chatId')

    // Delete previous items
    const keys = await this.wrapRequest(index.getAllKeys(chatId))
    for (const key of keys) {
      await this.wrapRequest(store.delete(key))
    }

    // Add new items
    for (const item of items) {
      await this.wrapRequest(store.put(item))
    }
  }

  async getPlan(chatId: string): Promise<PlanItemRecord[]> {
    const db = await this.getDb()
    const tx = db.transaction('plans', 'readonly')
    const store = tx.objectStore('plans')
    const index = store.index('by_chatId')
    const result = await this.wrapRequest<PlanItemRecord[]>(index.getAll(chatId))
    return (result || []).sort((a, b) => a.index - b.index)
  }

  async updatePlanItem(chatId: string, itemId: string, status: PlanItemRecord['status']): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction('plans', 'readwrite')
    const store = tx.objectStore('plans')
    const item = await this.wrapRequest<PlanItemRecord | undefined>(store.get(itemId))
    if (item && item.chatId === chatId) {
      item.status = status
      item.updatedAt = new Date().toISOString()
      await this.wrapRequest(store.put(item))
    }
  }

  async createRun(run: RunRecord): Promise<RunRecord> {
    const db = await this.getDb()
    const tx = db.transaction('runs', 'readwrite')
    const store = tx.objectStore('runs')
    await this.wrapRequest(store.add(run))
    return { ...run }
  }

  async getRun(id: string): Promise<RunRecord | null> {
    const db = await this.getDb()
    const tx = db.transaction('runs', 'readonly')
    const store = tx.objectStore('runs')
    const run = await this.wrapRequest(store.get(id))
    return run || null
  }

  async updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord> {
    const db = await this.getDb()
    const tx = db.transaction('runs', 'readwrite')
    const store = tx.objectStore('runs')
    const existing = await this.wrapRequest<RunRecord | undefined>(store.get(id))
    if (!existing) {
      throw new NotFoundError(`Run '${id}' not found`)
    }
    const updated = {
      ...existing,
      ...updates,
    }
    await this.wrapRequest(store.put(updated))
    return updated
  }

  async listRuns(chatId: string): Promise<RunRecord[]> {
    const db = await this.getDb()
    const tx = db.transaction('runs', 'readonly')
    const store = tx.objectStore('runs')
    const index = store.index('by_chatId')
    const result = await this.wrapRequest<RunRecord[]>(index.getAll(chatId))
    return (result || []).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  async createToolCall(tc: ToolCallRecord): Promise<ToolCallRecord> {
    const db = await this.getDb()
    const tx = db.transaction('tool_calls', 'readwrite')
    const store = tx.objectStore('tool_calls')
    await this.wrapRequest(store.add(tc))
    return { ...tc }
  }

  async getToolCall(id: string): Promise<ToolCallRecord | null> {
    const db = await this.getDb()
    const tx = db.transaction('tool_calls', 'readonly')
    const store = tx.objectStore('tool_calls')
    const tc = await this.wrapRequest(store.get(id))
    return tc || null
  }

  async updateToolCall(id: string, updates: Partial<ToolCallRecord>): Promise<ToolCallRecord> {
    const db = await this.getDb()
    const tx = db.transaction('tool_calls', 'readwrite')
    const store = tx.objectStore('tool_calls')
    const existing = await this.wrapRequest<ToolCallRecord | undefined>(store.get(id))
    if (!existing) {
      throw new NotFoundError(`Tool call '${id}' not found`)
    }
    const updated = {
      ...existing,
      ...updates,
    }
    await this.wrapRequest(store.put(updated))
    return updated
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    const db = await this.getDb()
    const tx = db.transaction('tool_calls', 'readonly')
    const store = tx.objectStore('tool_calls')
    const index = store.index('by_runId')
    const result = await this.wrapRequest<ToolCallRecord[]>(index.getAll(runId))
    return (result || []).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  async listToolCallsForChat(chatId: string): Promise<ToolCallRecord[]> {
    const db = await this.getDb()
    const tx = db.transaction('tool_calls', 'readonly')
    const store = tx.objectStore('tool_calls')
    const index = store.index('by_chatId')
    const result = await this.wrapRequest<ToolCallRecord[]>(index.getAll(chatId))
    return (result || []).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  async saveFileMetadata(meta: FileMetadata): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction('file_metadata', 'readwrite')
    const store = tx.objectStore('file_metadata')
    await this.wrapRequest(store.put(meta))
  }

  async getFileMetadata(chatId: string, path: string): Promise<FileMetadata | null> {
    const db = await this.getDb()
    const tx = db.transaction('file_metadata', 'readonly')
    const store = tx.objectStore('file_metadata')
    const result = await this.wrapRequest(store.get([chatId, path]))
    return result || null
  }

  async listFileMetadata(chatId: string): Promise<FileMetadata[]> {
    const db = await this.getDb()
    const tx = db.transaction('file_metadata', 'readonly')
    const store = tx.objectStore('file_metadata')
    const index = store.index('by_chatId')
    const result = await this.wrapRequest<FileMetadata[]>(index.getAll(chatId))
    return result || []
  }

  async deleteFileMetadata(chatId: string, path: string): Promise<boolean> {
    const db = await this.getDb()
    const tx = db.transaction('file_metadata', 'readwrite')
    const store = tx.objectStore('file_metadata')
    await this.wrapRequest(store.delete([chatId, path]))
    return true
  }

  async deleteChatFileMetadata(chatId: string): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction('file_metadata', 'readwrite')
    const store = tx.objectStore('file_metadata')
    const index = store.index('by_chatId')
    const keys = await this.wrapRequest(index.getAllKeys(chatId))
    for (const key of keys) {
      await this.wrapRequest(store.delete(key))
    }
  }

  async reconcileStartup(): Promise<ReconciliationResult> {
    const db = await this.getDb()
    const tx = db.transaction(['runs', 'tool_calls'], 'readwrite')
    const runStore = tx.objectStore('runs')
    const tcStore = tx.objectStore('tool_calls')
    const runStatusIndex = runStore.index('by_status')

    const runningRuns = await this.wrapRequest<RunRecord[]>(runStatusIndex.getAll('running'))
    const interruptedRuns: string[] = []
    const interruptedToolCalls: string[] = []
    const now = new Date().toISOString()

    for (const run of runningRuns) {
      run.status = 'interrupted'
      run.endedAt = now
      run.error = { message: 'Run interrupted by application restart' }
      await this.wrapRequest(runStore.put(run))
      interruptedRuns.push(run.id)
    }

    const tcStatusIndex = tcStore.index('by_status')
    const runningToolCalls = await this.wrapRequest<ToolCallRecord[]>(tcStatusIndex.getAll('running'))
    const pendingToolCalls = await this.wrapRequest<ToolCallRecord[]>(tcStatusIndex.getAll('pending'))

    for (const tc of [...runningToolCalls, ...pendingToolCalls]) {
      tc.status = 'interrupted'
      tc.endedAt = now
      tc.error = 'Tool call interrupted by application restart'
      await this.wrapRequest(tcStore.put(tc))
      interruptedToolCalls.push(tc.id)
    }

    return { interruptedRuns, interruptedToolCalls }
  }

  isDurable(): boolean {
    return true
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
      this.dbPromise = null
    }
  }
}
