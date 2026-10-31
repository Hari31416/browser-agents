import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startRelay } from './relay-core.mjs';
let mode = 'loop', aborts = 0;
const fixture = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  if (mode === 'auth') { res.writeHead(401).end('synthetic-secret-must-not-leak'); return; }
  if (mode === 'wrong-type') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders();
  if (mode === 'hang') {
    res.on('close', () => aborts++); return;
  }
  if (mode === 'malformed') { res.end('data: {invalid}\n\n'); return; }
  const count = payload.messages.filter(m => m.role === 'tool').length;
  const calls = [
    ['write_todos', { todos: ['Read input', 'Copy result'] }],
    ['read_file', { path: '/input.txt' }],
    ['write_file', { path: '/result.txt', content: 'hello from browser workspace' }],
  ];
  const events = [];
  if (calls[count]) {
    const [name, args] = calls[count]; const text = JSON.stringify(args);
    events.push({ tool_calls: [{ index: 0, id: `call${count}`, type: 'function', function: { name, arguments: text.slice(0, 4) } }] });
    events.push({ tool_calls: [{ index: 0, function: { arguments: text.slice(4) } }] });
  } else events.push({ content: 'copied ✓' });
  let stream = ': heartbeat\r\n\r\n';
  for (const delta of events) {
    const json = JSON.stringify({ choices: [{ delta }] });
    stream += `data: ${json.slice(0, 1)}\r\ndata: ${json.slice(1)}\r\n\r\n`;
  }
  if (mode !== 'truncated') stream += 'data: [DONE]\r\n\r\n';
  const bytes = Buffer.from(stream);
  for (let i = 0; i < bytes.length; i += 7) {
    if (res.destroyed) return;
    res.write(bytes.subarray(i, i + 7));
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  res.end();
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const relay = await startRelay({ endpoint: `http://127.0.0.1:${fixture.address().port}/chat`, model: 'fixture', key: 'synthetic-secret-must-not-leak', timeoutMs: 800 });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:5173/isolated.html');
  await page.evaluate(async config => { window.client = await import('/model-client.mjs'); window.config = config; }, { url: 'http://127.0.0.1:8765/chat', token: relay.token });
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/model-worker.mjs', {type:'module'});
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.onerror = event => { worker.terminate(); reject(Error(event.message)); };
    worker.postMessage({type:'run', config});
  }));
  assert.equal(result.ok, true); assert.equal(result.files['/result.txt'], 'hello from browser workspace');
  assert.deepEqual(result.events.map(e => e.tool), ['write_todos', 'read_file', 'write_file']);
  assert.equal(result.text, 'copied ✓');
  for (const [value, pattern] of [['auth', /HTTP 401/], ['wrong-type', /HTTP 502/], ['malformed', /JSON|Unexpected|property name/], ['truncated', /Truncated stream/]]) {
    mode = value;
    const error = await page.evaluate(() => client.completion({ ...config, messages: [{ role: 'user', content: 'synthetic' }] }).then(() => 'unexpected success', e => e.message));
    assert.match(error, pattern); assert.ok(!error.includes('synthetic-secret'));
  }
  mode = 'hang';
  const cancelled = await page.evaluate(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try { await client.completion({ ...config, messages: [], signal: controller.signal }); return 'unexpected success'; }
    catch (e) { return e.name; } finally { clearTimeout(timer); }
  });
  assert.equal(cancelled, 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(relay.stats.aborted >= 1); assert.ok(aborts >= 1);
  const timeout = await page.evaluate(() => client.completion({ ...config, messages: [] }).then(() => 'unexpected success', e => e.message));
  assert.match(timeout, /Upstream stream error|HTTP 504/);
  const forbidden = await fetch('http://127.0.0.1:8765/chat', { method: 'POST', headers: { Origin: 'null', 'X-Phase0-Session': relay.token } });
  assert.equal(forbidden.status, 403);
  const noToken = await fetch('http://127.0.0.1:8765/chat', { method: 'POST', headers: { Origin: 'http://127.0.0.1:5173' } });
  assert.equal(noToken.status, 403);
  await mkdir('results', { recursive: true });
  const report = { browser: browser.version(), checks: ['planning-file-loop', 'fragmented-utf8-CRLF-multiline-SSE', 'authentication-error-redaction', 'wrong-content-type', 'malformed-stream', 'truncated-stream', 'client-abort-upstream-propagation', 'timeout', 'origin-rejection', 'session-rejection'], relay: relay.stats };
  await writeFile('results/protocol.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close(); await relay.close();
  await new Promise(resolve => { fixture.close(resolve); fixture.closeAllConnections(); });
}
