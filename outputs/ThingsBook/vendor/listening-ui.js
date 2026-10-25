'use strict';
window.ThingsListening=(()=>{
  const bar=document.querySelector('.narrator-bar');
  const volume=el('input');volume.type='range';volume.id='narrator-volume';volume.min=0;volume.max=1;volume.step=.05;volume.value=1;volume.setAttribute('aria-label','Narration volume');
  const label=el('label','','Voice volume');label.append(volume);bar.append(label);volume.oninput=()=>ThingsReader.volumeChanged();
  const fade=el('input');fade.type='checkbox';fade.id='narrator-fade';fade.checked=true;const fadeLabel=el('label','','Fade at bedtime ');fadeLabel.append(fade);bar.append(fadeLabel);fade.onchange=()=>ThingsReader.remember();
  const controls=[];for(const [text,seconds]of[['Back 15s',-15],['Forward 15s',15]]){const button=el('button','secondary',text);button.type='button';button.onclick=()=>ThingsReader.seekSeconds(seconds);button.title='Seek within generated audio. Device voices use the passage controls.';bar.append(button);controls.push(button);}
  function stateChanged(){for(const button of controls)button.disabled=!ThingsReader.canSeek();if(navigator.mediaSession){try{navigator.mediaSession.playbackState=ThingsReader.isSpeaking()?'playing':ThingsReader.active()?'paused':'none';if(!ThingsReader.active())navigator.mediaSession.metadata=null;}catch{}}}
  if(navigator.mediaSession){for(const [action,handler]of[['play',()=>{if(!ThingsReader.isSpeaking())ThingsReader.togglePlayback();}],['pause',()=>{if(ThingsReader.isSpeaking())ThingsReader.togglePlayback();}],['stop',()=>ThingsReader.stop()],['seekbackward',()=>ThingsReader.seekSeconds(-15)],['seekforward',()=>ThingsReader.seekSeconds(15)]]){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}}
  stateChanged();return {stateChanged};
})();
