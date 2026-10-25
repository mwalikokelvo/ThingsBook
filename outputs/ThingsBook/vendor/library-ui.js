'use strict';
// Keep existing actions/listeners while making the phone header less crowded.
(()=>{
 const sidebar=document.querySelector('.sidebar'),reading=document.getElementById('reading-filter');
 const disclosure=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('div');
 disclosure.className='library-tools-disclosure';summary.textContent='Library tools & backups';content.className='library-tools-content';
 const actions=[...sidebar.querySelectorAll(':scope > button')].filter(node=>!['all-books','reading-filter'].includes(node.id));
 reading.after(disclosure);content.append(...actions,document.querySelector('.mobile-actions'));disclosure.append(summary,content);
 const phone=matchMedia('(max-width:720px)');const resize=()=>{disclosure.open=!phone.matches;};resize();phone.addEventListener('change',resize);
})();
