import {
  NotFoundError,
  QuotaExceededError,
  StaleRevisionError,
  WorkspaceError,
} from './errors.js'
import { MemoryFileStore } from './files/memory.js'
import { isOPFSAvailable, OPFSFileStore } from './files/opfs.js'
import type { FileStore } from './files/types.js'
import { computeHash } from './hash.js'
import { TabLockManager } from './lock.js'
import { getMimeType, normalizePath } from './path.js'
import { IndexedDbRecordStore, isIndexedDBAvailable } from './records/indexeddb.js'
import { MemoryRecordStore } from './records/memory.js'
import type { ReconciliationResult, RecordStore } from './records/types.js'
import { StagingManager, type StagingSession, type WorkspaceStorageTarget } from './staging.js'
import {
  SCHEMA_VERSION,
  type BoundedReadResult,
  type ChatArchive,
  type ChatMessageRecord,
  type ChatSession,
  type CommitResult,
  type EditFileOptions,
  type ExecutionSnapshot,
  type FileMetadata,
  type PlanItemRecord,
  type ReadBoundedOptions,
  type RunRecord,
  type StagedFileChange,
  type StorageLimits,
  type StorageStatus,
  type StorageUsage,
  type ToolCallRecord,
  type WorkspaceFile,
  type WorkspaceStore,
  type WriteFileOptions,
} from './types.js'

export const DEFAULT_STORAGE_LIMITS: StorageLimits = {
  maxFileBytes: 50 * 1024 * 1024, // 50 MB
  maxWorkspaceBytes: 200 * 1024 * 1024, // 200 MB
}

export class ChatWorkspace implements WorkspaceStore {
  readonly chatId: string
  private fileStore: FileStore
  private recordStore: RecordStore
  private lockManager: TabLockManager
  private stagingManager: StagingManager
  private limits: StorageLimits

  constructor(
    chatId: string,
    fileStore: FileStore,
    recordStore: RecordStore,
    lockManager: TabLockManager,
    stagingManager: StagingManager,
    limits: StorageLimits = DEFAULT_STORAGE_LIMITS,
  ) {
    if (!chatId || typeof chatId !== 'string') {
      throw new WorkspaceError('ChatId must be a non-empty string')
    }
    this.chatId = chatId
    this.fileStore = fileStore
    this.recordStore = recordStore
    this.lockManager = lockManager
    this.stagingManager = stagingManager
    this.limits = limits
  }

  async writeFile(
    path: string,
    content: Uint8Array | string,
    options: WriteFileOptions | 'utf-8' | 'base64' = {},
  ): Promise<FileMetadata> {
    return await this.lockManager.withChatLock(this.chatId, async () => {
      return await this._writeFile(path, content, options)
    })
  }

