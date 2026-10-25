 'use strict';
window.ThingsReaderGestures=(()=>{
 const content=document.getElementById('reader-content'),reader=document.getElementById('reader-dialog'),layout=document.getElementById('reader-layout');let start=null,turning=false;
 const label=el('label','','Swipe pages '),enabled=el('input');enabled.type='checkbox';enabled.checked=true;enabled.setAttribute('aria-label','Turn pages with a horizontal swipe');label.append(enabled);document.querySelector('.display-options').append(label);
 const selected=()=>!!window.getSelection()?.toString(),valid=()=>enabled.checked&&reader.open&&key&&ThingsReader.context()&&!ThingsReader.context().loading&&!document.querySelector('dialog[open]:not(#reader-dialog)');
 function reset(){start=null;}
 content.addEventListener('touchstart',e=>{reset();if(!valid()||turning||e.touches.length!==1||selected()||e.target.closest('a,button,input,textarea,select,[contenteditable]'))return;const t=e.touches[0];start={x:t.clientX,y:t.clientY,time:performance.now(),session:ThingsReader.context(),drag:false};},{passive:true});
 content.addEventListener('touchmove',e=>{if(!start)return;if(e.touches.length!==1||selected()||!valid()){reset();return;}const t=e.touches[0],x=Math.abs(t.clientX-start.x),y=Math.abs(t.clientY-start.y);if(y>18&&y>x){reset();return;}if(x>20&&x>y*1.6){start.drag=true;if(e.cancelable)e.preventDefault();}},{passive:false});
 content.addEventListener('touchend',e=>{const s=start;reset();if(!s||!s.drag||!valid()||selected()||s.session!==ThingsReader.context()||performance.now()-s.time>900||e.changedTouches.length!==1)return;const t=e.changedTouches[0],dx=t.clientX-s.x,dy=t.clientY-s.y;if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.6)return;turning=true;document.getElementById(dx<0?'reader-screen-next':'reader-screen-previous').click();setTimeout(()=>turning=false,450);},{passive:true});
 content.addEventListener('touchcancel',reset,{passive:true});reader.addEventListener('close',reset);enabled.onchange=()=>{content.classList.toggle('swipe-pages',enabled.checked);reset();};enabled.onchange();
 return {reset};
})();
