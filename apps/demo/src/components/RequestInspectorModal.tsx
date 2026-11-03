import { useState, useCallback, useEffect } from 'react'
import { Check, Copy, ShieldCheck, X } from 'lucide-react'
import type { AssembledRequestInspection } from '../types'

interface RequestInspectorModalProps {
  isOpen: boolean
  onClose: () => void
  inspectionData: AssembledRequestInspection | null
}

export function RequestInspectorModal({
  isOpen,
  onClose,
  inspectionData,
}: RequestInspectorModalProps) {
  const [copied, setCopied] = useState(false)

  const jsonString = inspectionData
    ? JSON.stringify(inspectionData, null, 2)
    : '{}'

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore
    }
  }, [jsonString])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspector-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 cursor-pointer"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl p-6 text-zinc-100 flex flex-col max-h-[85vh] cursor-default"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3 shrink-0">
          <div>
            <h2 id="inspector-modal-title" className="text-sm font-semibold tracking-tight">
              Assembled Model Request Inspection
            </h2>
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 mt-0.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Redacted payload: API keys and auth headers are never included in inspection data</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close request inspector"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto my-3 text-xs space-y-3 font-mono">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>
          </div>

          <pre className="p-4 bg-zinc-950 rounded border border-zinc-800 text-zinc-300 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[60vh]">
            {jsonString}
          </pre>
        </div>
      </div>
    </div>
  )
}
