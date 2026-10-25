'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('outputs/ThingsBook/vendor/listening.js','utf8'),context);vm.runInContext(fs.readFileSync('outputs/ThingsBook/reader.js','utf8')+'\nglobalThis.chunks=ReaderCore.speechChunks;',context);
const core=context.window.ListeningCore,at={location:2,paragraph:4};
const text=('A repeated phrase. A repeated phrase. 🌿 A quiet reading room. ').repeat(30);
for(const limit of [220,600]){
 const old=context.chunks(text,limit),next=context.chunks(text,100);
 for(let chunk=0;chunk<old.length;chunk++)for(const character of [0,3,old[chunk].length-1]){
  const saved={...core.checkpoint({...at,chunk,character},text),chunkLimit:limit,audioSeconds:7};
  const moved=core.rechunk(saved,at,text,old,next);assert.equal(moved.audioSeconds,0);
  const locate=(chunks,index)=>{let pos=0;for(let n=0;n<=index;n++)pos=text.indexOf(chunks[n],pos)+(n<index?chunks[n].length:0);return pos;};
  assert.equal(locate(next,moved.chunk)+moved.character,locate(old,chunk)+core.safeOffset(old[chunk],character));
 }
}
const stale=core.checkpoint(at,'different text');assert.equal(core.rechunk(stale,at,text,context.chunks(text,600),context.chunks(text,100)),stale);
assert.equal(context.chunks(text,100).every(c=>c.length<=100),true);
console.log('PASS: shorter personal phrases and legacy220/600 saved positions preserve exact Unicode text offsets; stale checkpoints remain invalid.');
