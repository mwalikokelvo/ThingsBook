'use strict';
// Move the existing controls so IDs, listeners and saved settings stay intact.
window.ThingsReaderDock=(()=>{
 const dialog=document.getElementById('reader-dialog');
 const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;};
 const dock=make('section','reader-dock'),bar=make('div','reader-dock-bar'),panel=make('div','reader-dock-panel');
 dock.setAttribute('aria-label','Reading controls');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Playback and pages');
 panel.id='reader-dock-panel';panel.hidden=true;
 const toggle=make('button','secondary reader-dock-toggle');toggle.type='button';toggle.textContent='Tools ▴';toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Show reader tools');
 const categories=make('div','reader-dock-categories');categories.setAttribute('role','group');categories.setAttribute('aria-label','Reader tool categories');
 const sections=[],buttons=[],play=document.getElementById('narrator-play'),stop=document.getElementById('narrator-stop');let expanded=false;
 function choose(index){sections.forEach((section,i)=>{section.hidden=i!==index;if(i===index)for(const details of section.querySelectorAll('details'))details.open=true;});buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));}
 function addSection(name,controls,before){
  const section=make('div','reader-dock-section'),button=make('button','secondary');button.type='button';section.id='reader-tools-'+name.toLowerCase();section.setAttribute('role','region');section.setAttribute('aria-label',name+' tools');button.setAttribute('aria-controls',section.id);button.textContent=name;button.onclick=()=>choose(sections.indexOf(section));button.setAttribute('aria-pressed',String(!sections.length));
  for(const control of controls){if(!control)continue;if(control.tagName==='DETAILS')control.open=true;section.append(control);}
  section.hidden=!!sections.length;const at=before?sections.findIndex(item=>item.id==='reader-tools-'+before.toLowerCase()):-1;
  if(at>=0){sections.splice(at,0,section);buttons.splice(at,0,button);categories.insertBefore(button,categories.children[at]);sections[at+1].before(section);}else{sections.push(section);buttons.push(button);categories.append(button);if(sections.length>1)sections[sections.length-2].after(section);}
  return section;
 }
 for(const [name,selectors] of [['Pages',['.reader-toolbar','.reader-search-bar']],['Voice',['.narrator-bar']],['Appearance',['.reader-display']],['Notes',['.reader-notes']]])addSection(name,selectors.map(selector=>dialog.querySelector(selector)));
 const pages=dialog.querySelector('.reader-screen-bar');
 stop.setAttribute('aria-label','Stop narration');
 bar.append(play,stop);if(pages)bar.append(pages);bar.append(toggle);
 panel.append(categories,...sections);dock.append(panel,bar);
 // The footer (chapter, percent, saved) sits just above the floating bar instead of under it.
 const clearance=()=>{if(!dialog.open)return;const top=bar.getBoundingClientRect().top,bottom=dialog.getBoundingClientRect().bottom;dialog.style.setProperty('--dock-clearance',Math.max(0,Math.round(bottom-top+6))+'px');const box=dialog.getBoundingClientRect();dialog.style.setProperty('--panel-right',Math.max(8,Math.round(innerWidth-box.right+parseFloat(getComputedStyle(dialog).paddingRight||'0')))+'px');};
 if(window.ResizeObserver)new ResizeObserver(clearance).observe(bar);window.addEventListener('resize',clearance);dialog.append(dock);dialog.classList.add('has-reader-dock');
 const appearance=make('div','display-options');for(const id of ['reader-theme','reader-size'])appearance.append(document.getElementById(id).closest('label'));sections[2].prepend(appearance);
 function collapse(focus=false){focus=focus||panel.contains(document.activeElement);expanded=false;panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Show reader tools');toggle.textContent='Tools ▴';dock.dataset.expanded='false';if(focus)toggle.focus({preventScroll:true});}
 function expand(){clearance();api.onExpand?.();expanded=true;panel.hidden=false;toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Hide reader tools');toggle.textContent='Hide ▾';dock.dataset.expanded='true';dialog.dataset.chrome='visible';}
 toggle.onclick=()=>expanded?collapse(true):expand();
 play.addEventListener('click',()=>collapse());document.getElementById('reader-focus').addEventListener('click',()=>collapse());
 bar.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||document.activeElement?.tagName!=='BUTTON')return;const targets=[...bar.querySelectorAll('button')].filter(button=>!button.disabled),index=targets.indexOf(document.activeElement);if(index<0)return;event.preventDefault();targets[event.key==='Home'?0:event.key==='End'?targets.length-1:(index+(event.key==='ArrowRight'?1:-1)+targets.length)%targets.length]?.focus();});
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();collapse(true);}});
 document.getElementById('reader-content').addEventListener('pointerdown',()=>{if(expanded)collapse();});
 new MutationObserver(records=>{document.body.classList.toggle('reader-active',dialog.open);for(const record of records){if(record.attributeName==='open'&&!dialog.open)collapse();if(record.attributeName==='data-chrome'&&dialog.dataset.chrome==='hidden'&&!panel.contains(document.activeElement))collapse();}}).observe(dialog,{attributes:true,attributeFilter:['open','data-chrome']});
 new MutationObserver(clearance).observe(dialog,{attributes:true,attributeFilter:['open']});
 const api={expand,collapse,expanded:()=>expanded,addSection,choose:name=>{const index=sections.findIndex(item=>item.id==='reader-tools-'+name.toLowerCase());if(index>=0)choose(index);}};collapse();return api;
})();
