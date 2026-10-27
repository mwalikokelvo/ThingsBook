'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ThingsBookDesktop',{
 version:'1.14.1',
 providerRequest:value=>ipcRenderer.invoke('thingsbook:provider',value),
 cancelProvider:()=>ipcRenderer.send('thingsbook:provider-cancel'),
 protectAccess:secret=>ipcRenderer.invoke('thingsbook:protect-access',secret),
 revealAccess:wrapped=>ipcRenderer.invoke('thingsbook:reveal-access',wrapped),
 nativeCoreStatus:()=>ipcRenderer.invoke('thingsbook:core-status'),
 indexBook:(book,bytes)=>ipcRenderer.invoke('thingsbook:core-index',{book,bytes}),
 searchLibrary:query=>ipcRenderer.invoke('thingsbook:core-search',query),
 clearSearch:()=>ipcRenderer.send('thingsbook:core-clear'),
 voices:()=>ipcRenderer.invoke('thingsbook:voices'),
 customVoices:()=>ipcRenderer.invoke('thingsbook:custom-voices'),
 synthesizeCustom:(text,voice,kind='prose')=>ipcRenderer.invoke('thingsbook:custom-speech',{text,voice,kind}),
 streamCustom:(text,voice,kind='prose')=>ipcRenderer.invoke('thingsbook:custom-stream',{text,voice,kind}),
 warmCustom:voice=>ipcRenderer.invoke('thingsbook:warm-voice',voice),
 releaseCustomStream:url=>ipcRenderer.send('thingsbook:release-stream',url),
 synthesize:(text,voice)=>ipcRenderer.invoke('thingsbook:speech',{text,voice}),
 panic:()=>ipcRenderer.send('thingsbook:panic'),
 stopSpeech:(release=true)=>ipcRenderer.send('thingsbook:stop-speech',release),
 onClose:handler=>ipcRenderer.on('thingsbook:request-close',()=>handler()),
 closeReady:()=>ipcRenderer.send('thingsbook:closed')
});
