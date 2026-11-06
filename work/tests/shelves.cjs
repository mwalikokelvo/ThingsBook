// Shelf lifecycle: rename and delete never lose a book, the choice is persisted in the encrypted
// library, and deleting the last shelf creates a default shelf instead of orphaning books.
// Runs app.js against a small fake IndexedDB, like verify-storage-1125.cjs.
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const path = require('node:path');

const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {value:'', textContent:'', hidden:false, disabled:false, required:false, open:false, files:[], classList:{add(){},remove(){},toggle(){}}, replaceChildren(){}, focus(){}, reset(){}, close(){}, showModal(){}});
  return nodes.get(id);
}
const memory = {settings:new Map(), books:new Map(), chunks:new Map(), staging:new Map(), ocr:new Map()};
const compound = name => name === 'chunks' || name === 'staging' || name === 'ocr';
const storeKey = (name, key) => compound(name) ? JSON.stringify(key) : key;
const inRange = (name, key, range) => compound(name) && JSON.parse(key)[0] === range.lower[0];
const fakeDb = {transaction(stores, mode) { let pending = 0;
  const request = produce => { const req = {}; pending++; queueMicrotask(() => { req.result = produce(); req.onsuccess?.(); pending--; }); return req; };
  const tx = {objectStore(name) { const map = memory[name]; return {
    get(key){ return request(() => map.get(storeKey(name,key))); },
    openCursor(){ const req = {}, values = [...map.values()]; let index = 0; pending++; const next = () => queueMicrotask(() => { if (index < values.length) { req.result = {value:values[index++],continue:next}; req.onsuccess(); } else { req.result = null; req.onsuccess(); pending--; } }); next(); return req; },
    getAll(range){ return request(() => range && range.lower !== undefined ? [...map.entries()].filter(([k]) => inRange(name,k,range)).map(([,v]) => v) : [...map.values()]); },
    getAllKeys(){ return request(() => [...map.keys()].map(k => compound(name) ? JSON.parse(k) : k)); },
    count(){ return request(() => map.size); },
    put(value,id){ map.set(compound(name) ? storeKey(name,[value.book,name === 'ocr' ? value.page : value.index]) : id || value.id, structuredClone(value)); },
    delete(key){ if (key && key.lower !== undefined) { for (const k of [...map.keys()]) if (inRange(name,k,key)) map.delete(k); } else map.delete(storeKey(name,key)); }
  };},abort(){}};
  if (mode === 'readwrite') { const finish = () => pending ? setImmediate(finish) : tx.oncomplete(); setImmediate(finish); }
  return tx; }};

