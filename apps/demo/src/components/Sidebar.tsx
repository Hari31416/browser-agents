import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Bot,
  Download,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import type { ChatSession, StorageStatus } from '@browser-agents/workspace'

interface SidebarProps {
  chats: ChatSession[]
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onCreateChat: () => void
  onDeleteChat: (chatId: string) => void
  onExportChat: (chatId: string) => void
  onRenameChat?: (chatId: string, title: string) => void
  storageStatus?: StorageStatus | null
  onOpenSettings: () => void
  onCollapse?: () => void
}

interface ChatGroup {
  label: string
  chats: ChatSession[]
}

function groupChatsByTimePeriod(chats: ChatSession[]): ChatGroup[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const startOfSevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000
  const startOfThirtyDaysAgo = startOfToday - 30 * 24 * 60 * 60 * 1000

  const buckets: Record<string, ChatSession[]> = {
    Today: [],
    Yesterday: [],
    'Previous 7 Days': [],
    'Previous 30 Days': [],
    Older: [],
  }

  // Sort descending by updated timestamp, or created timestamp
  const sorted = [...chats].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt).getTime() || 0
    const timeB = new Date(b.updatedAt || b.createdAt).getTime() || 0
    return timeB - timeA
  })

  for (const chat of sorted) {
    const time = new Date(chat.updatedAt || chat.createdAt).getTime() || 0
    if (time >= startOfToday) {
      buckets['Today'].push(chat)
    } else if (time >= startOfYesterday) {
      buckets['Yesterday'].push(chat)
    } else if (time >= startOfSevenDaysAgo) {
      buckets['Previous 7 Days'].push(chat)
    } else if (time >= startOfThirtyDaysAgo) {
      buckets['Previous 30 Days'].push(chat)
    } else {
      buckets['Older'].push(chat)
    }
  }

  const result: ChatGroup[] = []
  const order = ['Today', 'Yesterday', 'Previous 7 Days', 'Previous 30 Days', 'Older']
  for (const label of order) {
    if (buckets[label].length > 0) {
      result.push({ label, chats: buckets[label] })
    }
  }
  return result
}

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onExportChat,
  onRenameChat,
  onOpenSettings,
  onCollapse,
}: SidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingChatId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingChatId])

  const startEditing = useCallback((chat: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingChatId(chat.id)
    setEditTitle(chat.title || 'Untitled Chat')
  }, [])

  const saveEdit = useCallback(
    (chatId: string) => {
      const trimmed = editTitle.trim()
      if (trimmed) {
        onRenameChat?.(chatId, trimmed)
      }
      setEditingChatId(null)
    },
    [editTitle, onRenameChat],
  )

  const cancelEdit = useCallback(() => {
    setEditingChatId(null)
  }, [])

  const handleDelete = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation()
      if (confirm('Delete this chat workspace and all stored files?')) {
        onDeleteChat(chatId)
      }
    },
    [onDeleteChat],
  )

  const handleExport = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation()
      onExportChat(chatId)
    },
    [onExportChat],
  )

  const groupedChats = useMemo(() => groupChatsByTimePeriod(chats), [chats])

  return (
    <aside
      aria-label="Sidebar navigation"
      className="w-64 bg-zinc-950 border-r border-zinc-800/80 flex flex-col h-full shrink-0 select-none text-zinc-300"
    >
      {/* Branding on top left & Collapse toggle */}
      <div className="p-3.5 border-b border-zinc-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-950/60 border border-emerald-800/80 flex items-center justify-center text-emerald-400 shadow-xs shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <span className="font-semibold text-xs tracking-tight text-zinc-100 truncate">
              Browser Agents
            </span>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onCreateChat}
          aria-label="Create a new chat"
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 hover:border-emerald-500/40 text-xs font-semibold tracking-tight transition shadow-xs cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {chats.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500">
            No chats available. Click &apos;New Chat&apos; to start.
          </div>
        ) : (
          groupedChats.map(group => (
            <div key={group.label} className="space-y-1">
              <div className="px-2.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
                {group.label}
              </div>
              {group.chats.map(chat => {
                const isActive = chat.id === activeChatId
                const isEditing = editingChatId === chat.id

                return (
                  <div
                    key={chat.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectChat(chat.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        onSelectChat(chat.id)
                      }
                    }}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-xl text-xs cursor-pointer transition ${
                      isActive
                        ? 'bg-zinc-800/90 text-zinc-100 font-medium border border-zinc-700/60 shadow-xs'
                        : 'text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden mr-1 min-w-0 flex-1">
                      <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-emerald-400' : 'text-zinc-500'}`} />
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={editTitle}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Enter') saveEdit(chat.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          onBlur={() => saveEdit(chat.id)}
                          className="bg-zinc-900 text-zinc-100 px-1.5 py-0.5 rounded-md border border-zinc-700 text-xs w-full focus:outline-hidden focus:border-emerald-500"
                        />
                      ) : (
                        <span
                          onDoubleClick={e => startEditing(chat, e)}
                          title="Double-click to rename"
                          className="truncate"
                        >
                          {chat.title || 'Untitled Chat'}
                        </span>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                        <button
                          type="button"
                          onClick={e => startEditing(chat, e)}
                          aria-label={`Rename ${chat.title || 'chat'}`}
                          title="Rename thread"
                          className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={e => handleExport(e, chat.id)}
                          aria-label={`Export ${chat.title || 'chat'}`}
                          title="Export chat archive"
                          className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={e => handleDelete(e, chat.id)}
                          aria-label={`Delete ${chat.title || 'chat'}`}
                          title="Delete chat"
                          className="p-1 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-zinc-700/60 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer: Settings at the bottom */}
      <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/90">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open model endpoint settings"
          title="Open settings"
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-zinc-900 text-xs text-zinc-400 hover:text-zinc-100 transition cursor-pointer border border-transparent hover:border-zinc-800"
        >
          <Settings className="w-4 h-4 text-zinc-400" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
