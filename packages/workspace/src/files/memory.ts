import type { BoundedReadBytesResult, FileStore } from './types.js'

export class MemoryFileStore implements FileStore {
  // Map key: `${chatId}:${path}` -> Uint8Array
  private storage = new Map<string, Uint8Array>()

  private makeKey(chatId: string, path: string): string {
    return `${chatId}:${path}`
  }

  async writeBytes(chatId: string, path: string, data: Uint8Array): Promise<void> {
    const copy = new Uint8Array(data.length)
    copy.set(data)
    this.storage.set(this.makeKey(chatId, path), copy)
  }

  async readBytes(chatId: string, path: string): Promise<Uint8Array | null> {
    const data = this.storage.get(this.makeKey(chatId, path))
    if (!data) return null
    const copy = new Uint8Array(data.length)
    copy.set(data)
    return copy
  }

  async readBoundedBytes(
    chatId: string,
    path: string,
    offset: number,
    length: number,
  ): Promise<BoundedReadBytesResult | null> {
    const data = this.storage.get(this.makeKey(chatId, path))
    if (!data) return null

    const totalSize = data.length
    const start = Math.min(Math.max(0, offset), totalSize)
    const end = Math.min(start + Math.max(0, length), totalSize)
    const slice = data.slice(start, end)
    const isTruncated = end < totalSize

    return {
      data: slice,
      totalSize,
      isTruncated,
    }
  }

  async deleteBytes(chatId: string, path: string): Promise<boolean> {
    return this.storage.delete(this.makeKey(chatId, path))
  }

  async deleteChatFiles(chatId: string): Promise<void> {
    const prefix = `${chatId}:`
    for (const key of Array.from(this.storage.keys())) {
      if (key.startsWith(prefix)) {
        this.storage.delete(key)
      }
    }
  }

  async hasFile(chatId: string, path: string): Promise<boolean> {
    return this.storage.has(this.makeKey(chatId, path))
  }

  async getSize(chatId: string, path: string): Promise<number | null> {
    const data = this.storage.get(this.makeKey(chatId, path))
    return data ? data.length : null
  }

  isDurable(): boolean {
    return false
  }

  getBackendType(): 'opfs' | 'memory' {
    return 'memory'
  }
}
