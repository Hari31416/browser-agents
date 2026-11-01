export interface WorkspaceFile {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
  mimeType: string
  size: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceStore {
  readFile(path: string): Promise<WorkspaceFile | null>
  writeFile(path: string, content: string, encoding?: 'utf-8' | 'base64'): Promise<void>
  deleteFile(path: string): Promise<boolean>
  listFiles(prefix?: string): Promise<WorkspaceFile[]>
  clear(): Promise<void>
}
