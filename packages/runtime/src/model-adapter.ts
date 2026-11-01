import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages'
import {
  ChatGenerationChunk,
  type ChatResult,
} from '@langchain/core/outputs'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import type { RelayClient } from './relay-client.js'
import { InvalidToolArgumentsError } from './relay-client.js'
import type { ChatMessage, RelayConnectionConfig } from './types.js'

class AsyncQueue<T> {
  private readonly items: T[] = []
  private readonly resolvers: Array<(result: IteratorResult<T>) => void> = []
  private isDone = false
  private error: unknown = null

  push(val: T): void {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!
      resolve({ value: val, done: false })
    } else {
      this.items.push(val)
    }
  }

  close(): void {
    this.isDone = true
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!
      resolve({ value: undefined as unknown as T, done: true })
    }
  }

  fail(err: unknown): void {
    this.error = err
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!
      resolve(Promise.reject(err) as unknown as IteratorResult<T>)
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.error) throw this.error
      if (this.items.length > 0) {
        yield this.items.shift()!
      } else if (this.isDone) {
        return
      } else {
        const next = await new Promise<IteratorResult<T>>(r => this.resolvers.push(r))
        if (next.done) return
        yield next.value
      }
    }
  }
}

export class RelayChatModel extends BaseChatModel {
  readonly client: RelayClient
  readonly config: RelayConnectionConfig
  readonly tools: unknown[]

  constructor(client: RelayClient, config: RelayConnectionConfig, tools: unknown[] = []) {
    super({})
    this.client = client
    this.config = config
    this.tools = tools
  }

  _llmType(): string {
    return 'browser-relay-chat-model'
  }

  bindTools(tools: unknown[]): RelayChatModel {
    const formatted = tools.map(t =>
      typeof t === 'object' && t !== null && 'schema' in t
        ? convertToOpenAITool(t as Parameters<typeof convertToOpenAITool>[0])
        : t,
    )
    return new RelayChatModel(this.client, this.config, formatted)
  }

  private convertMessages(messages: BaseMessage[]): ChatMessage[] {
    return messages.map(msg => {
      const type = msg._getType()
      if (type === 'tool') {
        return {
          role: 'tool',
          tool_call_id: (msg as { tool_call_id?: string }).tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        }
      }
      if (type === 'ai') {
        const aiMsg = msg as AIMessage
        return {
          role: 'assistant',
          content: typeof aiMsg.content === 'string' ? aiMsg.content : null,
          ...(aiMsg.tool_calls?.length
            ? {
                tool_calls: aiMsg.tool_calls.map(c => ({
                  id: c.id ?? '',
                  type: 'function',
                  function: {
                    name: c.name,
                    arguments: JSON.stringify(c.args),
                  },
                })),
              }
            : {}),
        }
      }
      return {
        role: type === 'human' ? 'user' : (type as ChatMessage['role']),
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }
    })
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
    runManager?: { handleLLMNewToken?: (token: string) => Promise<void> | void },
  ): AsyncGenerator<ChatGenerationChunk> {
    const workingHistory = this.convertMessages(messages)
    const queue = new AsyncQueue<ChatGenerationChunk>()

    // Run the streaming request in background, pushing deltas to queue
    ;(async () => {
      try {
        let chatResult
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            chatResult = await this.client.streamChat(
              {
                provider_id: this.config.providerId,
                model: this.config.model,
                messages: workingHistory,
                tools: this.tools.length ? this.tools : undefined,
                stream: true,
              },
              {
                signal: options?.signal,
                onDelta: content => {
                  runManager?.handleLLMNewToken?.(content)
                  queue.push(
                    new ChatGenerationChunk({
                      text: content,
                      message: new AIMessageChunk({ content }),
                    }),
                  )
                },
              },
            )
            break
          } catch (err) {
            if (err instanceof InvalidToolArgumentsError && attempt < 2) {
              workingHistory.push({
                role: 'assistant',
                content:
                  'The proposed tool arguments could not be parsed as JSON. No tool was executed.',
              })
              workingHistory.push({
                role: 'user',
                content:
                  'Regenerate the call using valid JSON and plain text strings. Do not emit formatting tokens. Backslashes may only introduce legal JSON escapes.',
              })
              continue
            }
            throw err
          }
        }

        if (!chatResult) {
          throw new Error('Failed to obtain chat generation after retry attempts')
        }

        // Emit complete tool calls if any
        if (chatResult.calls.length > 0) {
          const toolChunks = chatResult.calls.map((call, idx) => ({
            name: call.name,
            args: call.args,
            id: call.id,
            index: idx,
            type: 'tool_call_chunk' as const,
          }))

          queue.push(
            new ChatGenerationChunk({
              text: '',
              message: new AIMessageChunk({
                content: '',
                tool_call_chunks: toolChunks,
              }),
            }),
          )
        }

        queue.close()
      } catch (err) {
        queue.fail(err)
      }
    })()

    for await (const chunk of queue) {
      yield chunk
    }
  }

  async _generate(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<ChatResult> {
    let fullText = ''
    const toolCallChunks: Array<{
      name?: string
      args?: string
      id?: string
      index?: number
    }> = []

    for await (const chunk of this._streamResponseChunks(messages, options)) {
      if (chunk.text) {
        fullText += chunk.text
      }
      const msgChunk = chunk.message as AIMessageChunk
      if (msgChunk.tool_call_chunks) {
        for (const tc of msgChunk.tool_call_chunks) {
          const idx = tc.index ?? 0
          const existing = (toolCallChunks[idx] ??= {})
          if (tc.name) existing.name = (existing.name ?? '') + tc.name
          if (tc.args) existing.args = (existing.args ?? '') + tc.args
          if (tc.id) existing.id = (existing.id ?? '') + tc.id
        }
      }
    }

    const toolCalls = toolCallChunks
      .filter(tc => tc.name && tc.id)
      .map(tc => ({
        id: tc.id!,
        name: tc.name!,
        args: JSON.parse(tc.args || '{}'),
        type: 'tool_call' as const,
      }))

    const aiMessage = new AIMessage({
      content: fullText,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    })

    return {
      generations: [
        {
          text: fullText,
          message: aiMessage,
        },
      ],
    }
  }
}

