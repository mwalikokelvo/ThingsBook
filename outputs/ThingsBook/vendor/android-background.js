 'use strict';
window.ThingsBackground=(()=>{
 const native=window.ThingsBookAndroid;if(!native?.backgroundListening)return {clear(){}};
 const enabled=document.createElement('input');enabled.type='checkbox';enabled.id='background-listening';const label=el('label','','Keep reading in background ');label.append(enabled);label.title='Optional foreground notification and media controls. Turn off to close the library when leaving the app.';document.querySelector('.narrator-bar').append(label);let last='';
 function update(){const active=!!key&&ThingsReader.active(),playing=active&&ThingsReader.isSpeaking(),state=[enabled.checked,active,playing].join(':');if(state===last)return;last=state;native.backgroundListening(enabled.checked,active,playing);}
 function clear(){enabled.checked=false;last='';native.backgroundListening(false,false,false);}
 async function command(action){if(!key||!ThingsReader.active()){clear();return;}if(action==='stop'){clear();ThingsReader.stop();await lock();return;}if(action==='toggle'||action==='pause'&&ThingsReader.isSpeaking()||action==='play'&&!ThingsReader.isSpeaking())await ThingsReader.togglePlayback();update();}
 enabled.onchange=update;new MutationObserver(update).observe(document.getElementById('reader-dialog'),{attributes:true,subtree:true,childList:true,attributeFilter:['open','data-narration']});const previous=ThingsListening.stateChanged;ThingsListening.stateChanged=()=>{previous();update();};return {clear,command,disabled:()=>{enabled.checked=false;last='';},focusLost:()=>{if(ThingsReader.isSpeaking())ThingsReader.togglePlayback();}};
})();
