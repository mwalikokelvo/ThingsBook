'use strict';
// Citation drafts use only saved metadata; missing publication details stay visible.
window.ThingsCitation=(()=>{
 const clean=(v,fallback='')=>String(v??fallback).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,500)||fallback;
 function format(book,style='APA',page=null){
  if(!book)return 'Missing book metadata';
  const author=clean(book.author,'Unknown author'),title=clean(book.title,'Untitled'),year=clean(book.year,'n.d.'),publisher=clean(book.publisher),kind=String(style).toLowerCase();
  if(kind==='bibtex'){const safe=v=>String(v).replace(/[{}\\]/g,'');return '@book{thingsbook_'+String(book.id||'book').replace(/[^a-z0-9]/gi,'')+',\n  title = {'+safe(title)+'},\n  author = {'+safe(author)+'},\n  year = {'+safe(year)+'}'+(publisher?',\n  publisher = {'+safe(publisher)+'}':'')+'\n}';}
  const end=v=>/[.!?]$/.test(v)?v:v+'.';
  let text=kind==='mla'||kind==='chicago'?author+'. '+end(title)+' '+(publisher?publisher+', ':'')+year+'.':author+'. ('+year+'). '+end(title)+(publisher?' '+end(publisher):'');
  if(page!==null&&page!==undefined&&String(page).trim())text+=' '+(kind==='mla'?'Page '+clean(page)+'.':'(p. '+clean(page)+').');
  return text;
 }
 return {format};
})();
