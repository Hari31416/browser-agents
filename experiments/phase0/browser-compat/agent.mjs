import browserProcess from 'process/browser';
import {Buffer} from 'buffer';

// Only the trusted orchestration worker gets browser Node-utility shims.
// Provider keys never belong in this environment or in the Python worker.
if (typeof WorkerGlobalScope === 'undefined' || !(self instanceof WorkerGlobalScope)) {
  throw new Error('Create the browser agent inside a dedicated worker.');
}
globalThis.process = browserProcess;
globalThis.Buffer = Buffer;
browserProcess.env = {};

// The patches defer Node-only tracing setup. No async-hooks alias is installed.
const { createDeepAgent, StateBackend } = await import('deepagents/browser');
const { createMiddleware, todoListMiddleware } = await import('langchain');
const forbidden = new Set(['task', 'execute', 'start_async_task', 'check_async_task', 'update_async_task', 'cancel_async_task']);

function explicitBackend(backend, runtime) {
  if (backend == null) return new StateBackend(runtime);
  if (backend instanceof StateBackend) {
    if (backend.isLegacy) {
      if (backend.runtime !== runtime) throw new Error('A runtime-bound StateBackend must be constructed for the current tool call.');
      return backend;
    }
    if (backend.constructor !== StateBackend) {
      throw new Error('StateBackend subclasses must receive an explicit runtime.');
    }
    // Do not mutate a shared backend with a current chat/run's state.
    return new StateBackend(runtime, { fileFormat: backend.fileFormat });
  }
  return backend;
}

export function createBrowserDeepAgent(options) {
  if (!options?.model || typeof options.model === 'string') {
    throw new Error('Provide an explicit browser model adapter; provider setup belongs to the relay.');
  }
  if (options.subagents?.length) throw new Error('Subagents are deferred in this browser runtime.');
  const backend = options.backend;
  const boundary = createMiddleware({
    name: 'BrowserToolBoundary',
    wrapModelCall: (request, handler) => handler({ ...request,
      tools: request.tools?.filter(tool => !forbidden.has(tool.name)),
    }),
    wrapToolCall: (request, handler) => {
      if (forbidden.has(request.toolCall.name)) throw new Error('Tool disabled in browser runtime: ' + request.toolCall.name);
      return handler(request);
    },
  });
  const middleware = options.middleware ?? [];
  return createDeepAgent({
    ...options, subagents: [],
    backend: async runtime => explicitBackend(typeof backend === 'function' ? await backend(runtime) : backend, runtime),
    middleware: [
      ...middleware.filter(m => m.name !== 'todoListMiddleware' && m.name !== 'BrowserToolBoundary'),
      todoListMiddleware(), boundary,
    ],
  });
}
export { StateBackend };
