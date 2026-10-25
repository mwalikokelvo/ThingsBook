/* Public OPDS acquisition only. No library data, cookies or credentials. */
'use strict';
function allowed(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='www.gutenberg.org'||u.port||u.username||u.password||u.hash||u.href.length>1600)return false;
 if(u.pathname==='/ebooks/search.opds/'){return [...u.searchParams.keys()].every(k=>['query','start_index'].includes(k))&&u.searchParams.getAll('query').length<=1&&(u.searchParams.get('query')||'').length<=160&&(!u.searchParams.has('start_index')||/^\d{1,5}$/.test(u.searchParams.get('start_index')));}
 if(u.search)return false;
 return /^\/ebooks\/[1-9]\d{0,6}\.(?:opds|epub\.(?:images|noimages)|epub3\.images|txt\.utf-8)$/.test(u.pathname)||/^\/cache\/epub\/[1-9]\d{0,6}\/pg[1-9]\d{0,6}[a-zA-Z0-9._-]*\.(?:epub|txt)$/.test(u.pathname)||/^\/files\/[1-9]\d{0,6}\/[a-zA-Z0-9._-]+\.(?:epub|txt)$/.test(u.pathname);
 }catch{return false;}
}
async function handle(request,fetcher){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{const outer=new URL(request.url);if(request.method!=='GET'||outer.searchParams.size!==1||!outer.searchParams.has('url'))return new Response('Blocked',{status:403,headers});
 let url=outer.searchParams.get('url');if(!allowed(url))return new Response('Blocked',{status:403,headers});
 const controller=new AbortController(),abort=()=>controller.abort();request.signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,45000);
 try{for(let hop=0;hop<5;hop++){
  const response=await fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{'Accept':'application/atom+xml, application/epub+zip, text/plain','User-Agent':'ThingsBook/1.11.0 (user-initiated OPDS reader)'}});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();url=new URL(location,url).href;if(!allowed(url))throw Error('Blocked redirect');continue;}
  if(!response.ok){await response.body?.cancel();return new Response('The catalog is unavailable. Try again later.',{status:502,headers});}
  const feed=new URL(url).pathname.includes('.opds'),limit=feed?2*1024*1024:32*1024*1024;
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Too large');}
  const reader=response.body.getReader();let count=0;const parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>limit){value.fill(0);throw Error('Too large');}parts.push(value);}const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new Response(bytes,{headers:{...headers,'Content-Type':feed?'application/atom+xml':'application/octet-stream'}});}finally{for(const part of parts)part.fill(0);await reader.cancel().catch(()=>{});}
 }throw Error('Too many redirects');}finally{clearTimeout(timer);request.signal?.removeEventListener('abort',abort);}
 }catch{return new Response('Download failed, timed out or exceeded the 32 MB catalog limit. Your library was not changed.',{status:502,headers});}
}

function electronFetch(url,options){return new Promise((resolve,reject)=>{
 const {net,session}=require('electron');const req=net.request({url,method:'GET',session:session.fromPartition('public-book-catalog'),redirect:'manual',credentials:'omit',useSessionCookies:false,cache:'no-store',referrerPolicy:'no-referrer',headers:options.headers});let settled=false,streamController=null,ended=false;
 const abort=()=>{req.abort();if(!settled)reject(Error('Cancelled'));else if(streamController&&!ended){ended=true;streamController.error(Error('Cancelled'));}};
 options.signal?.addEventListener('abort',abort,{once:true});req.on('close',()=>options.signal?.removeEventListener('abort',abort));req.on('error',e=>{if(!settled)reject(e);else if(streamController&&!ended){ended=true;streamController.error(e);}});
 req.on('redirect',(status,method,target)=>{settled=true;resolve(new Response(null,{status,headers:{location:target}}));req.abort();});
 req.on('response',incoming=>{settled=true;let bytes=0;const stream=new ReadableStream({start(c){streamController=c;incoming.on('data',chunk=>{if(ended)return;bytes+=chunk.length;if(bytes>32*1024*1024){ended=true;c.error(Error('Too large'));req.abort();return;}c.enqueue(new Uint8Array(chunk));});incoming.on('end',()=>{if(!ended){ended=true;c.close();}});incoming.on('error',e=>{if(!ended){ended=true;c.error(e);}});},cancel(){ended=true;req.abort();}});const headers={};for(const [name,value]of Object.entries(incoming.headers))headers[name]=Array.isArray(value)?value.join(', '):String(value);resolve(new Response(stream,{status:incoming.statusCode,headers}));});
 if(options.signal?.aborted)abort();else req.end();
 });}
module.exports={allowed,handle,electronFetch};
