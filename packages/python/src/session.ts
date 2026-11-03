import { normalizePath, type ChatWorkspace, type StagedFileChange } from '@browser-agents/workspace'
import { AssetLoader } from './assets.js'
import {
  PythonCancelledError,
  PythonError,
  PythonInitializationError,
  PythonSecurityError,
  PythonStorageError,
  PythonTimeoutError,
} from './errors.js'
import {
  DEFAULT_EXECUTION_LIMITS,
  isValidExecutionPath,
  validateOutputFiles,
} from './security.js'
import type {
  EnvironmentDiagnostics,
  PythonArtifact,
  PythonExecutionOptions,
  PythonExecutionResult,
  PythonSession,
  PythonSessionOptions,
  RuntimeAssets,
  WorkerInitResponse,
  WorkerRunResponse,
} from './types.js'
import { ISOLATED_WORKER_SCRIPT } from './worker-code.js'

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'svg':
      return 'image/svg+xml'
    case 'csv':
      return 'text/csv'
    case 'json':
      return 'application/json'
    case 'txt':
      return 'text/plain'
    case 'html':
      return 'text/html'
    default:
      return 'application/octet-stream'
  }
}

function areByteArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  timer?: ReturnType<typeof setTimeout>
}

export class PythonSessionImpl implements PythonSession {
  readonly chatId: string
  private workspace: ChatWorkspace | null
  private readonly assetLoader: AssetLoader
  private explicitAssets?: RuntimeAssets
  private readonly defaultTimeoutMs: number

  private frame: HTMLIFrameElement | null = null
  private channel: string | null = null
  private listener: ((event: MessageEvent) => void) | null = null
  private pending = new Map<string, PendingRequest>()

  private _isReady = false
  private _isTerminated = false
  private _diagnostics: EnvironmentDiagnostics | null = null

  constructor(chatId: string, options: PythonSessionOptions = {}) {
    this.chatId = chatId
    this.workspace = options.workspace ?? null
    this.assetLoader = new AssetLoader(options.assetBaseUrl ?? '/runtime')
    this.explicitAssets = options.assets
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000
  }

  get isReady(): boolean {
    return this._isReady
  }

  get isTerminated(): boolean {
    return this._isTerminated
  }

  get diagnostics(): EnvironmentDiagnostics | null {
    return this._diagnostics
  }

  setWorkspace(workspace: ChatWorkspace | null): void {
    this.workspace = workspace
  }

  async initialize(): Promise<void> {
    if (this._isReady && !this._isTerminated && this.frame) {
      return
    }

    if (typeof document === 'undefined') {
      throw new PythonInitializationError(
        'PythonSession requires a browser DOM environment with iframe support',
      )
    }

    this._isTerminated = false
    this._isReady = false

    // Load and verify pinned assets
    const assets = this.explicitAssets ?? (await this.assetLoader.load())

    const frame = document.createElement('iframe')
    frame.sandbox.add('allow-scripts')
    frame.hidden = true
    const channel = crypto.randomUUID()
    this.channel = channel

    const bootstrap = `
      const channel = ${JSON.stringify(channel)};
      const source = ${JSON.stringify(ISOLATED_WORKER_SCRIPT)};
      const worker = new Worker(URL.createObjectURL(new Blob([source], {type:'text/javascript'})), {});
      worker.onmessage = event => parent.postMessage({channel, result:event.data}, '*');
      worker.onerror = event => parent.postMessage({channel, failure:event.message || 'Worker failed before startup'}, '*');
      addEventListener('message', event => {
        if (event.source !== parent || event.data?.channel !== channel) return;
        if (event.data.cancel) {
          worker.terminate();
          parent.postMessage({channel, cancelled:true}, '*');
        } else {
          worker.postMessage(event.data.request);
        }
      });
      parent.postMessage({channel, booted:true}, '*');
    `

    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src blob: data:; form-action 'none'; base-uri 'none'"><script>${bootstrap.replaceAll('</script', '<\\/script')}<\/script>`

    let resolveBoot: (() => void) | undefined
    let resolveCancelled: (() => void) | undefined
    const bootPromise = new Promise<void>(resolve => {
      resolveBoot = resolve
    })

    const listener = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.channel !== channel) {
        return
      }

