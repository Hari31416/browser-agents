import { runAgent } from './model-client.mjs';
let controller;
onmessage = async ({data}) => {
  if (data?.type === 'cancel') { controller?.abort(); return; }
  if (data?.type !== 'run' || controller) return;
  controller = new AbortController();
  try { postMessage(await runAgent({...data.config, signal:controller.signal})); }
  catch (error) { postMessage({ok:false,error:String(error)}); }
  finally { controller = undefined; }
};
