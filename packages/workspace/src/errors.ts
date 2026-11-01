export class WorkspaceError extends Error {
  constructor(message: string, public readonly code: string = 'WORKSPACE_ERROR') {
    super(message)
    this.name = 'WorkspaceError'
  }
}

export class InvalidPathError extends WorkspaceError {
  constructor(message: string) {
    super(message, 'INVALID_PATH')
    this.name = 'InvalidPathError'
  }
}

export class QuotaExceededError extends WorkspaceError {
  constructor(message: string, public readonly bytesNeeded?: number, public readonly quotaLimit?: number) {
    super(message, 'QUOTA_EXCEEDED')
    this.name = 'QuotaExceededError'
  }
}

export class StaleRevisionError extends WorkspaceError {
  constructor(message: string, public readonly expectedVersion?: number, public readonly actualVersion?: number) {
    super(message, 'STALE_REVISION')
    this.name = 'StaleRevisionError'
  }
}

export class NotFoundError extends WorkspaceError {
  constructor(message: string) {
    super(message, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class StorageUnavailableError extends WorkspaceError {
  constructor(message: string) {
    super(message, 'STORAGE_UNAVAILABLE')
    this.name = 'StorageUnavailableError'
  }
}

export class LockAcquisitionError extends WorkspaceError {
  constructor(message: string) {
    super(message, 'LOCK_ACQUISITION_FAILED')
    this.name = 'LockAcquisitionError'
  }
}
