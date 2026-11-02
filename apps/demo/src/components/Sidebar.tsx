import { useCallback } from 'react'
import {
  Download,
  Plus,
  Settings,
  Trash2,
  Database,
  Radio,
  FileText,
} from 'lucide-react'
import type { ChatSession, StorageStatus } from '@browser-agents/workspace'
import type { ProviderPreferences } from '../types'

interface SidebarProps {
  chats: ChatSession[]
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onCreateChat: () => void
  onDeleteChat: (chatId: string) => void
  onExportChat: (chatId: string) => void
  storageStatus: StorageStatus | null
  preferences: ProviderPreferences
  sessionToken: string | null
  onOpenSettings: () => void
}

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onExportChat,
  storageStatus,
  preferences,
  sessionToken,
  onOpenSettings,
}: SidebarProps) {
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
          <div className="font-semibold text-xs tracking-wider uppercase text-zinc-400">
            Browser Agents
          </div>
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
                <div className="flex items-center gap-2 overflow-hidden mr-2">
                  <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                  <span className="truncate">{chat.title || 'Untitled Chat'}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                  <button
                    type="button"
                    onClick={e => handleExport(e, chat.id)}
                    aria-label={`Export ${chat.title || 'chat'}`}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={e => handleDelete(e, chat.id)}
                    aria-label={`Delete ${chat.title || 'chat'}`}
                    className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700/60"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer: Storage and Provider status */}
      <div className="p-3 border-t border-zinc-800 text-[11px] space-y-2 bg-zinc-950/80">
        {/* Storage status */}
        <div className="flex items-center justify-between text-zinc-400">
          <div className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-zinc-500" />
            <span>Storage:</span>
          </div>
          <span
            className={`font-mono ${
              storageStatus?.isDurable ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {storageStatus?.isDurable ? 'Durable (OPFS)' : 'In-Memory'}
          </span>
        </div>

        {/* Model status */}
        <div
          role="button"
          tabIndex={0}
          onClick={onOpenSettings}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') onOpenSettings()
          }}
          className="flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition text-zinc-300"
        >
          <div className="flex items-center gap-1.5 truncate mr-1">
            <Radio
              className={`w-3.5 h-3.5 shrink-0 ${
                preferences.isFixtureMode
                  ? 'text-sky-400'
                  : sessionToken
                    ? 'text-emerald-400'
                    : 'text-zinc-500'
              }`}
            />
            <span className="truncate">
              {preferences.isFixtureMode
                ? 'Fixture Mode'
                : preferences.selectedModel || preferences.customModel || 'No Model Set'}
            </span>
          </div>
          <Settings className="w-3 h-3 text-zinc-500 shrink-0" />
        </div>
      </div>
    </aside>
  )
}
