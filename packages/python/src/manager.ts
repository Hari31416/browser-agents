import { PythonSessionImpl } from './session.js'
import type {
  PythonSession,
  PythonSessionManager,
  PythonSessionOptions,
} from './types.js'

export class PythonSessionManagerImpl implements PythonSessionManager {
  private readonly sessions = new Map<string, PythonSessionImpl>()
  private readonly defaultOptions: PythonSessionOptions

  constructor(defaultOptions: PythonSessionOptions = {}) {
    this.defaultOptions = defaultOptions
  }

  async getSession(chatId: string, options: PythonSessionOptions = {}): Promise<PythonSession> {
    let session = this.sessions.get(chatId)
    if (!session || session.isTerminated) {
      session = new PythonSessionImpl(chatId, {
        ...this.defaultOptions,
        ...options,
      })
      this.sessions.set(chatId, session)
    } else if (options.workspace) {
      session.setWorkspace(options.workspace)
    }
    return session
  }

  async resetSession(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId)
    if (session) {
      await session.reset()
    }
  }

  async disposeSession(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId)
    if (session) {
      await session.terminate()
      this.sessions.delete(chatId)
    }
  }

  async disposeAll(): Promise<void> {
    const terminations = Array.from(this.sessions.values()).map(s => s.terminate())
    await Promise.all(terminations)
    this.sessions.clear()
  }
}
