export class RuntimeError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'RuntimeError'
  }
}

export class ContextLimitExceededError extends RuntimeError {
  constructor(
    public readonly currentMessages: number,
    public readonly maxMessages: number,
  ) {
    super(
      `Context message limit exceeded (${currentMessages} > ${maxMessages}). Stop behavior triggered.`,
      'CONTEXT_LIMIT_EXCEEDED',
    )
    this.name = 'ContextLimitExceededError'
  }
}

export class ConcurrentRunError extends RuntimeError {
  constructor(public readonly chatId: string) {
    super(
      `A run is already in progress for chat '${chatId}'. Concurrent execution rejected.`,
      'CONCURRENT_RUN_REJECTED',
    )
    this.name = 'ConcurrentRunError'
  }
}

export class StepLimitExceededError extends RuntimeError {
  constructor(public readonly maxSteps: number) {
    super(
      `Execution stopped: maximum step limit (${maxSteps}) reached.`,
      'STEP_LIMIT_EXCEEDED',
    )
    this.name = 'StepLimitExceededError'
  }
}

export class ToolExecutionError extends RuntimeError {
  constructor(
    public readonly toolName: string,
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(`Tool '${toolName}' failed: ${message}`, 'TOOL_EXECUTION_ERROR')
    this.name = 'ToolExecutionError'
  }
}

export class RunCancelledError extends RuntimeError {
  constructor(message = 'The agent run was cancelled') {
    super(message, 'RUN_CANCELLED')
    this.name = 'RunCancelledError'
  }
}
