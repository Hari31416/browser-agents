import type {
  ChatWorkspace,
  CommitResult,
  ExecutionSnapshot,
  StagedFileChange,
} from '@browser-agents/workspace'

export interface AssetManifestEntry {
  file: string
  package?: string
  sha256: string
  bytes: number
}

export interface AssetManifest {
  version: string
  assets: AssetManifestEntry[]
}

export type RuntimeAssets = Record<string, Uint8Array>

export interface SecurityProbeReport {
  relay: string
  loopback: string
  external: string
  indexedDB: string
  caches?: string
  localStorage: string
  parent: string
  webrtc: string
  serviceWorker?: string
  origin: string
}

export interface EnvironmentDiagnostics {
  python: string
  numpy: string
  pandas: string
  matplotlib: string
  readyMs: number
  wasmBytes: number
  beforeProbe: SecurityProbeReport
  afterProbe: SecurityProbeReport
}

export interface PythonExecutionOptions {
  timeoutMs?: number
  maxOutputChars?: number
  maxFileSizeBytes?: number
  maxTotalFilesBytes?: number
  maxFileCount?: number
  signal?: AbortSignal
  inputFiles?: Record<string, Uint8Array>
}

export interface PythonArtifact {
  path: string
  mimeType: string
  size: number
  dataBase64: string
  bytes: Uint8Array
}

export interface PythonExecutionResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  files: Record<string, Uint8Array>
  stagedChanges?: StagedFileChange[]
  commitResult?: CommitResult
  artifacts: PythonArtifact[]
  durationMs: number
  wasmBytes?: number
  error?: string
}

export interface WorkerInitRequest {
  id: string
  type: 'init'
  assets: RuntimeAssets
}

export interface WorkerRunRequest {
  id: string
  type: 'run'
  code: string
  files?: Record<string, Uint8Array>
  /** Replace the worker's entire /workspace with `files` before execution. */
  filesAreSnapshot?: boolean
  maxOutputChars?: number
}

export type WorkerRequest = WorkerInitRequest | WorkerRunRequest

export interface WorkerInitResponse {
  id: string
  type: 'result'
  ok: boolean
  before?: SecurityProbeReport
  after?: SecurityProbeReport
  versions?: {
    python: string
    numpy: string
    pandas: string
    matplotlib: string
  }
  readyMs?: number
  wasmBytes?: number
  error?: string
}

export interface WorkerRunResponse {
  id: string
  type: 'result'
  ok: boolean
  stdout?: string
  stderr?: string
  files?: Record<string, Uint8Array>
  wasmBytes?: number
  error?: string
}

export interface WorkerProgressResponse {
  progress: string
}

export type WorkerResponse = WorkerInitResponse | WorkerRunResponse | WorkerProgressResponse

export interface PythonSessionOptions {
  assetBaseUrl?: string
  assets?: RuntimeAssets
  workspace?: ChatWorkspace | null
  defaultTimeoutMs?: number
}

export interface PythonSession {
  readonly chatId: string
  readonly isReady: boolean
  readonly isTerminated: boolean
  readonly diagnostics?: EnvironmentDiagnostics | null
  initialize(): Promise<void>
  run(code: string, options?: PythonExecutionOptions): Promise<PythonExecutionResult>
  reset(): Promise<void>
  terminate(): Promise<void>
}

export interface PythonSessionManager {
  getSession(chatId: string, options?: PythonSessionOptions): Promise<PythonSession>
  resetSession(chatId: string): Promise<void>
  disposeSession(chatId: string): Promise<void>
  disposeAll(): Promise<void>
}
