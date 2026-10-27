 'use strict';
window.ThingsBackground=(()=>{
 const native=window.ThingsBookAndroid;if(!native?.backgroundListening)return {clear(){}};
 const enabled=document.createElement('input');enabled.type='checkbox';enabled.id='background-listening';const label=el('label','','Keep reading in background ');label.append(enabled);label.title='Reading aloud continues with the screen off or in another app, with a notification and media controls (no book title is shown). Turn off to close the library whenever you leave the app.';
 // On by default from 1.14.1 so reading aloud survives the screen turning off; the choice is remembered.
 try{enabled.checked=localStorage.getItem('thingsbook-background-listening')!=='off';}catch{enabled.checked=true;}document.querySelector('.narrator-bar').append(label);let last='';
 // Paused in the background for 15 minutes: stop and close the library, as leaving the app normally does.
 let idle=null;function watchIdle(active,playing){clearTimeout(idle);idle=null;if(enabled.checked&&active&&!playing&&document.hidden)idle=setTimeout(()=>{if(document.hidden&&!ThingsReader.isSpeaking())command('stop');},15*60000);}
 function update(){const active=!!key&&ThingsReader.active(),playing=active&&ThingsReader.isSpeaking(),state=[enabled.checked,active,playing,document.hidden].join(':');if(state===last)return;last=state;watchIdle(active,playing);native.backgroundListening(enabled.checked,active,playing);}
 document.addEventListener('visibilitychange',()=>update());
 // Ends the notification and background session (library locked or reading stopped); the remembered
 // choice is kept for next time.
 function clear(){clearTimeout(idle);last='';native.backgroundListening(false,false,false);}
 async function command(action){if(!key||!ThingsReader.active()){clear();return;}if(action==='stop'){clear();ThingsReader.stop();await lock();return;}if(action==='toggle'||action==='pause'&&ThingsReader.isSpeaking()||action==='play'&&!ThingsReader.isSpeaking())await ThingsReader.togglePlayback();update();}
 enabled.onchange=()=>{try{localStorage.setItem('thingsbook-background-listening',enabled.checked?'on':'off');}catch{}update();};new MutationObserver(update).observe(document.getElementById('reader-dialog'),{attributes:true,subtree:true,childList:true,attributeFilter:['open','data-narration']});const previous=ThingsListening.stateChanged;ThingsListening.stateChanged=()=>{previous();update();};return {clear,command,disabled:()=>{enabled.checked=false;last='';},focusLost:()=>{if(ThingsReader.isSpeaking())ThingsReader.togglePlayback();}};
})();
