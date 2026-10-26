'use strict';
window.ThingsNativeSearch=(()=>{
  const bridge=window.ThingsBookDesktop?.nativeCoreStatus?window.ThingsBookDesktop:window.ThingsPortableSearch;let epoch=0,indexed=new Set(),running=false;
  if(!bridge?.nativeCoreStatus)return {clear(){}};
  const dialog=el('dialog','sanctuary-dialog'),heading=el('div','dialog-heading');dialog.id='native-search-dialog';
  const close=el('button','secondary','Close');close.type='button';close.onclick=()=>dialog.close();heading.append(el('h2','','Search your book text'),close);dialog.append(heading);
  const help=el('p','fine','Private search for EPUB, TXT and PDF text. The index stays in memory and is discarded when you lock. Scanned PDF pages are included once they have been recognized.');
  const input=el('input');input.type='search';input.maxLength=200;input.placeholder='Find words across your books';input.setAttribute('aria-label','Words to find in your books');
  const build=el('button','secondary','Build private search index'),search=el('button','primary','Search'),status=el('p','fine'),results=el('div','command-results');status.setAttribute('role','status');if(bridge===window.ThingsPortableSearch)help.textContent='Private EPUB, TXT and PDF text search on this device. Literal words, up to16 MB per file,2 million text characters per book and8 million total;50 passage results. The index clears on close library. Scanned PDF pages are included once they have been recognized.';dialog.append(help,input,build,search,status,results);document.body.append(dialog);
  function clear(){epoch++;indexed.clear();input.value='';results.replaceChildren();status.textContent='';dialog.close();bridge.clearSearch();}
  // PDFs are indexed through a text-only EPUB with one chapter per page (blank pages included, so the
  // numbering stays aligned): either search engine accepts it, and a match's chapter is the PDF page.
  // Pages are read by byte range for chunked books. Scanned pages are indexed from text recognized earlier, when there is some.
  async function pdfAsEpub(book){const source=await bookSource(book.id),data=source?null:await (await bookBlob(book.id)).arrayBuffer()
const doc=await ThingsReader.inspectPdf(data,undefined,source)
try{const parts=[];let total=0
for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();page.cleanup?.()
let text=content.items.map(item=>item.str||'').join(' ').replace(/\s+/g,' ').trim();if(!text&&typeof loadRecognizedPage==='function')text=(await loadRecognizedPage(book.id,n-1).catch(()=>null))?.text?.replace(/\s+/g,' ').trim()||'';total+=text.length;if(total>2000000)break
parts.push({path:'page'+n+'.xhtml',title:'Page '+n,xhtml:ThingsEpubWriter.xhtml('Page '+n,'<p>'+ThingsEpubWriter.escape(text)+'</p>')})
if(n%10===0)await new Promise(resolve=>setTimeout(resolve,0))}
if(!total)throw Error('This PDF has no text layer or recognized text.')
return ThingsEpubWriter.build({title:book.title,parts})}
finally{source?.close?.();Promise.resolve(doc.destroy()).catch(()=>{})}}
  async function index(){if(running||!key)return;running=true;const owner=key,generation=epoch;build.disabled=search.disabled=true;let failures=0;try{const supported=books.filter(book=>['EPUB','TXT','PDF'].includes(book.format)&&!indexed.has(book.id));for(let i=0;i<supported.length;i++){
      if(key!==owner||generation!==epoch)return;status.textContent='Indexing '+(i+1)+' of '+supported.length+' books…';const book=supported[i];let data;
      try{data=book.format==='PDF'?await pdfAsEpub(book):new Uint8Array(await (await bookBlob(book.id)).arrayBuffer());if(key!==owner||generation!==epoch)return;await bridge.indexBook({id:book.id,title:book.title,author:book.author,format:book.format==='PDF'?'EPUB':book.format},data);if(key!==owner||generation!==epoch)return;indexed.add(book.id);}catch{if(key!==owner||generation!==epoch)return;failures++;}finally{data?.fill(0);}
    }if(generation===epoch)status.textContent=indexed.size+' books indexed privately.'+(failures?' '+failures+' could not be indexed; try a smaller selection or a repaired file.':'');
  }finally{running=false;build.disabled=search.disabled=false;}}
  build.onclick=()=>index().catch(()=>{status.textContent='Indexing could not finish.';});
  async function find(){const generation=epoch;if(!key||running)return;const query=input.value.trim();if(!query)return;if(!indexed.size)await index();if(generation!==epoch||!key)return;results.replaceChildren();search.disabled=true;try{const matches=await bridge.searchLibrary(query);if(generation!==epoch||!key)return;for(const match of matches){const book=books.find(item=>item.id===match.bookId);if(!book)continue;const row=el('button','secondary');row.type='button';row.append(el('strong','',book.title),el('span','',String(match.text).slice(0,220)));row.onclick=async()=>{dialog.close();await readBook(book.id);const chapter=Number(String(match.location).match(/^chapter:(\d+)/)?.[1]||0);const current=ThingsReader.context();let target=chapter;if(book.format==='TXT'){const terms=query.toLocaleLowerCase().split(/\s+/);target=current?.textChapters?.findIndex(part=>terms.every(term=>part.join(' ').toLocaleLowerCase().includes(term)))??-1;}if(current&&target>=0)await ThingsReader.jump(target);else toast('This match spans reading sections. Use Search this book to locate it.');document.getElementById('reader-search').value=query;document.getElementById('reader-find').click();};results.append(row);}status.textContent=matches.length?'Showing '+matches.length+' matching passages.':'No matching passages in indexed books.';}catch{if(generation===epoch)status.textContent='Search could not finish.';}finally{search.disabled=false;}}
  search.onclick=()=>find().catch(()=>{});input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();find().catch(()=>{});}};
  const open=el('button','nav-item','Search book text');open.type='button';open.onclick=async()=>{const state=await bridge.nativeCoreStatus();if(!state.available){toast('The native search engine is missing. Install the latest Windows build.');return;}if(!key)return;dialog.showModal();input.focus();};document.getElementById('reading-filter').after(open);
  return {clear};
})();
