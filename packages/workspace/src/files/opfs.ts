import { QuotaExceededError, StorageUnavailableError } from '../errors.js'
import type { BoundedReadBytesResult, FileStore } from './types.js'

export function isOPFSAvailable(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage !== 'undefined' &&
      typeof navigator.storage.getDirectory === 'function'
    )
  } catch {
    return false
  }
}

export class OPFSFileStore implements FileStore {
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null

  private async getRootDir(): Promise<FileSystemDirectoryHandle> {
    if (this.rootPromise) {
      return this.rootPromise
    }

    if (!isOPFSAvailable()) {
      throw new StorageUnavailableError('OPFS is not available in the current environment')
    }

    this.rootPromise = navigator.storage.getDirectory()
    return this.rootPromise
  }

  private async getChatDir(
    chatId: string,
    create: boolean = false,
  ): Promise<FileSystemDirectoryHandle | null> {
    const root = await this.getRootDir()
    try {
      const chatsDir = await root.getDirectoryHandle('chats', { create })
      return await chatsDir.getDirectoryHandle(chatId, { create })
    } catch {
      return null
    }
  }

  private async resolvePath(
    chatId: string,
    filePath: string,
    createDirs: boolean = false,
  ): Promise<{ dirHandle: FileSystemDirectoryHandle; fileName: string } | null> {
    const chatDir = await this.getChatDir(chatId, createDirs)
    if (!chatDir) return null

    const parts = filePath.split('/')
    const fileName = parts.pop()!
    let currentDir = chatDir

    for (const part of parts) {
      try {
        currentDir = await currentDir.getDirectoryHandle(part, { create: createDirs })
      } catch {
        return null
      }
    }

    return { dirHandle: currentDir, fileName }
  }

  async writeBytes(chatId: string, path: string, data: Uint8Array): Promise<void> {
    const resolved = await this.resolvePath(chatId, path, true)
    if (!resolved) {
      throw new StorageUnavailableError(`Failed to resolve directory path for '${path}' in chat '${chatId}'`)
    }

    try {
      const fileHandle = await resolved.dirHandle.getFileHandle(resolved.fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(data as Uint8Array<ArrayBuffer>)
      await writable.close()
    } catch (err) {
      if (err instanceof Error && err.name === 'QuotaExceededError') {
        throw new QuotaExceededError(`Storage quota exceeded while writing '${path}': ${err.message}`)
      }
      throw err
    }
  }

  async readBytes(chatId: string, path: string): Promise<Uint8Array | null> {
    const resolved = await this.resolvePath(chatId, path, false)
    if (!resolved) return null

    try {
      const fileHandle = await resolved.dirHandle.getFileHandle(resolved.fileName)
      const file = await fileHandle.getFile()
      const arrayBuffer = await file.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    } catch {
      return null
    }
  }

  async readBoundedBytes(
    chatId: string,
    path: string,
    offset: number,
    length: number,
  ): Promise<BoundedReadBytesResult | null> {
    const resolved = await this.resolvePath(chatId, path, false)
    if (!resolved) return null

    try {
      const fileHandle = await resolved.dirHandle.getFileHandle(resolved.fileName)
      const file = await fileHandle.getFile()
      const totalSize = file.size
      const start = Math.min(Math.max(0, offset), totalSize)
      const end = Math.min(start + Math.max(0, length), totalSize)
      const slice = file.slice(start, end)
      const arrayBuffer = await slice.arrayBuffer()
      const isTruncated = end < totalSize

      return {
        data: new Uint8Array(arrayBuffer),
        totalSize,
        isTruncated,
      }
    } catch {
      return null
    }
  }

  async deleteBytes(chatId: string, path: string): Promise<boolean> {
    const resolved = await this.resolvePath(chatId, path, false)
    if (!resolved) return false

    try {
      await resolved.dirHandle.removeEntry(resolved.fileName)
      return true
    } catch {
      return false
    }
  }

  async deleteChatFiles(chatId: string): Promise<void> {
    const root = await this.getRootDir()
    try {
      const chatsDir = await root.getDirectoryHandle('chats', { create: false })
      await chatsDir.removeEntry(chatId, { recursive: true })
    } catch {
      // Ignored if chat directory does not exist
    }
  }

  async hasFile(chatId: string, path: string): Promise<boolean> {
    const resolved = await this.resolvePath(chatId, path, false)
    if (!resolved) return false

    try {
      await resolved.dirHandle.getFileHandle(resolved.fileName)
      return true
    } catch {
      return false
    }
  }

  async getSize(chatId: string, path: string): Promise<number | null> {
    const resolved = await this.resolvePath(chatId, path, false)
    if (!resolved) return null

    try {
      const fileHandle = await resolved.dirHandle.getFileHandle(resolved.fileName)
      const file = await fileHandle.getFile()
      return file.size
    } catch {
      return null
    }
  }

  isDurable(): boolean {
    return true
  }

  getBackendType(): 'opfs' | 'memory' {
    return 'opfs'
  }
}
