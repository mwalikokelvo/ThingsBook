'use strict';
window.__deviceChecks={mode:'recovered-reader-no-save',finished:false,passed:false};
(async()=>{const r=window.__deviceChecks,q=id=>document.getElementById(id),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));try{
 for(let n=0;n<150&&!key;n++){if(typeof db!=='undefined'&&db&&config&&hasDeviceAccess&&!busy)await unlock({preventDefault(){}});if(!key)await wait(100);}
 if(!key){r.reason='local-unlock-needed';return;}
 r.research_restored=typeof ResearchCore.hydrate==='function'&&typeof ThingsResearch.peek==='function';r.links_api=typeof ThingsResearch.createLink==='function'&&typeof ThingsResearch.getLinksFor==='function';r.citations=ThingsCitation.format({id:'fixture',title:'A test book',author:'A reader',year:2026,publisher:'Local Press'},'BibTeX').includes('Local Press');
 const book=books.find(b=>b.format==='PDF'&&/omnibus/i.test((b.title||'')+' '+(b.filename||'')))||books.find(b=>b.format==='PDF');if(!book){r.reason='no-pdf-for-device-check';return;}
 await ThingsReader.open({...book,progress:{...book.progress,location:0,paragraph:0,listening:null,ocr:false,layout:'concurrent',scope:'book',volume:0}},await bookBlob(book.id),async()=>{});q('reader-dialog').showModal();ThingsReaderDock.collapse();
 const s=ThingsReader.context();r.pages=s.count;r.pdf_image=!!s.pdfCanvas;r.pdf_transcript=!!s.pdfTranscript;const visual=document.querySelector('.reader-pane-visual').getBoundingClientRect(),text=document.querySelector('.reader-pane-text').getBoundingClientRect();r.panes_visible=visual.height>100&&text.height>100&&visual.width>100&&text.width>100;r.mobile_panes_stacked=innerWidth>720||text.y>visual.y;
 if(!q('reader-content').querySelector('.reader-passage')){await q('narrator-play').onclick();r.scan_guard=!ThingsReader.isSpeaking()&&s.location===0&&/Recognize page/.test(q('reader-message').textContent);const start=performance.now();await q('reader-ocr').onclick();r.recognition_ms=Math.round(performance.now()-start);r.recognized_characters=[...q('reader-content').querySelectorAll('.reader-passage')].reduce((n,p)=>n+p.textContent.length,0);r.ocr_error=!!s.ocrError;}else r.scan_guard='not-needed-on-text-page';
 r.passed=r.research_restored&&r.links_api&&r.citations&&r.pdf_image&&r.pdf_transcript&&r.panes_visible&&r.mobile_panes_stacked&&!!r.scan_guard&&!r.ocr_error;
}catch(e){r.error_type=e.name||'Error';}finally{r.finished=true;}})();
