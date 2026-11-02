import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ChatWorkspace,
  MemoryFileStore,
  MemoryRecordStore,
  TabLockManager,
  StagingManager,
} from '../packages/workspace/dist/index.js'
import {
  AgentRuntime,
  RelayClient,
  RelayChatModel,
  MockPythonExecutor,
} from '../packages/runtime/dist/index.js'

// Load .env
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
const modelName = process.argv[2] || env.OPENAI_MODEL || process.env.OPENAI_MODEL || 'gemma-4-26B-A4B-it'

if (!baseUrl || !apiKey) {
  console.log('Skipping real relay agent test: credentials not configured')
  process.exit(0)
}

console.log(`Starting real relay agent test with model: ${modelName} (credentials redacted)`)

// Origin header is needed for relay security
const client = new RelayClient('http://127.0.0.1:8765')

// Wrap fetch to include Origin header for relay origin check
const originalFetch = globalThis.fetch
globalThis.fetch = (url, init = {}) => {
  const headers = new Headers(init.headers || {})
  if (!headers.has('Origin')) {
    headers.set('Origin', 'http://127.0.0.1:5173')
  }
  return originalFetch(url, { ...init, headers })
}

const origStreamChat = client.streamChat.bind(client)
client.streamChat = async (req, options) => {
  try {
    const res = await origStreamChat(req, options)
    for (const call of res.calls) {
      console.log(`[RAW TOOL CALL] ${call.name} -> raw args:\n${call.args}`)
    }
    return res
  } catch (err) {
    console.log(`[STREAM CHAT ERROR]`, err.message)
    throw err
  }
}

const sessionToken = await client.createSession()
console.log('Created relay session successfully')

const provider = await client.registerProvider({
  name: 'olakrutrim',
  base_url: baseUrl,
  api_key: apiKey,
})
console.log(`Registered provider: ${provider.provider_id}`)

const models = await client.listModels(provider.provider_id)
console.log(`Discovered ${models.length} models through relay`)

const relayModel = new RelayChatModel(client, {
  providerId: provider.provider_id,
  model: modelName,
})

const fileStore = new MemoryFileStore()
const recordStore = new MemoryRecordStore()
const lockManager = new TabLockManager()
const stagingManager = new StagingManager()
const workspace = new ChatWorkspace(
  'chat-real-test',
  fileStore,
  recordStore,
  lockManager,
  stagingManager,
)

await recordStore.createChat({
  id: 'chat-real-test',
  title: 'Real Model Smoke Test',
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

let pythonCalls = 0
const pythonExecutor = new MockPythonExecutor(async (code) => {
  pythonCalls++
  console.log(`[Python Executor] Executed code:\n${code.trim()}`)
  return {
    ok: true,
    exitCode: 0,
    stdout: 'Calculation: 15 * 4 = 60\n',
    stderr: '',
    files: {
      '/result.txt': new TextEncoder().encode('Result: 60'),
    },
    artifacts: [],
  }
})

const events = []
const runtime = new AgentRuntime({
  chatId: 'chat-real-test',
  model: relayModel,
  workspace,
  pythonExecutor,
  recordStore,
  limits: {
    maxSteps: 25,
    timeoutMs: 120_000,
  },
  onEvent: (event) => {
    events.push(event.type)
    if (event.type === 'plan:update') {
      console.log(`[Event plan:update] ${event.todos.length} items:`, event.todos.map(t => `${t.id || '-'}: ${t.content || t.description} [${t.status}]`).join('; '))
    } else if (event.type === 'tool:start') {
      console.log(`[Event tool:start] ${event.name} (callId: ${event.callId})`)
    } else if (event.type === 'tool:result') {
      console.log(`[Event tool:result] ${event.name} -> output bytes: ${event.output?.length ?? 0}`)
    } else if (event.type === 'text:delta') {
      process.stdout.write(event.delta)
    }
  },
})

console.log('\n--- Running Agent ---')
const result = await runtime.run('First create a 2-step plan with write_todos to calculate 15 * 4. Then execute python code to compute 15 * 4. Finally mark the plan complete and explain the result to the user without calling any more tools.')

console.log('\n\n--- Run Complete ---')
console.log('Result ok:', result.ok)
console.log('Result error:', result.error)
console.log('Total steps:', result.summary?.steps)
console.log('Tools called:', result.summary.tools)
console.log('Events captured:', [...new Set(events)])

// Check if /result.txt was written to workspace
const resultFile = await workspace.readFile('/result.txt').catch(() => null)
console.log('Workspace /result.txt present:', resultFile !== null)
if (resultFile) {
  const text = typeof resultFile.content === 'string'
    ? resultFile.content
    : new TextDecoder().decode(resultFile.content)
  console.log('Workspace /result.txt content:', text)
}

await client.deleteSession()
console.log('Relay session cleaned up.')
