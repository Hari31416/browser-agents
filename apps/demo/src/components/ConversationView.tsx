import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  AlertCircle,
  BarChart3,
  Bot,
  Check,
  Copy,
  LineChart,
  Sparkles,
  Table,
  Terminal,
  User,
} from 'lucide-react'
import type {
  ChatMessageRecord,
  PlanItemRecord,
  RunRecord,
  ToolCallRecord,
} from '@browser-agents/workspace'
import { MarkdownView } from './MarkdownView'
import { PlanView } from './PlanView'
import { ToolCallCard } from './ToolCallCard'
import type { ActiveRunInfo } from '../types'

interface ConversationViewProps {
  messages: ChatMessageRecord[]
  planItems: PlanItemRecord[]
  toolCalls: ToolCallRecord[]
  runs: RunRecord[]
  activeRun: ActiveRunInfo | null
  onDownloadFile: (path: string) => void
  onSelectPrompt?: (prompt: string) => void
}

interface TimelineMessageItem {
  type: 'message'
  id: string
  timestamp: string
  message: ChatMessageRecord
}

interface TimelineToolCallItem {
  type: 'tool_call'
  id: string
  timestamp: string
  toolCall: ToolCallRecord
}

type TimelineItem = TimelineMessageItem | TimelineToolCallItem

function formatTimestamp(isoString?: string): string {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return ''
  }
}

