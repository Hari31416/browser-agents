window.createFixedWorker = () => new Worker(new URL('./worker.mjs', import.meta.url), {type:'module'});
window.fixedWorker = createFixedWorker();
window.fixedWorker.onmessage = ({data}) => {
  if(data.type==='ready'){window.fixedWorker.postMessage({type:'exercise'});return;}
  window.phase0Result=data;document.querySelector('#result').textContent=JSON.stringify(data);
};
window.fixedWorker.onerror = event => { window.phase0Result={ok:false,error:event.message}; };
