// Local-only fault proxy. Never part of the deployed application.
import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{resolve,extname}from'node:path';
let root=resolve(process.env.QA_WEB_ROOT??'.data/release-r23-r25/web'),offline=false,apiOffline=false,dropUpload=false,dropKinds=new Set();const journal=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
createServer(async(req,res)=>{try{
 if(req.url.startsWith('/__qa/')){
  if(req.url==='/__qa/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(journal));return}
  if(req.url==='/__qa/old-shell')root=resolve('.data/release-r23-r25/before-web');
  if(req.url==='/__qa/new-shell')root=resolve('.data/release-r23-r25/web');
  if(req.url==='/__qa/drop-upload')dropUpload=true;
  if(req.url==='/__qa/drop-events')dropKinds=new Set(['shift_start','segment_change','shift_end','submit_volume']);
  offline=req.url.includes('all-off');apiOffline=req.url.includes('api-off');res.end('ok');return;
 }
 if(offline||(apiOffline&&req.url.startsWith('/api'))){req.socket.destroy();return}
 if(req.url.startsWith('/api')){
  const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
  const r=await fetch('http://127.0.0.1:4369'+req.url,{method:req.method,headers:Object.fromEntries(['authorization','x-tenant-id','content-type'].filter(k=>req.headers[k]).map(k=>[k,req.headers[k]])),...(['GET','HEAD'].includes(req.method)?{}:{body:bytes})});const answer=Buffer.from(await r.arrayBuffer());
  const command=req.url==='/api/v1/execution/events'?JSON.parse(bytes.toString()):null;
  const kind=command?.events?.[0]?.kind;const lost=(r.ok&&dropUpload&&req.method==='PUT'&&req.url.endsWith('/content'))||(r.ok&&dropKinds.has(kind));
  if(command||req.url.includes('/evidence'))journal.push({tenantId:req.headers['x-tenant-id'],path:req.url,method:req.method,status:r.status,command,lost});
  if(lost){if(kind)dropKinds.delete(kind);else dropUpload=false;apiOffline=true;req.socket.destroy();return}
  res.writeHead(r.status,Object.fromEntries(r.headers));res.end(answer);return;
 }
 const p=new URL(req.url,'http://localhost').pathname,f=resolve(root,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(root+'/'))throw Error();const b=await readFile(f);res.setHeader('Content-Type',mime[extname(f)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(b);
}catch{res.writeHead(404);res.end('not found')}}).listen(5218,'127.0.0.1',()=>console.log('Local gated QA5218 ->4369'));
