export const SCHEMA_VERSION = 1

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type PlanStatus = 'pending' | 'in_progress' | 'completed'
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatSession {
  id: string
  title: string
  schemaVersion: number
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

export interface ChatMessageRecord {
  id: string
  chatId: string
  role: MessageRole
  content?: string | null
  toolCalls?: Array<{
    id: string
    name: string
    args: string
  }>
  toolCallId?: string
  createdAt: string
}

export interface PlanItemRecord {
  id: string
  chatId: string
  index: number
  content: string
  status: PlanStatus
  createdAt: string
  updatedAt: string
}

export interface RunRecord {
  id: string
  chatId: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  model?: string
  error?: {
    message: string
    code?: string
  }
}

export interface ToolCallRecord {
  id: string
  runId: string
  chatId: string
  name: string
  args: string
  result?: unknown
  status: ToolCallStatus
  startedAt: string
  endedAt?: string
  error?: string
}

export interface FileMetadata {
  path: string
  chatId: string
  size: number
  mimeType: string
  version: number
  etag: string
  source?: 'user' | 'model'
  createdAt: string
  updatedAt: string
}

export interface WorkspaceFile {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
  mimeType: string
  size: number
  version?: number
  etag?: string
  source?: 'user' | 'model'
  createdAt: string
  updatedAt: string
}

export interface WriteFileOptions {
  encoding?: 'utf-8' | 'binary'
  overwrite?: boolean
  expectedVersion?: number
  mimeType?: string
  source?: 'user' | 'model'
}

export interface ReadBoundedOptions {
  start?: number
  end?: number
  maxBytes?: number
}

export interface BoundedReadResult {
  metadata: FileMetadata
  data: Uint8Array
  isTruncated: boolean
  text: () => string
}

export interface EditFileOptions {
  target: string
  replacement: string
  replaceAll?: boolean
  expectedVersion?: number
}

export interface StagedFileChange {
  type: 'write' | 'delete'
  path: string
  content?: Uint8Array | string
  encoding?: 'utf-8' | 'binary'
  mimeType?: string
}

export interface ExecutionSnapshot {
  snapshotId: string
  chatId: string
  createdAt: string
  baseRevisions: Record<string, number>
  files: FileMetadata[]
}

export interface CommitResult {
  success: boolean
  committed: string[]
  deleted: string[]
  revisions: Record<string, number>
}

export interface StorageLimits {
  maxFileBytes: number
  maxWorkspaceBytes: number
}

export interface StorageUsage {
  fileCount: number
  totalBytes: number
  maxWorkspaceBytes: number
  maxFileBytes: number
  isDurable: boolean
  backend: 'opfs' | 'memory'
}

export interface StorageStatus {
  isDurable: boolean
  backend: 'opfs' | 'memory'
  warning: string | null
}

export interface ChatArchive {
  schemaVersion: number
  exportedAt: string
  chat: ChatSession
  messages: ChatMessageRecord[]
  plan: PlanItemRecord[]
  runs: RunRecord[]
  toolCalls: ToolCallRecord[]
  files: Array<{
    path: string
    mimeType: string
    size: number
    version: number
    encoding: 'utf-8' | 'base64'
    content: string
  }>
}

export interface WorkspaceStore {
  readFile(path: string): Promise<WorkspaceFile | null>
  writeFile(
    path: string,
    content: Uint8Array | string,
    options?: WriteFileOptions | 'utf-8' | 'base64',
  ): Promise<FileMetadata>
  deleteFile(path: string): Promise<boolean>
  listFiles(prefix?: string): Promise<WorkspaceFile[]>
  clear(): Promise<void>
}
