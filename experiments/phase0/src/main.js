const worker = new Worker(new URL('./agent.js', import.meta.url), {type:'module'});
worker.onmessage = ({data}) => { document.querySelector('#result').textContent = JSON.stringify(data); window.phase0Result = data; };
worker.postMessage('run');

worker.onerror = event => { window.phase0Result = {ok:false,error:event.message || 'worker startup failed'}; };
