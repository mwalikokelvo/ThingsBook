'use strict';
window.ListeningCore=(()=>{
  const integer=value=>Math.max(0,Math.floor(Number(value)||0));
  function level(value,fallback=1){if(value===''||value==null)return fallback;const number=Number(value);return Number.isFinite(number)?Math.max(0,Math.min(1,number)):fallback;}
  function fingerprint(text){let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return text.length+':'+(hash>>>0).toString(16);}
  function safeOffset(text,value){let offset=Math.min(text.length,integer(value));if(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]))offset--;return offset;}
  function checkpoint(position,text){return {version:1,location:integer(position.location),paragraph:integer(position.paragraph),chunk:integer(position.chunk),character:integer(position.character),fingerprint:fingerprint(text)};}
  function resume(saved,position,text,chunks){if(!saved||saved.version!==1||saved.location!==position.location||saved.paragraph!==position.paragraph||saved.fingerprint!==fingerprint(text))return {chunk:0,character:0,valid:false};const chunk=Math.min(integer(saved.chunk),Math.max(0,chunks.length-1));return {chunk,character:safeOffset(chunks[chunk]||'',saved.character),valid:true};}
  function rechunk(saved,position,text,oldChunks,newChunks){
    const old=resume(saved,position,text,oldChunks);if(!old.valid)return saved;
    const starts=chunks=>{let cursor=0;return chunks.map(chunk=>{const at=text.indexOf(chunk,cursor);if(at<0)throw Error('Narration chunks no longer match the passage');cursor=at+chunk.length;return at;});};
    const before=starts(oldChunks),after=starts(newChunks),offset=before[old.chunk]+old.character;
    let chunk=0;while(chunk+1<after.length&&after[chunk+1]<=offset)chunk++;
    return {...saved,chunk,character:safeOffset(newChunks[chunk]||'',Math.max(0,offset-after[chunk])),audioSeconds:0};
  }
  function fade(remaining,total,span=10000){return Math.max(0,Math.min(1,remaining/Math.max(1,Math.min(total,span))));}
  return Object.freeze({level,checkpoint,resume,rechunk,safeOffset,fade,fingerprint});
})();
