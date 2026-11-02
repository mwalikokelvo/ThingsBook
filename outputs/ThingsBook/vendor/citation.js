'use strict';
// Citation drafts use only saved metadata; missing publication details stay visible.
window.ThingsCitation=(()=>{
 const clean=(v,fallback='')=>String(v??fallback).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,500)||fallback;
 // Stable key: the id's letters and digits as before; an id with none (or no id at all) gets a short hash of the whole id, so different books never share a key.
 const hash=v=>{let h=0x811c9dc5;for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16).padStart(8,'0');};
 const bibKey=book=>{const id=String(book.id??''),base=id.replace(/[^a-z0-9]/gi,'');return 'thingsbook_'+(base||(id?'x'+hash(id):'book'));};
 function format(book,style='APA',page=null){
  if(!book)return 'Missing book metadata';
  const author=clean(book.author,'Unknown author'),title=clean(book.title,'Untitled'),year=clean(book.year,'n.d.'),publisher=clean(book.publisher),kind=String(style).toLowerCase();
  if(kind==='bibtex'){const safe=v=>String(v).replace(/[{}\\]/g,'').replace(/[&%#_$]/g,c=>'\\'+c);const hasPage=page!==null&&page!==undefined&&clean(page);return '@book{'+bibKey(book)+',\n  title = {'+safe(title)+'},\n  author = {'+safe(author)+'},\n  year = {'+safe(year)+'}'+(publisher?',\n  publisher = {'+safe(publisher)+'}':'')+(hasPage?',\n  pages = {'+safe(clean(page).replace(/\s*[-–—]+\s*/g,'--'))+'}':'')+'\n}';}
  const end=v=>/[.!?]$/.test(v)?v:v+'.';
  let text=kind==='mla'||kind==='chicago'?author+'. '+end(title)+' '+(publisher?publisher+', ':'')+end(year):author+'. ('+year+'). '+end(title)+(publisher?' '+end(publisher):'');
  if(page!==null&&page!==undefined&&String(page).trim())text+=' '+(kind==='mla'?'Page '+clean(page)+'.':'(p. '+clean(page)+').');
  return text;
 }
 return {format};
})();
