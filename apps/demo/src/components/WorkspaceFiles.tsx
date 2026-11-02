import { useState, useCallback, useRef } from 'react'
import {
  Download,
  Eye,
  FileCode,
  FileText,
  HardDrive,
  Trash2,
  Upload,
} from 'lucide-react'
import type { WorkspaceFile } from '@browser-agents/workspace'
import { formatBytes } from '../lib/sanitizer'

interface WorkspaceFilesProps {
  files: WorkspaceFile[]
  onUploadFiles: (fileList: FileList) => Promise<void>
  onDownloadFile: (path: string) => void
  onDeleteFile: (path: string) => void
  onPreviewFile: (file: WorkspaceFile) => void
}

export function WorkspaceFiles({
  files,
  onUploadFiles,
  onDownloadFile,
  onDeleteFile,
  onPreviewFile,
}: WorkspaceFilesProps) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await onUploadFiles(e.dataTransfer.files)
      }
    },
    [onUploadFiles],
  )

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        await onUploadFiles(e.target.files)
        e.target.value = ''
      }
    },
    [onUploadFiles],
  )

  return (
    <aside
      aria-label="Workspace files"
      className="w-72 bg-zinc-950 border-l border-zinc-800 flex flex-col h-full shrink-0 select-none text-zinc-300"
    >
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
          <span>Workspace Files ({files.length})</span>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Upload files into workspace"
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition"
        >
          <Upload className="w-3 h-3 text-sky-400" />
          <span>Upload</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>

      {/* Drag & drop target zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`m-2.5 p-3 rounded-lg border border-dashed text-center text-xs transition cursor-pointer ${
          isDragging
            ? 'border-sky-500 bg-sky-950/20 text-sky-300'
            : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/40 text-zinc-500'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-4 h-4 mx-auto mb-1 text-zinc-500" />
        <span className="text-[11px]">Drop files here to upload to browser storage</span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        {files.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500 italic">
            No files in this workspace. Upload CSV, text, or data files for the agent to use.
          </div>
        ) : (
          files.map(file => {
            const ext = file.path.split('.').pop()?.toLowerCase() ?? ''
            const isCode = ['py', 'js', 'ts', 'json', 'html', 'css'].includes(ext)

            return (
              <div
                key={file.path}
                className="group flex items-center justify-between p-2 rounded bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/80 text-xs transition"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onPreviewFile(file)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') onPreviewFile(file)
                  }}
                  className="flex items-center gap-2 overflow-hidden mr-2 cursor-pointer flex-1 min-w-0"
                >
                  {isCode ? (
                    <FileCode className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                  )}
                  <div className="truncate">
                    <div className="truncate font-mono text-zinc-200">{file.path}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {formatBytes(file.size)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                  <button
                    type="button"
                    onClick={() => onPreviewFile(file)}
                    aria-label={`Preview ${file.path}`}
                    title="Preview file"
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownloadFile(file.path)}
                    aria-label={`Download ${file.path}`}
                    title="Download file"
                    className="p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete '${file.path}' from workspace?`)) {
                        onDeleteFile(file.path)
                      }
                    }}
                    aria-label={`Delete ${file.path}`}
                    title="Delete file"
                    className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
