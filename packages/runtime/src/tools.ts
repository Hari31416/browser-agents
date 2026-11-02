import { normalizePath } from '@browser-agents/workspace'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { ToolExecutionError } from './errors.js'
import type { PythonExecutor, RuntimeLimits } from './types.js'

export class AsyncMutex {
  private locked = false
  private readonly queue: Array<() => void> = []

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    while (this.locked) {
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.locked = true
    try {
      return await fn()
    } finally {
      this.locked = false
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

export interface PythonToolContext {
  executor: PythonExecutor
  mutex: AsyncMutex
  limits?: RuntimeLimits
  signal?: AbortSignal
  onFileGenerated?: (path: string, data: Uint8Array, mimeType: string) => Promise<void> | void
}

export function capOutput(text: string, maxChars = 64_000): string {
  if (text.length <= maxChars) {
    return text
  }
  return text.slice(0, maxChars) + `\n... [Output truncated after ${maxChars} characters]`
}

export function createPythonTool(context: PythonToolContext) {
  const maxOutputChars = context.limits?.maxOutputChars ?? 64_000

  return tool(
    async ({ code }: { code: string }) => {
      return await context.mutex.runExclusive(async () => {
        if (context.signal?.aborted) {
          throw new DOMException('Execution aborted', 'AbortError')
        }

        try {
          const result = await context.executor.execute(code, {
            signal: context.signal,
            timeoutMs: context.limits?.timeoutMs,
            maxOutputChars,
          })

          const cappedStdout = capOutput(result.stdout, maxOutputChars)
          const cappedStderr = capOutput(result.stderr, maxOutputChars)

          // If files were produced by Python, notify callback
          if (result.files && context.onFileGenerated) {
            for (const [filePath, data] of Object.entries(result.files)) {
              const mime = filePath.endsWith('.png')
                ? 'image/png'
                : filePath.endsWith('.csv')
                  ? 'text/csv'
                  : filePath.endsWith('.json')
                    ? 'application/json'
                    : 'text/plain'
              await context.onFileGenerated(filePath, data, mime)
            }
          }

          // Return structured result for model
          return JSON.stringify({
            ok: result.ok,
            exitCode: result.exitCode ?? (result.ok ? 0 : 1),
            stdout: cappedStdout,
            stderr: cappedStderr,
            error: result.error,
            files: Object.keys(result.files ?? {}),
            artifacts: result.artifacts?.map(a => a.path) ?? [],
          })
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err
          }
          return JSON.stringify({
            ok: false,
            exitCode: 1,
            stdout: '',
            stderr: err instanceof Error ? err.message : String(err),
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    },
    {
      name: 'execute_python',
      description:
        'Execute Python code in an isolated browser environment. Python has NumPy, pandas, and matplotlib pre-installed. Workspace files are available in the current working directory. Always use relative file paths (e.g., "plot.png" or "./plot.png") to read and save files; never use absolute paths starting with "/". Returns stdout, stderr, and output file artifacts.',
      schema: z.object({
        code: z.string().describe('The Python code to execute.'),
      }),
    },
  )
}

export interface ValidateToolPathOptions {
  allowRoot?: boolean
}

export function validateToolPath(
  pathInput: unknown,
  options?: ValidateToolPathOptions,
): { valid: boolean; normalized?: string; error?: string } {
  if (typeof pathInput !== 'string') {
    return { valid: false, error: 'File path must be a non-empty string' }
  }

  const trimmed = pathInput.trim()
  if (!trimmed) {
    if (options?.allowRoot) {
      return { valid: true, normalized: '/' }
    }
    return { valid: false, error: 'File path must be a non-empty string' }
  }

  // Reject absolute paths; only directory listing tools with allowRoot may query '/'
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:/.test(trimmed)) {
    if (options?.allowRoot && (trimmed === '/' || trimmed === '///')) {
      return { valid: true, normalized: '/' }
    }
    return {
      valid: false,
      error: `Access denied: absolute paths like '${pathInput}' are not allowed. Please use relative paths (e.g. 'Iris.csv' or './Iris.csv') relative to the workspace root.`,
    }
  }

  try {
    const normalized = normalizePath(pathInput, options)
    return { valid: true, normalized }
  } catch (err) {
    return {
      valid: false,
      error: `Access denied: invalid file path '${pathInput}' (${err instanceof Error ? err.message : String(err)})`,
    }
  }
}
