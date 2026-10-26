const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const path = require('node:path');
const nodes = new Map();
function node(id) { if (!nodes.has(id)) nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,required:false,files:[],classList:{add(){},remove(){},toggle(){}},replaceChildren(){},focus(){},reset(){},close(){},showModal(){}}); return nodes.get(id); }
const memory = {settings:new Map(), books:new Map()};
const fakeDb = {transaction(stores,mode) { const tx = {objectStore(name) { const map = memory[name]; return {get(id){ const req = {}; queueMicrotask(() => {req.result = map.get(id); req.onsuccess();}); return req;},openCursor(){ const req = {}, values = [...map.values()]; let index = 0; const next = () => queueMicrotask(() => {req.result = index < values.length ? {value:values[index++],continue:next} : null; req.onsuccess();}); next(); return req; },getAll(){const req = {}; queueMicrotask(() => {req.result = [...map.values()]; req.onsuccess();}); return req;},put(value,id){map.set(id || value.id,structuredClone(value));},add(value){assert(!map.has(value.id));map.set(value.id,structuredClone(value));},clear(){map.clear();},delete(id){map.delete(id);}};},abort(){}}; if (mode === 'readwrite') queueMicrotask(() => tx.oncomplete()); return tx; }};
const context = vm.createContext({console,TextEncoder,TextDecoder,crypto:webcrypto,Uint8Array,ArrayBuffer,Blob,URL,atob,btoa,structuredClone,queueMicrotask,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,navigator:{},document:{getElementById:node,querySelectorAll:()=>[]},window:{},location:{}});
const source = fs.readFileSync(process.argv[2] || path.resolve('outputs/ThingsBook/app.js'),'utf8').replace(/init\(\);\s*$/,'');
const vaultPath = path.join(path.dirname(process.argv[2] || path.resolve('outputs/ThingsBook/app.js')), 'vendor/vault.js');
if (fs.existsSync(vaultPath)) vm.runInContext(fs.readFileSync(vaultPath,'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(path.dirname(vaultPath),'storage.js'),'utf8'),context);
// THINGSBOOK_TEST_STREAM_BACKUP=1 forces backup version 2 so the same end-to-end path covers both formats.
const streamBackup = process.env.THINGSBOOK_TEST_STREAM_BACKUP === '1', backupPath = path.join(path.dirname(vaultPath),'backup.js');
if (fs.existsSync(backupPath)) { let code = fs.readFileSync(backupPath,'utf8'); if (streamBackup) { const forced = code.replace('const LEGACY_LIMIT = 256 * 1024 * 1024;','const LEGACY_LIMIT = 0;'); assert.notEqual(forced,code); code = forced; } vm.runInContext(code,context); }
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
  assert(!Buffer.from(record.file.data).includes(Buffer.from('A private chapter')));
  assert(!Buffer.from(record.meta.data).includes(Buffer.from('Private Author')));
  assert(!Buffer.from(memory.settings.get('vault').library.data).includes(Buffer.from('Private favorites')));
  assert.equal(await (await run(`bookBlob('${id}')`)).text(),'A private chapter. <script>not executed</script>');
  context.testRecord = structuredClone(record.file); new Uint8Array(context.testRecord.data)[0] ^= 1;
  await assert.rejects(run('unseal(testRecord)'));
  await run(`updateBook('${id}',{notes:'Page 42',status:'reading',rating:5,series:'Private series',year:2024,tags:['history'],progress:{location:3,percent:47,scratchpad:{3:{text:'Secret chapter reflection',created:123}},readingSeconds:120,tracking:0.04,measure:68,sleep:15},bookmarks:[{id:'mark',location:3}],highlights:[{id:'highlight',text:'private highlight'}],flashcards:[{id:'card',front:'Private recall question',back:'Private recall answer',schedule:{due:'2026-10-06T12:00:00.000Z'},reviews:[]}]})`);
  await run('backup()'); const backup = context.window.download.blob;
  if (streamBackup) assert((await backup.text()).startsWith('ThingsBook encrypted backup v2\n')); else assert.equal(JSON.parse(await backup.text()).books.length,1);assert(!(await backup.text()).includes('Secret chapter reflection'));assert(!Buffer.from(memory.books.get(id).meta.data).includes(Buffer.from('Secret chapter reflection')));
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

