// Deterministic feasibility loop, not a production agent or security boundary.
self.onmessage=async()=>{
 const files=new Map(), plan=[]; const events=[];
 const responses=[{tool:'plan',args:{step:'Write and read file'}},{tool:'write',args:{path:'/result.txt',content:'hello from browser'}},{tool:'read',args:{path:'/result.txt'}},{text:'done'}];
 const tools={plan:({step})=>{plan.push(step);return 'planned'},write:({path,content})=>{files.set(path,content);return 'written'},read:({path})=>files.get(path)};
 for(const response of responses){if(response.tool){const result=tools[response.tool](response.args);events.push({type:'tool',...response,result});}else events.push({type:'text',text:response.text});}
 self.postMessage({ok:true,plan,events});
};
