import type { PythonSession } from '@browser-agents/python'
import type {
  PythonExecuteOptions,
  PythonExecutionOutput,
  PythonExecutor,
} from './types.js'

export class SessionPythonExecutor implements PythonExecutor {
  constructor(private readonly session: PythonSession) {}

  async execute(
    code: string,
    options: PythonExecuteOptions = {},
  ): Promise<PythonExecutionOutput> {
    const startedAt = Date.now()
    try {
      const result = await this.session.run(code, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxOutputChars: options.maxOutputChars,
      })

      return {
        ok: result.ok,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        files: result.files,
        artifacts: result.artifacts,
        durationMs: result.durationMs ?? Date.now() - startedAt,
        error: result.error,
      }
    } catch (err) {
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async cancel(): Promise<void> {
    await this.session.terminate()
  }
}

export type MockExecutionHandler = (
  code: string,
  options?: PythonExecuteOptions,
) => Promise<PythonExecutionOutput> | PythonExecutionOutput

export class MockPythonExecutor implements PythonExecutor {
  private handler?: MockExecutionHandler
  private defaultDelay = 0
  private lastExecutedCode?: string

  constructor(handler?: MockExecutionHandler) {
    this.handler = handler
  }

  setHandler(handler: MockExecutionHandler): void {
    this.handler = handler
  }

  setDelay(ms: number): void {
    this.defaultDelay = ms
  }

  getLastExecutedCode(): string | undefined {
    return this.lastExecutedCode
  }

  async execute(
    code: string,
    options: PythonExecuteOptions = {},
  ): Promise<PythonExecutionOutput> {
    this.lastExecutedCode = code
    const startedAt = Date.now()

    if (this.defaultDelay > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          options.signal?.removeEventListener('abort', onAbort)
          resolve()
        }, this.defaultDelay)

        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException('Python execution aborted', 'AbortError'))
        }

        if (options.signal?.aborted) {
          onAbort()
        } else {
          options.signal?.addEventListener('abort', onAbort, { once: true })
        }
      })
    }

    if (options.signal?.aborted) {
      throw new DOMException('Python execution aborted', 'AbortError')
    }

    if (this.handler) {
      return await this.handler(code, options)
    }

    // Default mock response
    return {
      ok: true,
      exitCode: 0,
      stdout: `Mock Python execution completed for code: ${code.slice(0, 50)}...`,
      stderr: '',
      durationMs: Date.now() - startedAt,
    }
  }

  async cancel(): Promise<void> {
    // No-op for mock
  }
}
