import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../../..')
const runtimeDir = resolve(repoRoot, 'apps/demo/public/runtime')

let egressCount = 0

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.whl': 'application/octet-stream',
  '.zip': 'application/zip',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = url.pathname

  if (pathname === '/egress-sentinel') {
    egressCount++
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('egress reached')
    return
  }

  if (pathname === '/__stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ egressCount }),
    )
    return
  }

  let filePath = null
  if (pathname === '/test-page.html') {
    filePath = join(testDir, 'test-page.html')
  } else if (pathname.startsWith('/runtime/')) {
    filePath = join(runtimeDir, pathname.slice('/runtime/'.length))
  } else if (pathname.startsWith('/packages/')) {
    filePath = join(repoRoot, pathname.slice(1))
  }

  if (!filePath) {
    res.writeHead(404).end('Not found')
    return
  }

  try {
    const bytes = await readFile(filePath)
    const ext = extname(filePath)
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(bytes)
  } catch (err) {
    res.writeHead(404).end('File not found')
  }
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

console.log(`Test fixture server listening at ${baseUrl}`)

const { chromium } = await import(
  join(repoRoot, 'experiments/phase0/node_modules/playwright/index.mjs')
)

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})

const timeout = setTimeout(async () => {
  console.error('Browser test timed out!')
  await browser.close()
  server.close()
  process.exit(1)
}, 120_000)

