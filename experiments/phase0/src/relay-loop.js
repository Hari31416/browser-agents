// Browser owns the fake workspace and executes the tool.
async function request(messages){
 const response=await fetch('http://127.0.0.1:8765/chat',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({messages,tools:[{type:'function',function:{name:'read_file',description:'Read the test file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}]})});
 if(!response.ok)throw Error(`relay HTTP ${response.status}`);
 const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buf='',text='',calls=[];
 while(true){const {value,done}=await reader.read();if(done)break;buf+=value;let split;while((split=buf.indexOf('\n\n'))>=0){const event=buf.slice(0,split);buf=buf.slice(split+2);const line=event.split('\n').find(x=>x.startsWith('data: '));if(!line||line==='data: [DONE]')continue;const delta=JSON.parse(line.slice(6)).choices[0].delta;text+=delta.content||'';for(const part of delta.tool_calls||[]){const call=calls[part.index]??={id:'',name:'',args:''};call.id+=part.id||'';call.name+=part.function?.name||'';call.args+=part.function?.arguments||''}}}
 return {text,calls};
}
onmessage=async()=>{try{const messages=[{role:'user',content:'Read /input.txt.'}];const first=await request(messages);const call=first.calls[0];if(!call||call.name!=='read_file'||JSON.parse(call.args).path!=='/input.txt')throw Error('unexpected tool call');messages.push({role:'assistant',content:null,tool_calls:[{id:call.id,type:'function',function:{name:call.name,arguments:call.args}}]},{role:'tool',tool_call_id:call.id,content:'hello'});const second=await request(messages);postMessage({ok:true,tool:call.name,result:second.text})}catch(e){postMessage({ok:false,error:String(e)})}};
