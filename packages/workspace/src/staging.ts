import { StaleRevisionError, WorkspaceError } from './errors.js'
import { normalizePath } from './path.js'
import type {
  CommitResult,
  ExecutionSnapshot,
  FileMetadata,
  StagedFileChange,
} from './types.js'

export interface StagingSession {
  sessionId: string
  snapshot: ExecutionSnapshot
  changes: StagedFileChange[]
  isCommitted: boolean
  isDiscarded: boolean
}

export interface WorkspaceStorageTarget {
  chatId: string
  getFileMetadata(path: string): Promise<FileMetadata | null>
  writeFileBytes(
    path: string,
    data: Uint8Array,
    options?: { expectedVersion?: number; mimeType?: string; source?: 'user' | 'model' },
  ): Promise<FileMetadata>
  deleteFile(path: string, options?: { expectedVersion?: number }): Promise<boolean>
  readFileBytes(path: string): Promise<Uint8Array | null>
}

export class StagingManager {
  createSession(snapshot: ExecutionSnapshot, changes: StagedFileChange[] = []): StagingSession {
    const validatedChanges: StagedFileChange[] = []

    for (const change of changes) {
      const norm = normalizePath(change.path)
      validatedChanges.push({
        ...change,
        path: norm,
      })
    }

    return {
      sessionId: `stg_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      snapshot,
      changes: validatedChanges,
      isCommitted: false,
      isDiscarded: false,
    }
  }

  addChange(session: StagingSession, change: StagedFileChange): void {
    if (session.isCommitted || session.isDiscarded) {
      throw new WorkspaceError('Cannot add changes to a committed or discarded staging session')
    }
    const norm = normalizePath(change.path)
    // Replace any existing staged change for this path
    const existingIndex = session.changes.findIndex(c => c.path === norm)
    const normalizedChange = { ...change, path: norm }
    if (existingIndex >= 0) {
      session.changes[existingIndex] = normalizedChange
    } else {
      session.changes.push(normalizedChange)
    }
  }

  async commit(
    target: WorkspaceStorageTarget,
    session: StagingSession,
  ): Promise<CommitResult> {
    if (session.isCommitted) {
      throw new WorkspaceError('Staging session has already been committed')
    }
    if (session.isDiscarded) {
      throw new WorkspaceError('Cannot commit a discarded staging session')
    }

    const { snapshot, changes } = session

    // 1. Concurrency and conflict validation phase
    for (const change of changes) {
      const currentMeta = await target.getFileMetadata(change.path)
      const baseVersion = snapshot.baseRevisions[change.path]

      if (baseVersion === undefined) {
        // File did not exist at snapshot time
        if (currentMeta !== null) {
          throw new StaleRevisionError(
            `Conflict: file '${change.path}' was created concurrently in workspace`,
            undefined,
            currentMeta.version,
          )
        }
      } else {
        // File existed at snapshot time
        if (currentMeta === null) {
          throw new StaleRevisionError(
            `Conflict: file '${change.path}' was deleted concurrently in workspace`,
            baseVersion,
            undefined,
          )
        }
        if (currentMeta.version !== baseVersion) {
          throw new StaleRevisionError(
            `Conflict: file '${change.path}' was modified concurrently in workspace`,
            baseVersion,
            currentMeta.version,
          )
        }
      }
    }

    // 2. Atomic application with rollback support
    const rollbackLog: Array<{
      path: string
      previousData: Uint8Array | null
      previousMeta: FileMetadata | null
    }> = []

    const committed: string[] = []
    const deleted: string[] = []
    const revisions: Record<string, number> = {}

    try {
      for (const change of changes) {
        const previousMeta = await target.getFileMetadata(change.path)
        const previousData = previousMeta ? await target.readFileBytes(change.path) : null

        rollbackLog.push({
          path: change.path,
          previousData,
          previousMeta,
        })

        if (change.type === 'write') {
          let byteData: Uint8Array
          if (change.content instanceof Uint8Array) {
            byteData = change.content
          } else if (typeof change.content === 'string') {
            if (change.encoding === 'binary') {
              byteData = Uint8Array.from(atob(change.content), c => c.charCodeAt(0))
            } else {
              byteData = new TextEncoder().encode(change.content)
            }
          } else {
            byteData = new Uint8Array(0)
          }

          const newMeta = await target.writeFileBytes(change.path, byteData, {
            expectedVersion: previousMeta?.version,
            mimeType: change.mimeType,
            source: change.source,
          })
          committed.push(change.path)
          revisions[change.path] = newMeta.version
        } else if (change.type === 'delete') {
          await target.deleteFile(change.path, {
            expectedVersion: previousMeta?.version,
          })
          deleted.push(change.path)
          delete revisions[change.path]
        }
      }

      session.isCommitted = true
      return {
        success: true,
        committed,
        deleted,
        revisions,
      }
    } catch (commitErr) {
      // Rollback previously committed files in reverse order
      for (let i = rollbackLog.length - 1; i >= 0; i--) {
        const item = rollbackLog[i]
        try {
          if (item.previousMeta && item.previousData) {
            await target.writeFileBytes(item.path, item.previousData, {
              mimeType: item.previousMeta.mimeType,
            })
          } else {
            await target.deleteFile(item.path)
          }
        } catch {
          // Best effort rollback
        }
      }
      throw commitErr
    }
  }

  discard(session: StagingSession): void {
    session.isDiscarded = true
    session.changes = []
  }
}