const context = vm.createContext({IDBKeyRange:{bound:(lower,upper) => ({lower,upper})}, console, TextEncoder, TextDecoder,
  crypto:webcrypto, Uint8Array, ArrayBuffer, Blob, URL, atob, btoa, structuredClone, queueMicrotask,
  setTimeout:() => 1, clearTimeout(){}, navigator:{}, document:{getElementById:node, querySelectorAll:() => [], createElement:() => node('created')}, window:{}, location:{}});
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
vm.runInContext(fs.readFileSync(path.join(app, 'vendor/vault.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(app, 'app.js'), 'utf8').replace(/init\(\);\s*$/, ''), context);
context.fakeDb = fakeDb;
const run = code => vm.runInContext(code, context);
run('db = fakeDb; window.renders = 0; render = () => { window.renders++; }; toast = message => { window.lastToast = message; };');

async function seedBook(id, shelfId, title) {
  await run(`(async () => { const meta = await sealJSON({id:${JSON.stringify(id)},title:${JSON.stringify(title)},author:'A. Writer',shelfId:${JSON.stringify(shelfId)},format:'TXT',rating:0,size:1,filename:'harbour.txt',added:1,status:'unread',notes:''}); await transaction(['books'],tx => tx.objectStore('books').put({id:${JSON.stringify(id)},meta})); })()`);
}
const book = (id, shelfId, title) => `{id:${JSON.stringify(id)},title:${JSON.stringify(title)},author:'A. Writer',shelfId:${JSON.stringify(shelfId)},format:'TXT',rating:0,size:1,filename:'harbour.txt',added:1,status:'unread',notes:''}`;

async function main() {
  node('password').value = 'Shelf test password 1';
  node('confirm-password').value = 'Shelf test password 1';
  await run('unlock({preventDefault(){}})');
  assert.equal(run('!!key'), true, 'library unlocked');

  await run("saveShelves([{id:'shelf-a',name:'Fiction'},{id:'shelf-b',name:'Essays'}])");
  await seedBook('book-1', 'shelf-a', 'Harbour');
  await seedBook('book-2', 'shelf-b', 'Notes');
  run(`books = [${book('book-1','shelf-a','Harbour')},${book('book-2','shelf-b','Notes')}]`);

  const renders = run('window.renders');
  const renamed = await run("renameShelf('shelf-a','  Favourites  ')");
  assert.equal(renamed.error, undefined, 'a valid rename succeeds');
  assert.equal(renamed.name, 'Favourites', 'the name is trimmed');
  assert.equal(run("shelves.find(s => s.id === 'shelf-a').name"), 'Favourites', 'the shelf list is updated');
  assert.deepEqual(Array.from(await run('readJSON(config.library)'), s => s.name), ['Favourites','Essays'], 'the rename is persisted in the encrypted library');
  assert(run('window.renders') > renders, 'the library is redrawn so the sidebar and heading change');

  const empty = await run("renameShelf('shelf-a','   ')");
  assert.match(empty.error, /Enter a shelf name/, 'an empty name is refused');
  const duplicate = await run("renameShelf('shelf-a','essays')");
  assert.match(duplicate.error, /already has that name/, 'a name used by another shelf is refused, ignoring case');
  assert.equal(run("shelves.find(s => s.id === 'shelf-a').name"), 'Favourites', 'a refused rename changes nothing');
  const caseOnly = await run("renameShelf('shelf-a','FAVOURITES')");
  assert.equal(caseOnly.error, undefined, 'changing only the case is allowed');
  assert.equal(run("shelves.find(s => s.id === 'shelf-a').name"), 'FAVOURITES');

  run("filter = 'shelf-a'");
  const removed = await run("deleteShelf('shelf-a')");
  assert.equal(removed.error, undefined, 'deleting a shelf succeeds');
  assert.equal(removed.moved, 1, 'the books on it are reported as moved');
  assert.equal(run('shelves.length'), 1, 'the shelf is gone');
  assert.equal(run('filter'), 'shelf-b', 'the current filter returns to a shelf that still exists');
  assert.equal(run("books.find(b => b.id === 'book-1').shelfId"), 'shelf-b', 'the book is reassigned');
  assert.equal((await run("(async () => readJSON((await getRecord('book-1')).meta))()")).shelfId, 'shelf-b', 'the reassignment is persisted');
  assert.equal(run("books.every(b => shelves.some(s => s.id === b.shelfId))"), true, 'no book points at a deleted shelf');

  const last = await run("deleteShelf('shelf-b')");
  assert.equal(last.error, undefined, 'deleting the last shelf succeeds');
  assert.equal(last.moved, 2, 'all books are moved');
  assert.equal(run('shelves.length'), 1, 'a default shelf remains');
  assert.equal(run('shelves[0].name'), 'My collection', 'the default shelf has the library default name');
  assert.equal(run('books.length'), 2, 'no book is deleted');
  assert.equal(run("books.every(b => b.shelfId === shelves[0].id)"), true, 'every book is on the default shelf');
  assert.equal(run("books.every(b => shelves.some(s => s.id === b.shelfId))"), true, 'no orphaned books remain');
  assert.deepEqual(Array.from(await run('readJSON(config.library)'), s => s.name), ['My collection'], 'the default shelf is persisted');

  const missing = await run("deleteShelf('shelf-gone')");
  assert.match(missing.error, /no longer exists/, 'deleting an unknown shelf is refused');
  console.log('PASS shelf rename validation (empty, duplicate, case), encrypted persistence, deletion reassigns books, and the last shelf leaves a default shelf with no orphaned books.');
}

main().catch(error => { console.error(error); process.exit(1); });