try {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${baseUrl}/test-page.html`)
  await page.waitForFunction(() => window.testPageReady)

  console.log('Test page loaded and ES modules imported.')

  // 1. Initialize PythonSession and verify diagnostics & isolation probes
  const bootResult = await page.evaluate(async (url) => {
    const { AssetLoader, PythonSessionImpl } = window.PythonModule;
    const loader = new AssetLoader(url + '/runtime');
    const assets = await loader.load();
    const session = new PythonSessionImpl('test-chat-1', { assets });
    await session.initialize();
    window.session1 = session;
    return {
      isReady: session.isReady,
      diagnostics: session.diagnostics,
    };
  }, baseUrl);

  assert.equal(bootResult.isReady, true);
  assert.ok(bootResult.diagnostics, 'Diagnostics must be present');
  assert.match(bootResult.diagnostics.python, /^3\.14/);
  assert.match(bootResult.diagnostics.numpy, /^2\./);
  assert.match(bootResult.diagnostics.pandas, /^3\./);
  assert.match(bootResult.diagnostics.matplotlib, /^3\./);

  for (const stage of [bootResult.diagnostics.beforeProbe, bootResult.diagnostics.afterProbe]) {
    assert.equal(stage.relay, 'TypeError');
    assert.equal(stage.loopback, 'TypeError');
    assert.equal(stage.external, 'TypeError');
    assert.equal(stage.indexedDB, 'SecurityError');
    assert.equal(stage.localStorage, 'undefined');
    assert.equal(stage.parent, 'undefined');
    assert.equal(stage.webrtc, 'undefined');
    assert.equal(stage.origin, 'null');
  }

  console.log('Session bootstrap, package versions, and isolation probes verified.');

  // 2. CSV analysis, NumPy, Pandas, and Matplotlib PNG chart generation
  const analysisResult = await page.evaluate(async () => {
    const code = `
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('input.csv')
mean_y = float(np.mean(df['y']))
total_y = float(np.sum(df['y']))

with open('result.txt', 'w') as f:
    f.write(f'mean={mean_y:.1f},total={total_y:.1f}')

plt.figure()
df.plot(x='x', y='y')
plt.title('Test Plot')
plt.savefig('chart.png')
plt.close()

print(f'Computed mean={mean_y}')
`;

    const inputFiles = {
      '/input.csv': new TextEncoder().encode('x,y\n1,10\n2,20\n3,30\n'),
    };

    // Use session run
    return await window.session1.run(code, {
      timeoutMs: 30_000,
      inputFiles, // Even without ChatWorkspace, session handles input files directly
    });
  });

  assert.equal(analysisResult.ok, true, analysisResult.error);
  assert.equal(analysisResult.exitCode, 0);
  assert.match(analysisResult.stdout, /Computed mean=20\.0/);

  // Check generated files
  assert.ok(analysisResult.files['/result.txt'], 'result.txt must exist');
  const resultText = new TextDecoder().decode(new Uint8Array(analysisResult.files['/result.txt']));
  assert.equal(resultText, 'mean=20.0,total=60.0');

  assert.ok(analysisResult.files['/chart.png'], 'chart.png must exist');
  const pngBytes = new Uint8Array(analysisResult.files['/chart.png']);
  assert.deepEqual(
    Array.from(pngBytes.slice(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
    'Must be valid PNG file',
  );

  // Check artifacts list
  const pngArtifact = analysisResult.artifacts.find(a => a.path === '/chart.png');
  assert.ok(pngArtifact, 'PNG artifact must be found');
  assert.equal(pngArtifact.mimeType, 'image/png');
  assert.ok(pngArtifact.dataBase64.length > 0);

  console.log('CSV analysis, pandas/numpy computation, and PNG chart generation verified.');

  // 3. Adversarial network & credential escape probes
  const attackResult = await page.evaluate(async (url) => {
    const code = `
import json
from pyodide.http import pyfetch
from js import fetch, Function

results = {}
for name, request in [('python_http', pyfetch), ('js_fetch', fetch)]:
    try:
        await request('${url}/egress-sentinel')
        results[name] = 'ALLOWED'
    except Exception:
        results[name] = 'blocked'

js_probes = Function('return (async () => {\\n' + '''
const out = {};
const target = '${url}/egress-sentinel';
for (const [name, fn] of Object.entries({
  nativeFetch: () => globalThis.fetch(target),
  xhr: () => new Promise((resolve, reject) => { const x = new XMLHttpRequest(); x.open('GET', target); x.onload = resolve; x.onerror = reject; x.send(); }),
  websocket: () => new Promise((resolve, reject) => { const s = new WebSocket('ws://127.0.0.1:5173/egress-sentinel'); s.onopen = () => { s.close(); resolve(); }; s.onerror = reject; }),
  webtransport: () => new WebTransport('https://example.com/egress-sentinel').ready,
  eventsource: () => new Promise((resolve, reject) => { const s = new EventSource(target); s.onopen = () => { s.close(); resolve(); }; s.onerror = () => { s.close(); reject(); }; }),
  scriptImport: () => import(target),
  remoteWorker: () => new Promise((resolve, reject) => { const w = new Worker(target); w.onmessage = resolve; w.onerror = reject; }),
  nestedWorker: () => new Promise((resolve, reject) => { const w = new Worker(URL.createObjectURL(new Blob(["fetch('${url}/egress-sentinel').then(()=>postMessage('ALLOWED')).catch(()=>postMessage('blocked'))"], {type:'text/javascript'}))); w.onmessage = e => {w.terminate(); e.data === 'blocked' ? reject() : resolve();}; w.onerror = reject; }),
  indexedDB: () => indexedDB.open('trusted-credentials'),
  relay: () => fetch('http://127.0.0.1:8765/chat', {method:'POST', body:'test'}),
  storageDirectory: () => navigator.storage.getDirectory(),
})) {
  try {
    await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject('timeout'), 1000))]);
    out[name] = 'ALLOWED';
  } catch (error) {
    out[name] = error === 'timeout' ? 'timeout' : 'blocked';
  }
}
out.parent = typeof parent;
out.localStorage = typeof localStorage;
return JSON.stringify(out);
''' + '\\n})()')

results['javascript'] = json.loads(await js_probes())
print(json.dumps(results))
`;
    return await window.session1.run(code);
  }, baseUrl);

  assert.equal(attackResult.ok, true);
  const outcomes = JSON.parse(attackResult.stdout);
  assert.equal(outcomes.python_http, 'blocked');
  assert.equal(outcomes.js_fetch, 'blocked');
  for (const [name, val] of Object.entries(outcomes.javascript)) {
    assert.equal(val, ['parent', 'localStorage'].includes(name) ? 'undefined' : 'blocked', name);
  }

  // Check host server sentinel stats
  assert.equal(egressCount, 0, 'Zero egress network requests must have reached the server');
  console.log('Network denial and credential isolation probes passed with 0 egress leaks.');

  // 4. Session variable persistence vs fresh session reset & cross-chat isolation
  const multiSessionResult = await page.evaluate(async (url) => {
    const { AssetLoader, PythonSessionManagerImpl } = window.PythonModule;
    const loader = new AssetLoader(url + '/runtime');
    const assets = await loader.load();
    const manager = new PythonSessionManagerImpl({ assets });

    const chatA = await manager.getSession('chat-A');
    const chatB = await manager.getSession('chat-B');

    // Run 1 in Chat A: set variable
    await chatA.run('chat_a_secret = 999');

    // Run in Chat B: verify chat_a_secret is NOT visible
    const resB = await chatB.run("print('chat_a_secret' in globals())");

    // Run 2 in Chat A: verify chat_a_secret is preserved
    const resA2 = await chatA.run('print(chat_a_secret)');

    // Reset Chat A
    await chatA.reset();

    // Run 3 in Chat A: verify variables are reset
    const resA3 = await chatA.run("print('chat_a_secret' in globals())");

    await manager.disposeAll();

    return {
      chatBVisible: resB.stdout.trim(),
      chatA2Output: resA2.stdout.trim(),
      chatA3Visible: resA3.stdout.trim(),
    };
  }, baseUrl);

  assert.equal(multiSessionResult.chatBVisible, 'False', 'Chat B must not see Chat A variables');
  assert.equal(multiSessionResult.chatA2Output, '999', 'Chat A must preserve variables across runs');
  assert.equal(multiSessionResult.chatA3Visible, 'False', 'Chat A reset must clear variables');

  console.log('Cross-chat isolation and variable reset verified.');

  // 4a. Workspace snapshots remove stale worker files but keep the interpreter alive
  const workspaceSnapshotResult = await page.evaluate(async (url) => {
    const { AssetLoader, PythonSessionImpl } = window.PythonModule;
    const { WorkspaceManager, MemoryFileStore, MemoryRecordStore, TabLockManager } = window.WorkspaceModule;
    const loader = new AssetLoader(url + '/runtime');
    const assets = await loader.load();
    const manager = new WorkspaceManager({
      fileStore: new MemoryFileStore(),
      recordStore: new MemoryRecordStore(),
      lockManager: new TabLockManager(),
    });
    const chat = await manager.createChat('snapshot cleanup');
    const workspace = manager.getWorkspace(chat.id);
    await workspace.writeFile('/nested/deep/stale.txt', 'remove this');
    await workspace.writeFile('/generated/stale.txt', 'remove this too');
    await workspace.writeFile('/swap', 'this file becomes a directory');
    await workspace.writeFile('/prevalidate.txt', 'must survive invalid input');
    const session = new PythonSessionImpl(chat.id, { assets, workspace });

    const invalidSnapshot = await session.run('pass', {
      inputFiles: { '/../invalid.txt': new TextEncoder().encode('bad') },
    });
    if (invalidSnapshot.ok) throw Error('Invalid incoming path unexpectedly succeeded');
    if ((await workspace.readFile('/prevalidate.txt'))?.content !== 'must survive invalid input') {
      throw Error('Invalid snapshot input deleted workspace data before validation');
    }

    const first = await session.run(`
import os
persistent_value = 42
open('generated/stale.txt', 'w').write('python output')
open('/tmp/keep-outside-workspace.txt', 'w').write('safe')
os.symlink('/tmp', 'workspace_link')
os.chdir('nested/deep')
`);
    if (!first.ok) throw Error(first.error);

    // Simulate UI edits between turns: delete nested files and replace a file with a directory.
    await workspace.deleteFile('/nested/deep/stale.txt');
    await workspace.deleteFile('/generated/stale.txt');
    await workspace.deleteFile('/swap');
    await workspace.writeFile('/swap/child.txt', 'child');
    const second = await session.run(`
import os
assert persistent_value == 42
assert open('/tmp/keep-outside-workspace.txt').read() == 'safe'
assert not os.path.exists('nested/deep/stale.txt')
assert not os.path.exists('generated/stale.txt')
assert os.path.isdir('swap')
assert open('swap/child.txt').read() == 'child'
`);
    if (!second.ok) throw Error(second.error);

    // Replace the directory with a file on the next authoritative snapshot.
    await workspace.deleteFile('/swap/child.txt');
    await workspace.writeFile('/swap', 'now a file');
    const third = await session.run(`
import os
assert persistent_value == 42
assert os.path.isfile('swap')
assert open('swap').read() == 'now a file'
assert not os.path.exists('swap/child.txt')
`);
    if (!third.ok) throw Error(third.error);

    const moveWorkspace = await session.run(`
import os
os.chdir('/')
open('/tmp/workspace-root-sentinel.txt', 'w').write('untouched')
os.rename('/workspace', '/tmp/moved-workspace-for-test')
os.symlink('/tmp', '/workspace')
`);
    if (!moveWorkspace.ok) throw Error(moveWorkspace.error);
    const resetRoot = await session.run(`
import os
assert os.getcwd() == '/workspace'
assert not os.path.islink('/workspace')
assert open('/tmp/workspace-root-sentinel.txt').read() == 'untouched'
assert os.path.isfile('/tmp/moved-workspace-for-test/swap')
`);
    if (!resetRoot.ok) throw Error(resetRoot.error);
    await session.terminate();
    return { first: first.ok, second: second.ok, third: third.ok, resetRoot: resetRoot.ok };
  }, baseUrl);
  assert.deepEqual(workspaceSnapshotResult, { first: true, second: true, third: true, resetRoot: true });
  console.log('Authoritative workspace snapshots remove nested stale files and support path replacements while preserving Python variables.');

  // Without a ChatWorkspace, inputFiles remain incremental and interpreter files survive.
  const incrementalInputResult = await page.evaluate(async (url) => {
    const { AssetLoader, PythonSessionImpl } = window.PythonModule;
    const loader = new AssetLoader(url + '/runtime');
    const assets = await loader.load();
    const session = new PythonSessionImpl('incremental-inputs', { assets });
    const first = await session.run('persistent_value = 7\nopen("created.txt", "w").write("kept")', {
      inputFiles: { '/seed.txt': new TextEncoder().encode('seed') },
    });
    if (!first.ok) throw Error(first.error);
    const second = await session.run(`
import os
assert persistent_value == 7
assert open('created.txt').read() == 'kept'
assert open('seed.txt').read() == 'seed'
assert open('later.txt').read() == 'later'
`, { inputFiles: { '/later.txt': new TextEncoder().encode('later') } });
    await session.terminate();
    return { ok: second.ok, error: second.error };
  }, baseUrl);
  assert.equal(incrementalInputResult.ok, true, incrementalInputResult.error);
  console.log('No-workspace Python input files remain incremental across runs.');

  // 5. Python exception reporting
  const exceptionResult = await page.evaluate(async () => {
    return await window.session1.run("raise ValueError('Specific test exception message')");
  });

  assert.equal(exceptionResult.ok, false);
  assert.equal(exceptionResult.exitCode, 1);
  assert.match(exceptionResult.error, /ValueError: Specific test exception message/);

  console.log('Python exceptions cleanly handled and reported without breaking host.');

  // 6. Infinite loop cancellation & worker termination
  const cancellationResult = await page.evaluate(async () => {
    let ticks = 0;
    const interval = setInterval(() => ticks++, 10);
    const runPromise = window.session1.run('while True:\n    pass').then(
      () => 'unexpected_success',
      err => err.name,
    );

    await new Promise(r => setTimeout(r, 200));
    await window.session1.terminate();

    const result = await runPromise;
    clearInterval(interval);
    return { ticks, result };
  });

  assert.ok(cancellationResult.ticks > 0, 'UI event loop must remain responsive');
  assert.equal(cancellationResult.result, 'PythonCancelledError');

  console.log('Infinite loop cancellation and worker termination verified.');

  // 7. Output bounding limit
  const excessiveOutputResult = await page.evaluate(async () => {
    // Re-initialize session after termination
    await window.session1.initialize();
    return await window.session1.run("print('A' * 200_000)", { maxOutputChars: 64_000 });
  });

  assert.equal(excessiveOutputResult.ok, true);
  assert.ok(excessiveOutputResult.stdout.length <= 64_005);

  console.log('Excessive output capping verified.');

  await context.close();
  console.log('All browser verification tests passed successfully!');
} finally {
  clearTimeout(timeout);
  await browser.close();
  server.close();
}
