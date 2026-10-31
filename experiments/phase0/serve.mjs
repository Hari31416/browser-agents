import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
let egress = 0;
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/egress-sentinel') { egress++; res.writeHead(200).end('network reached'); return; }
  if (path === '/__stats') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ egress })); return; }
  const file = resolve(root, path.startsWith('/runtime/') ? 'public' + path : '.' + (path === '/' ? '/isolated.html' : path));
  if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
}).listen(5173, '127.0.0.1', () => console.log('Phase 0 static fixture http://127.0.0.1:5173'));
