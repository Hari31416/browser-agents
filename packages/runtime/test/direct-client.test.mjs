import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { DirectClient, OpenAIChatModel, InvalidToolArgumentsError, normalizeEndpoint } from '../dist/index.js'
import { HumanMessage, ToolMessage } from '@langchain/core/messages'

const requests = []
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : null
  requests.push({ path: req.url, headers: req.headers, body })
  if (req.headers.authorization === 'Bearer invalid') { res.writeHead(401).end(); return }
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'fixture' }] })); return
  }
  res.setHeader('Content-Type', 'text/event-stream')
  const delta = body.model === 'malformed'
    ? { tool_calls: [{ index: 0, id: 'bad', function: { name: 'echo', arguments: '{bad' } }] }
    : body.messages.at(-1).role === 'tool'
      ? { content: 'Tool completed.' }
      : { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'echo', arguments: '{"text":"hello"}' } }] }
  const stream = `data: ${JSON.stringify({ choices: [{ delta }] })}\r\n\r\ndata: [DONE]\r\n\r\n`
  // Exercise parsing across chunk boundaries.
  res.write(stream.slice(0, 17))
  setTimeout(() => res.end(stream.slice(17)), 5)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/v1`
try {
  assert.equal(normalizeEndpoint(`${base}/chat/completions`), base)
  assert.throws(() => normalizeEndpoint('file:///tmp/key'))
  assert.throws(() => normalizeEndpoint('https://user:secret@example.com/v1'))
  const client = new DirectClient(`${base}/`, 'synthetic-key')
  assert.deepEqual(await client.listModels(), ['fixture'])
  const model = new OpenAIChatModel(client, { model: 'fixture', providerId: 'direct' })
    .bindTools([{ type: 'function', function: { name: 'echo', parameters: { type: 'object' } } }])
  const user = new HumanMessage('Use echo')
  const toolCall = await model.invoke([user])
  assert.equal(toolCall.tool_calls[0].name, 'echo')
  assert.deepEqual(toolCall.tool_calls[0].args, { text: 'hello' })
  const result = await model.invoke([user, toolCall, new ToolMessage({ content: 'hello', tool_call_id: 'call_1' })])
  assert.equal(result.content, 'Tool completed.')
  for (const request of requests) {
    assert.equal(request.headers.authorization, 'Bearer synthetic-key')
    assert.equal(request.headers['x-relay-session'], undefined)
    assert.ok(!JSON.stringify(request.body).includes('synthetic-key'))
    assert.ok(!request.body || !('provider_id' in request.body))
  }
  assert.ok(requests[1].body.tools.length)
  await assert.rejects(new DirectClient(base, 'invalid').listModels(), /Authentication failed/)
  await assert.rejects(client.streamChat({ provider_id: 'direct', model: 'malformed', messages: [] }), InvalidToolArgumentsError)
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(client.streamChat({ provider_id: 'direct', model: 'fixture', messages: [] }, { signal: aborted.signal }), { name: 'AbortError' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  try { await assert.rejects(client.listModels(), /CORS.*Local relay/) } finally { globalThis.fetch = originalFetch }
  console.log('Direct connection: discovery, auth, tool loop, fragmented SSE, malformed arguments, abort, and CORS guidance passed.')
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
