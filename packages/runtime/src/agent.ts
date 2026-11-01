import browserProcess from 'process/browser.js'
import { Buffer } from 'buffer'
import type {
  AnyBackendProtocol,
  BackendRuntime,
} from 'deepagents/browser'

// Ensure Node-utility shims are attached when running in an orchestration worker or environment
if (typeof globalThis.process === 'undefined') {
  ;(globalThis as unknown as { process: typeof browserProcess }).process = browserProcess
  browserProcess.env = {}
}
if (typeof globalThis.Buffer === 'undefined') {
  ;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
}

const { createDeepAgent, StateBackend } = await import('deepagents/browser')
const { createMiddleware, todoListMiddleware } = await import('langchain')

const FORBIDDEN_TOOLS = new Set([
  'task',
  'execute',
  'start_async_task',
  'check_async_task',
  'update_async_task',
  'cancel_async_task',
])

export interface StateBackendOptions {
  fileFormat?: 'v1' | 'v2'
}

function explicitBackend(
  backend: unknown,
  runtime: BackendRuntime<unknown>,
): AnyBackendProtocol {
  if (backend == null) {
    return new StateBackend(runtime) as unknown as AnyBackendProtocol
  }
  if (backend instanceof StateBackend) {
    const legacyBackend = backend as unknown as {
      isLegacy?: boolean
      runtime?: BackendRuntime<unknown>
      fileFormat?: 'v1' | 'v2'
    }
    if (legacyBackend.isLegacy) {
      if (legacyBackend.runtime !== runtime) {
        throw new Error('A runtime-bound StateBackend must be constructed for the current tool call.')
      }
      return backend as unknown as AnyBackendProtocol
    }
    if (backend.constructor !== StateBackend) {
      throw new Error('StateBackend subclasses must receive an explicit runtime.')
    }
    // Prevent mutating a shared backend object across runs or tool calls
    return new StateBackend(runtime, {
      fileFormat: legacyBackend.fileFormat,
    }) as unknown as AnyBackendProtocol
  }
  return backend as AnyBackendProtocol
}

export interface CreateBrowserDeepAgentOptions {
  model: unknown
  backend?: unknown | ((runtime: BackendRuntime<unknown>) => Promise<unknown> | unknown)
  systemPrompt?: string
  subagents?: unknown[]
  middleware?: Array<{ name?: string; [key: string]: unknown }>
  [key: string]: unknown
}

export function createBrowserDeepAgent(
  options: CreateBrowserDeepAgentOptions,
): ReturnType<typeof createDeepAgent> {
  if (!options?.model || typeof options.model === 'string') {
    throw new Error('Provide an explicit browser model adapter; provider setup belongs to the relay.')
  }
  if (options.subagents && options.subagents.length > 0) {
    throw new Error('Subagents are deferred in this browser runtime.')
  }

  const backend = options.backend

  const boundary = createMiddleware({
    name: 'BrowserToolBoundary',
    wrapModelCall: (request, handler) => {
      const filtered = request.tools?.filter(tool => {
        const name = 'name' in tool ? (tool.name as string) : undefined
        return !name || !FORBIDDEN_TOOLS.has(name)
      })
      return handler({ ...request, tools: filtered })
    },
    wrapToolCall: (request, handler) => {
      if (FORBIDDEN_TOOLS.has(request.toolCall.name)) {
        throw new Error(`Tool disabled in browser runtime: ${request.toolCall.name}`)
      }
      return handler(request)
    },
  })

  const incomingMiddleware = options.middleware ?? []

  const params = {
    ...options,
    subagents: [],
    backend: async (runtime: BackendRuntime<unknown>) =>
      explicitBackend(
        typeof backend === 'function' ? await backend(runtime) : backend,
        runtime,
      ),
    middleware: [
      ...incomingMiddleware.filter(
        m => m.name !== 'todoListMiddleware' && m.name !== 'BrowserToolBoundary',
      ),
      todoListMiddleware(),
      boundary,
    ],
  }

  return createDeepAgent(params as never)
}

export { StateBackend }