  private async _writeFile(
    path: string,
    content: Uint8Array | string,
    options: WriteFileOptions | 'utf-8' | 'base64' = {},
  ): Promise<FileMetadata> {
    const normPath = normalizePath(path)
    const opts: WriteFileOptions =
      typeof options === 'string' ? { encoding: options === 'base64' ? 'binary' : 'utf-8' } : options

    let byteData: Uint8Array
    if (content instanceof Uint8Array) {
      byteData = content
    } else if (typeof content === 'string') {
      if (opts.encoding === 'binary') {
        byteData = Uint8Array.from(atob(content), c => c.charCodeAt(0))
      } else {
        byteData = new TextEncoder().encode(content)
      }
    } else {
      throw new WorkspaceError('Content must be a string or Uint8Array')
    }

    // Check per-file size limit
    if (byteData.length > this.limits.maxFileBytes) {
      throw new QuotaExceededError(
        `File size (${byteData.length} bytes) exceeds per-file limit of ${this.limits.maxFileBytes} bytes`,
        byteData.length,
        this.limits.maxFileBytes,
      )
    }

    const existingMeta = await this.recordStore.getFileMetadata(this.chatId, normPath)

    // Check optimistic concurrency version
    if (opts.expectedVersion !== undefined) {
      const currentVersion = existingMeta ? existingMeta.version : 0
      if (currentVersion !== opts.expectedVersion) {
        throw new StaleRevisionError(
          `File '${normPath}' version mismatch: expected ${opts.expectedVersion}, got ${currentVersion}`,
          opts.expectedVersion,
          currentVersion,
        )
      }
    }

    // Check overwrite constraint if overwrite is explicitly false
    if (opts.overwrite === false && existingMeta) {
      throw new WorkspaceError(`File '${normPath}' already exists and overwrite is false`)
    }

    // Check total workspace size limit
    const allFiles = await this.recordStore.listFileMetadata(this.chatId)
    const currentTotal = allFiles.reduce((acc, f) => acc + (f.path === normPath ? 0 : f.size), 0)
    if (currentTotal + byteData.length > this.limits.maxWorkspaceBytes) {
      throw new QuotaExceededError(
        `Workspace quota exceeded: total size would be ${currentTotal + byteData.length} bytes, limit is ${this.limits.maxWorkspaceBytes} bytes`,
        currentTotal + byteData.length,
        this.limits.maxWorkspaceBytes,
      )
    }

    const hash = await computeHash(byteData)
    const now = new Date().toISOString()
    const version = existingMeta ? existingMeta.version + 1 : 1
    const mimeType = opts.mimeType || getMimeType(normPath)

    await this.fileStore.writeBytes(this.chatId, normPath, byteData)

    const meta: FileMetadata = {
      path: normPath,
      chatId: this.chatId,
      size: byteData.length,
      mimeType,
      version,
      etag: hash,
      createdAt: existingMeta ? existingMeta.createdAt : now,
      updatedAt: now,
    }

    await this.recordStore.saveFileMetadata(meta)
    return meta
  }

  async readFile(path: string): Promise<WorkspaceFile | null> {
    const normPath = normalizePath(path)
    const meta = await this.recordStore.getFileMetadata(this.chatId, normPath)
    if (!meta) return null

    const data = await this.fileStore.readBytes(this.chatId, normPath)
    if (!data) return null

    const isText = meta.mimeType.startsWith('text/') ||
      meta.mimeType === 'application/json' ||
      meta.mimeType === 'application/javascript' ||
      meta.mimeType === 'application/typescript'

    return {
      path: meta.path,
      content: isText ? new TextDecoder().decode(data) : btoa(String.fromCharCode(...data)),
      encoding: isText ? 'utf-8' : 'base64',
      mimeType: meta.mimeType,
      size: meta.size,
      version: meta.version,
      etag: meta.etag,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    }
  }

  async readFileBytes(path: string): Promise<{ metadata: FileMetadata; data: Uint8Array; text: () => string }> {
    const normPath = normalizePath(path)
    const meta = await this.recordStore.getFileMetadata(this.chatId, normPath)
    if (!meta) {
      throw new NotFoundError(`File '${normPath}' not found in chat '${this.chatId}'`)
    }

    const data = await this.fileStore.readBytes(this.chatId, normPath)
    if (!data) {
      throw new NotFoundError(`File bytes for '${normPath}' not found in chat '${this.chatId}'`)
    }

    return {
      metadata: meta,
      data,
      text: () => new TextDecoder().decode(data),
    }
  }

  async readBounded(path: string, options: ReadBoundedOptions = {}): Promise<BoundedReadResult> {
    const normPath = normalizePath(path)
    const meta = await this.recordStore.getFileMetadata(this.chatId, normPath)
    if (!meta) {
      throw new NotFoundError(`File '${normPath}' not found in chat '${this.chatId}'`)
    }

    const start = options.start ?? 0
    const maxBytes = options.maxBytes ?? 64 * 1024
    let length = maxBytes
    if (options.end !== undefined && options.end > start) {
      length = Math.min(options.end - start, maxBytes)
    }

    const result = await this.fileStore.readBoundedBytes(this.chatId, normPath, start, length)
    if (!result) {
      throw new NotFoundError(`File bytes for '${normPath}' not found in chat '${this.chatId}'`)
    }

    return {
      metadata: meta,
      data: result.data,
      isTruncated: result.isTruncated,
      text: () => new TextDecoder().decode(result.data),
    }
  }

