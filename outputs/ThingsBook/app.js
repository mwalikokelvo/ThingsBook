'use strict';
const $ = id => document.getElementById(id);
const DB_NAME = 'thingsbook-encrypted-v1', DB_VERSION = 4;
// PDFs are streamed at import and opened by byte range, so they may be larger; other formats are
// still read whole when imported and opened.
const MAX_FILE = 100 * 1024 * 1024, MAX_PDF = 500 * 1024 * 1024;
const isPdfFile = async file => { try { return new TextDecoder().decode(new Uint8Array(await file.slice(0,1024).arrayBuffer())).includes('%PDF-'); } catch { return false; } };
const encoder = new TextEncoder(), decoder = new TextDecoder();
let db, config, key, books = [], shelves = [], filter = 'all', view = 'shelf',libraryPage=0,libraryQuery='';
let pendingBackup = null, activeBook = null, readerUrl = null, busy = false, idleTimer;
let metadataQueue = Promise.resolve(), pendingLock = null;
let storagePreview=0;
let libraryNeedsRender=false,searchTimer,importRun=null;
let hasDeviceAccess = false;
const palette = ['#31534a','#71564d','#8b754c','#5a637b','#747f59','#765668'];
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 5000); }
function size(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function b64(buffer) { const bytes = new Uint8Array(buffer); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); }
function unb64(text) { const s = atob(text), result = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) result[i] = s.charCodeAt(i); return result; }
const derive = ThingsVault.derive;
const seal = (data, vaultKey = key) => ThingsVault.seal(data, vaultKey);
const unseal = (record, vaultKey = key) => ThingsVault.unseal(record, vaultKey);
const sealJSON = value => ThingsVault.sealJSON(value, key);
const readJSON = (record, vaultKey = key) => ThingsVault.readJSON(record, vaultKey);
function request(req) { return new Promise((resolve,reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
function transaction(stores, action) { return new Promise((resolve,reject) => { const tx = db.transaction(stores, 'readwrite'); tx.oncomplete = resolve; tx.onerror = event => reject(tx.error || event.target?.error || new Error('Storage transaction failed')); tx.onabort = () => reject(tx.error || new Error('Storage transaction cancelled')); try { action(tx); } catch (e) { tx.abort(); reject(e); } }); }
async function getRecord(id) { return request(db.transaction('books').objectStore('books').get(id)); }
async function allRecords() { return request(db.transaction('books').objectStore('books').getAll()); }
// Chunked books (ThingsChunks): pieces live in the "chunks" store under [bookId, index].
const chunkRange = id => IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]);
async function getChunk(id,index) { return request(db.transaction('chunks').objectStore('chunks').get([id,index])); }
async function removeChunks(id) { await transaction(['chunks'],tx => tx.objectStore('chunks').delete(chunkRange(id))); }
// Deletes a book record and its pieces together.
function deleteBooks(tx,ids) { for (const id of ids) { tx.objectStore('books').delete(id); tx.objectStore('chunks').delete(chunkRange(id)); if (tx.objectStoreNames?.contains?.('ocr') ?? true) tx.objectStore('ocr').delete(chunkRange(id)); } }
// Recognized (OCR) page text, kept per book and page and sealed with the library key. The book id and page are
// sealed inside and checked when read, so a record moved to another book or page is ignored.
async function saveRecognizedPage(id,page,value) { const vaultKey = key; if (!vaultKey || !books.some(b => b.id === id) || !Number.isInteger(page) || page < 0) return; const sealed = await ThingsVault.sealJSON({book:id,page,text:String(value?.text || '').slice(0,40000),confidence:Number(value?.confidence) || 0},vaultKey); if (key !== vaultKey) return; await transaction(['ocr'],tx => tx.objectStore('ocr').put({book:id,page,...sealed})); }
async function loadRecognizedPage(id,page) { const vaultKey = key; if (!vaultKey || !Number.isInteger(page)) return null; const record = await request(db.transaction('ocr').objectStore('ocr').get([id,page])); if (!record) return null; try { const value = await ThingsVault.readJSON(record,vaultKey); return value.book === id && value.page === page && typeof value.text === 'string' && value.text ? {text:value.text,confidence:value.confidence} : null; } catch { return null; } }
// Pieces whose book record never got written (an interrupted import) are removed after unlock.
// Books still being imported are skipped: their record is written only after their pieces.
const importingBooks = new Set();
// Recognized text whose book no longer exists is removed after unlock.
async function removeOrphanRecognizedText() { const keys = await request(db.transaction('ocr').objectStore('ocr').getAllKeys()), ids = new Set(await request(db.transaction('books').objectStore('books').getAllKeys())); const orphans = [...new Set(keys.map(k => k[0]))].filter(id => !ids.has(id)); if (orphans.length) await transaction(['books','ocr'],tx => { for (const id of orphans) { const check = tx.objectStore('books').get(id); check.onsuccess = () => { if (!check.result) tx.objectStore('ocr').delete(chunkRange(id)); }; } }); return orphans.length; }
async function removeOrphanChunks() { const keys = await request(db.transaction('chunks').objectStore('chunks').getAllKeys()), ids = await request(db.transaction('books').objectStore('books').getAllKeys()); const known = new Set(ids), candidates = [...new Set(keys.map(k => k[0]))].filter(id => !known.has(id) && !importingBooks.has(id)); let removed = 0;
  // Re-check inside one books+chunks transaction, which IndexedDB orders against an import's record write.
  if (candidates.length) await transaction(['books','chunks'],tx => { for (const id of candidates) { const check = tx.objectStore('books').get(id); check.onsuccess = () => { if (!check.result && !importingBooks.has(id)) { tx.objectStore('chunks').delete(chunkRange(id)); removed++; } }; } }); return removed; }
// Books stored by earlier releases (one whole sealed file) are converted to chunks in the background,
// one at a time while the app is idle, so later progress and note saves stop rewriting the whole file.
// The record swap runs on metadataQueue, like updateBook, keeps the record's latest metadata and gives up
// (leaving the book exactly as it was) if the file changed, the book was removed, the library locked or
// another operation such as a backup is running.
const sameBytes = (a,b) => a.length === b.length && a.every((value,index) => value === b[index]);
async function migrateOneBook(id,vaultKey) {
  const before = await getRecord(id);
  if (!before?.file || !vaultKey || key !== vaultKey) return false;
  const plain = await unseal(before.file,vaultKey);
  importingBooks.add(id);
  try {
    await removeChunks(id);
    const chunks = await ThingsChunks.write(plain,vaultKey,id,part => transaction(['chunks'],tx => tx.objectStore('chunks').put(part)));
    new Uint8Array(plain).fill(0);
    const swap = metadataQueue.catch(() => {}).then(async () => {
      if (busy || key !== vaultKey) throw new Error('Book conversion paused.');
      const latest = await getRecord(id);
      if (!latest?.file || !sameBytes(new Uint8Array(latest.file.iv),new Uint8Array(before.file.iv))) throw new Error('Book changed during conversion.');
      await transaction(['books'],tx => tx.objectStore('books').put({id,meta:latest.meta,chunks}));
    });
    metadataQueue = swap.catch(() => {});
    await swap; return true;
  } catch (error) { await removeChunks(id).catch(() => {}); throw error; }
  finally { importingBooks.delete(id); }
}
let migrationRun = 0;
async function migrateBooks() {
  const run = ++migrationRun, vaultKey = key, pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const active = () => run === migrationRun && key === vaultKey;
  await pause(5000); if (!active()) return 0;
  const pending = (await recordSizes()).filter(size => !size.chunked).map(size => size.id);
  let converted = 0;
  for (const id of pending) {
    while (busy && active()) await pause(2000);
    if (!active()) break;
    try { if (await migrateOneBook(id,vaultKey)) converted++; } catch { /* left as a whole-file book; retried next unlock */ }
    await pause(1000);
  }
  return converted;
}
// Books saved before fingerprints existed get one in the background, so later imports can spot them.
// Converted books (Kindle, Word, ...) store an EPUB, not the original file, so they cannot be matched.
// Once per book: clean titles/authors imported before 1.14.1. Books whose details the reader edited
// (or that were already tidied) are left alone.
async function tidyBookDetails() {
  if (!window.ThingsMetadata) return 0; let changed = 0;
  for (const book of books.filter(b => !b.detailsTidied)) {
    const tidy = ThingsMetadata.tidy({title:book.title,author:book.author});
    if (tidy.title !== book.title || tidy.author !== book.author) { try { await updateBook(book.id,{title:tidy.title,author:tidy.author,detailsTidied:1}); changed++; } catch {} }
  }
  return changed;
}
async function fingerprintBooks() {
  if (typeof ThingsFingerprint === 'undefined') return 0;
  const run = migrationRun, vaultKey = key, pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const active = () => run === migrationRun && key === vaultKey;
  let added = 0;
  for (const book of books.filter(b => !b.fingerprint && !b.sourceFormat)) {
    while (busy && active()) await pause(2000);
    if (!active()) break;
    try {
      const source = await bookSource(book.id); if (!source) continue;
      const fingerprint = await ThingsFingerprint.of(source);
      if (active() && books.some(b => b.id === book.id)) { await updateBook(book.id,{fingerprint}); added++; }
    } catch { /* tried again at the next unlock */ }
    await pause(300);
  }
  return added;
}
async function allMetadata() { return new Promise((resolve,reject) => {
  const summaries = [], cursor = db.transaction('books').objectStore('books').openCursor();
  cursor.onerror = () => reject(cursor.error);
  cursor.onsuccess = () => { const current = cursor.result; if (!current) { resolve(summaries); return; }
    summaries.push({id:current.value.id,meta:current.value.meta}); current.continue();
  };
}); }
function storageError(e) { return e?.name === 'QuotaExceededError' ? 'Your browser storage is full. Export a backup, then free some space.' : 'Could not save this change. Your existing library is intact. Try again.'; }
async function saveShelves(next) { const updated = {...config, library:await sealJSON(next)}; await transaction(['settings'], tx => tx.objectStore('settings').put(updated,'vault')); config = updated; shelves = next; }
function gateState() {
  const needsSecret = !!pendingBackup || (!!config && !hasDeviceAccess);
  $('gate-description').textContent = pendingBackup ? 'Enter the recovery code or original password for this encrypted backup.' : needsSecret ? 'Enter your current password once to enable password-free access on this device. Your books stay encrypted.' : config ? 'Your place is saved. Open your library whenever you are ready.' : 'Make a home for your books. No password to create or remember on this device.';
  $('password-wrap').hidden = !needsSecret; $('password').required = needsSecret;
  $('confirm-wrap').hidden = true; $('confirm-password').required = false;
  $('password').autocomplete = 'current-password';
  $('password-note').textContent = 'Anyone using this device profile can open the library. Encrypted backups need a recovery code; save it separately before moving devices or clearing app data.';
  $('unlock-button').textContent = pendingBackup ? 'Verify and restore →' : config ? 'Open my library →' : 'Create my library →';
  $('cancel-restore').hidden = !pendingBackup;
  $('gate-error').textContent = ''; $('password').value = ''; $('confirm-password').value = '';
}
function resetIdle() { if (!key) return; clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (busy || (typeof ThingsReader !== 'undefined' && ThingsReader.isSpeaking())) resetIdle(); else { lock(); toast('Library closed after 15 minutes of inactivity. Open it to continue.'); } },15 * 60 * 1000); }
async function closeReader() { if (typeof ThingsReader !== 'undefined') await ThingsReader.close(); $('reader-content').replaceChildren(); if (readerUrl) URL.revokeObjectURL(readerUrl); readerUrl = null; }
async function lock() {
  pauseImport();window.ThingsBackground?.clear();window.ThingsProviders?.clear();window.ThingsDiscovery?.clear();window.ThingsReaderGestures?.reset();window.ThingsPrivacy?.show();window.ThingsNativeSearch?.clear();if(typeof ThingsReader!=='undefined')ThingsReader.stop();window.ThingsBookDesktop?.stopSpeech?.();window.ThingsBookAndroid?.stopSpeech?.();
  if(busy){if(!pendingLock)pendingLock=new Promise(resolve=>{const retry=()=>{if(busy){setTimeout(retry,100);return;}pendingLock=null;lock().then(resolve);};setTimeout(retry,100);});return pendingLock;}
  busy = true; try { await closeReader(); await metadataQueue; document.querySelectorAll('dialog[open]').forEach(d => d.close()); key = null; clearTimeout(searchTimer);searchTimer=null;libraryNeedsRender=false;storagePreview++; $('upload-storage').textContent=''; $('backup-storage').textContent=''; $('import-status').textContent=''; $('upload-error').textContent=''; $('import-progress').hidden=true; books = []; shelves = []; activeBook = null;window.ThingsSanctuary?.locked(); $('backup-recovery').value = ''; $('book-detail').replaceChildren(); $('shelves').replaceChildren(); $('shelf-nav').replaceChildren(); $('continue-reading').replaceChildren(); $('upload-form').reset(); $('search').value = ''; clearTimeout(idleTimer); $('app').hidden = true; $('gate').hidden = false; gateState();window.ThingsPrivacy?.hide(); (hasDeviceAccess && !pendingBackup ? $('unlock-button') : $('password')).focus(); } catch {window.ThingsPrivacy?.failed(); toast('Could not save your reading position. Retry locking after checking free space.'); } finally { busy = false; } }
