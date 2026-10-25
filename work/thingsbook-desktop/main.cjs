'use strict';
const {app,BrowserWindow,protocol,ipcMain,dialog,Menu,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),fsSync=require('node:fs'),{spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const ORIGIN='thingsbook://library';
const {NativeCore}=require('./native-core.cjs');
const {voiceCatalog}=require('./voice-catalog.cjs');
const nativeCore=new NativeCore(app.isPackaged?path.join(process.resourcesPath,'thingsbook-core.exe'):path.join(__dirname,'native/thingsbook-core.exe'));
protocol.registerSchemesAsPrivileged([{scheme:'thingsbook',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
const profile=process.env.THINGSBOOK_TEST_PROFILE || path.join(process.env.LOCALAPPDATA || app.getPath('appData'),'ThingsBookDesktop');
fsSync.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const zlibraryProvider=new (require('./zlibrary.cjs').Provider)(profile,app.isPackaged?path.join(process.resourcesPath,'ProviderProtection.exe'):path.join(__dirname,'native/ProviderProtection.exe'));
let window,speechJob,voiceListJob,customWorker,customBuffer='',customSequence=0,quitting=false,closeAfterSave=false;
const customPending=new Map(),customStreams=new Map(),warmedVoices=new Set(),voicePack=path.join(profile,'VoicePack');
let warming,customGeneration=0;
function wavHeader(size=0xffffffff){const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(size===0xffffffff?size:size+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);return b;}
const ownUrl=url=>{try{const parsed=new URL(url);return parsed.protocol==='thingsbook:'&&parsed.hostname==='library'&&!parsed.port;}catch{return false;}};
const trusted=event=>event.sender===window?.webContents&&event.senderFrame===window.webContents.mainFrame&&ownUrl(event.senderFrame.url);
const helper=()=>app.isPackaged?path.join(process.resourcesPath,'SpeechBridge.exe'):path.join(__dirname,'native','SpeechBridge.exe');
function dropStreams(){for(const item of customStreams.values()){try{item.controller.error(new Error('Narration released'));}catch{}}customStreams.clear();}
function cancelCustom(){customGeneration++;if(customWorker){customWorker.kill();customWorker=null;}customBuffer='';warmedVoices.clear();warming=null;for(const request of customPending.values()){clearTimeout(request.timer);request.reject(new Error('Narration cancelled'));}customPending.clear();dropStreams();}
function cancelSpeech(release=true){customGeneration++;if(speechJob){speechJob.kill();speechJob=null;}if(release||[...customPending.values()].some(item=>item.mode!=='warm'))cancelCustom();else dropStreams();}
async function customVoices(){
 try{
  const status=JSON.parse(await fs.readFile(path.join(voicePack,'ready.json'),'utf8'));
  const entries=voiceCatalog(status),available=[];
  for(const name of ['runtime/python.exe','models/config.yaml','models/model.safetensors','models/tokenizer.json'])await fs.access(path.join(voicePack,name));
  for(const entry of entries){try{await fs.access(path.join(voicePack,'voices',entry.id+'.safetensors'));available.push(entry);}catch{}}
  return available;
 }catch{return [];}
}
async function customSpeech(text,voice,kind='prose',mode='full'){
 const generation=customGeneration;
 if(!(await customVoices()).some(item=>item.id===voice))throw new Error('Your local recording voice pack is not prepared yet.');
 if(generation!==customGeneration)throw new Error('Narration cancelled');
 if(!customWorker){
  const child=spawn(path.join(voicePack,'runtime/python.exe'),['-u',path.join(__dirname,'custom-voice.py'),voicePack],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}});
  customWorker=child;customBuffer='';child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{if(customWorker===child)cancelCustom();});child.on('close',()=>{if(customWorker===child)cancelCustom();});
  child.stdout.on('data',chunk=>{
   if(customWorker!==child)return;customBuffer+=chunk.toString('utf8');if(customBuffer.length>24*1024*1024){cancelCustom();return;}
   let end;while((end=customBuffer.indexOf('\n'))>=0){
    const line=customBuffer.slice(0,end);customBuffer=customBuffer.slice(end+1);
    try{const result=JSON.parse(line),pending=customPending.get(result.id);if(!pending)continue;
     if(pending.mode==='stream'&&result.pcm!==undefined){const bytes=Buffer.from(result.pcm,'base64');if(result.rate!==24000||bytes.length%2||bytes.length>1024*1024||(pending.item.size+=bytes.length)>16*1024*1024)throw new Error('Invalid stream');pending.item.parts.push(bytes);pending.item.controller.enqueue(bytes);continue;}
     customPending.delete(result.id);clearTimeout(pending.timer);
     if(result.error)pending.reject(new Error(result.error));else if(pending.mode==='warm'&&result.ready){warmedVoices.add(pending.voice);pending.resolve(true);}else if(pending.mode==='stream'&&result.done){if(!pending.item.size)throw new Error('Empty stream');pending.item.bytes=Buffer.concat([wavHeader(pending.item.size),...pending.item.parts]);pending.item.parts=[];pending.item.controller.close();warmedVoices.add(pending.voice);}else if(pending.mode==='full'){const bytes=Buffer.from(result.audio,'base64');if(bytes.length>16*1024*1024||bytes.subarray(0,4).toString()!=='RIFF')pending.reject(new Error('Invalid local voice audio'));else{warmedVoices.add(pending.voice);pending.resolve(new Uint8Array(bytes));}}else throw new Error('Invalid voice response');
    }catch{cancelCustom();return;}
   }
  });
 }
 const id=++customSequence;
 if(customPending.size>=3)throw new Error('The local narrator is busy. Stop and try again.');
 const timer=setTimeout(()=>cancelCustom(),240000);
 if(mode==='stream'){
  if(customStreams.size>=3){clearTimeout(timer);throw new Error('Stop the current narration before starting another stream.');}
  const token=randomUUID(),item={parts:[],size:0,bytes:null,started:false,id};
  item.stream=new ReadableStream({start(controller){item.controller=controller;controller.enqueue(wavHeader());}});customStreams.set(token,item);
  customPending.set(id,{mode,voice,timer,item,resolve(){},reject(error){customStreams.delete(token);try{item.controller.error(error);}catch{}}});
  customWorker.stdin.write(JSON.stringify({id,text,voice,kind,mode})+'\n');return ORIGIN+'/speech/audio/'+token;
 }
 return new Promise((resolve,reject)=>{customPending.set(id,{mode,voice,resolve,reject,timer});customWorker.stdin.write(JSON.stringify({id,text,voice,kind,mode})+'\n');});
}
function warmVoice(voice){if(warmedVoices.has(voice))return Promise.resolve(true);if(warming)return warming.promise;const promise=customSpeech('',voice,'prose','warm').finally(()=>{if(warming?.promise===promise)warming=null;});warming={voice,promise};return promise;}
function streamResponse(request,token){
 const item=customStreams.get(token);if(!item)return new Response('Narration expired',{status:404});
 const headers={'Content-Type':'audio/wav','Cache-Control':'no-store','Accept-Ranges':'bytes'};
 if(item.bytes){const range=request.headers.get('range');if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range),start=match?Number(match[1]):NaN,end=match&&match[2]?Math.min(Number(match[2]),item.bytes.length-1):item.bytes.length-1;if(!Number.isSafeInteger(start)||start>end||start>=item.bytes.length)return new Response(null,{status:416});return new Response(item.bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${item.bytes.length}`,'Content-Length':String(end-start+1)}});}return new Response(item.bytes,{headers:{...headers,'Content-Length':String(item.bytes.length)}});}
 if(item.started)return new Response('Narration is still being prepared',{status:409});item.started=true;return new Response(item.stream,{headers});
}
function speechProcess(mode,payload){return new Promise((resolve,reject)=>{
 const child=spawn(helper(),[mode],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 if(mode==='--voices')voiceListJob=child;
 if(mode==='--synthesize'){cancelSpeech();speechJob=child;}
 let chunks=[],bytes=0,done=false;const timeout=setTimeout(()=>{child.kill();finish(new Error('The offline voice took too long. Try another installed voice.'));},90000);
 function finish(error,value){if(done)return;done=true;clearTimeout(timeout);if(speechJob===child)speechJob=null;if(voiceListJob===child)voiceListJob=null;error?reject(error):resolve(value);}
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024){child.kill();finish(new Error('The voice output was too large.'));}else{chunks.push(chunk);if(mode==='--voices'){const result=Buffer.concat(chunks);try{if(Array.isArray(JSON.parse(result.toString('utf8')))){finish(null,result);child.kill();}}catch{}}}});
 child.stderr.resume();child.on('error',()=>finish(new Error('The Windows speech helper could not start.')));
 child.on('close',code=>{if(code!==0)finish(new Error('The Windows voice could not read this passage. Choose another voice.'));else finish(null,Buffer.concat(chunks));});
 child.stdin.on('error',()=>{});child.stdin.end(payload?JSON.stringify(payload)+'\n':'');
});}
let voicesCache;
function configureIpc(){
 ipcMain.handle('thingsbook:provider',(event,value)=>{if(!trusted(event)||!value||JSON.stringify(value).length>10000)throw new Error('Invalid provider request');return zlibraryProvider.call(value);});
 ipcMain.on('thingsbook:provider-cancel',event=>{if(trusted(event))zlibraryProvider.cancel();});
 ipcMain.handle('thingsbook:protect-access',(event,secret)=>{
  if(!trusted(event)||typeof secret!=='string'||!secret.length||secret.length>4096||!safeStorage.isEncryptionAvailable()||process.platform!=='win32')throw new Error('Windows device protection is unavailable');
  return safeStorage.encryptString(secret).toString('base64');
 });
 ipcMain.handle('thingsbook:reveal-access',(event,wrapped)=>{
  if(!trusted(event)||typeof wrapped!=='string'||wrapped.length>16384||!wrapped.length||!/^[A-Za-z0-9+/=]+$/.test(wrapped)||!safeStorage.isEncryptionAvailable()||process.platform!=='win32')throw new Error('Invalid device access');
  return safeStorage.decryptString(Buffer.from(wrapped,'base64'));
 });
 ipcMain.handle('thingsbook:core-status',event=>{if(!trusted(event))throw new Error('Unavailable');return {available:nativeCore.available(),formats:['EPUB','TXT']};});
 ipcMain.handle('thingsbook:core-index',(event,value)=>{if(!trusted(event)||!value||!value.book||!['EPUB','TXT'].includes(value.book.format)||typeof value.book.id!=='string'||value.book.id.length>100||typeof value.book.title!=='string'||value.book.title.length>2000||typeof value.book.author!=='string'||value.book.author.length>2000||!(value.bytes instanceof Uint8Array)||!value.bytes.length||value.bytes.length>100*1024*1024)throw new Error('Invalid indexing request');return nativeCore.index(value.book,Buffer.from(value.bytes));});
 ipcMain.handle('thingsbook:core-search',(event,query)=>{if(!trusted(event)||typeof query!=='string'||!query.trim()||query.length>1024)throw new Error('Invalid search');return nativeCore.search(query);});
 ipcMain.on('thingsbook:core-clear',event=>{if(trusted(event))nativeCore.cancel();});
 ipcMain.on('thingsbook:panic',event=>{if(trusted(event)){cancelSpeech();window.minimize();}});
 ipcMain.handle('thingsbook:custom-voices',event=>{if(!trusted(event))throw new Error('Unavailable');return customVoices();});
 ipcMain.handle('thingsbook:custom-speech',(event,value)=>{if(!trusted(event)||!value||typeof value.text!=='string'||!value.text.trim()||value.text.length>4000||typeof value.voice!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.voice)||!['prose','heading',undefined].includes(value.kind))throw new Error('Invalid narration request');return customSpeech(value.text,value.voice,value.kind);});
 ipcMain.handle('thingsbook:custom-stream',(event,value)=>{if(!trusted(event)||!value||typeof value.text!=='string'||!value.text.trim()||value.text.length>4000||typeof value.voice!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.voice)||!['prose','heading',undefined].includes(value.kind))throw new Error('Invalid narration request');return customSpeech(value.text,value.voice,value.kind,'stream');});
 ipcMain.handle('thingsbook:warm-voice',(event,voice)=>{if(!trusted(event)||typeof voice!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(voice))throw new Error('Invalid voice');return warmVoice(voice);});
 ipcMain.on('thingsbook:release-stream',(event,url)=>{if(!trusted(event)||typeof url!=='string'||!url.startsWith(ORIGIN+'/speech/audio/'))return;const token=url.slice((ORIGIN+'/speech/audio/').length),item=customStreams.get(token);if(!item)return;if(customPending.has(item.id))cancelCustom();else customStreams.delete(token);});
 ipcMain.handle('thingsbook:voices',async event=>{if(!trusted(event))throw new Error('Unavailable');if(!voicesCache){voicesCache=speechProcess('--voices').then(bytes=>JSON.parse(bytes.toString('utf8'))).catch(()=>{voicesCache=null;return [];});}return voicesCache;});
 ipcMain.handle('thingsbook:speech',async(event,value)=>{if(!trusted(event)||!value||typeof value.text!=='string'||value.text.length>4000||typeof value.voice!=='string'||value.voice.length>200)throw new Error('Invalid narration request');return new Uint8Array(await speechProcess('--synthesize',{text:value.text,voice:value.voice}));});
 ipcMain.on('thingsbook:stop-speech',(event,release)=>{if(trusted(event))cancelSpeech(release!==false);});
 ipcMain.on('thingsbook:closed',event=>{if(trusted(event)){closeAfterSave=true;window.close();}});
}
async function start(){
 const root=path.join(__dirname,'web');
 await protocol.handle('thingsbook',async request=>{
  try{
   if(!ownUrl(request.url)||!['GET','HEAD'].includes(request.method))return new Response('Blocked',{status:403});
   const url=new URL(request.url);let relative=decodeURIComponent(url.pathname).replace(/^\//,'');if(!relative)relative='index.html';
   if(relative==='provider-file'&&request.method==='GET'){try{if(url.searchParams.size!==1||!url.searchParams.has('ticket'))return new Response('Blocked',{status:403});const bytes=await zlibraryProvider.download(url.searchParams.get('ticket'),request.signal);const response=new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});bytes.fill(0);return response;}catch{return new Response('Provider download failed or expired.',{status:502});}}
   if(relative==='catalog'){const catalog=require('./catalog.cjs');return catalog.handle(request,catalog.electronFetch);}
   if(relative.startsWith('speech/audio/')&&request.method==='GET')return streamResponse(request,relative.slice('speech/audio/'.length));
   if(relative==='speech/status')return new Response('{"ready":false,"voices":[]}',{headers:{'Content-Type':'application/json'}});
   const allow=['index.html','style.css','app.js','reader.js','reader.css','pdf.worker.mjs'];
   if(!allow.includes(relative)&&!['vendor/','cmaps/','standard_fonts/','wasm/'].some(prefix=>relative.startsWith(prefix)))return new Response('Not found',{status:404});
   const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep)||relative.includes('\\'))return new Response('Blocked',{status:403});
   const mime=relative.endsWith('.css')?'text/css':/\.m?js$/.test(relative)?'text/javascript':relative.endsWith('.html')?'text/html':relative.endsWith('.wasm')?'application/wasm':'application/octet-stream';
   const body=await fs.readFile(target);return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':mime+(mime.startsWith('text/')?'; charset=utf-8':''),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response('Not found',{status:404});}
 });
 configureIpc();
 window=new BrowserWindow({width:1280,height:880,minWidth:760,minHeight:620,show:false,title:'ThingsBook',backgroundColor:'#f5f1e9',icon:path.join(__dirname,'icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,devTools:!!process.env.THINGSBOOK_TEST_PROFILE}});
 Menu.setApplicationMenu(null);
 const ses=window.webContents.session;
 ses.setPermissionRequestHandler((wc,permission,callback)=>callback(wc===window.webContents&&ownUrl(wc.getURL())&&['persistent-storage','fullscreen'].includes(permission)));
 ses.setPermissionCheckHandler((wc,permission)=>wc===window.webContents&&ownUrl(wc.getURL())&&['persistent-storage','fullscreen'].includes(permission));
 ses.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>callback({cancel:!(ownUrl(details.url)||details.url.startsWith('blob:'+ORIGIN+'/')||details.url.startsWith('data:image/'))}));
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!ownUrl(url))event.preventDefault();});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 ses.on('will-download',(_event,item)=>{const name=path.basename(item.getFilename()).replace(/[<>:"/\\|?*]/g,'_');item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),name)});});
 window.on('close',event=>{if(!closeAfterSave&&!quitting){event.preventDefault();window.webContents.send('thingsbook:request-close');}});
 window.on('closed',()=>{cancelSpeech();window=null;app.quit();});
 window.once('ready-to-show',()=>{if(!process.env.THINGSBOOK_TEST_HIDDEN)window.show();});
 await window.loadURL(ORIGIN+'/');
 if(!process.env.THINGSBOOK_SMOKE_RESULT)customVoices().then(voices=>voices[0]&&warmVoice(voices[0].id)).catch(()=>{});
 if(process.env.THINGSBOOK_SMOKE_RESULT){
  try{const result=await window.webContents.executeJavaScript(`({secure:isSecureContext,storage:!!window.indexedDB,crypto:!!crypto.subtle,desktop:!!window.ThingsBookDesktop,pdf:typeof ThingsReaderLib!=='undefined',epub:typeof ThingsArchiveLib!=='undefined',title:document.title,version:window.ThingsBookDesktop.version})`);
   if(process.env.THINGSBOOK_SMOKE_REOPEN==='1')result.reopen=await window.webContents.executeJavaScript(`(async()=>{
    const started=Date.now();while(typeof key==='undefined'||!key||busy){if(Date.now()-started>15000)throw new Error('Password-free process restart timed out');await new Promise(resolve=>setTimeout(resolve,25));}
    if(books.length!==1||books[0].filename!=='Native fixture.txt'||document.getElementById('app').hidden)throw new Error('Library changed across process restart');
    const access=await request(db.transaction('settings').objectStore('settings').get('device-access'));
    if(access.kind!=='windows')throw new Error('Device protection changed across restart');
    await lock();return {automaticStartup:true,booksPreserved:true,osProtected:true};
   })()`);
   if(process.env.THINGSBOOK_SMOKE_NATIVE==='1')result.native=await window.webContents.executeJavaScript(`(async()=>{
    const check=(value,message)=>{if(!value)throw new Error(message);};
    while(!db)await new Promise(resolve=>setTimeout(resolve,20));
    const state=await window.ThingsBookDesktop.nativeCoreStatus();check(state.available,'Native binary missing');
    await unlock({preventDefault(){}});check(!!key,'Synthetic vault failed');
    const recovery=decoder.decode(await unseal(config.recovery));
    const access=await request(db.transaction('settings').objectStore('settings').get('device-access'));
    check(access.kind==='windows'&&!JSON.stringify(access).includes(recovery),'Device access is not OS protected');
    check(await window.ThingsBookDesktop.revealAccess(access.wrapped)===recovery,'DPAPI round trip failed');
    let invalidRejected=false;try{await window.ThingsBookDesktop.revealAccess('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');}catch{invalidRejected=true;}check(invalidRejected,'Invalid device cipher accepted');
    const transfer=new DataTransfer();transfer.items.add(new File(['A private starlight passage with café and 星.'],'Native fixture.txt',{type:'text/plain'}));document.getElementById('book-files').files=transfer.files;fillShelves(document.getElementById('shelf-select'));
    await upload({preventDefault(){}});check(books.length===1,'Synthetic upload failed');
    const open=[...document.querySelectorAll('button')].find(button=>button.textContent==='Search book text');await open.onclick();
    const dialog=document.getElementById('native-search-dialog');await [...dialog.querySelectorAll('button')].find(button=>button.textContent==='Build private search index').onclick();
    dialog.querySelector('input').value='starlight';await [...dialog.querySelectorAll('button')].find(button=>button.textContent==='Search').onclick();
    check(dialog.querySelector('.command-results').textContent.includes('Native fixture'),'Native UI result missing');
    const matches=await window.ThingsBookDesktop.searchLibrary('starlight');check(matches[0].text.includes('café and 星'),'Native Unicode result corrupted');
    await lock();check(!key,'Lock did not complete');check((await window.ThingsBookDesktop.searchLibrary('starlight')).length===0,'Native index survived lock');window.ThingsBookDesktop.clearSearch();
    await unlock({preventDefault(){}});check(!!key&&books.length===1,'Password-free native reopening failed');await lock();
    return {index:true,search:true,unicode:true,lockClearsIndex:true,deviceProtected:true,invalidDeviceCipherRejected:true,passwordFreeReopen:true};
   })()`);
   await fs.writeFile(process.env.THINGSBOOK_SMOKE_RESULT,JSON.stringify(result));}catch(error){await fs.writeFile(process.env.THINGSBOOK_SMOKE_RESULT,JSON.stringify({error:error.message}));}closeAfterSave=true;window.close();
 }
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 app.whenReady().then(start).catch(error=>{dialog.showErrorBox('ThingsBook could not open',error.message);quitting=true;app.quit();});
 app.on('before-quit',()=>{zlibraryProvider.cancel();cancelSpeech();if(voiceListJob){voiceListJob.kill();voiceListJob=null;}nativeCore.cancel();});
 app.on('window-all-closed',()=>app.quit());
}
