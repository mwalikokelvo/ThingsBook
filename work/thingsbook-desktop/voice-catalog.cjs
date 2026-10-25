'use strict';
function voiceCatalog(value){
 if(value?.engine!=='pocket-tts'||value.validated!==true||!Array.isArray(value.voices)||!value.voices.length||value.voices.length>64)throw new Error('Invalid voice catalog');
 const ids=new Set();
 return value.voices.map(item=>{
  if(!item||typeof item.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>120||/[\x00-\x1f\x7f]/.test(item.name))throw new Error('Invalid voice entry');
  ids.add(item.id);return {id:item.id,name:item.name.trim()};
 });
}
module.exports={voiceCatalog};
