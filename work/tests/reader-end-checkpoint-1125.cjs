'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const chapters=[['Already finished.','Continue reading without another tap.'],['The next page continues.']],rows=chapters[0].map(textContent=>({textContent,classList:{toggle(){},remove(){}},scrollIntoView(){}}));
const session={location:0,paragraph:0,count:2,textChapters:chapters,progress:{},saveQueue:Promise.resolve(),save:async()=>{}};
const elements=new Map(),q=id=>{if(!elements.has(id))elements.set(id,{value:'',dataset:{},checked:true,textContent:'',style:{},classList:{toggle(){},remove(){}},querySelectorAll:()=>rows});return elements.get(id);};
q('narrator-voice').value='custom:test';q('narrator-scope').value='book';q('narrator-speed').value='1';q('narrator-sleep').value='0';q('reader-layout').value='scroll';
const generated=[];let empty=false;
class Audio{constructor(){}async play(){setImmediate(()=>this.onended?.());}pause(){}removeAttribute(){}load(){}}
const c={window:{ThingsBookDesktop:{stopSpeech(){},async synthesizeCustom(text){if(!text.trim()){empty=true;throw Error('No spoken text');}generated.push(text);return new Uint8Array([1,2]);}}},document:{getElementById:q},Audio,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout:()=>0,clearTimeout(){},showLocation:async n=>{session.location=n;session.paragraph=0;rows.splice(0,rows.length,...chapters[n].map(textContent=>({textContent,classList:{toggle(){},remove(){}},scrollIntoView(){}})));}};
vm.createContext(c);vm.runInContext(fs.readFileSync('outputs/ThingsBook/vendor/listening.js','utf8'),c);
let source=fs.readFileSync('outputs/ThingsBook/reader.js','utf8').replace('async function showLocation(', 'async function unusedLocation(').replace('return {init,open,close,stop,active:', 'return {_seed:s=>{session=s;},_play:playPause,init,open,close,stop,active:');
vm.runInContext(source+'\nglobalThis.api=ThingsReader;',c);c.api._seed(session);
session.progress.listening={...c.window.ListeningCore.checkpoint({location:0,paragraph:0,chunk:0,character:chapters[0][0].length},chapters[0][0]),chunkLimit:100};
(async()=>{await c.api._play();for(let n=0;n<100;n++)await new Promise(setImmediate);assert.equal(empty,false,'A completed saved phrase must advance rather than requesting empty synthesis and stopping');assert.deepEqual(generated,['Continue reading without another tap.','The next page continues.']);assert.equal(session.completed,true);console.log('PASS: completed saved phrase advances across paragraphs/pages; empty synthesis cannot silently stop resume.');})().catch(e=>{console.error(e);process.exitCode=1;});
