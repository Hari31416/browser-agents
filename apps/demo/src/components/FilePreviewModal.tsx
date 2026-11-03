import { useState, useCallback, useEffect } from 'react'
import { Check, Copy, Download, ShieldAlert, X } from 'lucide-react'
import type { WorkspaceFile } from '@browser-agents/workspace'
import { formatBytes, getPreviewCategory } from '../lib/sanitizer'

interface FilePreviewModalProps {
  file: WorkspaceFile | null
  onClose: () => void
  onDownload: (path: string) => void
  workspaceReadFileBytes: (path: string) => Promise<Uint8Array | null>
}

export function FilePreviewModal({
  file,
  onClose,
  onDownload,
  workspaceReadFileBytes,
}: FilePreviewModalProps) {
  const [copied, setCopied] = useState(false)
  const [textContent, setTextContent] = useState<string>('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [htmlDoc, setHtmlDoc] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!file) {
      setTextContent('')
      setImageUrl(null)
      setHtmlDoc('')
      return
    }

    let active = true
    let createdUrl: string | null = null

    setLoading(true)
    workspaceReadFileBytes(file.path)
      .then(bytes => {
        if (!active || !bytes) {
          setLoading(false)
          return
        }

        const category = getPreviewCategory(file.mimeType, file.path)
        if (category === 'image') {
          const blob = new Blob([bytes as unknown as BlobPart], { type: file.mimeType })
          createdUrl = URL.createObjectURL(blob)
          setImageUrl(createdUrl)
        } else if (category === 'active_sandbox') {
          const decoded = new TextDecoder().decode(bytes)
          setHtmlDoc(decoded)
        } else if (category === 'text') {
          const decoded = new TextDecoder().decode(bytes)
          setTextContent(decoded)
        }
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [file, workspaceReadFileBytes])

  const handleCopyText = useCallback(async () => {
    if (!textContent) return
    try {
      await navigator.clipboard.writeText(textContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore
    }
  }, [textContent])

  useEffect(() => {
    if (!file) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [file, onClose])

  if (!file) return null

  const category = getPreviewCategory(file.mimeType, file.path)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 cursor-pointer"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl p-5 text-zinc-100 flex flex-col max-h-[85vh] cursor-default"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3 shrink-0">
          <div>
            <h2 id="preview-modal-title" className="text-sm font-semibold font-mono">
              {file.path}
            </h2>
            <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
              {formatBytes(file.size)} | {file.mimeType}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDownload(file.path)}
              aria-label={`Download ${file.path}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 border border-zinc-700 transition"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview modal"
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto my-3 text-xs">
          {loading ? (
            <div className="p-8 text-center text-zinc-400">Loading preview...</div>
          ) : category === 'image' && imageUrl ? (
            <div className="flex items-center justify-center p-4 bg-zinc-950 rounded border border-zinc-800 min-h-60">
              <img
                src={imageUrl}
                alt={file.path}
                className="max-h-[60vh] max-w-full object-contain rounded"
              />
            </div>
          ) : category === 'active_sandbox' && htmlDoc ? (
            <div className="space-y-2">
              <div className="p-2 rounded bg-amber-950/30 border border-amber-900/60 text-amber-300 text-[11px] flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Active content (HTML/SVG) is previewed inside an isolated sandbox iframe without scripts or same-origin privileges to protect your application origin.
                </span>
              </div>
              <iframe
                title={`Preview of ${file.path}`}
                srcDoc={htmlDoc}
                sandbox=""
                className="w-full h-80 rounded bg-white border border-zinc-700"
              />
            </div>
          ) : category === 'text' ? (
            <div className="space-y-2">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCopyText}
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
                      <span>Copy Text</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 bg-zinc-950 rounded border border-zinc-800 text-zinc-200 font-mono text-xs overflow-x-auto leading-relaxed whitespace-pre-wrap">
                <code>{textContent}</code>
              </pre>
            </div>
          ) : (
            <div className="p-8 text-center text-zinc-400 space-y-3">
              <p>Preview is not available for this binary file type.</p>
              <button
                type="button"
                onClick={() => onDownload(file.path)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium border border-zinc-700"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>Download File ({formatBytes(file.size)})</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
