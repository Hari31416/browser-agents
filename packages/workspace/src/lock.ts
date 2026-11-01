import { LockAcquisitionError } from './errors.js'

export interface LockOptions {
  timeoutMs?: number
}

export class TabLockManager {
  private inMemoryLocks = new Map<string, { owner: string; expiresAt: number }>()
  private lockOwnerId: string

  constructor() {
    this.lockOwnerId = `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`
  }

  get ownerId(): string {
    return this.lockOwnerId
  }

  async withChatLock<T>(
    chatId: string,
    operation: () => Promise<T>,
    options: LockOptions = {},
  ): Promise<T> {
    const lockName = `workspace_chat_${chatId}`
    const timeoutMs = options.timeoutMs ?? 5000

    // Try Web Locks API if available
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        return await navigator.locks.request(
          lockName,
          { signal: controller.signal },
          async () => {
            clearTimeout(timer)
            return await operation()
          },
        )
      } catch (err) {
        clearTimeout(timer)
        if (err instanceof Error && err.name === 'AbortError') {
          throw new LockAcquisitionError(`Timed out waiting for lock on chat '${chatId}'`)
        }
        throw err
      }
    }

    // In-memory fallback lock
    const acquired = await this.acquireMemoryLock(chatId, timeoutMs)
    if (!acquired) {
      throw new LockAcquisitionError(`Failed to acquire lock for chat '${chatId}' after ${timeoutMs}ms`)
    }

    try {
      return await operation()
    } finally {
      this.releaseMemoryLock(chatId)
    }
  }

  private async acquireMemoryLock(chatId: string, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now()
    const pollInterval = 20

    while (Date.now() - startTime < timeoutMs) {
      const now = Date.now()
      const existing = this.inMemoryLocks.get(chatId)

      if (!existing || existing.expiresAt < now || existing.owner === this.lockOwnerId) {
        this.inMemoryLocks.set(chatId, {
          owner: this.lockOwnerId,
          expiresAt: now + timeoutMs + 2000,
        })
        return true
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    return false
  }

  private releaseMemoryLock(chatId: string): void {
    const existing = this.inMemoryLocks.get(chatId)
    if (existing && existing.owner === this.lockOwnerId) {
      this.inMemoryLocks.delete(chatId)
    }
  }
}
