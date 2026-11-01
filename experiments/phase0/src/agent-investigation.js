import { createDeepAgent, StateBackend } from 'deepagents/browser';
import { todoListMiddleware } from 'langchain';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
const mode = import.meta.env.MODE;
class Fake extends BaseChatModel {
  constructor() { super({}); this.index=0; this.bound=[]; }
  _llmType() { return 'phase0-fake'; }
  bindTools(tools) { this.bound=tools.map(t=>t.name); return this; }
  async _generate() {
    const calls = [
      {name:'write_todos',args:{todos:[{content:'Write file',status:'in_progress'}]},id:'plan'},
      {name:'write_file',args:{file_path:'/result.txt',content:'hello from browser'},id:'write'},
      {name:'read_file',args:{file_path:'/result.txt'},id:'read'},
      {name:'write_todos',args:{todos:[{content:'Write file',status:'completed'}]},id:'finish-plan'},
    ];
    const call=calls[this.index++];
    const message=new AIMessage({content:call?'':'done',tool_calls:call?[{...call,type:'tool_call'}]:[]});
    return {generations:[{text:message.content,message}]};
  }
}
onmessage=async()=>{
  try {
    const model=new Fake();
    const planning=mode!=='mock-context';
    const backend=mode==='mock-ambient' ? new StateBackend() : runtime=>new StateBackend(runtime);
    const agent=createDeepAgent({model,subagents:[],backend,middleware:planning?[todoListMiddleware()]:[]});
    const result=await agent.invoke({messages:[{role:'user',content:'Plan, write and read a file.'}]},{recursionLimit:20});
    postMessage({ok:true,mode,boundTools:model.bound,
      toolResults:result.messages.filter(m=>m._getType()==='tool').map(m=>({name:m.name,content:m.content,status:m.status})),
      todos:result.todos,files:result.files});
  } catch(error) { postMessage({ok:false,mode,error:String(error),stack:error.stack}); }
};
