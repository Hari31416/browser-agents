export function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed, 'https://example.com')
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed
    }
    return null
  } catch {
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      return trimmed
    }
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type PreviewCategory = 'image' | 'text' | 'active_sandbox' | 'unsupported'

export function getPreviewCategory(mimeType: string, path: string): PreviewCategory {
  const lowerMime = mimeType.toLowerCase()
  const ext = path.split('.').pop()?.toLowerCase() ?? ''

  if (
    lowerMime === 'image/png' ||
    lowerMime === 'image/jpeg' ||
    lowerMime === 'image/webp' ||
    lowerMime === 'image/gif' ||
    ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
  ) {
    return 'image'
  }

  if (
    lowerMime === 'image/svg+xml' ||
    lowerMime === 'text/html' ||
    ['svg', 'html', 'htm'].includes(ext)
  ) {
    return 'active_sandbox'
  }

  if (
    lowerMime.startsWith('text/') ||
    lowerMime === 'application/json' ||
    lowerMime === 'application/xml' ||
    ['txt', 'csv', 'json', 'py', 'md', 'js', 'ts', 'yaml', 'yml'].includes(ext)
  ) {
    return 'text'
  }

  return 'unsupported'
}
