import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startRelay } from './relay-core.mjs';
const base = process.env.OPENAI_BASE_URL;
const model = process.env.OPENAI_MODEL;
if (!base || !model) throw Error('Set OPENAI_BASE_URL and OPENAI_MODEL; OPENAI_API_KEY is optional for keyless endpoints');
const url = new URL(base);
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('Use HTTPS or an explicit loopback endpoint');
const endpoint = /\/chat\/completions\/?$/.test(url.pathname) ? url.href : url.href.replace(/\/$/, '') + '/chat/completions';
const relay = await startRelay({ endpoint, model, key: process.env.OPENAI_API_KEY ?? '', timeoutMs: 60000 });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:5173/isolated.html');
  const result = await page.evaluate(config => new Promise((resolve, reject) => {
    const worker = new Worker('/model-worker.mjs', {type:'module'});
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.onerror = event => { worker.terminate(); reject(Error(event.message)); };
    worker.postMessage({type:'run', config});
  }), { url: 'http://127.0.0.1:8765/chat', token: relay.token });
  assert.equal(result.ok, true);
  assert.ok(result.events.some(e => e.tool === 'write_todos'));
  assert.ok(result.events.some(e => e.tool === 'read_file'));
  assert.ok(result.events.some(e => e.tool === 'write_file'));
  assert.equal(result.files['/result.txt'], 'hello from browser workspace');
  const report = { browser: browser.version(), ok: true, tools: result.events.map(e => e.tool), planItems: result.plan.length, resultFile: 'Synthetic input copied exactly', relayRequests: relay.stats.requests };
  await mkdir('results', { recursive: true });
  await writeFile('results/provider.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await relay.close(); }
