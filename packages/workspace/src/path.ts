import { InvalidPathError } from './errors.js'

export interface NormalizePathOptions {
  allowRoot?: boolean
}

export function normalizePath(rawPath: string, options?: NormalizePathOptions): string {
  if (typeof rawPath !== 'string') {
    throw new InvalidPathError('Path must be a string')
  }

  const trimmed = rawPath.trim()
  if (!trimmed) {
    if (options?.allowRoot) {
      return '/'
    }
    throw new InvalidPathError('Path cannot be empty')
  }

  // Reject null bytes and non-printable control characters
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new InvalidPathError('Path contains null bytes or control characters')
  }

  // Reject Windows drive letters (e.g., C:, D:)
  if (/^[a-zA-Z]:/.test(trimmed)) {
    throw new InvalidPathError('Windows drive letters are not permitted')
  }

  // Reject UNC paths (e.g., \\server\share)
  if (trimmed.startsWith('\\\\')) {
    throw new InvalidPathError('UNC paths are not permitted')
  }

  // Standardize backslashes to forward slashes
  const standardized = trimmed.replace(/\\/g, '/')

  const parts = standardized.split('/')
  const stack: string[] = []

  for (const part of parts) {
    if (!part || part === '.') {
      continue
    }
    if (part === '..') {
      if (stack.length === 0) {
        throw new InvalidPathError(`Path traversal not permitted: '${rawPath}' attempts to escape workspace root`)
      }
      stack.pop()
    } else {
      // Validate part characters (disallow invalid file characters if necessary)
      if (part.includes(':')) {
        throw new InvalidPathError(`Colon character not allowed in path segment: '${part}'`)
      }
      stack.push(part)
    }
  }

  if (stack.length === 0) {
    if (options?.allowRoot) {
      return '/'
    }
    throw new InvalidPathError(`Path '${rawPath}' resolves to workspace root`)
  }

  return stack.join('/')
}

export function getMimeType(path: string): string {
  const dotIndex = path.lastIndexOf('.')
  if (dotIndex === -1) {
    return 'application/octet-stream'
  }

  const ext = path.slice(dotIndex).toLowerCase()
  switch (ext) {
    case '.txt':
      return 'text/plain'
    case '.md':
      return 'text/markdown'
    case '.py':
      return 'text/x-python'
    case '.js':
    case '.mjs':
      return 'application/javascript'
    case '.ts':
      return 'application/typescript'
    case '.json':
      return 'application/json'
    case '.csv':
      return 'text/csv'
    case '.html':
    case '.htm':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    case '.pdf':
      return 'application/pdf'
    case '.zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}
