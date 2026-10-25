'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs');
class NativeCore {
  constructor(binary){this.binary=binary;this.child=null;this.buffer='';this.pending=new Map();this.sequence=0;this.generation=0;this.queue=Promise.resolve();}
  available(){return fs.existsSync(this.binary);}
  cancel(){this.generation++;const child=this.child;this.child=null;if(child)child.kill();this.buffer='';for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('Private search stopped.'));}this.pending.clear();}
  start(){if(this.child)return;if(!this.available())throw new Error('The native search engine is not installed.');
    const child=spawn(this.binary,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;child.stdout.setEncoding('utf8');child.stderr.resume();child.stdin.on('error',()=>{});
    const closed=()=>{if(this.child===child)this.cancel();};child.on('error',closed);child.on('close',closed);
    child.stdout.on('data',chunk=>{if(this.child!==child)return;this.buffer+=chunk.toString('utf8');if(this.buffer.length>4*1024*1024){this.cancel();return;}let end;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);try{const result=JSON.parse(line),item=this.pending.get(result.id);if(!item)continue;this.pending.delete(result.id);clearTimeout(item.timer);result.error?item.reject(new Error(result.error)):item.resolve(result.value);}catch{this.cancel();return;}}});
  }
  request(value){this.start();const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.cancel(),120000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...value,id})+'\n');});}
  run(operation){const generation=this.generation;const task=this.queue.catch(()=>{}).then(()=>{if(generation!==this.generation)throw new Error('Private search stopped.');return operation();});this.queue=task.catch(()=>{});return task;}
  index(book,bytes){return this.run(async()=>{await this.request({op:'begin',size:bytes.length,format:book.format,bookId:book.id,title:book.title,author:book.author});for(let offset=0;offset<bytes.length;offset+=64*1024)await this.request({op:'chunk',hex:bytes.subarray(offset,offset+64*1024).toString('hex')});return this.request({op:'finish'});}).finally(()=>bytes.fill(0));}
  search(query){return this.run(()=>this.request({op:'search',query}));}
}
module.exports={NativeCore};
