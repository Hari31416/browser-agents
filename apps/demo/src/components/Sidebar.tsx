import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Download,
  MessageSquare,
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
  storageStatus: StorageStatus | null
  onOpenSettings: () => void
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

  return (
    <aside
      aria-label="Sidebar navigation"
      className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col h-full shrink-0 select-none text-zinc-300"
    >
      {/* Header & New Chat */}
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-xs tracking-wider uppercase text-zinc-400">
            Browser Agents
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open model endpoint settings"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onCreateChat}
          aria-label="Create a new chat"
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {chats.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">
            No chats available. Click &apos;New Chat&apos; to start.
          </div>
        ) : (
          chats.map(chat => {
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
                className={`group flex items-center justify-between px-2.5 py-2 rounded text-xs cursor-pointer transition ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 font-medium'
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden mr-1 min-w-0 flex-1">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
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
                      className="bg-zinc-900 text-zinc-100 px-1 py-0.5 rounded border border-zinc-700 text-xs w-full focus:outline-hidden"
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
                      className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={e => handleExport(e, chat.id)}
                      aria-label={`Export ${chat.title || 'chat'}`}
                      title="Export chat"
                      className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={e => handleDelete(e, chat.id)}
                      aria-label={`Delete ${chat.title || 'chat'}`}
                      title="Delete chat"
                      className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700/60"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