  async editFile(path: string, options: EditFileOptions): Promise<FileMetadata> {
    const normPath = normalizePath(path)

    return await this.lockManager.withChatLock(this.chatId, async () => {
      const fileInfo = await this.readFileBytes(normPath)
      const currentText = fileInfo.text()

      if (!currentText.includes(options.target)) {
        throw new WorkspaceError(`Target string '${options.target}' not found in file '${normPath}'`)
      }

      let newText: string
      if (options.replaceAll) {
        newText = currentText.replaceAll(options.target, options.replacement)
      } else {
        newText = currentText.replace(options.target, options.replacement)
      }

      return await this._writeFile(normPath, newText, {
        expectedVersion: options.expectedVersion ?? fileInfo.metadata.version,
        mimeType: fileInfo.metadata.mimeType,
      })
    })
  }

  async deleteFile(path: string, options: { expectedVersion?: number } = {}): Promise<boolean> {
    return await this.lockManager.withChatLock(this.chatId, async () => {
      return await this._deleteFile(path, options)
    })
  }

  private async _deleteFile(path: string, options: { expectedVersion?: number } = {}): Promise<boolean> {
    const normPath = normalizePath(path)

    const meta = await this.recordStore.getFileMetadata(this.chatId, normPath)
    if (!meta) return false

    if (options.expectedVersion !== undefined && meta.version !== options.expectedVersion) {
      throw new StaleRevisionError(
        `File '${normPath}' version mismatch on delete: expected ${options.expectedVersion}, got ${meta.version}`,
        options.expectedVersion,
        meta.version,
      )
    }

    await this.fileStore.deleteBytes(this.chatId, normPath)
    await this.recordStore.deleteFileMetadata(this.chatId, normPath)
    return true
  }

  async listFiles(prefix?: string): Promise<WorkspaceFile[]> {
    const metas = await this.recordStore.listFileMetadata(this.chatId)
    const normPrefix = prefix ? normalizePath(prefix) : undefined

    const filtered = normPrefix
      ? metas.filter(m => m.path === normPrefix || m.path.startsWith(`${normPrefix}/`))
      : metas

    const results: WorkspaceFile[] = []
    for (const meta of filtered) {
      const f = await this.readFile(meta.path)
      if (f) results.push(f)
    }
    return results
  }

  async listMetadata(prefix?: string): Promise<FileMetadata[]> {
    const metas = await this.recordStore.listFileMetadata(this.chatId)
    if (!prefix) return metas
    const normPrefix = normalizePath(prefix)
    return metas.filter(m => m.path === normPrefix || m.path.startsWith(`${normPrefix}/`))
  }

  async statFile(path: string): Promise<FileMetadata | null> {
    const normPath = normalizePath(path)
    return await this.recordStore.getFileMetadata(this.chatId, normPath)
  }

  async exportFile(path: string): Promise<{ filename: string; mimeType: string; data: Uint8Array }> {
    const fileInfo = await this.readFileBytes(path)
    const segments = fileInfo.metadata.path.split('/')
    const filename = segments[segments.length - 1]
    return {
      filename,
      mimeType: fileInfo.metadata.mimeType,
      data: fileInfo.data,
    }
  }

  async exportAllFiles(): Promise<Array<{ path: string; mimeType: string; data: Uint8Array }>> {
    const metas = await this.recordStore.listFileMetadata(this.chatId)
    const outputs: Array<{ path: string; mimeType: string; data: Uint8Array }> = []

    for (const meta of metas) {
      const bytes = await this.fileStore.readBytes(this.chatId, meta.path)
      if (bytes) {
        outputs.push({
          path: meta.path,
          mimeType: meta.mimeType,
          data: bytes,
        })
      }
    }

    return outputs
  }

