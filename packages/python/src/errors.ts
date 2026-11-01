export class PythonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PythonError'
  }
}

export class PythonExecutionError extends PythonError {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number

  constructor(message: string, stdout = '', stderr = '', exitCode = 1) {
    super(message)
    this.name = 'PythonExecutionError'
    this.stdout = stdout
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

export class PythonTimeoutError extends PythonError {
  readonly timeoutMs: number

  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Python execution exceeded timeout of ${timeoutMs}ms and was terminated`)
    this.name = 'PythonTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export class PythonCancelledError extends PythonError {
  constructor(message = 'Python execution was cancelled') {
    super(message)
    this.name = 'PythonCancelledError'
  }
}

export class PythonInitializationError extends PythonError {
  readonly causeError?: unknown

  constructor(message: string, causeError?: unknown) {
    super(message)
    this.name = 'PythonInitializationError'
    this.causeError = causeError
  }
}

export class PythonSecurityError extends PythonError {
  constructor(message: string) {
    super(message)
    this.name = 'PythonSecurityError'
  }
}

export class PythonStorageError extends PythonError {
  readonly causeError?: unknown

  constructor(message: string, causeError?: unknown) {
    super(message)
    this.name = 'PythonStorageError'
    this.causeError = causeError
  }
}
