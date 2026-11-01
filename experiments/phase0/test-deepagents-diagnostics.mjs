import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const modes=['baseline','globals','mock-context','mock-planning','mock-ambient'];
await mkdir('results',{recursive:true});
for(const mode of modes){
  const build=spawnSync('pnpm',['exec','vite','build','--config','vite.investigation.config.js','--mode',mode],{encoding:'utf8'});
  await writeFile(`results/build-${mode}.log`,(build.stdout??'')+(build.stderr??''));
  assert.equal(build.status,0,`Build failed: ${mode}; inspect results/build-${mode}.log`);
}
const server=spawn(process.execPath,['serve.mjs'],{stdio:['ignore','pipe','inherit']});
let browser;
try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('Fixture failed; free port 5173')));});
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const results={};
  for(const mode of modes){
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:5173/dist-investigation/${mode}/investigation.html`);
    await page.waitForFunction(()=>window.phase0Result,null,{timeout:15000});
    results[mode]=await page.evaluate(()=>window.phase0Result);await page.close();
  }
  assert.equal(results.baseline.ok,false);assert.match(results.baseline.error,/process is not defined/);
  // With the registered LangSmith browser patches, globals-only now passes.
  assert.equal(results.globals.ok,true,results.globals.error);
  assert.equal(results.globals.files['/result.txt'].content,'hello from browser');
  assert.equal(results['mock-context'].ok,true);
  assert.ok(results['mock-context'].toolResults.some(t=>t.name==='write_todos'&&t.status==='error'));
  const planned=results['mock-planning'];assert.equal(planned.ok,true);
  assert.ok(planned.boundTools.includes('write_todos'));
  assert.equal(planned.files['/result.txt'].content,'hello from browser');
  assert.equal(planned.todos[0].status,'completed');
  assert.equal(planned.toolResults.filter(t=>t.status==='error').length,0);
  assert.equal(results['mock-ambient'].ok,false);assert.match(results['mock-ambient'].error,/configurable/);
  const require=createRequire(import.meta.resolve('deepagents'));
  const versions=Object.fromEntries(['deepagents','langchain','@langchain/core','@langchain/langgraph','langsmith'].map(n=>[n,require(n+'/package.json').version]));
  const report={browser:browser.version(),versions,diagnosticOnly:true,patchedDependencies:true,results};
  await writeFile('evidence/deepagents-diagnostics-after-fix.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({browser:report.browser,versions,checks:modes.map(mode=>({mode,invocationCompleted:results[mode].ok,error:results[mode].error??null})),planningAndFilesPassedWithBrowserPatches:true},null,2));
} finally {await browser?.close();server.kill('SIGTERM');}
