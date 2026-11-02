import type {
  ChatRequest,
  CreateSessionResponse,
  ModelDiscoveryResponse,
  ProviderRegisterRequest,
  ProviderResponse,
  ToolCallAccumulator,
  ToolCallDelta,
} from './types.js'

export interface ParsedChatResult {
  text: string
  calls: ToolCallAccumulator[]
}

export class InvalidToolArgumentsError extends SyntaxError {
  invalidToolArguments = true
  constructor(message: string) {
    super(message)
    this.name = 'InvalidToolArgumentsError'
  }
}

export class RelayClient {
  constructor(
    private readonly baseUrl: string = 'http://127.0.0.1:8765',
    private sessionToken?: string,
  ) {}

  setSessionToken(token: string): void {
    this.sessionToken = token
  }

  getSessionToken(): string | undefined {
    return this.sessionToken
  }

  async createSession(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(`Failed to create relay session: HTTP ${res.status}`)
    }
    const data = (await res.json()) as CreateSessionResponse
    this.sessionToken = data.session_token
    return data.session_token
  }

  async deleteSession(): Promise<void> {
    if (!this.sessionToken) return
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: {
        'X-Relay-Session': this.sessionToken,
      },
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete session: HTTP ${res.status}`)
    }
    this.sessionToken = undefined
  }

  async registerProvider(req: ProviderRegisterRequest): Promise<ProviderResponse> {
    if (!this.sessionToken) {
      throw new Error('Session token not set. Call createSession first.')
    }
    const res = await fetch(`${this.baseUrl}/api/providers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Session': this.sessionToken,
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
      throw new Error(err.detail || `Provider registration failed: HTTP ${res.status}`)
    }
    return (await res.json()) as ProviderResponse
  }

  async listModels(providerId: string): Promise<string[]> {
    if (!this.sessionToken) {
      throw new Error('Session token not set')
    }
    const res = await fetch(`${this.baseUrl}/api/providers/${providerId}/models`, {
      method: 'GET',
      headers: {
        'X-Relay-Session': this.sessionToken,
      },
    })
    if (!res.ok) {
      return []
    }
    const data = (await res.json()) as ModelDiscoveryResponse
    return data.models
  }

  async deleteProvider(providerId: string): Promise<void> {
    if (!this.sessionToken) return
    const res = await fetch(`${this.baseUrl}/api/providers/${providerId}`, {
      method: 'DELETE',
      headers: {
        'X-Relay-Session': this.sessionToken,
      },
    })
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete provider: HTTP ${res.status}`)
    }
  }

  async streamChat(
    req: ChatRequest,
    options?: {
      signal?: AbortSignal
      onDelta?: (content: string) => void
    },
  ): Promise<ParsedChatResult> {
    if (!this.sessionToken) {
      throw new Error('Session token not set')
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Session': this.sessionToken,
      },
      body: JSON.stringify(req),
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      const detail = errorBody?.message || errorBody?.detail || `HTTP ${response.status}`
      throw new Error(`Relay error (${response.status}): ${detail}`)
    }

    if (!response.body) {
      throw new Error('Response body missing from relay stream')
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let text = ''
    let doneMarker = false
    let totalBytes = 0
    const calls: ToolCallAccumulator[] = []

    const parseEvent = (eventText: string): void => {
      const dataLines = eventText
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')

      if (!dataLines) return
      if (dataLines === '[DONE]') {
        doneMarker = true
        return
      }

      let chunk: {
        error?: { message?: string }
        choices?: Array<{
          delta?: {
            content?: string
            tool_calls?: ToolCallDelta[]
          }
        }>
      }

      try {
        chunk = JSON.parse(dataLines)
      } catch (err) {
        throw new SyntaxError(`Invalid SSE JSON chunk: ${String(err)}`)
      }

      if (chunk.error) {
        throw new Error(`Upstream stream error: ${chunk.error.message || 'unknown'}`)
      }

      const delta = chunk.choices?.[0]?.delta
      if (!delta) return

      if (delta.content) {
        text += delta.content
        options?.onDelta?.(delta.content)
      }

      for (const part of delta.tool_calls ?? []) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index > 20) {
          throw new Error('Invalid tool call index')
        }
        const call = (calls[part.index] ??= { id: '', name: '', args: '' })
        if (part.id) call.id += part.id
        if (part.function?.name) call.name += part.function.name
        if (part.function?.arguments) call.args += part.function.arguments
      }
    }

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        totalBytes += value.length
        if (totalBytes > 2_000_000) {
          throw new Error('Stream size limit exceeded (2MB)')
        }
        buffer += value
        let match: RegExpExecArray | null
        while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
          parseEvent(buffer.slice(0, match.index))
          buffer = buffer.slice(match.index + match[0].length)
        }
        if (doneMarker) break
      }

      if (buffer.trim() && !doneMarker) {
        parseEvent(buffer)
      }

      for (const call of calls) {
        if (!call || !call.id || !call.name) {
          throw new Error('Incomplete tool call received from upstream')
        }
        try {
          JSON.parse(call.args)
        } catch (err) {
          throw new InvalidToolArgumentsError(
            `Invalid JSON arguments for tool ${call.name}: ${String(err)} (raw args: ${JSON.stringify(call.args)})`,
          )
        }
      }

      return { text, calls }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}
