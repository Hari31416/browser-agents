import { parseChatStream, type ParsedChatResult } from './relay-client.js'
import type { ChatRequest } from './types.js'

export function normalizeEndpoint(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS endpoint without embedded credentials, query, or fragment.')
  }
  return url.href.replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '')
}

/** OpenAI-compatible requests made by the trusted browser application. */
export class DirectClient {
  readonly baseUrl: string

  constructor(baseUrl: string, private readonly apiKey = '') {
    this.baseUrl = normalizeEndpoint(baseUrl)
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/${path}`, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
        headers: {
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...init?.headers,
        },
      })
    } catch (error) {
      if (init?.signal?.aborted) throw error
      throw new Error('Cannot reach the endpoint from this browser. Check the address, network, and CORS settings, or choose Local relay.')
    }
    if (!response.ok) {
      throw new Error(response.status === 401 || response.status === 403
        ? `Authentication failed (HTTP ${response.status}). Check your API key.`
        : `Endpoint returned HTTP ${response.status}. Check the base URL and model.`)
    }
    return response
  }

  async listModels(): Promise<string[]> {
    const response = await this.request('models')
    const json = await response.json()
    const items = Array.isArray(json) ? json : json.data
    if (!Array.isArray(items)) throw new Error('The models endpoint returned an unsupported response. Enter a model ID manually.')
    return items.map(item => typeof item === 'string' ? item : item?.id)
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).sort()
  }

  async streamChat(req: ChatRequest, options?: {
    signal?: AbortSignal
    onDelta?: (content: string) => void
  }): Promise<ParsedChatResult> {
    const response = await this.request('chat/completions', {
      method: 'POST',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model, messages: req.messages, tools: req.tools, stream: true }),
    })
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel()
      throw new Error('The endpoint did not return an SSE stream.')
    }
    return parseChatStream(response, options)
  }
}
