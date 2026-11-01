export interface PythonExecutionOptions {
  timeoutMs?: number
  packages?: string[]
}

export interface PythonExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  artifacts?: Array<{
    path: string
    mimeType: string
    dataBase64: string
  }>
}

export interface PythonEnvironment {
  initialize(): Promise<void>
  runCode(code: string, options?: PythonExecutionOptions): Promise<PythonExecutionResult>
  terminate(): Promise<void>
}
