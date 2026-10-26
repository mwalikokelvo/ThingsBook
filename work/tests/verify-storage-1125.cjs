const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const path = require('node:path');
const nodes = new Map();
function node(id) { if (!nodes.has(id)) nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,required:false,files:[],classList:{add(){},remove(){},toggle(){}},replaceChildren(){},focus(){},reset(){},close(){},showModal(){}}); return nodes.get(id); }
const memory = {settings:new Map(), books:new Map(), chunks:new Map()};
// Minimal IndexedDB stand-in. "chunks" uses the compound key [book, index]; a key range covers one book.
const storeKey = (name, key) => name === 'chunks' ? JSON.stringify(key) : key;
const inRange = (name, key, range) => name === 'chunks' && JSON.parse(key)[0] === range.lower[0];
const fakeRequest = produce => { const req = {}; queueMicrotask(() => { req.result = produce(); req.onsuccess?.(); }); return req; };
const fakeDb = {transaction(stores,mode) { const tx = {objectStore(name) { const map = memory[name]; return {
  get(key){ return fakeRequest(() => map.get(storeKey(name,key))); },
  openCursor(){ const req = {}, values = [...map.values()]; let index = 0; const next = () => queueMicrotask(() => {req.result = index < values.length ? {value:values[index++],continue:next} : null; req.onsuccess();}); next(); return req; },
  getAll(){ return fakeRequest(() => [...map.values()]); },
  getAllKeys(){ return fakeRequest(() => [...map.keys()].map(k => name === 'chunks' ? JSON.parse(k) : k)); },
  put(value,id){ map.set(name === 'chunks' ? storeKey(name,[value.book,value.index]) : id || value.id, structuredClone(value)); },
  add(value){ assert(!map.has(value.id)); map.set(value.id, structuredClone(value)); },
  clear(){ map.clear(); },
  delete(key){ if (key && key.lower !== undefined) { for (const k of [...map.keys()]) if (inRange(name,k,key)) map.delete(k); } else map.delete(storeKey(name,key)); }
};},abort(){}}; if (mode === 'readwrite') queueMicrotask(() => tx.oncomplete()); return tx; }};
const context = vm.createContext({IDBKeyRange:{bound:(lower,upper) => ({lower,upper})},console,TextEncoder,TextDecoder,crypto:webcrypto,Uint8Array,ArrayBuffer,Blob,URL,atob,btoa,structuredClone,queueMicrotask,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,navigator:{},document:{getElementById:node,querySelectorAll:()=>[]},window:{},location:{}});
const source = fs.readFileSync(process.argv[2] || path.resolve('outputs/ThingsBook/app.js'),'utf8').replace(/init\(\);\s*$/,'');
const vaultPath = path.join(path.dirname(process.argv[2] || path.resolve('outputs/ThingsBook/app.js')), 'vendor/vault.js');
if (fs.existsSync(vaultPath)) vm.runInContext(fs.readFileSync(vaultPath,'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(path.dirname(vaultPath),'storage.js'),'utf8'),context);
// THINGSBOOK_TEST_STREAM_BACKUP=1 forces backup version 2 so the same end-to-end path covers both formats.
const streamBackup = process.env.THINGSBOOK_TEST_STREAM_BACKUP === '1', legacyLibrary = process.env.THINGSBOOK_TEST_LEGACY_LIBRARY === '1', backupPath = path.join(path.dirname(vaultPath),'backup.js');
if (fs.existsSync(backupPath)) { let code = fs.readFileSync(backupPath,'utf8'); if (streamBackup) { const forced = code.replace('const LEGACY_LIMIT = 256 * 1024 * 1024;','const LEGACY_LIMIT = 0;'); assert.notEqual(forced,code); code = forced; } vm.runInContext(code,context); }
const chunksPath = path.join(path.dirname(vaultPath),'chunks.js');
if (fs.existsSync(chunksPath)) vm.runInContext(fs.readFileSync(chunksPath,'utf8'),context);
vm.runInContext(source,context);
context.fakeDb = fakeDb;
const run = code => vm.runInContext(code,context);
run('db = fakeDb; render = () => {}; toast = message => { window.lastToast = message; }; downloadBlob = (blob,filename) => { window.download = {blob,filename}; };');
async function main() {
  node('password').value = 'Test-only library password'; node('confirm-password').value = 'Test-only library password';
  await run('unlock({preventDefault(){}})');
  assert.equal(run('!!key'),true); assert(memory.settings.has('vault')); assert(memory.settings.has('device-access')); assert.equal(memory.settings.get('device-access').key.extractable,false);
  const originalSalt = memory.settings.get('vault').salt;
  assert.equal(originalSalt.length,16);
  await run("saveShelves([...shelves,{id:'test-shelf',name:'Private favorites'}])");
  const file = new Blob(['A private chapter. <script>not executed</script>']);
  file.name = 'Quiet.txt'; node('book-files').files = [file];
  node('book-title').value = 'Quiet'; node('book-author').value = 'Private Author'; node('book-rating').value = '0'; node('book-color').value = '#31534a'; node('shelf-select').value = 'test-shelf';
  await run('upload({preventDefault(){}})');
  assert.equal(run('books.length'),1); assert.equal(run('books[0].rating'),0);
  const id = run('books[0].id'), record = memory.books.get(id);
  // New books are stored as sealed pieces; the book record itself holds no file bytes.
  assert.equal(record.file,undefined); assert.deepEqual(record.chunks,{count:1,bytes:48});
  const pieces = () => [...memory.chunks.values()].filter(part => part.book === id);
  assert.equal(pieces().length,1); assert(!Buffer.from(pieces()[0].data).includes(Buffer.from('A private chapter')));
  assert(!Buffer.from(record.meta.data).includes(Buffer.from('Private Author')));
  assert(!Buffer.from(memory.settings.get('vault').library.data).includes(Buffer.from('Private favorites')));
  assert.equal(await (await run(`bookBlob('${id}')`)).text(),'A private chapter. <script>not executed</script>');
  // A tampered piece, or a piece moved to another position, is rejected and then repaired for the rest of the test.
  const pieceKey = JSON.stringify([id,0]), original = memory.chunks.get(pieceKey);
  memory.chunks.set(pieceKey,{...structuredClone(original),data:(() => { const d = original.data.slice(0); new Uint8Array(d)[0] ^= 1; return d; })()});
  await assert.rejects(run(`bookBlob('${id}')`),/damaged or incomplete/);
  memory.chunks.set(pieceKey,{...structuredClone(original),index:1}); await assert.rejects(run(`bookBlob('${id}')`),/damaged or incomplete/);
  memory.chunks.delete(pieceKey); await assert.rejects(run(`bookBlob('${id}')`),/damaged or incomplete/);
  memory.chunks.set(pieceKey,original); assert.equal(await (await run(`bookBlob('${id}')`)).text(),'A private chapter. <script>not executed</script>');
  // Pieces left by an interrupted import are removed; pieces of a book still being imported are kept.
  memory.chunks.set(JSON.stringify(['ghost',0]),{book:'ghost',index:0,iv:new Uint8Array(12),data:new ArrayBuffer(32)});
  memory.chunks.set(JSON.stringify(['in-flight',0]),{book:'in-flight',index:0,iv:new Uint8Array(12),data:new ArrayBuffer(32)});
  run("importingBooks.add('in-flight')"); await run('removeOrphanChunks()'); await new Promise(r => setTimeout(r,0));
  assert(!memory.chunks.has(JSON.stringify(['ghost',0]))); assert(memory.chunks.has(JSON.stringify(['in-flight',0]))); assert(memory.chunks.has(pieceKey));
  run("importingBooks.delete('in-flight')"); memory.chunks.delete(JSON.stringify(['in-flight',0]));
  // THINGSBOOK_TEST_LEGACY_LIBRARY=1 rewrites the book in the 1.12.5 whole-file layout, so the rest of
  // the flow (edit, backup version 1, restore, read) runs against a library made by earlier releases.
  if (legacyLibrary) {
    await run(`(async () => { const r = await getRecord('${id}'), plain = new Uint8Array(await (await bookBlob('${id}')).arrayBuffer()); delete r.chunks; r.file = await seal(plain); await transaction(['books','chunks'],tx => { tx.objectStore('books').put(r); tx.objectStore('chunks').delete(chunkRange('${id}')); }); })()`);
    assert(memory.books.get(id).file && !memory.books.get(id).chunks && !pieces().length);
    assert.equal(await (await run(`bookBlob('${id}')`)).text(),'A private chapter. <script>not executed</script>');
  }
  await run(`updateBook('${id}',{notes:'Page 42',status:'reading',rating:5,series:'Private series',year:2024,tags:['history'],progress:{location:3,percent:47,scratchpad:{3:{text:'Secret chapter reflection',created:123}},readingSeconds:120,tracking:0.04,measure:68,sleep:15},bookmarks:[{id:'mark',location:3}],highlights:[{id:'highlight',text:'private highlight'}],flashcards:[{id:'card',front:'Private recall question',back:'Private recall answer',schedule:{due:'2026-10-06T12:00:00.000Z'},reviews:[]}]})`);
  await run('backup()'); const backup = context.window.download.blob;
  // Version 1 is only possible for whole-file books; chunked books always stream as version 2.
  if (legacyLibrary && !streamBackup) assert.equal(JSON.parse(await backup.text()).books.length,1); else assert((await backup.text()).startsWith('ThingsBook encrypted backup v2\n'));assert(!(await backup.text()).includes('Secret chapter reflection'));assert(!Buffer.from(memory.books.get(id).meta.data).includes(Buffer.from('Secret chapter reflection')));
  assert(! (await backup.text()).includes('Private Author'));assert(!(await backup.text()).includes('Private recall question'));assert(!Buffer.from(memory.books.get(id).meta.data).includes(Buffer.from('Private recall answer')));
  await run('lock()'); assert.equal(run('key'),null); assert.equal(run('books.length'),0);
  node('password').value = 'Incorrect-password'; await run('unlock({preventDefault(){}})'); assert.equal(run('key'),null); assert.match(node('gate-error').textContent,/incorrect/);
  node('password').value = 'Test-only library password'; await run('unlock({preventDefault(){}})');
  assert.equal(run('books.length'),1); assert.equal(run('books[0].notes'),'Page 42'); assert.equal(run('books[0].progress.location'),3); assert.equal(run('books[0].bookmarks.length'),1); assert.equal(run('books[0].highlights[0].text'),'private highlight'); assert.equal(run('books[0].status'),'reading'); assert.equal(run('shelves.length'),2);
  // Validate restoring the exported ciphertext, including an incorrect password.
  await run('restoreFile(window.download.blob)'); assert.equal(run('!!pendingBackup'),true);
  node('password').value = 'Wrong-backup-password'; await run('unlock({preventDefault(){}})'); assert.equal(memory.books.size,1); assert.equal(run('key'),null);
  node('password').value = 'Test-only library password'; await run('unlock({preventDefault(){}})'); assert.equal(run('pendingBackup'),null); assert.equal(run('books[0].notes'),'Page 42');assert.equal(run('books[0].progress.scratchpad[3].text'),'Secret chapter reflection');assert.equal(run('books[0].series'),'Private series');assert.equal(run('books[0].progress.readingSeconds'),120);assert.equal(run('books[0].tags[0]'),'history');assert.equal(run('books[0].flashcards[0].front'),'Private recall question');
  assert.equal(await (await run(`bookBlob('${id}')`)).text(),'A private chapter. <script>not executed</script>');
  // Invalid uploads must not create a file; unsupported extensions and oversize.
  const invalid = new Blob(['not a pdf']); invalid.name = 'broken.pdf'; node('book-files').files = [invalid]; await run('upload({preventDefault(){}})'); assert.equal(memory.books.size,1); assert.match(node('upload-error').textContent,/valid PDF/);
  node('book-files').files = [{name:'huge.txt',size:101*1024*1024}]; await run('upload({preventDefault(){}})'); assert.equal(memory.books.size,1); assert.match(node('upload-error').textContent,/100 MB/);
  // PDFs may be up to 500 MB (they are streamed); larger ones are refused with a PDF-specific message.
  node('book-files').files = [{name:'huge.pdf',size:501*1024*1024,slice:() => new Blob(['%PDF-1.7 synthetic header'])}]; await run('upload({preventDefault(){}})'); assert.equal(memory.books.size,1); assert.match(node('upload-error').textContent,/PDF under 500 MB/);
  const chunks = []; let finished = false, cancelled = false;
  context.window.ThingsBookAndroid = {beginTransfer(name,mime,mode){assert.equal(mode,'export');return true;},writeChunk(chunk){assert(chunk.length<=140000);chunks.push(Buffer.from(chunk,'base64'));return true;},finishTransfer(){finished=true;return true;},cancelTransfer(){cancelled=true;}};
  context.androidPayload = new Blob(['sample data '.repeat(30000)],{type:'text/plain'});
  await run("nativeTransfer(androidPayload,'sample.txt','export')");
  assert.equal(Buffer.concat(chunks).toString(),'sample data '.repeat(30000)); assert(finished); assert(!cancelled);
  context.window.ThingsBookAndroid.writeChunk=()=>false;
  await assert.rejects(run("nativeTransfer(androidPayload,'sample.txt','export')")); assert(cancelled);
  console.log('PASS: create vault, encrypted metadata/files/shelves, upload, zero rating, decrypt original, tamper rejection, edit, export encrypted backup, lock, reject wrong passwords, reload persisted records, restore backup, invalid PDF and size limits, chunked Android export and error cleanup.');
}
main().catch(e => {console.error(e);process.exitCode=1;});

