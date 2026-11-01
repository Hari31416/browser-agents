import type { PlanItemRecord, RecordStore, RunRecord, ToolCallRecord } from '@browser-agents/workspace'
import type {
  AgentEvent,
  AgentEventHandler,
} from './types.js'

export function createRunId(): string {
  return `run_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

export function createCallId(): string {
  return `call_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

export class AgentEventEmitter {
  private readonly handlers = new Set<AgentEventHandler>()
  private readonly recordStore?: RecordStore
  private readonly eventQueue: AgentEvent[] = []

  constructor(recordStore?: RecordStore) {
    this.recordStore = recordStore
  }

  subscribe(handler: AgentEventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  getRecordedEvents(): readonly AgentEvent[] {
    return this.eventQueue
  }

  async emit(event: AgentEvent): Promise<void> {
    this.eventQueue.push(event)

    // First, invoke in-memory listeners
    for (const handler of this.handlers) {
      try {
        await handler(event)
      } catch (err) {
        console.error('Error in agent event handler:', err)
      }
    }

    // Second, if record store is available, persist state
    if (this.recordStore) {
      try {
        await this.persistToRecordStore(event)
      } catch (err) {
        console.error('Failed to persist event to record store:', err)
      }
    }
  }

  private async persistToRecordStore(event: AgentEvent): Promise<void> {
    if (!this.recordStore) return

    switch (event.type) {
      case 'run:start': {
        const runRecord: RunRecord = {
          id: event.runId,
          chatId: event.chatId,
          status: 'running',
          startedAt: event.timestamp,
        }
        await this.recordStore.createRun(runRecord)
        break
      }

      case 'plan:update': {
        const run = await this.recordStore.getRun(event.runId)
        if (run) {
          const now = new Date().toISOString()
          const planItems: PlanItemRecord[] = event.todos.map((todo, idx) => ({
            id: todo.id || `todo_${idx + 1}`,
            chatId: run.chatId,
            index: idx,
            content: todo.content,
            status: todo.status,
            createdAt: now,
            updatedAt: now,
          }))
          await this.recordStore.setPlan(run.chatId, planItems)
        }
        break
      }

      case 'tool:start': {
        const run = await this.recordStore.getRun(event.runId)
        const toolCallRecord: ToolCallRecord = {
          id: event.callId,
          runId: event.runId,
          chatId: run?.chatId ?? '',
          name: event.name,
          args: JSON.stringify(event.args),
          status: 'running',
          startedAt: event.timestamp,
        }
        await this.recordStore.createToolCall(toolCallRecord)
        break
      }

      case 'tool:result': {
        await this.recordStore.updateToolCall(event.callId, {
          status: 'completed',
          result: event.result,
          endedAt: event.timestamp,
        })
        break
      }

      case 'tool:error': {
        await this.recordStore.updateToolCall(event.callId, {
          status: 'failed',
          error: event.error,
          endedAt: event.timestamp,
        })
        break
      }

      case 'run:cancel': {
        await this.recordStore.updateRun(event.runId, {
          status: 'cancelled',
          endedAt: event.timestamp,
          error: {
            message: event.reason ?? 'Cancelled by user',
          },
        })
        break
      }

      case 'run:complete': {
        await this.recordStore.updateRun(event.runId, {
          status: 'completed',
          endedAt: event.timestamp,
        })
        break
      }

      case 'run:error': {
        await this.recordStore.updateRun(event.runId, {
          status: 'failed',
          endedAt: event.timestamp,
          error: {
            message: event.error,
          },
        })
        break
      }
    }
  }
}
