import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ArrowUp,
  Eye,
  Info,
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
  onOpenInspector,
  onOpenDataFlow,
}: ComposerProps) {
  const [prompt, setPrompt] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(
        Math.max(textareaRef.current.scrollHeight, 40),
        160,
      )}px`
    }
  }, [prompt])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (prompt.trim() && !isRunning && !disabled) {
          const text = prompt.trim()
          setPrompt('')
          if (textareaRef.current) textareaRef.current.style.height = 'auto'
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
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
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

  const canSubmit = Boolean(prompt.trim()) && !disabled && !isRunning

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 sm:p-4 pt-1 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-transparent shrink-0"
    >
      <div className="max-w-3xl mx-auto rounded-2xl border border-zinc-800 bg-zinc-900/95 shadow-xl backdrop-blur-md focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all p-3 space-y-2">
        <textarea
          ref={textareaRef}
          rows={1}
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
          className="w-full bg-transparent text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden resize-none leading-relaxed p-1 min-h-[38px] max-h-36 overflow-y-auto"
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950/80 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 transition cursor-pointer max-w-[200px] sm:max-w-xs shadow-2xs"
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
              className={`hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[11px] font-mono ${badge.color}`}
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

            {/* Inspect Request button */}
            {onOpenInspector && (
              <button
                type="button"
                onClick={onOpenInspector}
                aria-label="Inspect assembled model request"
                title="Inspect assembled model request"
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Data flow info button */}
            <button
              type="button"
              onClick={onOpenDataFlow}
              aria-label="View data privacy and local storage details"
              title="Data flow and isolation boundary information"
              className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right: Modern Send / Stop Button */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isRunning ? (
              <button
                type="button"
                onClick={onCancelRun}
                aria-label="Cancel active agent execution"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-medium transition shadow-xs cursor-pointer"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                aria-label="Send message to agent"
                className={`flex items-center justify-center w-8 h-8 rounded-xl transition shadow-xs ${
                  canSubmit
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 cursor-pointer shadow-emerald-500/20'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60'
                }`}
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
