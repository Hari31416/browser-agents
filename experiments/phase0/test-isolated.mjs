import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const timer = setTimeout(() => browser.close(), 120000);
const samples = [];
try {
  for (let sample = 0; sample < 3; sample++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5173/isolated.html');
    await page.waitForFunction(() => window.phase0);
    const ready = await page.evaluate(async () => {
      const start = performance.now();
      window.bundle = await phase0.loadAssets();
      const assetsMs = performance.now() - start;
      window.session = await phase0.createSession(bundle.assets);
      localStorage.setItem('phase0-fake-provider-key', 'synthetic-secret');
      return { ...session.ready, assetsMs: Math.round(assetsMs), totalMs: Math.round(performance.now() - start),
        assetBytes: bundle.manifest.assets.reduce((n, a) => n + a.bytes, 0) };
    });
    assert.equal(ready.ok, true);
    for (const stage of [ready.before, ready.after]) {
      for (const name of ['relay', 'loopback', 'external']) assert.equal(stage[name], 'TypeError');
      assert.equal(stage.indexedDB, 'SecurityError');
      assert.equal(stage.localStorage, 'undefined');
      assert.equal(stage.parent, 'undefined');
      assert.equal(stage.webrtc, 'undefined');
      assert.equal(stage.origin, 'null');
    }
    samples.push({ assetsMs: ready.assetsMs, readyMs: ready.readyMs, totalMs: ready.totalMs, assetBytes: ready.assetBytes,
      wasmCapacityBytes: ready.wasmBytes, versions: ready.versions });
    if (sample > 0) { await page.evaluate(() => session.close()); await context.close(); continue; }

    const analysis = await page.evaluate(() => session.run(`import numpy as np, pandas as pd, matplotlib
matplotlib.use('agg')
import matplotlib.pyplot as plt
df = pd.read_csv('input.csv')
mean = float(np.mean(df['y']))
open('result.txt', 'w').write(f'mean={mean}')
df.plot(x='x', y='y')
plt.savefig('chart.png')
print(f'mean={mean}')`, { '/input.csv': new TextEncoder().encode('x,y\n1,2\n2,4\n3,6\n') }));
    assert.equal(analysis.ok, true, analysis.error);
    assert.equal(new TextDecoder().decode(analysis.files['/result.txt']), 'mean=4.0');
    assert.deepEqual([...analysis.files['/chart.png'].slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    samples[0].analysisWasmCapacityBytes = analysis.wasmBytes;
    samples[0].pngBytes = analysis.files['/chart.png'].length;
    await page.evaluate(async files => {
      const root = await navigator.storage.getDirectory();
      const file = await root.getFileHandle('phase0-persisted-result.txt', { create: true });
      const writer = await file.createWritable(); await writer.write(files['/result.txt']); await writer.close();
    }, analysis.files);

    const attacks = await page.evaluate(() => session.run(String.raw`import json
from pyodide.http import pyfetch
from js import fetch, Function
results = {}
for name, request in [('python_http', pyfetch), ('js_fetch', fetch)]:
    try:
        await request('http://127.0.0.1:5173/egress-sentinel')
        results[name] = 'ALLOWED'
    except Exception:
        results[name] = 'blocked'
js_probes = Function('return (async () => {\n' + '''
const out = {};
const url = 'http://127.0.0.1:5173/egress-sentinel';
for (const [name, fn] of Object.entries({
 nativeFetch: () => globalThis.fetch(url),
 xhr: () => new Promise((resolve, reject) => { const x = new XMLHttpRequest(); x.open('GET', url); x.onload = resolve; x.onerror = reject; x.send(); }),
 websocket: () => new Promise((resolve, reject) => { const s = new WebSocket('ws://127.0.0.1:5173/egress-sentinel'); s.onopen = () => { s.close(); resolve(); }; s.onerror = reject; }),
 webtransport: () => new WebTransport('https://example.com/egress-sentinel').ready,
 eventsource: () => new Promise((resolve, reject) => { const s = new EventSource(url); s.onopen = () => { s.close(); resolve(); }; s.onerror = () => { s.close(); reject(); }; }),
 scriptImport: () => import('http://127.0.0.1:5173/egress-sentinel'),
 remoteWorker: () => new Promise((resolve, reject) => { const w = new Worker(url); w.onmessage = resolve; w.onerror = reject; }),
 nestedWorker: () => new Promise((resolve, reject) => { const w = new Worker(URL.createObjectURL(new Blob(["fetch('http://127.0.0.1:5173/egress-sentinel').then(()=>postMessage('ALLOWED')).catch(()=>postMessage('blocked'))"], {type:'text/javascript'}))); w.onmessage = e => {w.terminate(); e.data === 'blocked' ? reject() : resolve();}; w.onerror = reject; }),
 indexedDB: () => indexedDB.open('trusted-credentials'),
 relay: () => fetch('http://127.0.0.1:8765/chat', {method:'POST', body:'test'}),
 storageDirectory: () => navigator.storage.getDirectory(),
})) {
 try { await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject('timeout'), 1000))]); out[name] = 'ALLOWED'; }
 catch (error) { out[name] = error === 'timeout' ? 'timeout' : 'blocked'; }
}
out.parent = typeof parent;
out.localStorage = typeof localStorage;
return JSON.stringify(out);
''' + '\n})()')
results['javascript'] = json.loads(await js_probes())
print(json.dumps(results))`));
    assert.equal(attacks.ok, true, attacks.error);
    const outcomes = JSON.parse(attacks.stdout);
    assert.equal(outcomes.python_http, 'blocked'); assert.equal(outcomes.js_fetch, 'blocked');
    for (const [name, value] of Object.entries(outcomes.javascript)) {
      assert.equal(value, ['parent', 'localStorage'].includes(name) ? 'undefined' : 'blocked', name);
    }
    assert.equal((await (await fetch('http://127.0.0.1:5173/__stats')).json()).egress, 0);

    const separation = await page.evaluate(async () => {
      const other = await phase0.createSession(bundle.assets);
      const b = await other.run("open('other-chat.txt', 'w').write('private chat B'); chat_b_variable=42");
      const a = await session.run("import os; print(os.path.exists('/workspace/other-chat.txt')); print('chat_b_variable' in globals())");
      await other.close();
      return { a, b };
    });
    assert.equal(separation.b.ok, true); assert.equal(separation.a.stdout, 'False\nFalse\n');
    const maliciousOutput = await page.evaluate(async () => {
      const attacker = await phase0.createSession(bundle.assets);
      await attacker.run("from js import Function; Function(\"globalThis.onmessage = e => postMessage({id:e.data.id,type:'result',ok:true,files:{'/../outside':new Uint8Array([1])}})\")()");
      const outcome = await attacker.run('pass').then(() => 'unexpected success', error => error.message);
      await attacker.close(); return outcome;
    });
    assert.equal(maliciousOutput, 'Invalid execution output');
    const invalid = await page.evaluate(() => session.run('pass', { '/../outside.txt': new Uint8Array([1]) }));
    assert.equal(invalid.ok, false);
    const error = await page.evaluate(() => session.run("raise ValueError('synthetic failure')"));
    assert.equal(error.ok, false); assert.match(error.error, /synthetic failure/);

    const browserCdp = await browser.newBrowserCDPSession();
    const processes = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
    const ids = processes.map(p => String(p.id));
    const rss = execFileSync('/bin/ps', ['-o', 'rss=', '-p', ids.join(',')], { encoding: 'utf8' });
    samples[0].browserProcessesRssKiBSum = rss.trim().split(/\s+/).reduce((n, v) => n + Number(v), 0);
    await browserCdp.detach();

    const cancellation = await page.evaluate(async () => {
      let ticks = 0;
      const heartbeat = setInterval(() => ticks++, 10);
      const pending = session.run('while True:\n    pass').then(() => 'unexpected completion', e => e.message);
      await new Promise(resolve => setTimeout(resolve, 200));
      const started = performance.now(); await session.close();
      const reason = await pending;
      clearInterval(heartbeat);
      return { ticks, reason, closeMs: Math.round(performance.now() - started) };
    });
    assert.ok(cancellation.ticks > 0); assert.equal(cancellation.reason, 'Execution cancelled');
    samples[0].cancelMs = cancellation.closeMs;
    samples[0].networkProbeOutcomes = outcomes;
    await page.reload(); await page.waitForFunction(() => window.phase0);
    const recovery = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const stored = await (await root.getFileHandle('phase0-persisted-result.txt')).getFile();
      const { assets } = await phase0.loadAssets();
      const next = await phase0.createSession(assets);
      const fresh = await next.run("print('df' in globals()); print('chat_b_variable' in globals())");
      await next.close(); return { text: await stored.text(), fresh };
    });
    assert.equal(recovery.text, 'mean=4.0'); assert.equal(recovery.fresh.stdout, 'False\nFalse\n');
    samples[0].checks = ['analysis', 'png', 'startup-denial', 'python-and-js-egress', 'nested-worker', 'opaque-storage', 'cross-chat', 'hostile-output-validation', 'paths', 'errors', 'infinite-loop-cancel', 'OPFS-reopen', 'fresh-interpreter'];
    await context.close();
  }
  const result = { browser: browser.version(), measurement: 'Fresh browser contexts; local pinned assets on warm filesystem; not CDN/download cold-start or unique resident memory.', samples };
  await mkdir('results', { recursive: true });
  await writeFile('results/isolated.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { clearTimeout(timer); await browser.close(); }
