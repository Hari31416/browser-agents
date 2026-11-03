import { useState, useCallback, useRef } from 'react'
import {
  Info,
  Play,
  RefreshCw,
  Settings,
  Square,
  Terminal,
} from 'lucide-react'
import type { ProviderPreferences, PythonState } from '../types'

interface ComposerProps {
  isRunning: boolean
  onSendMessage: (prompt: string) => Promise<void>
  onCancelRun: () => void
  disabled?: boolean
  disabledPlaceholder?: string
  preferences: ProviderPreferences
  pythonState: PythonState
  onResetPython: () => void
  onOpenSettings: () => void
  onOpenInspector?: () => void
  onOpenDataFlow: () => void
}

export function Composer({
  isRunning,
  onSendMessage,
  onCancelRun,
  disabled = false,
  disabledPlaceholder,
  preferences,
  pythonState,
  onResetPython,
  onOpenSettings,
  onOpenDataFlow,
}: ComposerProps) {
  const [prompt, setPrompt] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (prompt.trim() && !isRunning && !disabled) {
          const text = prompt.trim()
          setPrompt('')
          onSendMessage(text)
        }
      }
    },
    [prompt, isRunning, disabled, onSendMessage],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (isRunning) {
        onCancelRun()
      } else if (prompt.trim() && !disabled) {
        const text = prompt.trim()
        setPrompt('')
        onSendMessage(text)
      }
    },
    [isRunning, onCancelRun, prompt, disabled, onSendMessage],
  )

  const getPythonBadge = () => {
    switch (pythonState.status) {
      case 'ready':
        return {
          color: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
          dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]',
          text: 'Python Ready',
          tooltip: 'Pyodide WebWorker Ready • Packages: NumPy, pandas, matplotlib',
        }
      case 'running':
        return {
          color: 'text-amber-400 bg-amber-950/40 border-amber-800/60 animate-pulse',
          dot: 'bg-amber-400 animate-ping',
          text: 'Python Running...',
          tooltip: 'Executing Python code in worker',
        }
      case 'initializing':
        return {
          color: 'text-sky-400 bg-sky-950/40 border-sky-800/60',
          dot: 'bg-sky-400 animate-pulse',
          text: 'Loading Pyodide...',
          tooltip: 'Loading Pyodide & scientific packages',
        }
      case 'error':
        return {
          color: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
          dot: 'bg-rose-400',
          text: 'Python Error',
          tooltip: 'Python interpreter encountered an error',
        }
      case 'terminated':
        return {
          color: 'text-zinc-400 bg-zinc-900 border-zinc-800',
          dot: 'bg-zinc-500',
          text: 'Interpreter Reset',
          tooltip: 'Interpreter terminated • Fresh on next run',
        }
      case 'idle':
      default:
        return {
          color: 'text-zinc-400 bg-zinc-900/60 border-zinc-800',
          dot: 'bg-zinc-600',
          text: 'Python Idle',
          tooltip: 'Python interpreter idle',
        }
    }
  }

  const badge = getPythonBadge()
  const activeModel = preferences.isFixtureMode
    ? 'Fixture Mode'
    : preferences.selectedModel || preferences.customModel || 'Select Model'

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 border-t border-zinc-800 bg-zinc-950/90 shrink-0"
    >
      <div className="max-w-4xl mx-auto rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 focus-within:border-zinc-700 transition space-y-2">
        <textarea
          ref={textareaRef}
          rows={2}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning || disabled}
          placeholder={
            disabled
              ? disabledPlaceholder || 'Configure a model endpoint to start'
              : 'Ask the agent to analyze files, generate charts, or write Python...'
          }
          aria-label="Agent prompt input"
          className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden resize-none leading-relaxed p-1"
        />

        {/* Composer Bottom Toolbar: Model selector, Python state, Inspect, Run */}
        <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 gap-2">
          {/* Left: Model selector & Auxiliary status pills */}
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {/* Model Selector Button */}
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Select model or configure endpoint"
              title="Click to configure model endpoint and settings"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950/80 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 transition cursor-pointer max-w-[220px] sm:max-w-xs"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  preferences.isFixtureMode
                    ? 'bg-sky-400'
                    : preferences.selectedModel || preferences.customModel
                      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
                      : 'bg-zinc-500'
                }`}
              />
              <span className="font-mono text-[11px] truncate">{activeModel}</span>
              <Settings className="w-3 h-3 text-zinc-500 shrink-0" />
            </button>

            {/* Python Status Pill & Reset */}
            <div
              title={badge.tooltip}
              className={`hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono ${badge.color}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dot}`} />
              <Terminal className="w-3 h-3 shrink-0 opacity-80" />
              <span>{badge.text}</span>
              <button
                type="button"
                onClick={onResetPython}
                aria-label="Reset Python interpreter session"
                title="Reset interpreter session (clears variables; keeps files)"
                className="ml-0.5 text-zinc-400 hover:text-zinc-200 transition"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            </div>

            {/* Data flow info button */}
            <button
              type="button"
              onClick={onOpenDataFlow}
              aria-label="View data privacy and local storage details"
              title="Data flow and isolation boundary information"
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: Run / Stop Button */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isRunning ? (
              <button
                type="button"
                onClick={onCancelRun}
                aria-label="Cancel active agent execution"
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium transition shadow-xs"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim() || disabled}
                aria-label="Send message to agent"
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 text-zinc-900 text-xs font-medium transition shadow-xs"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
