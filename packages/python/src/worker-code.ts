export const ISOLATED_WORKER_SCRIPT = `
let py;
let busy = false;
const post = globalThis.postMessage.bind(globalThis);

const safePath = path => {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 512) return false;
  const segments = path.split('/');
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i];
    if (!s || s === '.' || s === '..' || !/^[\\w.-]+$/.test(s)) return false;
  }
  return true;
};

const probe = async () => {
  const result = {};
  for (const [name, url] of Object.entries({
    relay: 'http://127.0.0.1:8765/chat',
    loopback: 'http://127.0.0.1:5173/egress-sentinel',
    external: 'https://example.com/egress-sentinel'
  })) {
    try {
      await fetch(url, { mode: 'no-cors' });
      result[name] = 'allowed';
    } catch (error) {
      result[name] = error.name;
    }
  }
  for (const name of ['indexedDB', 'caches']) {
    try {
      if (name === 'indexedDB') indexedDB.open('trusted-credentials');
      else await caches.open('trusted-credentials');
      result[name] = 'allowed';
    } catch (error) {
      result[name] = error.name;
    }
  }
  result.localStorage = typeof localStorage;
  result.parent = typeof parent;
  result.webrtc = typeof RTCPeerConnection;
  result.serviceWorker = typeof navigator.serviceWorker;
  result.origin = globalThis.origin;
  return result;
};

function readFilesRecursive(dir = '/workspace', prefix = '') {
  const files = {};
  const entries = py.FS.readdir(dir);
  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const fullPath = dir + '/' + name;
    const virtPath = prefix + '/' + name;
    const stat = py.FS.stat(fullPath);
    if (py.FS.isDir(stat.mode)) {
      Object.assign(files, readFilesRecursive(fullPath, virtPath));
    } else if (py.FS.isFile(stat.mode)) {
      if (!safePath(virtPath)) throw Error('Invalid file path in workspace: ' + virtPath);
      const bytes = py.FS.readFile(fullPath);
      if (bytes.length > 5_000_000) throw Error('Output file too large: ' + virtPath);
      files[virtPath] = bytes;
    }
  }
  return files;
}

function ensureParentDirs(path) {
  const parts = path.split('/').filter(Boolean);
  let cur = '/workspace';
  for (let i = 0; i < parts.length - 1; i++) {
    cur += '/' + parts[i];
    try {
      py.FS.mkdir(cur);
    } catch (e) {
      // Ignore if exists
    }
  }
}

onmessage = async ({ data }) => {
  if (!data || typeof data.id !== 'string' || busy) return;
  busy = true;
  let stdout = '';
  let stderr = '';

  try {
    if (data.type === 'init') {
      const started = performance.now();
      post({ progress: 'init received' });
      const before = await probe();
      post({ progress: 'startup probes completed' });

      const urls = {};
      for (const [name, bytes] of Object.entries(data.assets)) {
        urls[name] = URL.createObjectURL(
          new Blob([bytes], {
            type: name.endsWith('.mjs')
              ? 'text/javascript'
              : name.endsWith('.wasm')
              ? 'application/wasm'
              : 'application/octet-stream'
          })
        );
      }

      globalThis.importScripts = undefined;
      const { loadPyodide } = await import(urls['pyodide.mjs']);
      const { default: createModule } = await import(urls['pyodide.asm.mjs']);
      post({ progress: 'modules imported' });

      const lock = JSON.parse(new TextDecoder().decode(data.assets['pyodide-lock.json']));

      // Fixed offline asset resolver. CSP still denies all network URLs.
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
        stdout: line => {
          stdout = (stdout + line + '\\n').slice(0, 64_000);
          post({ progress: line });
        },
        stderr: line => {
          stderr = (stderr + line + '\\n').slice(0, 64_000);
          post({ progress: line });
        }
      });
      post({ progress: 'interpreter ready' });

      await py.loadPackage(['numpy', 'pandas', 'matplotlib']);
      post({ progress: 'packages ready' });

      // Configure matplotlib non-interactive backend
      py.runPython("import matplotlib; matplotlib.use('Agg', force=True)");

      try {
        py.FS.mkdirTree('/workspace');
      } catch {}
      py.FS.chdir('/workspace');

      const after = await probe();
      const versions = JSON.parse(
        py.runPython(
          "import json, sys, numpy, pandas, matplotlib; json.dumps({'python':sys.version.split()[0], 'numpy':numpy.__version__, 'pandas':pandas.__version__, 'matplotlib':matplotlib.__version__})"
        )
      );

      post({
        id: data.id,
        type: 'result',
        ok: true,
        before,
        after,
        versions,
        readyMs: Math.round(performance.now() - started),
        wasmBytes: py._module.HEAPU8.buffer.byteLength
      });
    } else if (data.type === 'run' && py) {
      if (typeof data.code !== 'string' || data.code.length > 100_000) {
        throw Error('Invalid code length');
      }

      // Sync incoming files into /workspace
      for (const [name, bytes] of Object.entries(data.files ?? {})) {
        if (!safePath(name) || !(bytes instanceof Uint8Array) || bytes.length > 5_000_000) {
          throw Error('Invalid input file: ' + name);
        }
        ensureParentDirs(name);
        py.FS.writeFile('/workspace' + name, bytes);
      }

      stdout = '';
      stderr = '';
      const maxChars = data.maxOutputChars ?? 64_000;
      const collect = which => line => {
        if (which === 'stdout') stdout = (stdout + line + '\\n').slice(0, maxChars);
        else stderr = (stderr + line + '\\n').slice(0, maxChars);
      };
      py.setStdout({ batched: collect('stdout') });
      py.setStderr({ batched: collect('stderr') });

      const value = await py.runPythonAsync(data.code);

      // Ensure any files generated directly in virtual root are brought into /workspace
      const systemEntries = new Set(['.', '..', 'tmp', 'home', 'dev', 'proc', 'workspace', 'lib', 'etc']);
      try {
        const rootEntries = py.FS.readdir('/');
        for (const entry of rootEntries) {
          if (systemEntries.has(entry)) continue;
          const fullRootPath = '/' + entry;
          const destPath = '/workspace/' + entry;
          try {
            const stat = py.FS.stat(fullRootPath);
            if (py.FS.isFile(stat.mode)) {
              const bytes = py.FS.readFile(fullRootPath);
              py.FS.writeFile(destPath, bytes);
              py.FS.unlink(fullRootPath);
            }
          } catch {}
        }
      } catch {}

      const files = readFilesRecursive('/workspace', '');

      value?.destroy?.();

      post({
        id: data.id,
        type: 'result',
        ok: true,
        stdout,
        stderr,
        files,
        wasmBytes: py._module.HEAPU8.buffer.byteLength
      });
    } else {
      throw Error('Unsupported request');
    }
  } catch (error) {
    post({
      id: data.id,
      type: 'result',
      ok: false,
      stdout,
      stderr,
      error: String(error).slice(0, 8000)
    });
  } finally {
    busy = false;
  }
};
`.trim()
