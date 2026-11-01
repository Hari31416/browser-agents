import { PythonSecurityError } from './errors.js'

/**
 * Validates a virtual workspace file path.
 * Must start with '/', contain only alphanumeric, dot, hyphen, underscore, and slash.
 * Must not contain directory traversal segments like '..' or '.'
 */
export function isValidExecutionPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) {
    return false
  }
  if (!path.startsWith('/')) {
    return false
  }
  if (path === '/' || path === '/.' || path === '/..') {
    return false
  }
  // No null bytes
  if (path.includes('\0')) {
    return false
  }
  // Check path segments
  const segments = path.split('/')
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    if (seg === '' || seg === '.' || seg === '..') {
      return false
    }
    // Must be safe characters
    if (!/^[\w.-]+$/.test(seg)) {
      return false
    }
  }
  return true
}

export interface OutputValidationLimits {
  maxFileCount?: number
  maxFileSizeBytes?: number
  maxTotalFilesBytes?: number
}

export const DEFAULT_EXECUTION_LIMITS: Required<OutputValidationLimits> = {
  maxFileCount: 100,
  maxFileSizeBytes: 5_000_000, // 5 MB
  maxTotalFilesBytes: 10_000_000, // 10 MB
}

/**
 * Validates untrusted output files returned from the Python execution worker.
 */
export function validateOutputFiles(
  files: unknown,
  limits: OutputValidationLimits = {},
): Record<string, Uint8Array> {
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    throw new PythonSecurityError('Output files payload must be an object')
  }

  const maxCount = limits.maxFileCount ?? DEFAULT_EXECUTION_LIMITS.maxFileCount
  const maxSingle = limits.maxFileSizeBytes ?? DEFAULT_EXECUTION_LIMITS.maxFileSizeBytes
  const maxTotal = limits.maxTotalFilesBytes ?? DEFAULT_EXECUTION_LIMITS.maxTotalFilesBytes

  const entries = Object.entries(files as Record<string, unknown>)
  if (entries.length > maxCount) {
    throw new PythonSecurityError(
      `Execution generated too many files: ${entries.length} exceeds limit of ${maxCount}`,
    )
  }

  let totalBytes = 0
  const validated: Record<string, Uint8Array> = {}

  for (const [rawPath, rawBytes] of entries) {
    if (!isValidExecutionPath(rawPath)) {
      throw new PythonSecurityError(`Invalid execution output path: '${rawPath}'`)
    }

    if (!(rawBytes instanceof Uint8Array)) {
      throw new PythonSecurityError(`Output file '${rawPath}' content must be a Uint8Array`)
    }

    if (rawBytes.byteLength > maxSingle) {
      throw new PythonSecurityError(
        `Output file '${rawPath}' exceeds single file limit (${rawBytes.byteLength} > ${maxSingle})`,
      )
    }

    totalBytes += rawBytes.byteLength
    if (totalBytes > maxTotal) {
      throw new PythonSecurityError(
        `Total output files size exceeds limit (${totalBytes} > ${maxTotal})`,
      )
    }

    validated[rawPath] = rawBytes
  }

  return validated
}
