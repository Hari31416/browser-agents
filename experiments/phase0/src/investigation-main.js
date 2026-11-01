const worker = new Worker(new URL('./agent-investigation.js', import.meta.url), {type:'module'});
worker.onmessage = ({data}) => { window.phase0Result = data; document.querySelector('#result').textContent = JSON.stringify(data); };
worker.onerror = event => { window.phase0Result = {ok:false,error:event.message,filename:event.filename,line:event.lineno,column:event.colno}; };
worker.postMessage('run');
