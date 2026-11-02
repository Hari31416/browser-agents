import { useEffect, useMemo, useRef } from 'react'
import { AlertCircle, Bot, User } from 'lucide-react'
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

export function ConversationView({
  messages,
  planItems,
  toolCalls,
  runs,
  activeRun,
  onDownloadFile,
}: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll on new streaming text or messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeRun?.streamingText, toolCalls.length])

  // Build a unified chronological timeline without duplicate messages
  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = []

    // 1. Process messages and deduplicate
    const processedMessages: ChatMessageRecord[] = []
    for (const msg of messages) {
      const content = (msg.content || '').trim()
      // Skip if an identical message from the same role already exists
      const isDuplicate = processedMessages.some(
        p => p.role === msg.role && (p.content || '').trim() === content,
      )
      if (isDuplicate) continue

      // Skip concatenated composite message if individual turn messages are already present
      if (msg.role === 'assistant' && content.includes('\n\n')) {
        const parts = content.split(/\n\s*\n/).map(p => p.trim())
        const allPartsExist =
          parts.length > 1 &&
          parts.every(part =>
            processedMessages.some(
              p => p.role === 'assistant' && (p.content || '').trim() === part,
            ),
          )
        if (allPartsExist) continue
      }

      processedMessages.push(msg)
    }

    for (const msg of processedMessages) {
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

    // 4. Deduplicate any consecutive identical messages
    const deduplicated: TimelineItem[] = []
    for (const item of items) {
      if (item.type === 'message') {
        const last = deduplicated[deduplicated.length - 1]
        if (
          last &&
          last.type === 'message' &&
          last.message.role === item.message.role &&
          (last.message.content || '').trim() === (item.message.content || '').trim()
        ) {
          continue
        }
      }
      deduplicated.push(item)
    }

    return deduplicated
  }, [messages, toolCalls])

  return (
    <div
      role="log"
      aria-live="polite"
      className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 text-sm"
    >
      {messages.length === 0 && !activeRun ? (
        <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto text-zinc-400 space-y-3 py-16">
          <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-200 text-base">Autonomous Browser Agent</h3>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Upload files to your browser workspace, then ask the agent to plan and run Python calculations using NumPy, pandas, and matplotlib. All code runs locally in browser WebAssembly with zero network egress.
            </p>
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
            className={`flex gap-3 max-w-4xl mx-auto ${
              isUser ? 'justify-end' : 'justify-start'
            }`}
          >
            {!isUser && (
              <div className="w-7 h-7 rounded-full bg-sky-950 border border-sky-800 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`rounded-lg p-4 text-xs leading-relaxed max-w-[85%] ${
                isUser
                  ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/80 whitespace-pre-wrap'
                  : 'bg-zinc-900 text-zinc-200 border border-zinc-800/80'
              }`}
            >
              {isUser ? (
                <div>{msg.content}</div>
              ) : (
                <MarkdownView content={msg.content || ''} />
              )}
            </div>

            {isUser && (
              <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0 mt-0.5">
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
            <div className="w-7 h-7 rounded-full bg-sky-950 border border-sky-800 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-4 h-4" />
            </div>

            <div className="rounded-lg p-4 text-xs leading-relaxed max-w-[85%] bg-zinc-900 text-zinc-200 border border-zinc-800/80 w-full space-y-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 border-b border-zinc-800 pb-1.5">
                <span className="font-mono">
                  Step {activeRun.step} | {activeRun.state}...
                </span>
                <span className="flex items-center gap-1 text-sky-400 animate-pulse">
                  Streaming response
                </span>
              </div>

              {activeRun.streamingText ? (
                <MarkdownView content={activeRun.streamingText} />
              ) : (
                <div className="italic text-zinc-500 py-1">Agent is thinking...</div>
              )}
            </div>
          </div>

          {/* Active run error banner */}
          {activeRun.error && (
            <div className="p-3 rounded bg-red-950/40 border border-red-800 text-xs text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
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
        <div className="max-w-4xl mx-auto p-3 rounded bg-amber-950/20 border border-amber-900/40 text-xs text-amber-400 flex items-center gap-2">
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
