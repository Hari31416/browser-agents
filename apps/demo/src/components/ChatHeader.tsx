import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Eye,
  Info,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  Settings,
  Terminal,
} from 'lucide-react'
import type { PythonState, ProviderPreferences } from '../types'

interface ChatHeaderProps {
  title: string
  onUpdateTitle: (title: string) => void
  preferences: ProviderPreferences
  pythonState: PythonState
  onResetPython: () => void
  onOpenSettings: () => void
  onOpenInspector: () => void
  onOpenDataFlow: () => void
  isSidebarOpen?: boolean
  onToggleSidebar?: () => void
  isFilesOpen?: boolean
  onToggleFiles?: () => void
  filesCount?: number
}

export function ChatHeader({
  title,
  onUpdateTitle,
  preferences,
  pythonState,
  onResetPython,
  onOpenSettings,
  onOpenInspector,
  onOpenDataFlow,
  isSidebarOpen = true,
  onToggleSidebar,
  isFilesOpen = true,
  onToggleFiles,
  filesCount = 0,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [currentTitle, setCurrentTitle] = useState(title)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setCurrentTitle(title)
  }, [title])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const commitTitle = useCallback(() => {
    const trimmed = currentTitle.trim()
    if (trimmed && trimmed !== title) {
      onUpdateTitle(trimmed)
    } else {
      setCurrentTitle(title)
    }
    setIsEditing(false)
  }, [currentTitle, title, onUpdateTitle])

  const getPythonBadge = () => {
    switch (pythonState.status) {
      case 'ready':
        return {
          color: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80',
          dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]',
          text: 'Python Ready',
          tooltip: 'Pyodide WebWorker Ready • NumPy, pandas, matplotlib',
        }
      case 'running':
        return {
          color: 'bg-amber-950/60 text-amber-400 border-amber-800/80 animate-pulse',
          dot: 'bg-amber-400 animate-ping',
          text: 'Python Running...',
          tooltip: 'Executing Python code locally in browser worker',
        }
      case 'initializing':
        return {
          color: 'bg-sky-950/60 text-sky-400 border-sky-800/80',
          dot: 'bg-sky-400 animate-pulse',
          text: 'Loading Pyodide...',
          tooltip: 'Downloading Pyodide and scientific packages into memory',
        }
      case 'terminated':
        return {
          color: 'bg-zinc-900 text-zinc-400 border-zinc-800',
          dot: 'bg-zinc-500',
          text: 'Session Reset',
          tooltip: 'Interpreter terminated • Fresh environment on next execution',
        }
      case 'error':
        return {
          color: 'bg-rose-950/60 text-rose-400 border-rose-800/80',
          dot: 'bg-rose-400',
          text: 'Python Error',
          tooltip: 'Interpreter encountered an error',
        }
      case 'idle':
      default:
        return {
          color: 'bg-zinc-900/80 text-zinc-400 border-zinc-800',
          dot: 'bg-zinc-500',
          text: 'Python Idle',
          tooltip: 'Interpreter idle • Zero memory footprint until run',
        }
    }
  }

  const badge = getPythonBadge()
  const activeModel = preferences.isFixtureMode
    ? 'Fixture Mode'
    : preferences.selectedModel || preferences.customModel || 'No Model Configured'

  return (
    <header className="h-13 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-3.5 flex items-center justify-between shrink-0 select-none text-zinc-200 z-10">
      {/* Left: Sidebar toggle (when collapsed) & Chat title */}
      <div className="flex items-center gap-2.5 min-w-0">
        {!isSidebarOpen && onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Open sidebar"
            title="Open navigation sidebar"
            className="p-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition shadow-xs"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={currentTitle}
            onChange={e => setCurrentTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') {
                setCurrentTitle(title)
                setIsEditing(false)
              }
            }}
            aria-label="Edit chat title"
            className="text-xs sm:text-sm font-semibold bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-zinc-100 focus:outline-hidden focus:border-emerald-500 max-w-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            aria-label="Rename chat"
            title="Click to rename chat"
            className="group flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-200 hover:text-white px-1.5 py-1 rounded-md hover:bg-zinc-900/60 transition truncate max-w-xs text-left"
          >
            <span className="truncate">{title || 'Untitled Chat'}</span>
            <Pencil className="w-3 h-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}

        <span className="text-zinc-700 hidden sm:inline">•</span>

        {/* Clickable Model Badge */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Select model or configure endpoint"
          title="Click to configure model endpoint and settings"
          className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900/80 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-[11px] text-zinc-400 hover:text-zinc-200 font-mono transition max-w-[190px] truncate"
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
          <span className="truncate">{activeModel}</span>
          <Settings className="w-2.5 h-2.5 opacity-60 shrink-0" />
        </button>
      </div>

      {/* Right: Python status, Inspector, Privacy info, Files toggle */}
      <div className="flex items-center gap-2">
        {/* Python status indicator & reset */}
        <div
          title={badge.tooltip}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono ${badge.color}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dot}`} />
          <Terminal className="w-3.5 h-3.5 shrink-0 opacity-80" />
          <span className="hidden md:inline">{badge.text}</span>
          <button
            type="button"
            onClick={onResetPython}
            aria-label="Reset Python interpreter session"
            title="Reset interpreter session (clears variables; keeps files)"
            className="ml-0.5 text-zinc-400 hover:text-zinc-200 transition"
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
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs transition border border-zinc-800 hover:border-zinc-700 shadow-2xs"
        >
          <Eye className="w-3.5 h-3.5 text-zinc-400" />
          <span>Inspect</span>
        </button>

        {/* Data flow info button */}
        <button
          type="button"
          onClick={onOpenDataFlow}
          aria-label="View data privacy and local storage details"
          title="Data privacy and browser isolation details"
          className="p-1.5 rounded-lg hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 transition border border-transparent hover:border-zinc-800"
        >
          <Info className="w-4 h-4" />
        </button>

        {/* Open workspace files toggle (when files panel is collapsed) */}
        {!isFilesOpen && onToggleFiles && (
          <button
            type="button"
            onClick={onToggleFiles}
            aria-label="Open workspace files"
            title="Open workspace files"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 transition shadow-xs text-xs font-mono"
          >
            <PanelRightOpen className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-[10px] px-1 py-0.2 rounded bg-zinc-950 border border-zinc-800 text-emerald-400">
              {filesCount}
            </span>
          </button>
        )}
      </div>
    </header>
  )
}
