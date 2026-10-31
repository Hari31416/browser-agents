// Disposable protocol experiment. Not an authenticated or hardened relay.
import http from 'node:http';
const origin='http://127.0.0.1:5173';
const key=process.env.PHASE0_API_KEY || '';
const endpoint=process.env.PHASE0_ENDPOINT;
const model=process.env.PHASE0_MODEL;
const server=http.createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/chat'||req.headers.origin!==origin){res.writeHead(403).end();return}
 try{
  let body='';for await(const chunk of req){body+=chunk;if(body.length>100000) throw Error('request too large')}
  const payload=JSON.parse(body);
  if(endpoint){
   if(!model) throw Error('PHASE0_MODEL required');
   const upstream=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({...payload,model,stream:true})});
   if(!upstream.ok){res.writeHead(502).end('upstream error');return}
   res.writeHead(200,{'Access-Control-Allow-Origin':origin,'Content-Type':'text/event-stream'});
   for await(const chunk of upstream.body)res.write(chunk);
   res.end();
  }else{
   res.writeHead(200,{'Access-Control-Allow-Origin':origin,'Content-Type':'text/event-stream'});
   const hasTool=payload.messages.some(m=>m.role==='tool');
   const delta=hasTool?{content:'File read: hello'}:{tool_calls:[{index:0,id:'call1',type:'function',function:{name:'read_file',arguments:'{"path":"/input.txt"}'}}]};
   res.write(`data: ${JSON.stringify({choices:[{delta}]})}\n\n`);res.end('data: [DONE]\n\n');
  }
 }catch{if(!res.headersSent)res.writeHead(400);res.end('request failed')}
});
server.listen(8765,'127.0.0.1',()=>console.log(`Phase 0 relay listening on 127.0.0.1:8765 (${endpoint?'provider':'fake'} mode)`));
