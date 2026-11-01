import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startRelay } from './relay-core.mjs';
import {browserUtilities} from './browser-compat/vite.mjs';
assert.equal(browserUtilities().resolveId('node:async_hooks'),undefined);
await mkdir('results',{recursive:true});
const built=spawnSync('pnpm',['exec','vite','build','--config','vite.fixed.config.js'],{encoding:'utf8'});
await writeFile('results/build-fixed.log',(built.stdout??'')+(built.stderr??''));
assert.equal(built.status,0,'Fixed build failed; see results/build-fixed.log');
const server=spawn(process.execPath,['serve.mjs'],{stdio:['ignore','pipe','inherit']});
let browser,relay,fixture;
try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('Fixture failed; free port 5173')));});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:5173/dist-fixed/fixed.html');
  await page.waitForFunction(()=>window.phase0Result,null,{timeout:30000});
  const result=await page.evaluate(()=>window.phase0Result);
  assert.equal(result.ok,true,result.error);
  assert.equal(result.hash,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const image=result.binary.toolResults.find(t=>t.name==='read_file');assert.equal(image.status,'success');assert.equal(image.content[0].data,result.pngBase64);

  function check(run,marker) {
    assert.equal(run.files['/result.txt'].content,marker+'-edited');
    assert.equal(run.files['/temporary.txt'],undefined);
    assert.equal(run.todos[0].status,'completed');
    for(const name of ['write_todos','write_file','edit_file','read_file','glob','grep','ls','delete']) {
      const tool=run.toolResults.find(t=>t.name===name);assert.ok(tool,name);assert.notEqual(tool.status,'error');
      assert.ok(!JSON.stringify(tool.content).startsWith('"Error:'),JSON.stringify(tool));
    }
    assert.match(JSON.stringify(run.toolResults.find(t=>t.name==='read_file').content),new RegExp(marker+'-edited'));
    assert.match(JSON.stringify(run.toolResults.find(t=>t.name==='glob').content),/result.txt/);
    assert.match(JSON.stringify(run.toolResults.find(t=>t.name==='grep').content),/edited/);
    for(const name of ['task','execute','start_async_task'])assert.ok(!run.boundTools.includes(name));
  }
  check(result.direct,'direct');check(result.factory,'factory');check(result.streaming,'stream');
  check(result.concurrent[0],'chat-A');check(result.concurrent[1],'chat-B');
  assert.ok(result.streaming.streamEvents>10);
  assert.match(result.boundBackendRejected,/current tool call/);
  assert.match(result.tracing,/tracing requires native async context/);
  assert.match(result.cancelled,/Abort/);assert.match(result.toolBoundary,/Tool disabled/);
  assert.deepEqual(result.processEnvironmentKeys,[]);
  const report={browser:browser.version(),noAsyncHooksMock:true,checks:['sha256-known-vector','binary-PNG-read','explicit-planning','zero-argument-backend-adaptation','runtime-factory-backend','write-edit-read-glob-grep-list-delete','interleaved-chats-shared-backend','stale-bound-backend-rejected','graph-update-streaming','cancellation','subagent-boundary','tracing-rejected','empty-browser-environment'],streamEvents:result.streaming.streamEvents};
  const providerRequest = config => page.evaluate(config=>new Promise(resolve=>{
    const listener=event=>{if(event.data.type==='provider-result'){fixedWorker.removeEventListener('message',listener);resolve(event.data);}};
    fixedWorker.addEventListener('message',listener);fixedWorker.postMessage({type:'provider',config});
  }),config);
  let fixtureStep=0,feedbackObserved=false;
  fixture=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const payload=JSON.parse(body);
    const steps=[
      ['write_todos',null],
      ['write_todos',{todos:[{content:'Copy input',status:'in_progress'}]}],
      ['read_file',{file_path:'/input.txt'}],
      ['write_file',{file_path:'/result.txt',content:'hello from browser workspace'}],
      ['write_todos',{todos:[{content:'Copy input',status:'completed'}]}],
    ];
    const step=fixtureStep++;
    if(step===1)feedbackObserved=payload.messages.some(m=>m.role==='user'&&String(m.content).includes('Regenerate the call'));
    const call=steps[step];
    const args=step===0?'{"todos":[{"content":"bad'+String.fromCharCode(92)+'q","status":"pending"}]}':JSON.stringify(call?.[1]);
    const delta=call?{tool_calls:[{index:0,id:'fixture-'+step,type:'function',function:{name:call[0],arguments:args}}]}:{content:'Copied'};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  relay=await startRelay({endpoint:'http://127.0.0.1:'+fixture.address().port+'/chat',model:'fixture'});
  const synthetic=await providerRequest({url:'http://127.0.0.1:8765/chat',token:relay.token});
  assert.equal(synthetic.ok,true,synthetic.error);
  assert.equal(synthetic.files['/result.txt'].content,'hello from browser workspace');
  assert.equal(synthetic.todos[0].status,'completed');assert.equal(synthetic.argumentRetries,1);assert.equal(feedbackObserved,true);
  assert.equal(synthetic.toolResults.filter(t=>t.name==='write_todos').length,2);
  report.compatibleEndpoint={ok:true,relayRequests:relay.stats.requests,malformedArgumentsRejectedBeforeExecution:true,feedbackRecovery:true};
  await relay.close();relay=undefined;
  await new Promise(resolve=>{fixture.close(resolve);fixture.closeAllConnections();});fixture=undefined;
  if(process.argv.includes('--provider')) {
    if(!process.env.OPENAI_BASE_URL||!process.env.OPENAI_MODEL)throw Error('Configure the project OPENAI_* values first');
    const url=new URL(process.env.OPENAI_BASE_URL);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use HTTPS or an explicit loopback endpoint');
    const endpoint=/\/chat\/completions\/?$/.test(url.pathname)?url.href:url.href.replace(/\/$/,'')+'/chat/completions';
    relay=await startRelay({endpoint,model:process.env.OPENAI_MODEL,key:process.env.OPENAI_API_KEY??'',timeoutMs:60000});
    const real=await providerRequest({url:'http://127.0.0.1:8765/chat',token:relay.token});
    if(!real.ok){await writeFile('results/deepagents-provider-error.json',JSON.stringify({error:real.error,stack:real.stack},null,2));await writeFile('evidence/deepagents-provider-limitation.json',JSON.stringify({ok:false,browser:browser.version(),date:'2026-11-01',stage:'configured-endpoint-tool-arguments',error:real.error,argumentRetries:real.argumentRetries??0},null,2)+'\n');}
    assert.equal(real.ok,true,real.error);
    assert.equal(real.files['/result.txt'].content,'hello from browser workspace');
    assert.ok(real.toolResults.some(t=>t.name==='read_file'));
    assert.ok(real.todos.length>0&&real.todos.every(t=>t.status==='completed'));
    report.provider={ok:true,tools:real.toolResults.map(t=>t.name),relayRequests:relay.stats.requests,syntheticFileCopiedExactly:true,argumentRetries:real.argumentRetries??0};
  }
  await writeFile('evidence/deepagents-fix.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {await browser?.close();await relay?.close();if(fixture)await new Promise(resolve=>{fixture.close(resolve);fixture.closeAllConnections();});server.kill('SIGTERM');}