// ---------------------------------------------------------------------------
// ScriptedChatModel for Deterministic Verification and Testing
// ---------------------------------------------------------------------------

export interface ScriptedTurn {
  text?: string
  tokens?: string[]
  toolCalls?: Array<{
    name: string
    args: Record<string, unknown> | string
    id?: string
  }>
  delayMs?: number
  malformedArguments?: boolean
  error?: string
}

export class ScriptedChatModel extends BaseChatModel {
  readonly boundToolNames: string[] = []
  private readonly turns: ScriptedTurn[]
  private readonly state: { turnIndex: number; calls: number }
  observedMessages: BaseMessage[][] = []

  constructor(turns: ScriptedTurn[] = [], state = { turnIndex: 0, calls: 0 }) {
    super({})
    this.turns = turns
    this.state = state
  }

  get turnIndex(): number {
    return this.state.turnIndex
  }

  set turnIndex(val: number) {
    this.state.turnIndex = val
  }

  get observedCalls(): number {
    return this.state.calls
  }

  _llmType(): string {
    return 'scripted-chat-model'
  }

  bindTools(tools: unknown[]): ScriptedChatModel {
    const bound = new ScriptedChatModel(this.turns, this.state)
    bound.observedMessages = this.observedMessages
    for (const t of tools) {
      const name =
        typeof t === 'object' && t !== null && 'name' in t
          ? String((t as { name: string }).name)
          : undefined
      if (name) bound.boundToolNames.push(name)
    }
    return bound
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
    runManager?: { handleLLMNewToken?: (token: string) => Promise<void> | void },
  ): AsyncGenerator<ChatGenerationChunk> {
    this.observedMessages.push([...messages])
    this.state.calls++

    if (this.state.turnIndex >= this.turns.length) {
      yield new ChatGenerationChunk({
        text: 'Completed',
        message: new AIMessageChunk({ content: 'Completed' }),
      })
      return
    }

    const turn = this.turns[this.state.turnIndex++]

    if (turn.delayMs && turn.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          options?.signal?.removeEventListener('abort', onAbort)
          resolve()
        }, turn.delayMs)

        const onAbort = () => {
          clearTimeout(timer)
          reject(new DOMException('Model call aborted', 'AbortError'))
        }

        if (options?.signal?.aborted) {
          onAbort()
        } else {
          options?.signal?.addEventListener('abort', onAbort, { once: true })
        }
      })
    }

    if (options?.signal?.aborted) {
      throw new DOMException('Model call aborted', 'AbortError')
    }

    if (turn.error) {
      throw new Error(turn.error)
    }

    if (turn.malformedArguments) {
      throw new InvalidToolArgumentsError('Invalid JSON in tool call arguments')
    }

    // Stream text tokens if provided
    if (turn.tokens && turn.tokens.length > 0) {
      for (const token of turn.tokens) {
        await runManager?.handleLLMNewToken?.(token)
        yield new ChatGenerationChunk({
          text: token,
          message: new AIMessageChunk({ content: token }),
        })
      }
    } else if (turn.text) {
      await runManager?.handleLLMNewToken?.(turn.text)
      yield new ChatGenerationChunk({
        text: turn.text,
        message: new AIMessageChunk({ content: turn.text }),
      })
    }

    // Stream tool call chunks if any
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      const toolCallChunks = turn.toolCalls.map((tc, idx) => ({
        name: tc.name,
        args: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args),
        id: tc.id || `call_${idx + 1}`,
        index: idx,
        type: 'tool_call_chunk' as const,
      }))

      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_call_chunks: toolCallChunks,
        }),
      })
    }
  }

  async _generate(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<ChatResult> {
    let fullText = ''
    const toolCallChunks: Array<{
      name?: string
      args?: string
      id?: string
      index?: number
    }> = []

    for await (const chunk of this._streamResponseChunks(messages, options)) {
      if (chunk.text) {
        fullText += chunk.text
      }
      const msgChunk = chunk.message as AIMessageChunk
      if (msgChunk.tool_call_chunks) {
        for (const tc of msgChunk.tool_call_chunks) {
          const idx = tc.index ?? 0
          const existing = (toolCallChunks[idx] ??= {})
          if (tc.name) existing.name = (existing.name ?? '') + tc.name
          if (tc.args) existing.args = (existing.args ?? '') + tc.args
          if (tc.id) existing.id = (existing.id ?? '') + tc.id
        }
      }
    }

    const toolCalls = toolCallChunks
      .filter(tc => tc.name && tc.id)
      .map(tc => ({
        id: tc.id!,
        name: tc.name!,
        args: JSON.parse(tc.args || '{}'),
        type: 'tool_call' as const,
      }))

    const aiMessage = new AIMessage({
      content: fullText,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    })

    return {
      generations: [
        {
          text: fullText,
          message: aiMessage,
        },
      ],
    }
  }
}