  async clear(): Promise<void> {
    await this.lockManager.withChatLock(this.chatId, async () => {
      await this.fileStore.deleteChatFiles(this.chatId)
      await this.recordStore.deleteChatFileMetadata(this.chatId)
    })
  }

  async getUsage(): Promise<StorageUsage> {
    const metas = await this.recordStore.listFileMetadata(this.chatId)
    const totalBytes = metas.reduce((acc, m) => acc + m.size, 0)
    return {
      fileCount: metas.length,
      totalBytes,
      maxWorkspaceBytes: this.limits.maxWorkspaceBytes,
      maxFileBytes: this.limits.maxFileBytes,
      isDurable: this.fileStore.isDurable() && this.recordStore.isDurable(),
      backend: this.fileStore.getBackendType(),
    }
  }

  // --- Python Staging & Snapshot Protocol ---

  async createExecutionSnapshot(): Promise<ExecutionSnapshot> {
    const metas = await this.recordStore.listFileMetadata(this.chatId)
    const baseRevisions: Record<string, number> = {}

    for (const meta of metas) {
      baseRevisions[meta.path] = meta.version
    }

    return {
      snapshotId: `snap_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      chatId: this.chatId,
      createdAt: new Date().toISOString(),
      baseRevisions,
      files: metas.map(m => ({ ...m })),
    }
  }

  stageChanges(snapshot: ExecutionSnapshot, changes: StagedFileChange[] = []): StagingSession {
    if (snapshot.chatId !== this.chatId) {
      throw new WorkspaceError(`Snapshot chatId '${snapshot.chatId}' does not match workspace '${this.chatId}'`)
    }
    return this.stagingManager.createSession(snapshot, changes)
  }

  async commitStagedChanges(session: StagingSession): Promise<CommitResult> {
    return await this.lockManager.withChatLock(this.chatId, async () => {
      const target: WorkspaceStorageTarget = {
        chatId: this.chatId,
        getFileMetadata: path => this.recordStore.getFileMetadata(this.chatId, path),
        writeFileBytes: (path, data, options) =>
          this._writeFile(path, data, {
            expectedVersion: options?.expectedVersion,
            mimeType: options?.mimeType,
          }),
        deleteFile: (path, options) => this._deleteFile(path, options),
        readFileBytes: async path => {
          const res = await this.readFileBytes(path).catch(() => null)
          return res ? res.data : null
        },
      }

      return await this.stagingManager.commit(target, session)
    })
  }

  discardStagedChanges(session: StagingSession): void {
    this.stagingManager.discard(session)
  }
}

export interface WorkspaceManagerOptions {
  fileStore?: FileStore
  recordStore?: RecordStore
  lockManager?: TabLockManager
  stagingManager?: StagingManager
  limits?: StorageLimits
}

export class WorkspaceManager {
  readonly fileStore: FileStore
  readonly recordStore: RecordStore
  readonly lockManager: TabLockManager
  readonly stagingManager: StagingManager
  readonly limits: StorageLimits

  constructor(options: WorkspaceManagerOptions = {}) {
    this.fileStore = options.fileStore ?? (isOPFSAvailable() ? new OPFSFileStore() : new MemoryFileStore())
    this.recordStore = options.recordStore ?? (isIndexedDBAvailable() ? new IndexedDbRecordStore() : new MemoryRecordStore())
    this.lockManager = options.lockManager ?? new TabLockManager()
    this.stagingManager = options.stagingManager ?? new StagingManager()
    this.limits = options.limits ?? DEFAULT_STORAGE_LIMITS
  }

  getWorkspace(chatId: string): ChatWorkspace {
    return new ChatWorkspace(
      chatId,
      this.fileStore,
      this.recordStore,
      this.lockManager,
      this.stagingManager,
      this.limits,
    )
  }

  getStorageStatus(): StorageStatus {
    const isDurable = this.fileStore.isDurable() && this.recordStore.isDurable()
    const backend = this.fileStore.getBackendType()
    let warning: string | null = null

    if (!isDurable) {
      warning = 'Durable browser storage (OPFS/IndexedDB) is unavailable; workspaces will not persist across browser reload'
    }

    return {
      isDurable,
      backend,
      warning,
    }
  }

  // --- Chat Lifecycle ---

  async createChat(title: string, metadata?: Record<string, unknown>): Promise<ChatSession> {
    const now = new Date().toISOString()
    const chat: ChatSession = {
      id: `chat_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      title: title.trim() || 'Untitled Chat',
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      metadata,
    }
    return await this.recordStore.createChat(chat)
  }

