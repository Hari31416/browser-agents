import { CheckCircle2, Clock, ListTodo, Loader2 } from 'lucide-react'
import type { PlanItemRecord } from '@browser-agents/workspace'

interface PlanViewProps {
  todos: PlanItemRecord[]
}

export function PlanView({ todos }: PlanViewProps) {
  if (!todos || todos.length === 0) return null

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3.5 my-3 text-xs space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-zinc-300">
        <ListTodo className="w-4 h-4 text-sky-400" />
        <span>Agent Plan</span>
        <span className="text-[11px] font-normal text-zinc-500 font-mono">
          ({todos.filter(t => t.status === 'completed').length}/{todos.length})
        </span>
      </div>

      <div className="space-y-1.5 pt-1">
        {todos.map((todo, idx) => {
          const isDone = todo.status === 'completed'
          const isInProgress = todo.status === 'in_progress'

          return (
            <div
              key={todo.id || idx}
              className={`flex items-start gap-2 p-1.5 rounded transition ${
                isDone
                  ? 'text-zinc-400 bg-zinc-950/40'
                  : isInProgress
                    ? 'text-zinc-100 bg-zinc-800/60 font-medium'
                    : 'text-zinc-400'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : isInProgress ? (
                  <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-zinc-500" />
                )}
              </div>
              <span className={`leading-relaxed ${isDone ? 'line-through' : ''}`}>
                {todo.content}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