      if (event.data.booted) {
        resolveBoot?.()
        return
      }

      if (event.data.cancelled) {
        resolveCancelled?.()
        return
      }

      if (event.data.failure) {
        const err = new PythonInitializationError(event.data.failure)
        for (const p of this.pending.values()) {
          if (p.timer) clearTimeout(p.timer)
          p.reject(err)
        }
        this.pending.clear()
        return
      }

      const result = event.data.result
      if (!result) return
      if (result.progress) return

      if (result.type !== 'result' || typeof result.ok !== 'boolean') return
      const p = this.pending.get(result.id)
      if (!p) return

      this.pending.delete(result.id)
      if (p.timer) clearTimeout(p.timer)
      p.resolve(result)
    }

    this.listener = listener
    window.addEventListener('message', listener)
    this.frame = frame
    document.body.append(frame)

    try {
      await Promise.race([
        bootPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new PythonInitializationError('Frame bootstrap timeout')), 10_000),
        ),
      ])

      const initResponse = (await this.sendRequest('init', { assets }, 60_000)) as WorkerInitResponse
      if (!initResponse.ok) {
        throw new PythonInitializationError(initResponse.error ?? 'Pyodide initialization failed')
      }

      if (initResponse.versions && initResponse.before && initResponse.after) {
        this._diagnostics = {
          python: initResponse.versions.python,
          numpy: initResponse.versions.numpy,
          pandas: initResponse.versions.pandas,
          matplotlib: initResponse.versions.matplotlib,
          readyMs: initResponse.readyMs ?? 0,
          wasmBytes: initResponse.wasmBytes ?? 0,
          beforeProbe: initResponse.before,
          afterProbe: initResponse.after,
        }
      }

      this._isReady = true
    } catch (err) {
      await this.terminate()
      throw err
    }
  }

  private sendRequest(type: 'init' | 'run', payload: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<any> {
    if (this._isTerminated || !this.frame?.contentWindow || !this.channel) {
      return Promise.reject(new PythonError('Session is not active'))
    }

    const id = crypto.randomUUID()
    const channel = this.channel
    const frame = this.frame

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.terminate().finally(() => {
          reject(new PythonTimeoutError(timeoutMs))
        })
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      frame.contentWindow?.postMessage({ channel, request: { ...payload, id, type } }, '*')
    })
  }

  async run(code: string, options: PythonExecutionOptions = {}): Promise<PythonExecutionResult> {
    if (!this._isReady || this._isTerminated || !this.frame) {
      await this.initialize()
    }

    const timeout = options.timeoutMs ?? this.defaultTimeoutMs
    const maxChars = options.maxOutputChars ?? 64_000
    const limits = {
      maxFileCount: options.maxFileCount ?? DEFAULT_EXECUTION_LIMITS.maxFileCount,
      maxFileSizeBytes: options.maxFileSizeBytes ?? DEFAULT_EXECUTION_LIMITS.maxFileSizeBytes,
      maxTotalFilesBytes: options.maxTotalFilesBytes ?? DEFAULT_EXECUTION_LIMITS.maxTotalFilesBytes,
    }

    // 1. Snapshot and sync workspace files into Python
    let snapshot = null
    const inputFiles: Record<string, Uint8Array> = {}

    if (options.inputFiles) {
      for (const [p, data] of Object.entries(options.inputFiles)) {
        const pyPath = p.startsWith('/') ? p : '/' + p
        inputFiles[pyPath] = data
      }
    }

    if (this.workspace) {
      try {
        snapshot = await this.workspace.createExecutionSnapshot()
        for (const meta of snapshot.files) {
          const file = await this.workspace.readFileBytes(meta.path)
          if (file) {
            const pyPath = meta.path.startsWith('/') ? meta.path : '/' + meta.path
            inputFiles[pyPath] = file.data
          }
        }
      } catch (err) {
        throw new PythonStorageError(
          `Failed to create workspace snapshot: ${err instanceof Error ? err.message : String(err)}`,
          err,
        )
      }
    }

    // 2. Abort signal handling
    let abortListener: (() => void) | undefined
    if (options.signal) {
      if (options.signal.aborted) {
        throw new PythonCancelledError()
      }
      abortListener = () => {
        this.terminate()
      }
      options.signal.addEventListener('abort', abortListener)
    }

    const startedAt = performance.now()

    try {
      const response = (await this.sendRequest(
        'run',
        {
          code,
          files: inputFiles,
          maxOutputChars: maxChars,
        },
        timeout,
      )) as WorkerRunResponse

      const durationMs = Math.round(performance.now() - startedAt)

      if (!response.ok) {
        return {
          ok: false,
          exitCode: 1,
          stdout: response.stdout ?? '',
          stderr: response.stderr ?? '',
          files: {},
          artifacts: [],
          durationMs,
          wasmBytes: response.wasmBytes,
          error: response.error,
        }
      }

      // 3. Validate untrusted output files
      const validatedFiles = validateOutputFiles(response.files ?? {}, limits)

      // 4. Staging and committing to workspace
      let stagedChanges: StagedFileChange[] | undefined
      let commitResult = undefined

      if (this.workspace && snapshot) {
        stagedChanges = []
        const validatedByNormPath = new Map<string, Uint8Array>()

        // Staging writes for new or modified files
        for (const [outPath, outBytes] of Object.entries(validatedFiles)) {
          const normOutPath = normalizePath(outPath)
          validatedByNormPath.set(normOutPath, outBytes)

          const originalBytes = inputFiles['/' + normOutPath]
          if (!originalBytes || !areByteArraysEqual(originalBytes, outBytes)) {
            const previousMeta = snapshot.files.find(file => file.path === normOutPath)
            stagedChanges.push({
              type: 'write',
              path: normOutPath,
              content: outBytes,
              encoding: 'binary',
              mimeType: getMimeType(normOutPath),
              source: previousMeta ? previousMeta.source : 'model',
            })
          }
        }

        // Staging deletes for missing files
        for (const snapPath of Object.keys(snapshot.baseRevisions)) {
          const normSnapPath = normalizePath(snapPath)
          if (!validatedByNormPath.has(normSnapPath)) {
            stagedChanges.push({
              type: 'delete',
              path: normSnapPath,
            })
          }
        }

        if (stagedChanges.length > 0) {
          try {
            const stagingSession = this.workspace.stageChanges(snapshot, stagedChanges)
            commitResult = await this.workspace.commitStagedChanges(stagingSession)
          } catch (err) {
            throw new PythonStorageError(
              `Failed to commit staged changes: ${err instanceof Error ? err.message : String(err)}`,
              err,
            )
          }
        }
      }

      // 5. Build artifacts
      const artifacts: PythonArtifact[] = Object.entries(validatedFiles).map(([path, bytes]) => ({
        path,
        mimeType: getMimeType(path),
        size: bytes.byteLength,
        dataBase64: uint8ArrayToBase64(bytes),
        bytes,
      }))

      return {
        ok: true,
        exitCode: 0,
        stdout: response.stdout ?? '',
        stderr: response.stderr ?? '',
        files: validatedFiles,
        stagedChanges,
        commitResult,
        artifacts,
        durationMs,
        wasmBytes: response.wasmBytes,
      }
    } finally {
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener)
      }
    }
  }

  async reset(): Promise<void> {
    await this.terminate()
    this._isReady = false
    this._isTerminated = false
  }

  async terminate(): Promise<void> {
    if (this._isTerminated) return
    this._isTerminated = true
    this._isReady = false

    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new PythonCancelledError())
    }
    this.pending.clear()

    if (this.frame && this.channel) {
      try {
        this.frame.contentWindow?.postMessage({ channel: this.channel, cancel: true }, '*')
      } catch {}
    }

    if (this.listener) {
      window.removeEventListener('message', this.listener)
      this.listener = null
    }

    if (this.frame) {
      try {
        this.frame.remove()
      } catch {}
      this.frame = null
    }

    this.channel = null
  }
}
