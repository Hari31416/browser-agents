export interface BoundedReadBytesResult {
  data: Uint8Array
  totalSize: number
  isTruncated: boolean
}

export interface FileStore {
  writeBytes(chatId: string, path: string, data: Uint8Array): Promise<void>
  readBytes(chatId: string, path: string): Promise<Uint8Array | null>
  readBoundedBytes(
    chatId: string,
    path: string,
    offset: number,
    length: number,
  ): Promise<BoundedReadBytesResult | null>
  deleteBytes(chatId: string, path: string): Promise<boolean>
  deleteChatFiles(chatId: string): Promise<void>
  hasFile(chatId: string, path: string): Promise<boolean>
  getSize(chatId: string, path: string): Promise<number | null>
  isDurable(): boolean
  getBackendType(): 'opfs' | 'memory'
}