export function ConversationView({
  messages,
  planItems,
  toolCalls,
  runs,
  activeRun,
  onDownloadFile,
  onSelectPrompt,
}: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = useCallback(async (id: string, text?: string | null) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // Ignore clipboard failures
    }
  }, [])

  // Auto-scroll on new streaming text or messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeRun?.streamingText, toolCalls.length])

  // Build a unified chronological timeline. Message IDs represent turns, so
  // repeated text from different messages remains visible.
  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = []

    // 1. Process every stored message independently
    for (const msg of messages) {
      items.push({
        type: 'message',
        id: msg.id,
        timestamp: msg.createdAt,
        message: msg,
      })
    }

    // 2. Process tool calls
    for (const tc of toolCalls) {
      items.push({
        type: 'tool_call',
        id: tc.id,
        timestamp: tc.startedAt,
        toolCall: tc,
      })
    }

    // 3. Sort chronologically
    items.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    return items
  }, [messages, toolCalls])

  const starterSuggestions = useMemo(
    () => [
      {
        icon: Table,
        title: 'Analyze Data',
        prompt: 'Check workspace files, load the data using pandas, and show summary statistics and columns.',
      },
      {
        icon: BarChart3,
        title: 'Plot Distribution',
        prompt: 'Generate a histogram and boxplot for numerical columns using matplotlib, and save the chart to the workspace.',
      },
      {
        icon: LineChart,
        title: 'Monte Carlo Simulation',
        prompt: 'Run a Monte Carlo simulation of 1,000 trials with numpy, calculate confidence intervals, and plot the trajectories.',
      },
      {
        icon: Terminal,
        title: 'Environment Check',
        prompt: 'Run Python to check installed package versions (numpy, pandas, matplotlib) and system memory.',
      },
    ],
    [],
  )

  return (
    <div
      role="log"
      aria-live="polite"
      className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 text-sm"
    >
      {messages.length === 0 && !activeRun ? (
        <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto py-12 px-4 space-y-6">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-950/30">
              <Bot className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-semibold text-zinc-100 text-lg sm:text-xl tracking-tight">
                Autonomous Browser Agent
              </h3>
              <p className="text-xs sm:text-sm text-zinc-400 max-w-md leading-relaxed">
                Upload files to your browser workspace, then ask the agent to plan and run Python calculations using NumPy, pandas, and matplotlib in client-side WebAssembly with zero data egress.
              </p>
            </div>
          </div>

          {/* Starter action chips */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-left">
            {starterSuggestions.map(item => {
              const Icon = item.icon
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => onSelectPrompt?.(item.prompt)}
                  className="group flex items-start gap-3 p-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-850/90 border border-zinc-800/80 hover:border-zinc-700 transition cursor-pointer text-left shadow-xs"
                >
                  <div className="p-2 rounded-lg bg-zinc-950/80 border border-zinc-800 text-zinc-400 group-hover:text-emerald-400 group-hover:border-emerald-900/60 transition shrink-0 mt-0.5">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-zinc-200 group-hover:text-emerald-300 transition flex items-center gap-1.5">
                      <span>{item.title}</span>
                      <Sparkles className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                    </div>
                    <div className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5 leading-snug">
                      {item.prompt}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* Plan View at top if present */}
      {planItems.length > 0 && (
        <div className="max-w-4xl mx-auto pt-1 pb-2">
          <PlanView todos={planItems} />
        </div>
      )}

      {/* Inter-mingled timeline items in chronological order */}
      {timelineItems.map(item => {
        if (item.type === 'tool_call') {
          return (
            <div key={item.id} className="max-w-4xl mx-auto pl-10 pr-2">
              <ToolCallCard
                toolCall={item.toolCall}
                onDownloadFile={onDownloadFile}
              />
            </div>
          )
        }

        const msg = item.message
        const isUser = msg.role === 'user'

        return (
          <div
            key={item.id}
            className={`group flex gap-3 max-w-4xl mx-auto ${
              isUser ? 'justify-end' : 'justify-start'
            }`}
          >
            {!isUser && (
              <div className="w-8 h-8 rounded-xl bg-emerald-950/70 border border-emerald-800/70 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                <Bot className="w-4 h-4" />
              </div>
            )}

            {isUser ? (
              <div className="flex flex-col items-end max-w-[85%]">
                <div className="rounded-2xl px-4 py-2.5 sm:px-5 sm:py-3 leading-relaxed bg-zinc-800 text-zinc-100 border border-zinc-700/80 whitespace-pre-wrap text-sm sm:text-[15px] font-normal shadow-xs">
                  {msg.content}
                </div>
                <div className={`flex items-center gap-2 mt-1 px-1 text-[11px] text-zinc-500 font-mono transition-opacity ${
                  copiedId === msg.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}>
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.id, msg.content)}
                    aria-label="Copy message"
                    className="flex items-center gap-1 hover:text-zinc-300 transition"
                  >
                    {copiedId === msg.id ? (
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
                  <span>•</span>
                  <span>{formatTimestamp(msg.createdAt)}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start max-w-[85%] flex-1">
                <div className="rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 leading-relaxed bg-zinc-900/90 text-zinc-200 border border-zinc-800/80 text-sm sm:text-[15px] w-fit max-w-full shadow-xs">
                  <MarkdownView content={msg.content || ''} />
                </div>
                <div className={`flex items-center gap-2 mt-1 px-1 text-[11px] text-zinc-500 font-mono transition-opacity ${
                  copiedId === msg.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}>
                  <span>{formatTimestamp(msg.createdAt)}</span>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.id, msg.content)}
                    aria-label="Copy message"
                    className="flex items-center gap-1 hover:text-zinc-300 transition"
                  >
                    {copiedId === msg.id ? (
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
              </div>
            )}

            {isUser && (
              <div className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        )
      })}

      {/* Active Run UI: Streaming response and error state */}
      {activeRun && (
        <div className="max-w-4xl mx-auto space-y-4 pt-1">
          {/* Live Assistant Response Streaming */}
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-xl bg-emerald-950/70 border border-emerald-800/70 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
              <Bot className="w-4 h-4" />
            </div>

            <div className="rounded-2xl px-4 py-3.5 text-sm sm:text-[15px] leading-relaxed max-w-[85%] bg-zinc-900/95 text-zinc-200 border border-zinc-800/80 w-full space-y-2 shadow-xs">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 border-b border-zinc-800/80 pb-2">
                <span className="font-mono text-zinc-300">
                  {activeRun.state}...
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Streaming response
                </span>
              </div>

              {activeRun.streamingText ? (
                <MarkdownView content={activeRun.streamingText} />
              ) : (
                <div className="italic text-zinc-500 py-1 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Agent is thinking and planning Python execution...
                </div>
              )}
            </div>
          </div>

          {/* Active run error banner */}
          {activeRun.error && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Run Error: </span>
                <span>{activeRun.error}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notice for interrupted / cancelled runs */}
      {runs.some(r => r.status === 'interrupted') && (
        <div className="max-w-4xl mx-auto p-3.5 rounded-xl bg-amber-950/20 border border-amber-900/40 text-xs text-amber-400 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            A previous run was interrupted when the app was closed. Prior workspace files and conversation records have been reconciled and preserved.
          </span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
