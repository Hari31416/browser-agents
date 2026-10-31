// Runs in an opaque-origin module worker under inherited restrictive CSP.
let py;
let busy = false;
const post = globalThis.postMessage.bind(globalThis);
const safePath = path => typeof path === 'string' && /^\/[\w.-]+$/.test(path) && !['/.', '/..'].includes(path);
const probe = async () => {
  const result = {};
  for (const [name, url] of Object.entries({ relay: 'http://127.0.0.1:8765/chat', loopback: 'http://127.0.0.1:5173/egress-sentinel', external: 'https://example.com/egress-sentinel' })) {
    try { await fetch(url, { mode: 'no-cors' }); result[name] = 'allowed'; }
    catch (error) { result[name] = error.name; }
  }
  for (const name of ['indexedDB', 'caches']) {
    try {
      if (name === 'indexedDB') indexedDB.open('trusted-credentials');
      else await caches.open('trusted-credentials');
      result[name] = 'allowed';
    } catch (error) { result[name] = error.name; }
  }
  result.localStorage = typeof localStorage;
  result.parent = typeof parent;
  result.webrtc = typeof RTCPeerConnection;
  result.serviceWorker = typeof navigator.serviceWorker;
  result.origin = globalThis.origin;
  return result;
};
onmessage = async ({ data }) => {
  if (!data || typeof data.id !== 'string' || busy) return;
  busy = true;
  try {
    if (data.type === 'init') {
      const started = performance.now(); post({progress:'init received'});
      const before = await probe(); post({progress:'startup probes completed'});
      const urls = {};
      for (const [name, bytes] of Object.entries(data.assets)) {
        urls[name] = URL.createObjectURL(new Blob([bytes], { type: name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' }));
      }
      globalThis.importScripts = undefined;
      const { loadPyodide } = await import(urls['pyodide.mjs']);
      const { default: createModule } = await import(urls['pyodide.asm.mjs']);
      post({progress:'modules imported'});
      const lock = JSON.parse(new TextDecoder().decode(data.assets['pyodide-lock.json']));
      // Fixed offline asset resolver. CSP still denies every network URL.
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = (input, options) => {
        const url = typeof input === 'string' ? input : input.url ?? String(input);
        const prefix = 'https://blocked.invalid/';
        const file = url.startsWith(prefix) ? url.slice(prefix.length) : '';
        return nativeFetch(Object.hasOwn(urls, file) ? urls[file] : input, options);
      };
      py = await loadPyodide({
        indexURL: 'https://blocked.invalid/',
        packageBaseUrl: 'https://blocked.invalid/',
        lockFileContents: lock,
        stdLibURL: urls['python_stdlib.zip'],
        createPyodideModule: createModule,
        stdout: line => post({progress:line}), stderr: line => post({progress:line}),
      });
      post({progress:'interpreter ready'});
      await py.loadPackage(['numpy', 'pandas', 'matplotlib']);
      post({progress:'packages ready'});
      py.FS.mkdirTree('/workspace');
      py.FS.chdir('/workspace');
      const after = await probe();
      const versions = JSON.parse(py.runPython("import json, sys, numpy, pandas, matplotlib; json.dumps({'python':sys.version.split()[0], 'numpy':numpy.__version__, 'pandas':pandas.__version__, 'matplotlib':matplotlib.__version__})"));
      post({ id: data.id, type: 'result', ok: true, before, after, versions,
        readyMs: Math.round(performance.now() - started), wasmBytes: py._module.HEAPU8.buffer.byteLength });
    } else if (data.type === 'run' && py) {
      if (typeof data.code !== 'string' || data.code.length > 100_000) throw Error('Invalid code');
      for (const [name, bytes] of Object.entries(data.files ?? {})) {
        if (!safePath(name) || !(bytes instanceof Uint8Array) || bytes.length > 5_000_000) throw Error('Invalid file');
        py.FS.writeFile('/workspace' + name, bytes);
      }
      let stdout = '', stderr = '';
      const collect = which => line => {
        if (which === 'stdout') stdout = (stdout + line + '\n').slice(0, 64_000);
        else stderr = (stderr + line + '\n').slice(0, 64_000);
      };
      py.setStdout({ batched: collect('stdout') });
      py.setStderr({ batched: collect('stderr') });
      const value = await py.runPythonAsync(data.code);
      const files = {};
      for (const name of py.FS.readdir('/workspace')) {
        if (name === '.' || name === '..') continue;
        if (safePath('/' + name) && py.FS.isFile(py.FS.stat('/workspace/' + name).mode)) {
          const bytes = py.FS.readFile('/workspace/' + name);
          if (bytes.length > 5_000_000) throw Error('Output too large');
          files['/' + name] = bytes;
        }
      }
      value?.destroy?.();
      post({ id: data.id, type: 'result', ok: true, stdout, stderr, files,
        wasmBytes: py._module.HEAPU8.buffer.byteLength });
    } else throw Error('Unsupported request');
  } catch (error) {
    post({ id: data.id, type: 'result', ok: false, error: String(error).slice(0, 8000) });
  } finally { busy = false; }
};
