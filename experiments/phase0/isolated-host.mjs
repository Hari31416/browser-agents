const workerSource = await (await fetch('/isolated-worker.mjs')).text();

// Trusted page fetches a fixed manifest and verifies every asset before transfer.
export async function loadAssets() {
  const manifest = await (await fetch('/runtime/manifest.json')).json();
  const assets = {};
  await Promise.all(manifest.assets.map(async asset => {
    if (!/^[\w.+-]+$/.test(asset.file)) throw Error('Invalid manifest path');
    const response = await fetch('/runtime/' + asset.file);
    if (!response.ok) throw Error('Asset unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(x => x.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256 || bytes.length !== asset.bytes) throw Error('Asset integrity mismatch');
    assets[asset.file] = bytes;
  }));
  return { assets, manifest };
}

export async function createSession(assets) {
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts';
  frame.hidden = true;
  const channel = crypto.randomUUID();
  const bootstrap = `
    const channel = ${JSON.stringify(channel)};
    const source = ${JSON.stringify(workerSource)};
    const worker = new Worker(URL.createObjectURL(new Blob([source], {type:'text/javascript'})), {});
    worker.onmessage = event => parent.postMessage({channel, result:event.data}, '*');
    worker.onerror = event => parent.postMessage({channel, failure:event.message || 'Worker failed before startup'}, '*');
    addEventListener('message', event => {
      if (event.source !== parent || event.data?.channel !== channel) return;
      if (event.data.cancel) { worker.terminate(); parent.postMessage({channel, cancelled:true}, '*'); }
      else worker.postMessage(event.data.request);
    });
    parent.postMessage({channel, booted:true}, '*');
  `;
  frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src blob: data:; form-action 'none'; base-uri 'none'"><script>${bootstrap.replaceAll('</script', '<\\/script')}<\/script>`;
  const pending = new Map();
  let closed = false;
  let resolveCancelled;
  let resolveBoot;
  const boot = new Promise(resolve => { resolveBoot = resolve; });
  const listener = event => {
    if (event.source !== frame.contentWindow || event.data?.channel !== channel) return;
    if (event.data.booted) { return resolveBoot(); }
    if (event.data.cancelled) { resolveCancelled?.(); return; }
    if (event.data.failure) {
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(event.data.failure)); }
      pending.clear(); return;
    }
    const result = event.data.result;
    if (result?.progress) return;
    if (!result || result.type !== 'result' || typeof result.ok !== 'boolean') return;
    const p = pending.get(result.id);
    if (!p) return;
    // Worker outputs confer no authority: only settle an existing request.
    pending.delete(result.id); clearTimeout(p.timer);
    if (result.files) {
      const entries = Object.entries(result.files);
      let bytes = 0;
      if (entries.length > 100 || entries.some(([name, data]) => {
        bytes += data?.byteLength ?? 0;
        return !/^\/[\w.-]+$/.test(name) || ['/.', '/..'].includes(name) || !(data instanceof Uint8Array) || data.length > 5_000_000;
      }) || bytes > 10_000_000) { p.reject(Error('Invalid execution output')); return; }
    }
    p.resolve(result);
  };
  addEventListener('message', listener);
  document.body.append(frame);
  await Promise.race([boot, new Promise((_, reject) => setTimeout(() => reject(Error('Frame bootstrap timeout')), 10_000))]);
  const close = async () => {
    if (closed) return;
    closed = true;
    const cancelled = new Promise(resolve => { resolveCancelled = resolve; });
    frame.contentWindow.postMessage({ channel, cancel: true }, '*');
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Execution cancelled')); }
    pending.clear();
    await Promise.race([cancelled, new Promise(resolve => setTimeout(resolve, 1000))]);
    frame.remove(); removeEventListener('message', listener);
  };
  const request = (type, payload = {}, timeout = 60_000) => {
    if (closed) return Promise.reject(Error('Session closed'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { close(); reject(Error('Execution timeout')); }, timeout);
      pending.set(id, { resolve, reject, timer });
      frame.contentWindow.postMessage({ channel, request: { ...payload, id, type } }, '*');
    });
  };
  const ready = await request('init', { assets });
  if (!ready.ok) { await close(); throw Error(ready.error); }
  return { ready, run: (code, files = {}, timeout) => request('run', { code, files }, timeout), close, frame };
}

window.phase0 = { loadAssets, createSession };