  async getChat(chatId: string): Promise<ChatSession | null> {
    return await this.recordStore.getChat(chatId)
  }

  async listChats(): Promise<ChatSession[]> {
    return await this.recordStore.listChats()
  }

  async updateChat(chatId: string, updates: Partial<ChatSession>): Promise<ChatSession> {
    return await this.recordStore.updateChat(chatId, updates)
  }

  async deleteChat(chatId: string): Promise<boolean> {
    const ws = this.getWorkspace(chatId)
    await ws.clear()
    return await this.recordStore.deleteChat(chatId)
  }

  // --- Export Chat ---

  async exportChat(chatId: string): Promise<ChatArchive> {
    const chat = await this.recordStore.getChat(chatId)
    if (!chat) {
      throw new NotFoundError(`Chat '${chatId}' not found`)
    }

    const messages = await this.recordStore.getMessages(chatId)
    const plan = await this.recordStore.getPlan(chatId)
    const runs = await this.recordStore.listRuns(chatId)
    const toolCalls = await this.recordStore.listToolCallsForChat(chatId)
    const ws = this.getWorkspace(chatId)
    const files = await ws.listFiles()

    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      chat,
      messages,
      plan,
      runs,
      toolCalls,
      files: files.map(f => ({
        path: f.path,
        mimeType: f.mimeType,
        size: f.size,
        version: f.version || 1,
        encoding: f.encoding,
        content: f.content,
      })),
    }
  }

  // --- Startup Reconciliation ---

  async reconcileStartup(): Promise<ReconciliationResult> {
    return await this.recordStore.reconcileStartup()
  }

  // --- Record Pass-Throughs ---

  async addMessage(msg: ChatMessageRecord): Promise<void> {
    await this.recordStore.addMessage(msg)
  }

  async getMessages(chatId: string): Promise<ChatMessageRecord[]> {
    return await this.recordStore.getMessages(chatId)
  }

  async setPlan(chatId: string, items: PlanItemRecord[]): Promise<void> {
    await this.recordStore.setPlan(chatId, items)
  }

  async getPlan(chatId: string): Promise<PlanItemRecord[]> {
    return await this.recordStore.getPlan(chatId)
  }

  async updatePlanItem(chatId: string, itemId: string, status: PlanItemRecord['status']): Promise<void> {
    await this.recordStore.updatePlanItem(chatId, itemId, status)
  }

  async createRun(run: RunRecord): Promise<RunRecord> {
    return await this.recordStore.createRun(run)
  }

  async updateRun(id: string, updates: Partial<RunRecord>): Promise<RunRecord> {
    return await this.recordStore.updateRun(id, updates)
  }

  async getRun(id: string): Promise<RunRecord | null> {
    return await this.recordStore.getRun(id)
  }

  async listRuns(chatId: string): Promise<RunRecord[]> {
    return await this.recordStore.listRuns(chatId)
  }

  async createToolCall(tc: ToolCallRecord): Promise<ToolCallRecord> {
    return await this.recordStore.createToolCall(tc)
  }

  async updateToolCall(id: string, updates: Partial<ToolCallRecord>): Promise<ToolCallRecord> {
    return await this.recordStore.updateToolCall(id, updates)
  }

  async listToolCalls(runId: string): Promise<ToolCallRecord[]> {
    return await this.recordStore.listToolCalls(runId)
  }
}
