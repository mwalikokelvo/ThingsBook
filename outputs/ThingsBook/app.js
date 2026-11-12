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
// Shelf lifecycle: renaming changes only the name, deleting moves the shelf's books to another shelf
// and never deletes a book. Removing the last shelf creates the default shelf a new library starts with.
const DEFAULT_SHELF_NAME = 'My collection';
function shelfNameError(value, id) {
  const name = String(value ?? '').trim();
  if (!name) return { error: 'Enter a shelf name.' };
  if (name.length > 80) return { error: 'Shelf names are at most 80 characters.' };
  if (!shelves.some(s => s.id === id)) return { error: 'That shelf no longer exists.' };
  if (shelves.some(s => s.id !== id && s.name.trim().toLowerCase() === name.toLowerCase())) return { error: 'Another shelf already has that name.' };
  return { name };
}
async function renameShelf(id, value) {
  if (!key) return { error: 'Open your library first.' };
  const check = shelfNameError(value, id);
  if (check.error) return check;
  await saveShelves(shelves.map(s => s.id === id ? {...s, name: check.name} : s));
  render();
  return { name: check.name };
}
async function deleteShelf(id) {
  if (!key) return { error: 'Open your library first.' };
  const shelf = shelves.find(s => s.id === id);
  if (!shelf) return { error: 'That shelf no longer exists.' };
  let next = shelves.filter(s => s.id !== id);
  let target = next.find(s => s.name.toLowerCase() === DEFAULT_SHELF_NAME.toLowerCase()) || next[0];
  if (!target) { target = { id: crypto.randomUUID(), name: DEFAULT_SHELF_NAME }; next = [target]; }
  const moving = books.filter(b => b.shelfId === id);
  for (const book of moving) await updateBook(book.id, { shelfId: target.id });
  await saveShelves(next);
  if (filter === id) filter = target.id;
  libraryPage = 0;
  render();
  return { shelf, target, moved: moving.length };
}
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
      if (saveAccess) remembered = await ThingsDeviceAccess.remember(password,candidateKey);
      await transaction(['settings'], tx => tx.objectStore('settings').put(updated,'vault'));
      config = updated;
      if (saveAccess) hasDeviceAccess = true;
      books = decodedBooks;
      shelves = decodedShelves;
      if (pendingBackup) {
        // The staged books are now the library. The old library is gone.
        await transaction(['books'], tx => { for (const book of pendingBackup.books) tx.objectStore('books').put(book); });
        pendingBackup = null;
      }
    } else {
      // New library.
      const check = await seal(encoder.encode('ThingsBook vault v1'),candidateKey);
      const library = await sealJSON([{id:crypto.randomUUID(),name:DEFAULT_SHELF_NAME}],candidateKey);
      updated = {salt:b64(salt),check,library,recovery:await seal(encoder.encode(password),candidateKey)};
      await transaction(['settings'], tx => tx.objectStore('settings').put(updated,'vault'));
      config = updated;
      remembered = await ThingsDeviceAccess.remember(password,candidateKey);
      hasDeviceAccess = true;
      books = [];
      shelves = [{id:crypto.randomUUID(),name:DEFAULT_SHELF_NAME}];
      await saveShelves(shelves);
    }
    key = candidateKey;
    $('gate').hidden = true;
    $('app').hidden = false;
    render();
    resetIdle();
    // Background work after unlock.
    removeOrphanChunks().then(n => n && toast('Removed '+n+' unfinished import'+(n>1?'s':'')+'.'));
    removeOrphanRecognizedText();
    migrateBooks();
    tidyBookDetails();
    fingerprintBooks();
  } catch (e) {
    $('gate-error').textContent = e.message || 'Could not open the library.';
  } finally {
    busy = false;
    $('unlock-button').disabled = false;
  }
}
function remainingMinutes(book) {
  const pct = Math.round(book.progress?.percent || 0);
  const remPages = Math.max(0, Math.round(book.pages * (100 - pct) / 100));
  return remPages ? Math.max(1, Math.round(remPages * 1.5)) : Infinity;
}
function estTime(book) {
  const pages = book.pages || 0;
  return pages ? Math.max(1, Math.round(pages * 1.5)) : 0;
}
function render() {
  clearTimeout(searchTimer);searchTimer=null;libraryNeedsRender=false;
  const query = $('search').value.trim().toLowerCase();const signature=filter+'|'+query;if(signature!==libraryQuery){libraryPage=0;libraryQuery=signature;}
  const found = books.filter(b => (filter === 'all' || (filter === 'reading' ? b.status === 'reading' : b.shelfId === filter)) && `${b.title} ${b.author} ${b.filename} ${b.notes || ''} ${b.format} ${b.series||''} ${(b.tags||[]).join(' ')}`.toLowerCase().includes(query));
  found.sort((a,b) => {
  const s = $('sort').value;
  if (s === 'oldest') return (a.added || 0) - (b.added || 0);
  if (s === 'largest') return (b.size || 0) - (a.size || 0);
  if (s === 'smallest') return (a.size || 0) - (b.size || 0);
  if (s === 'pages') return (b.pages || 0) - (a.pages || 0);
if (s === 'pages-asc') return (a.pages || 0) - (b.pages || 0);
  if (s === 'year') return (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title);
  if (s === 'year-asc') return (a.year || 0) - (b.year || 0) || a.title.localeCompare(b.title);
  if (s === 'series') return (a.series || '').localeCompare(b.series || '') || (a.seriesNumber || '').localeCompare(b.seriesNumber || '', undefined, {numeric: true}) || a.title.localeCompare(b.title);
  if (s === 'series-desc') return (b.series || '').localeCompare(a.series || '') || (b.seriesNumber || '').localeCompare(a.seriesNumber || '', undefined, {numeric: true}) || a.title.localeCompare(b.title);
  if (s === 'publisher') return (a.publisher || '').localeCompare(b.publisher || '') || a.title.localeCompare(b.title);
  if (s === 'publisher-desc') return (b.publisher || '').localeCompare(a.publisher || '') || a.title.localeCompare(b.title);
  if (s === 'language') return (a.language || '').localeCompare(b.language || '') || a.title.localeCompare(b.title);
  if (s === 'language-desc') return (b.language || '').localeCompare(a.language || '') || a.title.localeCompare(b.title);
  if (s === 'format') return (a.format || '').localeCompare(b.format || '') || a.title.localeCompare(b.title);
  if (s === 'format-desc') return (b.format || '').localeCompare(a.format || '') || a.title.localeCompare(b.title);
  if (s === 'filename') return (a.filename || '').localeCompare(b.filename || '') || a.title.localeCompare(b.title);
  if (s === 'filename-desc') return (b.filename || '').localeCompare(a.filename || '') || a.title.localeCompare(b.title);
  if (s === 'random') return Math.random() - 0.5;
  if (s === 'lastRead') return (b.lastRead || 0) - (a.lastRead || 0);
  if (s === 'lastRead-asc') return (a.lastRead || 0) - (b.lastRead || 0);
  if (s === 'title') return a.title.localeCompare(b.title);
  if (s === 'title-desc') return b.title.localeCompare(a.title);
  if (s === 'author') return (a.author || '').localeCompare(b.author || '');
  if (s === 'author-desc') return (b.author || '').localeCompare(a.author || '');
  if (s === 'rating') return b.rating - a.rating;
  if (s === 'rating-asc') return a.rating - b.rating;
  if (s === 'remaining') {
    const ra = remainingMinutes(a), rb = remainingMinutes(b);
    if (ra === rb) return (b.lastRead || 0) - (a.lastRead || 0);
    return ra - rb;
  }
  if (s === 'progress') return (b.progress?.percent || 0) - (a.progress?.percent || 0);
  if (s === 'progress-asc') return (a.progress?.percent || 0) - (b.progress?.percent || 0);
  if (s === 'tags') return (a.tags?.[0] || '').localeCompare(b.tags?.[0] || '') || a.title.localeCompare(b.title);
  if (s === 'tags-desc') return (b.tags?.[0] || '').localeCompare(a.tags?.[0] || '') || a.title.localeCompare(b.title);
  if (s === 'status') {
    const order = {reading: 0, unread: 1, finished: 2};
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.title.localeCompare(b.title);
  }
  if (s === 'status-desc') {
    const order = {reading: 0, unread: 1, finished: 2};
    return (order[b.status] ?? 9) - (order[a.status] ?? 9) || a.title.localeCompare(b.title);
  }
  if (s === 'esttime') return estTime(b) - estTime(a) || a.title.localeCompare(b.title);
  if (s === 'esttime-asc') return estTime(a) - estTime(b) || a.title.localeCompare(b.title);
  if (s === 'notes') {
    const na = (a.notes || '').length, nb = (b.notes || '').length;
    return nb - na || a.title.localeCompare(b.title);
  }
  if (s === 'notes-desc') {
    const na = (a.notes || '').length, nb = (b.notes || '').length;
    return na - nb || a.title.localeCompare(b.title);
  }
  if (s === 'seriesnum') return (a.seriesNumber || 999) - (b.seriesNumber || 999) || a.title.localeCompare(b.title);
  if (s === 'seriesnum-desc') return (b.seriesNumber || 0) - (a.seriesNumber || 0) || a.title.localeCompare(b.title);
  if (s === 'tagcount') {
    const na = (a.tags || []).length, nb = (b.tags || []).length;
    return nb - na || a.title.localeCompare(b.title);
  }
  if (s === 'tagcount-asc') {
    const na = (a.tags || []).length, nb = (b.tags || []).length;
    return na - nb || a.title.localeCompare(b.title);
  }
  return b.added - a.added;
  });
  const groups = shelves.map(shelf => ({shelf, books: found.filter(b => b.shelfId === shelf.id)}));
  const ordered=[];for(let offset=0;offset<found.length;offset+=60){const page=found.slice(offset,offset+60);ordered.push(...(filter==='reading'?page:groups.flatMap(shelf=>page.filter(book=>book.shelfId===shelf.id))));}window.ThingsSanctuary?.selectionChanged(ordered.map(book=>book.id),signature+'|'+$('sort').value+'|'+view);
  $('result-count').textContent = found.length === books.length ? 'A collection that grows with you' : `${found.length} of ${books.length} books`;
  $('total-books').textContent = books.length;
  $('total-shelves').textContent = shelves.length;
  $('total-reading').textContent = books.filter(b => b.status === 'reading').length;
  $('nav-count').textContent = books.length;
  const shelfNav = $('shelf-nav'); shelfNav.replaceChildren();
  for (const shelf of shelves) {
    const btn = el('button', 'nav-item', shelf.name);
    btn.onclick = () => { filter = shelf.id; render(); };
    if (filter === shelf.id) btn.classList.add('active');
    shelfNav.append(btn);
  }
  $('all-books').classList.toggle('active', filter === 'all');
  $('reading-filter').classList.toggle('active', filter === 'reading');
  $('location').textContent = filter === 'all' ? 'All books' : filter === 'reading' ? 'Currently reading' : shelves.find(s => s.id === filter)?.name || 'Shelf';
  const shelvesEl = $('shelves'); shelvesEl.replaceChildren();
  const resume = [...books].filter(b => b.lastRead && b.status !== 'finished' && b.progress?.percent!==100).sort((a,b) => b.lastRead-a.lastRead)[0]; const resumeHost = $('continue-reading'); resumeHost.replaceChildren(); resumeHost.hidden = !resume;
  if (resume) {
    const card = el('div', 'continue-card');
    const cover = el('div', 'continue-cover'); cover.style.setProperty('--book-color', resume.color); cover.append(el('span', '', resume.title));
    const info = el('div', 'continue-info');
    info.append(el('p', 'eyebrow', 'CONTINUE READING'), el('h3', '', resume.title), el('p', '', resume.author));
    const pct = Math.round(resume.progress?.percent || 0);
    const bar = el('div', 'progress-bar'); bar.append(el('div', 'progress-fill')); bar.querySelector('.progress-fill').style.width = pct + '%';
    info.append(bar, el('span', 'fine', pct + '% · ' + (resume.progress?.location != null ? (resume.format === 'PDF' ? 'page ' : 'chapter ') + (resume.progress.location + 1) : '')));
    const open = el('button', 'primary', 'Continue →'); open.onclick = () => readBook(resume.id);
    info.append(open);
    card.append(cover, info);
    resumeHost.append(card);
  }
  if (view === 'shelf') {
    for (const {shelf, books: shelfBooks} of groups) {
      if (!shelfBooks.length && filter !== shelf.id) continue;
      const section = el('section', 'shelf');
      section.append(el('h3', 'shelf-title', shelf.name + ' · ' + shelfBooks.length));
      const grid = el('div', 'books');
      for (const book of shelfBooks) grid.append(bookButton(book));
      section.append(grid);
      shelvesEl.append(section);
    }
  } else {
    const grid = el('div', 'books grid');
    for (const book of found) grid.append(bookButton(book));
    shelvesEl.append(grid);
  }
  if (!found.length) shelvesEl.append(el('p', 'empty', 'No books match your search or filter.'));
}
function bookButton(book) {
  const btn = el('button', 'book');
  btn.onclick = () => showDetail(book.id);
  const cover = el('div', 'book-cover'); cover.style.setProperty('--book-color', book.color);
  cover.append(el('span', '', book.title), el('span', 'book-ornament', '✦'), el('span', 'book-format', book.format));
  if (book.cover) {
    const img = el('img'); img.src = book.cover; img.alt = '';
    cover.append(img);
  }
  const pct = Math.round(book.progress?.percent || 0); const remaining = 100 - pct; const progressNote = pct ? ` · ${pct}% read · ${remaining}% left` : ''; const daysAgo = book.lastRead ? Math.floor((Date.now() - book.lastRead) / 86400000) : null; const lastReadNote = daysAgo != null ? (daysAgo === 0 ? ' · last read today' : daysAgo === 1 ? ' · last read yesterday' : ' · last read ' + daysAgo + 'd ago') : ''; const formatNote = book.format ? ` · ${book.format}` : ''; const sizeNote = book.size ? ` · ${size(book.size)}` : ''; const pagesNote = book.pages ? ` · ${book.pages} pages` : ''; const remPages = book.pages && pct && pct < 100 ? Math.max(0, Math.round(book.pages * remaining / 100)) : null; const remMins = remPages ? Math.max(1, Math.round(remPages * 1.5)) : null; const remTimeNote = remMins ? (remMins >= 60 ? ` · ~${Math.floor(remMins/60)}h ${remMins%60}m left` : ` · ~${remMins} min left`) : ''; const languageNote = book.language ? ` · ${book.language}` : ''; const seriesNote = book.series ? ` · ${book.series}${book.seriesNumber ? ' #' + book.seriesNumber : ''}` : ''; const yearNote = book.year ? ` · ${book.year}` : ''; const publisherNote = book.publisher ? ` · ${book.publisher}` : ''; const tagsNote = (book.tags && book.tags.length) ? ` · Tags: ${book.tags.slice(0,5).join(', ')}${book.tags.length > 5 ? '…' : ''}` : ''; const statusNote = book.status && book.status !== 'unread' ? ` · ${book.status}` : ''; const ratingNote = book.rating ? ` · ${'★'.repeat(book.rating)}` : ''; const notesNote = book.notes ? ' · has notes' : ''; const addedDays = book.added ? Math.floor((Date.now() - book.added) / 86400000) : null; const addedNote = addedDays != null ? (addedDays === 0 ? ' · added today' : addedDays === 1 ? ' · added yesterday' : ' · added ' + addedDays + 'd ago') : ''; const sourceNote = book.sourceFormat ? ' · from ' + book.sourceFormat : ''; const fileNote = book.filename && book.filename !== book.title ? ' · ' + book.filename : ''; const shelf = shelves.find(s => s.id === book.shelfId); const coverNote = book.cover ? ' · custom cover' : ''; const loc = book.progress?.location; const locNote = loc != null ? ' · at ' + (book.format === 'PDF' ? 'page' : 'chapter') + ' ' + (loc + 1) : ''; const remPagesNote = remPages != null && remPages > 0 ? ' · ~' + remPages + ' pages left' : ''; const totalMins = book.pages ? Math.max(1, Math.round(book.pages * 1.5)) : null; const totalTimeNote = totalMins ? ' · ~' + totalMins + ' min total' : ''; const shelfNote = shelf ? ' · ' + shelf.name : '';
  btn.title = book.title + (book.author ? ' by ' + book.author : '') + progressNote + lastReadNote + formatNote + sizeNote + pagesNote + remTimeNote + languageNote + seriesNote + yearNote + publisherNote + tagsNote + statusNote + ratingNote + notesNote + addedNote + sourceNote + fileNote + coverNote + locNote + remPagesNote + totalTimeNote + shelfNote;
  btn.setAttribute('aria-label', btn.title);
  btn.append(cover, el('span', 'book-title', book.title), el('span', 'book-author', book.author || ''));
  return btn;
}
async function showDetail(id) {
  const book = books.find(b => b.id === id); if (!book) return;
  activeBook = book;
  const content = $('book-detail'); content.replaceChildren();
  const cover = el('div','detail-cover'); cover.style.setProperty('--book-color',book.color); cover.append(el('span','',book.title),el('span','book-ornament','✦'),el('span','book-format',book.format));
  if (book.cover) { const img = el('img'); img.src = book.cover; img.alt = ''; cover.append(img); }
  const pct = Math.round(book.progress?.percent || 0); const remaining = 100 - pct; const progressMeta = pct ? ` · ${pct}% read · ${remaining}% left` : ''; const totalMins = book.pages ? Math.max(1, Math.round(book.pages * 1.5)) : null; const totalTimeMeta = totalMins ? ` · ~${totalMins} min total` : '';
  const remPages = book.pages && pct && pct < 100 ? Math.max(0, Math.round(book.pages * remaining / 100)) : null;
  const remMins = remPages ? Math.max(1, Math.round(remPages * 1.5)) : null; const remTimeMeta = remMins ? (remMins >= 60 ? ` · ~${Math.floor(remMins/60)}h ${remMins%60}m left` : ` · ~${remMins} min left`) : '';
  content.append(cover,el('h2','detail-title',book.title),el('p','detail-meta',`${book.author}\n${book.format}${book.pages?' · '+book.pages+' pages':''} · ${size(book.size)} · ${book.rating ? '★'.repeat(book.rating) : 'Not rated'}${progressMeta}${remTimeMeta}${totalTimeMeta}`));
  const row = el('div','form-row');
  const title = field('Title',el('input')); title.value = book.title; title.maxLength = 200;
  const author = field('Author',el('input')); author.value = book.author || ''; author.maxLength = 200;
  row.append(title, author);
  content.append(row);
  const publisher=field('Publisher (for citations)',el('input'));publisher.maxLength=200;publisher.value=book.publisher||'';
  const language=field('Language',el('input'));language.maxLength=40;language.value=book.language||'';
  const status = el('select'); for (const [value,text] of [['unread','To read'],['reading','Currently reading'],['finished','Finished']]) { const o = el('option','',text); o.value = value; status.append(o); } status.value = book.status; const statusLabel = el('label','','Reading status'); statusLabel.append(status); row.append(statusLabel);
  const rating = field('Rating',el('select')); for (let n = 0; n <= 5; n++) { const o = el('option','',n ? '★'.repeat(n) : 'Not rated'); o.value = n; rating.append(o); } rating.value = book.rating;
  const notes = field('Reading note / bookmark',el('input')); notes.value = book.notes || ''; notes.maxLength = 1000; notes.placeholder = 'e.g. Continue at page 42…';
  const series=field('Series',el('input'));series.maxLength=200;series.value=book.series||'';const year=field('Release year',el('input'));year.type='number';year.min=0;year.max=9999;year.value=book.year||'';const tags=field('Tags',el('input'));tags.maxLength=400;tags.value=(book.tags||[]).join(' ');
  const seriesNumber=field('Number in series',el('input'));seriesNumber.maxLength=30;seriesNumber.value=book.seriesNumber||'';
  content.append(publisher,language,series,seriesNumber,year,tags,notes);
  if(['EPUB','PDF'].includes(book.format)&&window.ThingsImport){
    const coverBtn = el('button','secondary','Extract cover from book');
    coverBtn.onclick = async () => {
      let data;
      data=await (await bookBlob(id)).arrayBuffer();const embedded=book.format==='PDF'?await window.ThingsImport.pdf(data):await window.ThingsImport.epub(data,makeCover);
      if (embedded?.cover) { await updateBook(id, {cover: embedded.cover}); toast('Cover extracted.'); showDetail(id); }
      else toast('No embedded cover found.');
    };
    content.append(coverBtn);
  }
  const save = el('button','primary wide','Save details →');
  save.onclick = async () => {
    busy = true;
    try {
      await updateBook(id, {
        title: title.value.trim() || book.title,
        author: author.value.trim(),
        publisher: publisher.value.trim(),
        language: language.value.trim(),
        status: status.value,
        rating: Number(rating.value),
        notes: notes.value.trim(),
        series: series.value.trim(),
        seriesNumber: seriesNumber.value.trim(),
        year: year.value ? Number(year.value) : undefined,
        tags: tags.value.trim() ? tags.value.trim().split(/\s+/).filter(Boolean) : [],
        detailsTidied: 1
      });
      toast('Details saved.');
      $('detail-dialog').close();
      render();
    } catch (e) { toast(storageError(e)); } finally { busy = false; }
  };
  content.append(save);
  const open = el('button','primary wide','Open in reader →'); open.onclick = () => readBook(id);
  content.append(open);
  const remove = el('button','text-button','Remove from library');
  remove.onclick = async () => {
    if (!confirm('Remove "'+book.title+'" from your library? This cannot be undone.')) return;
    busy = true;
    try {
      await transaction(['books','chunks','ocr'], tx => deleteBooks(tx, [id]));
      books = books.filter(b => b.id !== id);
      toast('Book removed.');
      $('detail-dialog').close();
      render();
    } catch (e) { toast(storageError(e)); } finally { busy = false; }
  };
  content.append(remove);
  $('detail-dialog').showModal();
}
function field(label, input) {
  const wrap = el('label');
  wrap.append(el('span','',label), input);
  return wrap;
}
async function updateBook(id, changes) {
  const book = books.find(b => b.id === id);
  if (!book) return;
  Object.assign(book, changes);
  const meta = await sealJSON(book);
  await transaction(['books'], tx => tx.objectStore('books').put({id, meta, chunks: book.chunks}));
}
async function readBook(id) {
  if (busy) return; busy = true;
  try {
    const book = books.find(b => b.id === id), blob = (book?.format === 'PDF' && await bookSource(id)) || await bookBlob(id);
    if (book.status === 'unread') await updateBook(id, {status: 'reading'});
    await closeReader();
    $('detail-dialog').close();
    $('reader-title').textContent = book.title;
    $('reader-dialog').showModal();
    await ThingsReader.open(blob, book, async (progress) => {
      await updateBook(id, {progress, lastRead: Date.now()});
      libraryNeedsRender = true;
    });
  } catch (e) { toast('Could not open the book. ' + (e.message || '')); } finally { busy = false; resetIdle(); }
}
async function bookSource(id) {
  const record = await getRecord(id);
  if (!record) return null;
  if (record.chunks) {
    const parts = [];
    for (let i = 0; i < record.chunks; i++) {
      const chunk = await getChunk(id, i);
      if (!chunk) throw new Error('Missing chunk');
      parts.push(await unseal(chunk));
    }
    return new Blob(parts);
  }
  return record.file ? new Blob([await unseal(record.file)]) : null;
}
async function bookBlob(id) {
  const source = await bookSource(id);
  return source || new Blob([]);
}
function fillShelves(select, selected) {
  select.replaceChildren();
  for (const shelf of shelves) {
    const o = el('option','',shelf.name); o.value = shelf.id;
    if (shelf.id === selected) o.selected = true;
    select.append(o);
  }
}
function openUpload(files) {
  if (busy) return;
  $('upload-dialog').showModal();
  fillShelves($('shelf-select'), shelves[0]?.id);
  if (files) $('book-files').files = files;
  $('file-summary').textContent = files ? files.length + ' file' + (files.length>1?'s':'') + ' selected' : 'Choose one book to customize its details, or several to import together.';
}
$('add-book').onclick = () => openUpload();
$('unlock-form').onsubmit = unlock;
$('new-shelf').onclick = () => { $('shelf-dialog').showModal(); $('shelf-name').focus(); };
$('shelf-form').onsubmit = async e => { e.preventDefault(); const name = $('shelf-name').value.trim(); if (!name) return; busy = true; try { await saveShelves([...shelves,{id:crypto.randomUUID(),name}]); $('shelf-dialog').close(); if ($('upload-dialog').open) fillShelves($('shelf-select'),shelves.at(-1).id); render(); toast('Your new shelf is ready.'); } catch(e) { $('shelf-error').textContent = storageError(e); } finally { busy = false; } };
  document.querySelectorAll('[data-close]').forEach(btn => btn.onclick = () => { if (busy) { toast('Please wait for the current save to finish.'); return; } btn.closest('dialog').close(); });
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel',e => { if (busy) e.preventDefault(); })); $('reader-dialog').addEventListener('close',() => {if(!$('reader-dialog').open)closeReader().catch(() => toast('Reading position could not be saved.'));}); ThingsReader.init();
  const zone = $('drop-zone'); zone.onclick = () => openUpload(); zone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUpload(); } };
  for (const type of ['dragenter','dragover']) zone.addEventListener(type,e => { e.preventDefault(); zone.classList.add('dragover'); }); zone.ondragleave = () => zone.classList.remove('dragover'); zone.ondrop = e => { e.preventDefault(); zone.classList.remove('dragover'); openUpload(e.dataTransfer.files); };
  window.addEventListener('dragover',e => e.preventDefault()); window.addEventListener('drop',e => e.preventDefault());
  $('backup').onclick = prepareBackup; for (const id of ['restore','gate-restore']) $(id).onclick = () => { if (!busy) $('backup-file').click(); }; $('backup-file').onchange = () => restoreFile($('backup-file').files[0]);
  $('mobile-shelf').onclick = () => $('new-shelf').click(); $('mobile-backup').onclick = prepareBackup; $('mobile-restore').onclick = () => $('restore').click(); $('mobile-lock').onclick = lock;
  for (const type of ['pointerdown','keydown','scroll']) window.addEventListener(type,resetIdle,{passive:true});
  window.addEventListener('beforeunload',e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });
  window.nativeNotice = message => toast(message);
  window.nativeBack = () => { const dialogs = [...document.querySelectorAll('dialog[open]')]; if (dialogs.length) { if (!busy) dialogs.at(-1).close(); return true; } if (key && !busy) { lock(); return true; } return false; };
  window.nativeLock = () => lock();
  if (hasDeviceAccess) await unlock({preventDefault(){}});
}
init();