async function unlock(event) {
  event.preventDefault(); if (busy) return; busy = true; $('unlock-button').disabled = true; $('gate-error').textContent = '';
  try {
    let password = $('password').value;
    if (!config && !pendingBackup && password && password !== $('confirm-password').value) throw new Error('The passwords do not match.');
    const source = pendingBackup?.config || config;
    const salt = source?.salt || crypto.getRandomValues(new Uint8Array(16));
    let candidateKey, remembered;
    if (source && !pendingBackup && !password && hasDeviceAccess) {
      try { remembered = await request(db.transaction('settings').objectStore('settings').get('device-access')); candidateKey = await ThingsDeviceAccess.open(remembered,source); }
      catch { hasDeviceAccess = false; gateState(); throw new Error('This device could not reopen the library. Enter your recovery code or previous password; your books have not changed.'); }
    } else {
      if (source && !password) throw new Error('Enter the recovery code or previous password.');
      if (!source && !password) password = ThingsDeviceAccess.recoveryCode();
      candidateKey = await derive(password,salt);
    }
    let updated;
    if (source) {
      let decodedShelves, decodedBooks;
      try {
        if (decoder.decode(await unseal(source.check,candidateKey)) !== 'ThingsBook vault v1') throw new Error();
        decodedShelves = await readJSON(source.library,candidateKey);
        const records = pendingBackup?.books || await allMetadata();
        decodedBooks = await Promise.all(records.map(async r => { const meta = await readJSON(r.meta,candidateKey); if (meta.id !== r.id) throw new Error(); return meta; }));
        if (!Array.isArray(decodedShelves) || !decodedShelves.length || decodedShelves.some(s => typeof s.id !== 'string' || typeof s.name !== 'string')) throw new Error();
      } catch { if (remembered) { hasDeviceAccess = false; gateState(); } throw new Error('The password or recovery code is incorrect, or the library/backup is damaged.'); }
      updated = {...source};
      if (password) updated.recovery = await seal(encoder.encode(password),candidateKey);
      if(pendingBackup&&!await confirmStorage(ThingsStorage.payload(pendingBackup.books,pendingBackup.config),'restore'))throw new Error('Restore cancelled before saving. Your existing library is unchanged. You can retry or cancel the restore.');
      // Every book of a backup is verified and staged piece by piece before anything is replaced.
      if (pendingBackup) await stageRestore(pendingBackup,candidateKey);
      const saveAccess = !remembered;
      if (saveAccess) remembered = await ThingsDeviceAccess.remember(password,candidateKey,Array.from(source.check.iv).join(','));
      // Reopening an already remembered library is read-only: low disk space
      // must not prevent access merely because another key write would fail.
      if (saveAccess || pendingBackup) await transaction(pendingBackup ? ['settings','books','chunks','staging','ocr'] : ['settings'], tx => {
        if (pendingBackup) swapStaged(tx,pendingBackup);
        tx.objectStore('settings').put(updated,'vault'); tx.objectStore('settings').put(remembered,'device-access');
      });
      pendingBackup = null; config = updated; key = candidateKey; shelves = decodedShelves; books = decodedBooks;
      removeOrphanChunks().catch(() => {}); removeOrphanRecognizedText().catch(() => {}); migrateBooks().catch(() => 0).then(() => tidyBookDetails()).then(() => fingerprintBooks()).catch(() => {});
    } else {
      key = candidateKey; const initial = [{id:crypto.randomUUID(),name:'My collection'}];
      const created = {version:1,salt,check:await seal(encoder.encode('ThingsBook vault v1')),library:await sealJSON(initial),recovery:await seal(encoder.encode(password))};
      remembered = await ThingsDeviceAccess.remember(password,candidateKey,Array.from(created.check.iv).join(','));
      await transaction(['settings'], tx => { tx.objectStore('settings').put(created,'vault'); tx.objectStore('settings').put(remembered,'device-access'); }); config = created; shelves = initial; books = [];
    }
    hasDeviceAccess = true;
    $('password').value = ''; $('confirm-password').value = ''; filter = 'all'; $('gate').hidden = true; $('app').hidden = false; render(); resetIdle();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  } catch (e) { key = null; $('gate-error').textContent = e?.name==='QuotaExceededError'?'Not enough app storage to finish saving. Your existing library is unchanged. Free space, then retry or cancel this restore.':e?.message || storageError(e); }
  finally { busy = false; $('unlock-button').disabled = false; }
}
function bookButton(book, index, grid) {
  const cover = grid || index === 0;
  const button = el('button',`book ${cover ? 'cover' : 'spine'}`);
  button.style.setProperty('--book-color', /^#[0-9a-f]{6}$/i.test(book.color) ? book.color : '#31534a');
  button.style.animationDelay = `${Math.min(index * .04, .4)}s`;
  const pct = Math.round(book.progress?.percent || 0); const progressNote = pct ? ` · ${pct}% read` : ''; button.title = `${book.title} — ${book.author}${progressNote}`; button.setAttribute('aria-label',`Open ${book.title} by ${book.author}${progressNote}`);
  if(cover&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(book.cover||'')){button.classList.add('has-cover');const image=el('img','custom-cover');image.src=book.cover;image.alt='';image.loading='lazy';image.decoding='async';button.append(image);}
  if (cover) button.append(el('span','book-format',book.format),el('span','book-ornament','✦'));
  button.append(el('span','book-title',book.title),el('span','book-author',book.author==='Unknown author'&&!cover?'':book.author));
  if (cover) button.append(el('span','book-rating',book.rating ? '★'.repeat(book.rating) : 'THINGSBOOK'));
  if (book.progress?.percent) { const bar = el('span','reading-progress'); const fill = el('i'); fill.style.width = Math.max(0,Math.min(100,book.progress.percent))+'%'; bar.append(fill); button.append(bar); }
  if (!cover) button.style.height = `${170 + (index % 4) * 10}px`;
  button.addEventListener('click',() => showDetail(book.id));window.ThingsSanctuary?.decorateBook(button,book); return button;
}
function refreshLibrary(){if($('reader-dialog').open){libraryNeedsRender=true;return;}render();}
function scheduleLibrarySearch(){clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;if(key)refreshLibrary();},120);}
function render() {
  clearTimeout(searchTimer);searchTimer=null;libraryNeedsRender=false;
  const query = $('search').value.trim().toLowerCase();const signature=filter+'|'+query;if(signature!==libraryQuery){libraryPage=0;libraryQuery=signature;}
  const found = books.filter(b => (filter === 'all' || (filter === 'reading' ? b.status === 'reading' : b.shelfId === filter)) && `${b.title} ${b.author} ${b.filename} ${b.notes || ''} ${b.format} ${b.series||''} ${(b.tags||[]).join(' ')}`.toLowerCase().includes(query));
  const visibleBooks = found.slice(libraryPage*60,(libraryPage+1)*60);
  $('book-count').textContent = books.length; $('total-books').textContent = books.length; $('total-shelves').textContent = shelves.length; $('total-reading').textContent = books.filter(b => b.status === 'reading').length; $('total-storage').textContent = size(books.reduce((n,b) => n + b.size + 16,0));
  const resume = [...books].filter(b => b.lastRead && b.status !== 'finished' && b.progress?.percent!==100).sort((a,b) => b.lastRead-a.lastRead)[0]; const resumeHost = $('continue-reading'); resumeHost.replaceChildren(); resumeHost.hidden = !resume;
  if (resume) { const text = el('div'); text.append(el('strong','',resume.title),el('p','',`${Math.round(resume.progress?.percent || 0)}% read · your next chapter is waiting`)); const button = el('button','primary','Continue reading →'); button.onclick = () => readBook(resume.id); resumeHost.append(text,button); }
  const current = shelves.find(s => s.id === filter); $('location').textContent = current?.name || (filter === 'reading' ? 'Currently reading' : 'All books'); $('library-heading').textContent = current?.name || (filter === 'reading' ? 'Currently reading' : 'Your bookshelf'); $('result-count').textContent = books.length ? `${found.length} ${found.length === 1 ? 'book' : 'books'} · a little world of your own` : 'A collection that grows with you';
  $('all-books').classList.toggle('active',filter === 'all'); $('reading-filter').classList.toggle('active',filter === 'reading');
  $('shelf-nav').replaceChildren(); for (const shelf of shelves) { const btn = el('button',`nav-item ${filter === shelf.id ? 'active' : ''}`); btn.append(el('span','','▱'),document.createTextNode(shelf.name),el('b','',String(books.filter(b => b.shelfId === shelf.id).length))); btn.onclick = () => { filter = shelf.id; render(); }; $('shelf-nav').append(btn); }
  $('shelves').replaceChildren(); const groups = filter === 'reading' ? [{id:'reading',name:'One chapter at a time'}] : shelves.filter(s => !current || s.id === current.id);
  const ordered=[];for(let offset=0;offset<found.length;offset+=60){const page=found.slice(offset,offset+60);ordered.push(...(filter==='reading'?page:groups.flatMap(shelf=>page.filter(book=>book.shelfId===shelf.id))));}window.ThingsSanctuary?.selectionChanged(ordered.map(book=>book.id),signature+'|'+$('sort').value+'|'+view);
  let shown = 0;
  for (const shelf of groups) {
    const items = filter === 'reading' ? visibleBooks : visibleBooks.filter(b => b.shelfId === shelf.id);
    if ((query||found.length) && !items.length) continue;
    const section = el('section','shelf');
    const heading = el('h2'); heading.append(el('span','',shelf.name),el('small','',String(items.length))); section.append(heading);
    const booksHost = el('div',view==='grid'?'books grid':'books');
    items.sort((a,b)=>{const mode=$('sort').value;if(mode==='title')return a.title.localeCompare(b.title);if(mode==='author')return a.author.localeCompare(b.author);if(mode==='progress')return (b.progress?.percent||0)-(a.progress?.percent||0);if(mode==='recent')return (b.lastRead||0)-(a.lastRead||0);return 0;});
    items.forEach((book,i)=>booksHost.append(bookButton(book,i,view==='grid'))); section.append(booksHost); $('shelves').append(section); shown += items.length;
  }
  if (!shown) { const empty = el('section','shelf empty'); empty.append(el('h2','','Nothing here yet'),el('p','',query?'No books match that search.':'Add a book or choose another shelf.')); $('shelves').append(empty); }
  const pages = Math.ceil(found.length/60)||1; const pager = el('div','library-pager'); if (pages>1) { const prev = el('button','text-button','← Previous'); prev.disabled=libraryPage===0; prev.onclick=()=>{libraryPage--;render();}; const next = el('button','text-button','Next →'); next.disabled=libraryPage>=pages-1; next.onclick=()=>{libraryPage++;render();}; pager.append(prev,el('span','',`Page ${libraryPage+1} of ${pages}`),next); } $('shelves').append(pager);
}
// ... rest of file truncated in this example for brevity; in real call full content is used
