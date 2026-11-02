import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read .env if present
const envPath = resolve(process.cwd(), '.env')
let envContent = ''
try {
  envContent = readFileSync(envPath, 'utf8')
} catch {}

const env = {}
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq > 0) {
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim()
    env[k] = v
  }
}

const baseUrl = env.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL
const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY
const defaultModel = env.OPENAI_MODEL || process.env.OPENAI_MODEL || 'gemma-4-26B-A4B-it'

if (!baseUrl || !apiKey) {
  console.log(JSON.stringify({
    ok: false,
    skipped: true,
    reason: 'Credentials not configured in .env',
  }))
  process.exit(0)
}

console.log(`Connecting to provider at ${new URL(baseUrl).origin}... (credentials redacted)`)

// 1. List available models
const listRes = await fetch(`${baseUrl}/models`, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
})

if (!listRes.ok) {
  console.error(`Failed to list models: HTTP ${listRes.status}`)
  process.exit(1)
}

const listData = await listRes.json()
const modelIds = listData.data?.map(m => m.id) ?? []
console.log(`Discovered ${modelIds.length} models: ${modelIds.join(', ')}`)

// 2. Test chat completions and tool calls for selected models
const candidateModels = [defaultModel, ...modelIds.filter(m => m !== defaultModel)]
const results = []

const tools = [
  {
    type: 'function',
    function: {
      name: 'write_todos',
      description: 'Create or update the current plan and task status list',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                description: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['id', 'description', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write text content to a file at the given relative path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
]

for (const model of candidateModels.slice(0, 5)) {
  console.log(`\nTesting model: ${model}`)
  try {
    const payload = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an agent with planning and file tools. Always create a plan first using write_todos before taking actions.',
        },
        {
          role: 'user',
          content: 'Create a plan with 2 steps to analyze data, then write a file named /summary.txt with text "Hello World". Use your tools.',
        },
      ],
      tools,
      tool_choice: 'auto',
      stream: false,
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.log(`Model ${model} returned HTTP ${res.status}: ${errText.slice(0, 150)}`)
      results.push({ model, ok: false, error: `HTTP ${res.status}` })
      continue
    }

    const data = await res.json()
    const choice = data.choices?.[0]
    const toolCalls = choice?.message?.tool_calls ?? []
    console.log(`Model ${model} responded with ${toolCalls.length} tool calls:`)
    let validToolArgs = true
    const parsedCalls = []
    for (const tc of toolCalls) {
      console.log(`  - Tool: ${tc.function?.name}`)
      console.log(`    Arguments raw: ${tc.function?.arguments}`)
      try {
        const parsed = JSON.parse(tc.function?.arguments)
        parsedCalls.push({ name: tc.function?.name, parsed })
      } catch (err) {
        validToolArgs = false
        console.log(`    Arguments parse error: ${err.message}`)
      }
    }

    results.push({
      model,
      ok: validToolArgs && toolCalls.length > 0,
      toolCallsCount: toolCalls.length,
      toolNames: toolCalls.map(tc => tc.function?.name),
      validToolArgs,
      firstCall: parsedCalls[0],
    })
  } catch (err) {
    console.log(`Model ${model} threw error: ${err.message}`)
    results.push({ model, ok: false, error: err.message })
  }
}

console.log('\n--- Summary Results ---')
console.log(JSON.stringify(results, null, 2))
