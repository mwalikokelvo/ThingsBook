'use strict';
window.ThingsPrivacy=(()=>{
  const screen=el('dialog','privacy-screen');screen.id='privacy-screen';screen.hidden=true;screen.setAttribute('role','alertdialog');screen.setAttribute('aria-modal','true');screen.setAttribute('aria-label','Locking your private library');screen.addEventListener('cancel',event=>event.preventDefault());
  const heading=el('h2','','Your library is covered.'),message=el('p'),retry=el('button','primary','Retry lock');retry.type='button';retry.onclick=()=>lock();screen.append(heading,message,retry);document.body.append(screen);
  function show(){screen.hidden=false;if(!screen.open)screen.showModal();message.textContent='Finishing the current save before locking. Audio has stopped.';retry.disabled=true;document.getElementById('app').inert=true;screen.tabIndex=-1;screen.focus();}
  function failed(){screen.hidden=false;message.textContent='Your screen remains covered. The last save could not finish. Check free storage, then retry locking.';retry.disabled=false;retry.focus();}
  function hide(){screen.close();screen.hidden=true;document.getElementById('app').inert=false;}
  return {show,failed,hide};
})();
