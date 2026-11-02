import { HardDrive, Network, Shield, Terminal, X } from 'lucide-react'

interface DataFlowModalProps {
  isOpen: boolean
  onClose: () => void
}

export function DataFlowModal({ isOpen, onClose }: DataFlowModalProps) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dataflow-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-2xl rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl p-6 text-zinc-100 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h2 id="dataflow-modal-title" className="text-base font-semibold tracking-tight">
              Data Flow & Isolation Architecture
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              How your files, code, and upstream requests are isolated and routed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close data flow modal"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs leading-relaxed text-zinc-300">
          {/* Card 1: Local Storage */}
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-zinc-100">
              <HardDrive className="w-4 h-4 text-sky-400" />
              <span>1. Local Browser Storage (OPFS & IndexedDB)</span>
            </div>
            <p className="text-zinc-400 text-[11px]">
              Uploaded files, conversation history, and generated artifacts reside exclusively in your browser&apos;s Origin Private File System (OPFS) and IndexedDB. Raw file contents are never sent to external servers unless specifically included in a tool result.
            </p>
          </div>

          {/* Card 2: Python WebAssembly Isolation */}
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-zinc-100">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>2. Isolated Python Execution Sandbox</span>
            </div>
            <p className="text-zinc-400 text-[11px]">
              Python scripts run inside a WebAssembly environment (Pyodide) hosted in a null-origin sandboxed worker iframe. Network egress (`fetch`, `XMLHttpRequest`, `WebSocket`, sockets) is blocked by a strict Content-Security-Policy. Python code has no access to DOM, cookies, or relay credentials.
            </p>
          </div>

          {/* Card 3: Model Relay */}
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-zinc-100">
              <Network className="w-4 h-4 text-amber-400" />
              <span>3. Upstream Model Relay</span>
            </div>
            <p className="text-zinc-400 text-[11px]">
              The local Python relay acts as a bridge between the browser application and your configured model endpoint (such as local Ollama or OpenAI). It manages authentication headers in memory only and streams tokens back to the browser without executing agent tools or touching file storage.
            </p>
          </div>

          {/* Card 4: Credential Protection */}
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-zinc-100">
              <Shield className="w-4 h-4 text-indigo-400" />
              <span>4. Ephemeral Credentials</span>
            </div>
            <p className="text-zinc-400 text-[11px]">
              API keys are transferred directly to the local relay during registration and purged from the input form. They are never written to `localStorage`, IndexedDB, or exported chat archives.
            </p>
          </div>
        </div>

        <div className="flex justify-end border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
