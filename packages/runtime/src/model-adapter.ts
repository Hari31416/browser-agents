import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatResult } from '@langchain/core/outputs'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import type { RelayClient } from './relay-client.js'
import { InvalidToolArgumentsError } from './relay-client.js'
import type { ChatMessage, RelayConnectionConfig } from './types.js'

export class RelayChatModel extends BaseChatModel {
  private readonly client: RelayClient
  private readonly config: RelayConnectionConfig
  private readonly tools: unknown[]

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

  async _generate(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<ChatResult> {
    const inputMessages: ChatMessage[] = messages.map(msg => {
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

    const workingHistory = [...inputMessages]
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
          { signal: options?.signal },
        )
        break
      } catch (err) {
        if (err instanceof InvalidToolArgumentsError && attempt < 2) {
          workingHistory.push({
            role: 'assistant',
            content: 'The proposed tool arguments could not be parsed as JSON. No tool was executed.',
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

    const aiMessage = new AIMessage({
      content: chatResult.text,
      tool_calls: chatResult.calls.map(call => ({
        id: call.id,
        name: call.name,
        args: JSON.parse(call.args),
        type: 'tool_call' as const,
      })),
    })

    return {
      generations: [
        {
          text: chatResult.text,
          message: aiMessage,
        },
      ],
    }
  }
}
