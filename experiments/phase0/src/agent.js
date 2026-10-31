import { createDeepAgent } from 'deepagents/browser';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
class Fake extends BaseChatModel {
  constructor(){ super({}); this.i=0; }
  _llmType(){ return 'phase0-fake'; }
  bindTools(){ return this; }
  async _generate(){
    const calls = [
      {name:'write_todos', args:{todos:[{content:'Write file',status:'in_progress'}]}, id:'1', type:'tool_call'},
      {name:'write_file', args:{file_path:'/result.txt',content:'hello from browser'}, id:'2', type:'tool_call'},
      {name:'read_file', args:{file_path:'/result.txt'}, id:'3', type:'tool_call'},
    ];
    const call = calls[this.i++];
    const message = new AIMessage({content:call?'':'done',tool_calls:call?[call]:[]});
    return {generations:[{text:message.content,message}]};
  }
}
self.onmessage = async () => {
  try {
    const agent = createDeepAgent({model:new Fake(), subagents:[]});
    const result = await agent.invoke({messages:[{role:'user',content:'Plan, write and read a file.'}]});
    self.postMessage({ok:true, messages:result.messages.map(m=>({type:m._getType(),content:m.content,name:m.name,tool_calls:m.tool_calls})),todos:result.todos,files:result.files});
  } catch (e) { self.postMessage({ok:false,error:String(e),stack:e.stack}); }
};
