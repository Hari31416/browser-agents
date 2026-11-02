import { useState, useCallback } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Terminal,
} from 'lucide-react'
import type { ToolCallRecord } from '@browser-agents/workspace'

interface ToolCallCardProps {
  toolCall: ToolCallRecord
  onDownloadFile?: (path: string) => void
}

export function ToolCallCard({ toolCall, onDownloadFile }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  // Parse args
  let parsedArgs: Record<string, unknown> = {}
  try {
    if (typeof toolCall.args === 'string') {
      parsedArgs = JSON.parse(toolCall.args)
    } else if (typeof toolCall.args === 'object' && toolCall.args !== null) {
      parsedArgs = toolCall.args as Record<string, unknown>
    }
  } catch {
    // Keep raw string in parsedArgs
    parsedArgs = { raw: toolCall.args }
  }

  // Parse result if python execution
  let pythonStdout = ''
  let pythonStderr = ''
  let pythonFiles: string[] = []
  let rawResultString = ''

  if (toolCall.result) {
    if (typeof toolCall.result === 'object') {
      const resObj = toolCall.result as {
        stdout?: string
        stderr?: string
        files?: Record<string, unknown>
        artifacts?: Array<{ path: string }>
      }
      pythonStdout = resObj.stdout || ''
      pythonStderr = resObj.stderr || ''
      if (resObj.files) {
        pythonFiles = Object.keys(resObj.files)
      } else if (resObj.artifacts) {
        pythonFiles = resObj.artifacts.map(a => a.path)
      }
      rawResultString = JSON.stringify(toolCall.result, null, 2)
    } else {
      rawResultString = String(toolCall.result)
    }
  }

  const isPython =
    toolCall.name === 'execute_python' ||
    toolCall.name === 'python' ||
    toolCall.name === 'python_interpreter'
  const pythonCode = isPython && typeof parsedArgs.code === 'string' ? parsedArgs.code : null

  const handleCopyCode = useCallback(async () => {
    if (!pythonCode) return
    try {
      await navigator.clipboard.writeText(pythonCode)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      // Ignore
    }
  }, [pythonCode])

  const isCompleted = toolCall.status === 'completed'
  const isFailed = toolCall.status === 'failed'
  const isRunning = toolCall.status === 'running'

  return (
    <div className="my-2.5 rounded-lg border border-zinc-800 bg-zinc-950/70 overflow-hidden text-xs">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(prev => !prev)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') setExpanded(prev => !prev)
        }}
        className="flex items-center justify-between px-3 py-2 bg-zinc-900/60 hover:bg-zinc-900 cursor-pointer transition select-none"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
          )}
          <span className="font-mono font-medium text-zinc-200">
            {toolCall.name || 'tool_call'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1 text-[11px] text-sky-400 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Running...</span>
            </span>
          )}
          {isCompleted && (
            <span className="text-[11px] text-emerald-400 font-medium">Completed</span>
          )}
          {isFailed && <span className="text-[11px] text-red-400 font-medium">Failed</span>}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="p-3 space-y-2.5 border-t border-zinc-800/80 font-mono text-[11px]">
          {/* If Python: Show code block */}
          {pythonCode && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="flex items-center gap-1 font-semibold text-zinc-300">
                  <Terminal className="w-3 h-3 text-sky-400" />
                  <span>Python Script:</span>
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  aria-label="Copy python code"
                  className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-2.5 bg-zinc-900 rounded border border-zinc-800 text-zinc-200 overflow-x-auto leading-relaxed whitespace-pre">
                <code>{pythonCode}</code>
              </pre>
            </div>
          )}

          {/* Non-python args */}
          {!pythonCode && Object.keys(parsedArgs).length > 0 && (
            <div className="space-y-1">
              <span className="text-zinc-400 font-semibold">Arguments:</span>
              <pre className="p-2 bg-zinc-900 rounded border border-zinc-800 text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(parsedArgs, null, 2)}
              </pre>
            </div>
          )}

          {/* Python Stdout */}
          {pythonStdout && (
            <div className="space-y-1">
              <span className="text-zinc-400 font-semibold">Stdout:</span>
              <pre className="p-2.5 bg-zinc-900/90 rounded border border-zinc-800 text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                {pythonStdout}
              </pre>
            </div>
          )}

          {/* Python Stderr */}
          {pythonStderr && (
            <div className="space-y-1">
              <span className="text-amber-400 font-semibold">Stderr:</span>
              <pre className="p-2.5 bg-zinc-900/90 rounded border border-amber-900/60 text-amber-300 overflow-x-auto whitespace-pre-wrap">
                {pythonStderr}
              </pre>
            </div>
          )}

          {/* Generated Files */}
          {pythonFiles.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-zinc-300 font-semibold">Generated Files:</span>
              <div className="flex flex-wrap gap-1.5">
                {pythonFiles.map(filePath => (
                  <button
                    key={filePath}
                    type="button"
                    onClick={() => onDownloadFile?.(filePath)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
                  >
                    <Download className="w-3 h-3 text-emerald-400" />
                    <span>{filePath}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Standard result for non-python tool */}
          {!isPython && rawResultString && (
            <div className="space-y-1">
              <span className="text-zinc-400 font-semibold">Output:</span>
              <pre className="p-2.5 bg-zinc-900 rounded border border-zinc-800 text-zinc-200 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                {rawResultString}
              </pre>
            </div>
          )}

          {/* Error Message */}
          {toolCall.error && (
            <div className="p-2 rounded bg-red-950/40 border border-red-800 text-red-300 space-y-1">
              <div className="flex items-center gap-1 font-semibold text-red-200">
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                <span>Execution Error:</span>
              </div>
              <pre className="whitespace-pre-wrap text-[11px]">
                {typeof toolCall.error === 'string'
                  ? toolCall.error
                  : JSON.stringify(toolCall.error, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
