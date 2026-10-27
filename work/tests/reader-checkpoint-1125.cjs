const fs=require('fs'),vm=require('vm'),assert=require('assert');
const nodes=[{textContent:'A sentence about the morning garden. '.repeat(22)}],elements=new Map();
const q=id=>{if(!elements.has(id))elements.set(id,{value:'',dataset:{},textContent:'',querySelectorAll:()=>nodes});return elements.get(id)};
q('narrator-voice').value='custom:amazing';
const c={nodesForTest:{textContent:'A sample segment.'},window:{},document:{getElementById:q}};vm.createContext(c);
vm.runInContext(fs.readFileSync('outputs/ThingsBook/vendor/listening.js','utf8'),c);
let source=fs.readFileSync('outputs/ThingsBook/reader.js','utf8').replace('return {init,open,close,stop,active:', 'return {_seed:s=>{session=s;},_limit:speechLimit,_chunks:narrationChunks,_resume:resumeListening,_observe:player=>{playing=true;paused=false;audio=player;observeAudio(speechEpoch,0,nodesForTest,"A sample segment.");},_paused:value=>{paused=value;},init,open,close,stop,active:');
vm.runInContext(source+'\nglobalThis.api=ThingsReader;globalThis.core=ReaderCore;',c);
const text=nodes[0].textContent,owner={location:0,paragraph:0,progress:{}};c.api._seed(owner);
assert.equal(c.api._limit(text),100);assert(c.api._chunks(text).every(t=>t.length<=100));
for(const limit of [600,220]){
 const old=c.core.speechChunks(text,limit),saved=c.window.ListeningCore.checkpoint({location:0,paragraph:0,chunk:1,character:4},text);saved.audioSeconds=3.5;if(limit===220)saved.chunkLimit=limit;owner.progress.listening=saved;
 const expected=c.window.ListeningCore.rechunk(saved,{location:0,paragraph:0},text,old,c.api._chunks(text));const resumed=c.api._resume();assert.equal(resumed.chunk,expected.chunk);assert.equal(resumed.character,expected.character);assert.equal(resumed.audioSeconds,0);assert.equal(owner.progress.listening.chunkLimit,100);
}
q('narrator-voice').value='windows:test';assert.equal(c.api._limit(text),100,'Voice changes retain current checkpoint boundaries');
owner.paragraph=1;assert.equal(c.api._limit(text),600);q('narrator-voice').value='custom:amazing';assert.equal(c.api._limit(text),100);
let highlighted=0,cleared=0;c.window.ThingsSanctuary={narrating(){highlighted++;},narrationStopped(){cleared++;}};const audio={volume:1};c.api._observe(audio);audio.onwaiting();assert.equal(q('reader-dialog').dataset.narration,'buffering');assert.match(q('reader-message').textContent,/Preparing the next words/);assert.equal(cleared,1);audio.onplaying();assert.equal(q('reader-dialog').dataset.narration,'playing');assert.equal(highlighted,1);c.api._paused(true);audio.onwaiting();assert.equal(q('reader-dialog').dataset.narration,'playing','Stale waiting cannot overwrite a paused session');
console.log('PASS: real audio waiting/playing status and highlight lifecycle.');
console.log('PASS: short neural segments, legacy audio timestamp/boundaries and voice-change checkpoint compatibility.');
