import { createBrowserDeepAgent, StateBackend } from './agent.mjs';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { traceable } from 'langsmith/traceable';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import {createHash} from './sha256.mjs';
import { completion } from '../model-client.mjs';

class ScriptedModel extends BaseChatModel {
  constructor(marker, {delay=0, forbidden=false}={}) { super({}); this.marker=marker; this.index=0; this.bound=[]; this.delay=delay; this.forbidden=forbidden; }
  _llmType() { return 'browser-fixed-fixture'; }
  bindTools(tools) { this.bound=tools.map(t=>t.name); return this; }
  async _generate(_messages, options) {
    if (this.delay) await new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
      const timer=setTimeout(()=>{options.signal?.removeEventListener('abort',abort);resolve();},this.delay);
      if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
    });
    const calls = this.forbidden ? [{name:'task',args:{description:'must not run',subagent_type:'general-purpose'}}] : [
      {name:'write_todos',args:{todos:[{content:'Process file',status:'in_progress'}]}},
      {name:'write_file',args:{file_path:'/result.txt',content:this.marker}},
      {name:'edit_file',args:{file_path:'/result.txt',old_string:this.marker,new_string:this.marker+'-edited'}},
      {name:'read_file',args:{file_path:'/result.txt'}},
      {name:'glob',args:{pattern:'*.txt',path:'/'}},
      {name:'grep',args:{pattern:'edited',path:'/',glob:'*.txt',output_mode:'content'}},
      {name:'ls',args:{path:'/'}},
      {name:'write_file',args:{file_path:'/temporary.txt',content:'temporary'}},
      {name:'delete',args:{file_path:'/temporary.txt'}},
      {name:'write_todos',args:{todos:[{content:'Process file',status:'completed'}]}},
    ];
    const call=calls[this.index++];
    const message=new AIMessage({content:call?'':'done',tool_calls:call?[{...call,id:String(this.index),type:'tool_call'}]:[]});
    return {generations:[{text:message.content,message}]};
  }
}
class RelayModel extends BaseChatModel {
  constructor(config, tools=[]) { super({}); this.connection=config; this.tools=tools; }
  _llmType() { return 'browser-relay'; }
  bindTools(tools) { return new RelayModel(this.connection,tools.map(t=>convertToOpenAITool(t))); }
  async _generate(messages, options) {
    const input=messages.map(message=>{
      const type=message._getType();
      if(type==='tool') return {role:'tool',tool_call_id:message.tool_call_id,content:typeof message.content==='string'?message.content:JSON.stringify(message.content)};
      if(type==='ai') return {role:'assistant',content:message.content||null,...(message.tool_calls?.length?{tool_calls:message.tool_calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{})};
      return {role:type==='human'?'user':type,content:message.content};
    });
    let result;
    const requested=[...input];
    for(let attempt=0;attempt<3;attempt++) {
      try {result=await completion({...this.connection,messages:requested,tools:this.tools,signal:options.signal});break;}
      catch(error) {
        if(!error.invalidToolArguments || attempt===2)throw new Error('Relay model: '+error.message);
        // No tools have run. Return parsing feedback; never repair/execute malformed JSON.
        globalThis.argumentRetries=(globalThis.argumentRetries??0)+1;
        requested.push({role:'assistant',content:'The proposed tool arguments could not be parsed as JSON. No tool was executed.'});
        requested.push({role:'user',content:'Regenerate the call using valid JSON and plain text strings. Do not emit formatting tokens. For write_todos, a valid example is {"todos":[{"content":"Read input","status":"in_progress"}]}. Backslashes may only introduce legal JSON escapes.'});
      }
    }
    const message=new AIMessage({content:result.text,tool_calls:result.calls.map(c=>({id:c.id,name:c.name,args:JSON.parse(c.args),type:'tool_call'}))});
    return {generations:[{text:result.text,message}]};
  }
}
const summarize=(state,model)=>({boundTools:model.bound,todos:state.todos,files:state.files,
  toolResults:state.messages.filter(m=>m._getType()==='tool').map(m=>({name:m.name,content:m.content,status:m.status}))});
async function exercise(marker, backend, streaming=false) {
  const model=new ScriptedModel(marker,{delay:2});
  const agent=createBrowserDeepAgent({model,backend});
  const input={messages:[{role:'user',content:'Plan and process the file.'}]};
  if(streaming){let state,count=0;for await(const next of await agent.stream(input,{recursionLimit:40,streamMode:'values'})){state=next;count++;}return {...summarize(state,model),streamEvents:count};}
  return summarize(await agent.invoke(input,{recursionLimit:40}),model);
}
self.onmessage=async({data})=>{
 try {
  if(data.type==='provider') {
    globalThis.argumentRetries=0;
    const model=new RelayModel(data.config);
    const agent=createBrowserDeepAgent({model,backend:new StateBackend(),systemPrompt:'Use write_todos to record a plan. Read /input.txt with read_file, copy its exact contents to /result.txt with write_file, then mark the plan completed. Use tools for all file access. Do not call subagents or execute shell commands.'});
    const stamp=new Date().toISOString();
    const state=await agent.invoke({messages:[{role:'user',content:'Plan and copy /input.txt to /result.txt.'}],files:{'/input.txt':{content:'hello from browser workspace',mimeType:'text/plain',created_at:stamp,modified_at:stamp}}},{recursionLimit:30});
    postMessage({type:'provider-result',ok:true,argumentRetries:globalThis.argumentRetries??0,...summarize(state,{bound:[]})});
  } else if(data.type==='exercise') {
    const hash=createHash('sha256').update('a').update(new TextEncoder().encode('bc')).digest('hex');
    const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzS0AAAAASUVORK5CYII=';
    class BinaryModel extends ScriptedModel {
      async _generate(){const call=this.index++===0?{name:'read_file',args:{file_path:'/plot.png'},id:'image',type:'tool_call'}:undefined;const message=new AIMessage({content:call?'':'done',tool_calls:call?[call]:[]});return {generations:[{text:message.content,message}]};}
    }
    const binaryModel=new BinaryModel('binary');const binaryAgent=createBrowserDeepAgent({model:binaryModel,backend:new StateBackend()});
    const binaryState=await binaryAgent.invoke({messages:[{role:'user',content:'Read the PNG.'}],files:{'/plot.png':{content:pngBase64,encoding:'base64',mimeType:'image/png',created_at:new Date().toISOString(),modified_at:new Date().toISOString()}}},{recursionLimit:20});
    const binary=summarize(binaryState,binaryModel);
    const direct=await exercise('direct',new StateBackend());
    const shared=new StateBackend();
    const concurrent=await Promise.all([exercise('chat-A',shared),exercise('chat-B',shared)]);
    const factory=await exercise('factory',runtime=>new StateBackend(runtime));
    let capturedBackend;
    await exercise('capture',runtime=>(capturedBackend=new StateBackend(runtime)));
    let boundBackendRejected;try{await exercise('other-chat',capturedBackend);boundBackendRejected='unexpected success';}catch(error){boundBackendRejected=String(error);}
    const streaming=await exercise('stream',new StateBackend(),true);
    let tracing;
    try {await traceable(async()=>42,{tracingEnabled:true})();tracing='unexpected success';}catch(e){tracing=String(e);}
    const model=new ScriptedModel('cancel',{delay:1000});const controller=new AbortController();
    const agent=createBrowserDeepAgent({model});const timer=setTimeout(()=>controller.abort(),30);
    let cancelled;try{await agent.invoke({messages:[{role:'user',content:'cancel'}]},{signal:controller.signal});cancelled='unexpected success';}catch(e){cancelled=String(e);}finally{clearTimeout(timer);}
    const attackModel=new ScriptedModel('attack',{forbidden:true});
    const boundaryAgent=createBrowserDeepAgent({model:attackModel});
    let toolBoundary;try {const result=await boundaryAgent.invoke({messages:[{role:'user',content:'attack'}]},{recursionLimit:8});toolBoundary=JSON.stringify(result.messages.map(m=>m.content));}catch(e){toolBoundary=String(e);}
    postMessage({ok:true,hash,pngBase64,binary,direct,concurrent,factory,boundBackendRejected,streaming,tracing,cancelled,toolBoundary,processEnvironmentKeys:Object.keys(process.env)});
  }
 }catch(e){postMessage({type:data.type+'-result',ok:false,argumentRetries:globalThis.argumentRetries??0,error:String(e),stack:e.stack});}
};

postMessage({type:'ready'});
