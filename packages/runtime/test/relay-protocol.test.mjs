import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RelayClient } from '../dist/relay-client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '../../../backend')
const uvicornBin = path.join(backendDir, '.venv/bin/uvicorn')

const RELAY_PORT = 8766
const UPSTREAM_PORT = 8767

// Mock upstream OpenAI-compatible server
let upstreamStep = 0
const upstreamServer = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-discovered-model-a' }, { id: 'mock-discovered-model-b' }] }))
    return
  }

  if (req.method === 'GET' && req.url === '/v2/models') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Not Found' } }))
    return
  }

  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = ''
    for await (const chunk of req) body += chunk
    const payload = JSON.parse(body)

    if (payload.model === 'auth-fail-model') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }))
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    })

    if (payload.model === 'tool-call-model') {
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"write_todos","arguments":"{\\"todos\\":[]}"}}]}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    if (payload.model === 'slow-model') {
      res.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n')
      // Simulate delay for client abort
      await new Promise(r => setTimeout(r, 1000))
      res.write('data: {"choices":[{"delta":{"content":"end"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    // Normal fragmented stream
    res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
    await new Promise(r => setTimeout(r, 10))
    res.write('data: {"choices":[{"delta":{"content":" world!"}}]}\n\n')
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  res.writeHead(404).end()
})

await new Promise(resolve => upstreamServer.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

// Start FastAPI relay
const relayProcess = spawn(
  uvicornBin,
  ['relay.main:app', '--host', '127.0.0.1', '--port', String(RELAY_PORT)],
  {
    cwd: backendDir,
    env: { ...process.env, PYTHONPATH: 'src' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

try {
  // Wait for relay to be ready
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Relay server startup timed out')), 5000)
    const check = data => {
      if (data.toString().includes('Application startup complete')) {
        clearTimeout(timer)
        resolve()
      }
    }
    relayProcess.stdout?.on('data', check)
    relayProcess.stderr?.on('data', check)
    relayProcess.on('error', reject)
  })

  const client = new RelayClient(`http://127.0.0.1:${RELAY_PORT}`)

  // 1. Session creation
  const sessionToken = await client.createSession()
  assert.ok(sessionToken && sessionToken.length > 20)

  // 2. Register first provider with model discovery
  const prov1 = await client.registerProvider({
    base_url: `http://127.0.0.1:${UPSTREAM_PORT}/v1`,
    api_key: 'test-secret-key-1',
  })
  assert.equal(prov1.has_api_key, true)
  assert.deepEqual(prov1.discovered_models, ['mock-discovered-model-a', 'mock-discovered-model-b'])
  // Ensure secret API key is not leaked in returned record
  assert.equal('api_key' in prov1, false)

  // 3. Register a second base URL without changing runtime code (missing discovery fallback)
  const prov2 = await client.registerProvider({
    base_url: `http://127.0.0.1:${UPSTREAM_PORT}/v2`,
    models: ['manual-model-x', 'manual-model-y'],
  })
  assert.equal(prov2.has_api_key, false)
  assert.deepEqual(prov2.discovered_models, ['manual-model-x', 'manual-model-y'])

  // 4. Fragmented stream forwarding
  const streamResult = await client.streamChat({
    provider_id: prov1.provider_id,
    model: 'mock-discovered-model-a',
    messages: [{ role: 'user', content: 'test stream' }],
    stream: true,
  })
  assert.equal(streamResult.text, 'Hello world!')
  assert.equal(streamResult.calls.length, 0)

  // 5. Tool call stream forwarding
  const toolResult = await client.streamChat({
    provider_id: prov1.provider_id,
    model: 'tool-call-model',
    messages: [{ role: 'user', content: 'run tool' }],
    stream: true,
  })
  assert.equal(toolResult.calls.length, 1)
  assert.equal(toolResult.calls[0].name, 'write_todos')
  assert.equal(toolResult.calls[0].args, '{"todos":[]}')

  // 6. Upstream authentication error exposure without credential leakage
  await assert.rejects(
    async () => {
      await client.streamChat({
        provider_id: prov1.provider_id,
        model: 'auth-fail-model',
        messages: [{ role: 'user', content: 'fail auth' }],
      })
    },
    err => {
      assert.match(String(err), /401/)
      assert.ok(!String(err).includes('test-secret-key-1'))
      return true
    },
  )

  // 7. Cancellation handling
  const abortCtrl = new AbortController()
  const slowPromise = client.streamChat(
    {
      provider_id: prov1.provider_id,
      model: 'slow-model',
      messages: [{ role: 'user', content: 'slow' }],
    },
    { signal: abortCtrl.signal },
  )
  setTimeout(() => abortCtrl.abort(), 50)
  await assert.rejects(
    async () => {
      await slowPromise
    },
    err => {
      assert.match(String(err), /aborted|AbortError/i)
      return true
    },
  )

  // 8. Delete session and confirm credentials destroyed
  await client.deleteSession()
  await assert.rejects(async () => {
    await client.streamChat({
      provider_id: prov1.provider_id,
      model: 'mock-discovered-model-a',
      messages: [{ role: 'user', content: 'after delete' }],
    })
  })

  console.log('Relay protocol verification passed completely.')
} finally {
  relayProcess.kill('SIGTERM')
  await new Promise(r => upstreamServer.close(r))
}
