import { AlertCircle, RefreshCw, X } from 'lucide-react'

interface ErrorBannerProps {
  message: string | null
  onDismiss?: () => void
  onAction?: () => void
  actionLabel?: string
}

export function ErrorBanner({
  message,
  onDismiss,
  onAction,
  actionLabel,
}: ErrorBannerProps) {
  if (!message) return null

  return (
    <div
      role="alert"
      className="bg-red-950/60 border-b border-red-800 text-red-200 px-4 py-2.5 text-xs flex items-center justify-between gap-3 shrink-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
        <span className="truncate">{message}</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {onAction && actionLabel && (
          <button
            type="button"
            onClick={onAction}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-900/80 hover:bg-red-800 border border-red-700 text-white text-[11px] font-medium transition"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{actionLabel}</span>
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error banner"
            className="text-red-300 hover:text-white p-1 transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
