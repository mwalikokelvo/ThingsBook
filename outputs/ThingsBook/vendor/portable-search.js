 'use strict';
/* Portable bounded in-memory search for platforms without the Windows worker. */
window.ThingsPortableSearch=(()=>{
 const indexed=new Map();let epoch=0,total=0;
 function clearSearch(){epoch++;indexed.clear();total=0;}
 async function indexBook(book,bytes){const generation=epoch;if(!book||!['EPUB','TXT'].includes(book.format)||bytes.length>16*1024*1024)throw Error('Portable search supports EPUB/TXT files up to16 MB.');let files=null;const records=[];let size=0;
 const add=(value,chapter)=>{const valueText=String(value).replace(/\s+/g,' ').trim();if(!valueText)return;size+=valueText.length;if(size>2000000)throw Error('This book exceeds the portable text limit.');for(let n=0;n<valueText.length;n+=2200)records.push({bookId:book.id,location:'chapter:'+chapter,text:valueText.slice(n,n+2400),fold:valueText.slice(n,n+2400).toLocaleLowerCase()});};
 try{if(book.format==='EPUB'){const parsed=ReaderCore.epub(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));files=parsed.files;for(let i=0;i<parsed.chapters.length;i++){if(generation!==epoch)throw Error('Search closed.');add(parsed.chapters[i].body.textContent,i);if(i%5===0)await new Promise(r=>setTimeout(r,0));}}else{const text=ReaderCore.decodeText?ReaderCore.decodeText(bytes):new TextDecoder().decode(bytes);const paragraphs=ReaderCore.paragraphs(text);for(let i=0;i<paragraphs.length;i+=40){add(paragraphs.slice(i,i+40).join(' '),i/40);if(i%400===0)await new Promise(r=>setTimeout(r,0));}}
 if(generation!==epoch)throw Error('Search closed.');const previous=indexed.get(book.id)?.size||0;if(total-previous+size>8000000)throw Error('Portable search has reached its8 million character limit.');indexed.set(book.id,{records,size});total=total-previous+size;
 }finally{for(const file of Object.values(files||{}))file.fill(0);}
 }
 async function searchLibrary(query){const generation=epoch,terms=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0,20),results=[];if(!terms.length)return results;let count=0;for(const {records}of indexed.values())for(const record of records){if(generation!==epoch)return [];if(terms.every(term=>record.fold.includes(term))){const first=Math.max(0,record.fold.indexOf(terms[0])-70);results.push({bookId:record.bookId,location:record.location,text:record.text.slice(first,first+220)});if(results.length>=50)return results;}if(++count%300===0)await new Promise(r=>setTimeout(r,0));}return results;}
 return {nativeCoreStatus:async()=>({available:true,portable:true}),indexBook,searchLibrary,clearSearch};
})();
