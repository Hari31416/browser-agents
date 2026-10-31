// Phase 0 transport fixture. No user accounts or durable provider registry.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
export async function startRelay({ endpoint, model, key = '', port = 8765, timeoutMs = 15000 } = {}) {
  const token = randomUUID();
  const stats = { requests: 0, completed: 0, aborted: 0 };
  const origin = 'http://127.0.0.1:5173';
  const server = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
    if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': 'content-type,x-phase0-session', 'Access-Control-Allow-Methods': 'POST' }).end(); return;
    }
    if (req.method !== 'POST' || req.url !== '/chat' || req.headers['x-phase0-session'] !== token) {
      res.writeHead(403, cors).end(); return;
    }
    stats.requests++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let complete = false;
    res.on('close', () => { if (!complete) { stats.aborted++; controller.abort(); } });
    const fail = (status, code) => {
      if (res.destroyed) return;
      if (!res.headersSent) {
        res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: code }));
      } else {
        res.end(`data: ${JSON.stringify({ error: { message: code } })}\n\n`);
      }
    };
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 100000) { fail(413, 'request_too_large'); return; }
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      if (!Array.isArray(payload.messages)) { fail(400, 'invalid_messages'); return; }
      if (!endpoint || !model) { fail(503, 'provider_not_configured'); return; }
      const upstream = await fetch(endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ messages: payload.messages, tools: payload.tools, model, stream: true }),
      });
      if (!upstream.ok) { await upstream.body?.cancel(); fail(upstream.status === 401 || upstream.status === 403 ? 401 : 502, 'upstream_http_error'); return; }
      if (!upstream.headers.get('content-type')?.includes('text/event-stream')) {
        await upstream.body?.cancel(); fail(502, 'expected_event_stream'); return;
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      for await (const chunk of upstream.body) {
        if (controller.signal.aborted || res.destroyed) break;
        if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve); });
      }
      complete = !controller.signal.aborted;
      if (complete) stats.completed++;
      res.end();
    } catch (error) {
      fail(controller.signal.aborted ? 504 : error instanceof SyntaxError ? 400 : 502,
        controller.signal.aborted ? 'upstream_timeout_or_cancel' : 'relay_request_failed');
    } finally { clearTimeout(timer); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { token, stats, port: server.address().port, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
