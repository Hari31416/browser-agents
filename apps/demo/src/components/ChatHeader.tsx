import { useCallback } from 'react'
import {
  Eye,
  Info,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import type { PythonState, ProviderPreferences } from '../types'

interface ChatHeaderProps {
  title: string
  onUpdateTitle: (title: string) => void
  preferences: ProviderPreferences
  pythonState: PythonState
  onResetPython: () => void
  onOpenInspector: () => void
  onOpenDataFlow: () => void
}

export function ChatHeader({
  title,
  onUpdateTitle,
  preferences,
  pythonState,
  onResetPython,
  onOpenInspector,
  onOpenDataFlow,
}: ChatHeaderProps) {
  const handleTitleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const next = e.target.value.trim()
      if (next && next !== title) {
        onUpdateTitle(next)
      }
    },
    [title, onUpdateTitle],
  )

  const getPythonBadge = () => {
    switch (pythonState.status) {
      case 'ready':
        return {
          color: 'bg-emerald-950 text-emerald-400 border-emerald-800',
          text: 'Python Ready (NumPy, pandas, matplotlib)',
        }
      case 'running':
        return {
          color: 'bg-amber-950 text-amber-400 border-amber-800 animate-pulse',
          text: 'Python Running...',
        }
      case 'initializing':
        return {
          color: 'bg-sky-950 text-sky-400 border-sky-800',
          text: 'Loading Pyodide & Packages...',
        }
      case 'terminated':
        return {
          color: 'bg-zinc-800 text-zinc-400 border-zinc-700',
          text: 'Interpreter Terminated (Fresh on next run)',
        }
      case 'error':
        return {
          color: 'bg-red-950 text-red-400 border-red-800',
          text: 'Python Error',
        }
      case 'idle':
      default:
        return {
          color: 'bg-zinc-900 text-zinc-400 border-zinc-800',
          text: 'Python Idle',
        }
    }
  }

  const badge = getPythonBadge()

  return (
    <header className="h-14 border-b border-zinc-800 bg-zinc-900/60 px-4 flex items-center justify-between shrink-0 select-none text-zinc-200">
      <div className="flex items-center gap-3 min-w-0">
        <input
          type="text"
          defaultValue={title}
          key={title}
          onBlur={handleTitleBlur}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Chat title"
          className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-zinc-500 focus:outline-hidden px-1 py-0.5 text-zinc-100 max-w-xs truncate"
        />
        <span className="text-zinc-600">/</span>
        <span className="text-xs font-mono text-zinc-400 truncate max-w-xs">
          {preferences.isFixtureMode
            ? 'Testbed Fixture'
            : preferences.selectedModel || preferences.customModel || 'No Model Configured'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Python status indicator & reset */}
        <div
          title="Python interpreter state. Variables reset between sessions or when restarted. Workspace files persist."
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono ${badge.color}`}
        >
          <Terminal className="w-3.5 h-3.5 shrink-0" />
          <span>{badge.text}</span>
          <button
            type="button"
            onClick={onResetPython}
            aria-label="Reset Python interpreter session"
            title="Reset interpreter session (clears variables; keeps files)"
            className="ml-1 text-zinc-400 hover:text-zinc-200 transition"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {/* Inspect Request button */}
        <button
          type="button"
          onClick={onOpenInspector}
          aria-label="Inspect assembled model request"
          title="Inspect assembled model request (credentials excluded)"
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs transition border border-zinc-700"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Inspect Request</span>
        </button>

        {/* Data flow info button */}
        <button
          type="button"
          onClick={onOpenDataFlow}
          aria-label="View data privacy and local storage details"
          title="Data flow and isolation boundary information"
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
