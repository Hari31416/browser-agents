import { useState, useCallback, useRef } from 'react'
import { Play, Square } from 'lucide-react'

interface ComposerProps {
  isRunning: boolean
  onSendMessage: (prompt: string) => Promise<void>
  onCancelRun: () => void
  disabled?: boolean
  disabledPlaceholder?: string
}

export function Composer({
  isRunning,
  onSendMessage,
  onCancelRun,
  disabled = false,
  disabledPlaceholder,
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

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 border-t border-zinc-800 bg-zinc-950/90 shrink-0"
    >
      <div className="relative flex items-end gap-2 max-w-4xl mx-auto rounded-lg border border-zinc-800 bg-zinc-900 p-2 focus-within:border-zinc-700 transition">
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
          className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-hidden resize-none leading-relaxed p-1"
        />

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
    </form>
  )
}
