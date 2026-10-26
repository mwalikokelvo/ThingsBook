 'use strict';
window.ThingsAndroidNeural=(()=>{
 const native=window.ThingsBookAndroid;if(!native?.personalRequest)return null;const pending=new Map();
 function call(action){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);stopSpeech(false);reject(Error('Personal voice preparation timed out. Try a shorter passage or an offline device voice.'));},120000);pending.set(id,{resolve,reject,timer});native.personalRequest(id,JSON.stringify(action));});}
 function receive(id,text){const entry=pending.get(id);if(!entry)return;pending.delete(id);clearTimeout(entry.timer);try{const r=JSON.parse(text);r.error?entry.reject(Error(r.error)):entry.resolve(r.value);}catch{entry.reject(Error('Personal voice response could not be read.'));}}
 function stopSpeech(release=false){native.cancelPersonal(!!release);for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Personal narration cancelled.'));}pending.clear();}
 const customVoices=async()=>{try{return JSON.parse(native.personalStatus()).voices||[];}catch{return [];}},streamCustom=async(text,voice,kind='prose')=>{const r=await call({action:'synthesize',text,voice,kind});if(!/^[a-f0-9-]{36}$/.test(r.ticket||''))throw Error('Invalid local audio segment.');return '/personal-audio?ticket='+r.ticket;};
 const api={receive,customVoices,streamCustom,warmCustom:()=>call({action:'warm'}),stopSpeech,releaseCustomStream:url=>{try{const u=new URL(url,location.href);if(u.pathname==='/personal-audio')native.releasePersonal(u.searchParams.get('ticket')||'');}catch{}},synthesizeCustom:async(text,voice,kind)=>{const url=await streamCustom(text,voice,kind);try{return new Uint8Array(await(await fetch(url,{credentials:'omit',cache:'no-store'})).arrayBuffer());}finally{api.releaseCustomStream(url);}}};
 const settings=document.createElement('button');settings.type='button';settings.className='secondary';settings.textContent='Install private Android voices';settings.onclick=()=>{ThingsReader.stop();native.choosePersonalPack();};document.querySelector('.narrator-bar').append(settings);
 window.nativePersonalPackResult=message=>{window.nativeNotice?.(message);window.nativeSpeechReady?.();};
 // A private build may carry its voice pack; the app installs it once when no voices are installed.
 setTimeout(()=>{try{native.installBundledVoices?.();}catch{}},1500);return api;
})();
