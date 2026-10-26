'use strict';
const $ = id => document.getElementById(id);
const DB_NAME = 'thingsbook-encrypted-v1', DB_VERSION = 2;
const MAX_FILE = 100 * 1024 * 1024;
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
function deleteBooks(tx,ids) { for (const id of ids) { tx.objectStore('books').delete(id); tx.objectStore('chunks').delete(chunkRange(id)); } }
// Pieces whose book record never got written (an interrupted import) are removed after unlock.
// Books still being imported are skipped: their record is written only after their pieces.
const importingBooks = new Set();
async function removeOrphanChunks() { const keys = await request(db.transaction('chunks').objectStore('chunks').getAllKeys()), ids = await request(db.transaction('books').objectStore('books').getAllKeys()); const known = new Set(ids), candidates = [...new Set(keys.map(k => k[0]))].filter(id => !known.has(id) && !importingBooks.has(id)); let removed = 0;
  // Re-check inside one books+chunks transaction, which IndexedDB orders against an import's record write.
  if (candidates.length) await transaction(['books','chunks'],tx => { for (const id of candidates) { const check = tx.objectStore('books').get(id); check.onsuccess = () => { if (!check.result && !importingBooks.has(id)) { tx.objectStore('chunks').delete(chunkRange(id)); removed++; } }; } }); return removed; }
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
        if (pendingBackup) for (const record of records) { if (record.chunks) await ThingsChunks.verify(record,record.parts,candidateKey); else await unseal(record.file,candidateKey); }
      } catch { if (remembered) { hasDeviceAccess = false; gateState(); } throw new Error('The password or recovery code is incorrect, or the library/backup is damaged.'); }
      updated = {...source};
      if (password) updated.recovery = await seal(encoder.encode(password),candidateKey);
      if(pendingBackup&&!await confirmStorage(ThingsStorage.payload(pendingBackup.books,pendingBackup.config),'restore'))throw new Error('Restore cancelled before saving. Your existing library is unchanged. You can retry or cancel the restore.');
      const saveAccess = !remembered;
      if (saveAccess) remembered = await ThingsDeviceAccess.remember(password,candidateKey,Array.from(source.check.iv).join(','));
      // Reopening an already remembered library is read-only: low disk space
      // must not prevent access merely because another key write would fail.
      if (saveAccess || pendingBackup) await transaction(pendingBackup ? ['settings','books','chunks'] : ['settings'], tx => {
        if (pendingBackup) { tx.objectStore('books').clear(); tx.objectStore('chunks').clear(); for (const {parts,...record} of pendingBackup.books) { tx.objectStore('books').put(record); for (const part of parts || []) tx.objectStore('chunks').put(part); } }
        tx.objectStore('settings').put(updated,'vault'); tx.objectStore('settings').put(remembered,'device-access');
      });
      pendingBackup = null; config = updated; key = candidateKey; shelves = decodedShelves; books = decodedBooks;
      removeOrphanChunks().catch(() => {});
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
  button.title = `${book.title} — ${book.author}`; button.setAttribute('aria-label',`Open ${book.title} by ${book.author}`);
  if(cover&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(book.cover||'')){const image=el('img','custom-cover');image.src=book.cover;image.alt='';image.loading='lazy';image.decoding='async';button.append(image);}
  if (cover) button.append(el('span','book-format',book.format),el('span','book-ornament','✦'));
  button.append(el('span','book-title',book.title),el('span','book-author',book.author));
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
  found.sort((a,b) => $('sort').value === 'lastRead' ? (b.lastRead || 0) - (a.lastRead || 0) : $('sort').value === 'title' ? a.title.localeCompare(b.title) : $('sort').value === 'rating' ? b.rating - a.rating : b.added - a.added);
  libraryPage=Math.max(0,Math.min(libraryPage,Math.ceil(found.length/60)-1));const visibleBooks=found.slice(libraryPage*60,(libraryPage+1)*60);window.ThingsSanctuary?.pages(found.length,libraryPage,next=>{libraryPage=next;render();});
  $('nav-count').textContent = books.length; $('total-books').textContent = books.length; $('total-shelves').textContent = shelves.length; $('total-reading').textContent = books.filter(b => b.status === 'reading').length; $('total-storage').textContent = size(books.reduce((n,b) => n + b.size + 16,0));
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
    const wrap = el('section','shelf-group'), heading = el('div','shelf-heading'); heading.append(el('strong','',shelf.name),el('span','',`${items.length} ${items.length === 1 ? 'book' : 'books'}`)); wrap.append(heading);
    const row = el('div',view === 'shelf' ? 'shelf-row' : 'grid-row'); items.forEach((book,i) => row.append(bookButton(book,i,view === 'grid')));
    if (!items.length) row.append(el('p','shelf-empty',filter === 'reading' ? 'Open a book to begin your next chapter.' : 'Your next favorite belongs here. Add your first book.'));
    wrap.append(row); if (view === 'shelf') wrap.append(el('div','shelf-floor')); $('shelves').append(wrap); shown++;
  }
  if (!shown) $('shelves').append(el('p','no-results','No books match your search.'));window.ThingsSanctuary?.render();
}
function fillShelves(select, selected) { select.replaceChildren(); for (const s of shelves) { const option = el('option','',s.name); option.value = s.id; select.append(option); } select.value = selected || (shelves.some(s => s.id === filter) ? filter : shelves[0].id); }
function storageDescription(report){return report.available===null?'App storage estimate is unavailable. Your device will check space when saving.':`${size(report.available)} estimated app storage available (${size(report.usage)} used). This is an app quota estimate, not free disk space.`;}
async function confirmStorage(bytes,action){const report=await ThingsStorage.inspect(bytes);if(!report.low)return true;return confirm(`Storage looks low for this ${action}: ${size(report.available)} estimated app storage available; about ${size(report.needed)} recommended including a safety margin. Estimates can differ from actual space. Free space or use a smaller import/backup. Continue anyway? Existing saved books are preserved if writing fails.`);}
async function refreshUploadStorage(files){const stamp=++storagePreview,owner=key;$('upload-storage').textContent=files.length?'Checking app storage…':'';if(!files.length)return;const report=await ThingsStorage.inspect(files.reduce((n,file)=>n+file.size,0));if(stamp!==storagePreview||owner!==key||!key)return;$('upload-storage').textContent=storageDescription(report)+` About ${size(report.needed)} recommended for this import including a safety margin.`+(report.low?' Space looks low; you will be asked before importing.':'');}
function fileSummary() { const files = [...$('book-files').files]; $('file-summary').textContent = files.length ? `${files.length} selected · ${size(files.reduce((n,f) => n + f.size,0))} · Embedded PDF/EPUB details are detected automatically.` : 'Choose one book to customize its details, or several to import together.'; $('book-title').disabled = files.length > 1; void refreshUploadStorage(files); }
function openUpload(files) { if (!key || busy) return; $('upload-form').reset(); $('import-status').textContent=''; $('import-progress').hidden=true; $('save-book').textContent='Add to my library →'; storagePreview++; $('upload-storage').textContent=''; $('book-title').disabled = false; $('upload-error').textContent = ''; fillShelves($('shelf-select')); $('file-summary').textContent = 'Choose one book to customize its details, or several to import together.'; if (files) { const transfer = new DataTransfer(); for (const file of files) transfer.items.add(file); $('book-files').files = transfer.files; fileSummary(); } $('upload-dialog').showModal(); }
function pauseImport(){if(!importRun)return;importRun.paused=true;$('pause-import').disabled=true;$('pause-import').textContent='Finishing current book…';}
function retainImportFiles(files){try{const transfer=new DataTransfer();for(const file of files)transfer.items.add(file);$('book-files').files=transfer.files;return true;}catch{$('book-files').value='';return false;}}
async function upload(event) {
  event.preventDefault();if(busy)return;const files=[...$('book-files').files];if(!files.length)return;$('upload-error').textContent='';
  for(const file of files){if(!file.size||file.size>MAX_FILE){$('upload-error').textContent=`${file.name}: choose a nonempty file under 100 MB.`;return;}}
  const details={title:$('book-title').value.trim(),author:$('book-author').value.trim(),rating:Number($('book-rating').value),color:$('book-color').value,shelfId:$('shelf-select').value};
  const run={paused:false};importRun=run;busy=true;$('save-book').disabled=true;$('book-files').disabled=true;let saved=0,count=0,fallbackCount=0,remaining=[],failed=[],started=false;
  try{
    if(!await confirmStorage(files.reduce((n,file)=>n+file.size,0),'import'))return;
    started=true;$('import-progress').hidden=false;$('import-progress').max=files.length;$('import-progress').value=0;$('pause-import').hidden=false;$('pause-import').disabled=false;$('pause-import').textContent='Pause after current book';
    for(let index=0;index<files.length;index++){
      if(run.paused){remaining.push(...files.slice(index));break;}
      const file=files[index];let data,stage='read';count=index+1;$('save-book').textContent=`Encrypting book ${count} of ${files.length}…`;$('import-status').textContent=`${saved} saved · Reading ${file.name} (${count} of ${files.length})`;
      try{
        // PDFs are recognized from their first kilobyte and streamed: details are read by byte range and
        // pieces are encrypted straight from the file, so a large PDF is never held in memory whole.
        const streamed=decoder.decode(new Uint8Array(await file.slice(0,1024).arrayBuffer())).includes('%PDF-');
        data=streamed?null:await file.arrayBuffer();let format=streamed?'PDF':window.ThingsImport?.format?window.ThingsImport.format(file.name,data):file.name.split('.').pop().toUpperCase();
        // Kindle books and Word documents are converted to EPUB once, here; the stored book is that EPUB.
        let storedName=file.name,sourceFormat=null;
        if(format==='MOBI'||format==='DOCX'||format==='FB2'){$('save-book').textContent=`Converting ${{MOBI:'Kindle book',DOCX:'Word document',FB2:'FictionBook'}[format]} ${count} of ${files.length}…`;const converted=format==='MOBI'?await ThingsKindle.toEPUB(data):format==='DOCX'?await ThingsDocx.toEPUB(data,{name:file.name}):await ThingsFB2.toEPUB(data);new Uint8Array(data).fill(0);data=converted.epub.buffer.slice(converted.epub.byteOffset,converted.epub.byteOffset+converted.epub.byteLength);format='EPUB';sourceFormat=converted.kind;storedName=file.name.replace(/\.fb2\.zip$/i,'').replace(/\.[^.]*$/,'')+'.epub';}
        if(format==='PDF'&&!streamed)throw new Error('This file does not appear to be a valid PDF.');
        if(format==='EPUB'&&new Uint8Array(data)[0]!==80)throw new Error('This file does not appear to be an EPUB archive.');
        stage='save';
        let embedded = {};
        if (format === 'EPUB' && window.ThingsImport) {
          try {embedded = await window.ThingsImport.epub(data, makeCover); if (embedded.warnings.length) fallbackCount++;}
          catch {fallbackCount++;}
        }
        if(format==='PDF'&&window.ThingsImport){$('save-book').textContent=`Reading PDF details ${count} of ${files.length}…`;embedded=await window.ThingsImport.pdf(null,{source:{size:file.size,read:async(begin,end)=>new Uint8Array(await file.slice(begin,end).arrayBuffer())}});if(embedded.warnings.length)fallbackCount++;}
        const meta = {id:crypto.randomUUID(),title:files.length === 1 && details.title ? details.title : embedded.title || window.SanctuaryCore?.title(file.name)||file.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' '),author:details.author || embedded.author || 'Unknown author',rating:details.rating,color:files.length > 1 ? palette[(books.length + count) % palette.length] : details.color,shelfId:details.shelfId,format,size:data ? data.byteLength : file.size,filename:storedName,...(sourceFormat?{sourceFormat,sourceFilename:file.name}:{}),added:Date.now(),status:'unread',notes:'',series:embedded.series||'',seriesNumber:embedded.seriesNumber||'',year:embedded.year||null,language:embedded.language||'',cover:embedded.cover||null,pages:embedded.pages||null};
        if(!shelves.some(s=>s.id===meta.shelfId)){if(!shelves.length)await saveShelves([{id:crypto.randomUUID(),name:'Imported Books'}]);meta.shelfId=shelves[0].id;}
        // Pieces first, one transaction each; the book record is written last, so a book only
        // appears once every piece is stored. A failure removes the pieces already written.
        importingBooks.add(meta.id);
        try {
          const chunks = await ThingsChunks.write(data ?? file,key,meta.id,part => transaction(['chunks'],tx => tx.objectStore('chunks').put(part)));
          const record = {id:meta.id,meta:await sealJSON(meta),chunks};
          await transaction(['books'],tx => tx.objectStore('books').add(record));
        } catch (error) { await removeChunks(meta.id).catch(() => {}); throw error; }
        finally { importingBooks.delete(meta.id); }
        books.push(meta);
        saved++;
      }catch(error){failed.push({file,message:stage==='read'?(error?.name==='Error'?error.message:'Could not read this source file. Check access and try again.'):storageError(error)});if(stage==='save'){remaining.push(...files.slice(index+1));break;}}
      finally{if(data)new Uint8Array(data).fill(0);$('import-progress').value=count;}
    }
    remaining=[...failed.map(item=>item.file),...remaining];
    $('import-status').textContent=`${saved} saved · ${failed.length} failed · ${remaining.length-failed.length} waiting`;
    if(remaining.length){const retained=retainImportFiles(remaining);if(files.length>1)$('book-title').value='';fileSummary();$('upload-error').textContent=failed.length?failed.slice(0,10).map(item=>`${item.file.name}: ${item.message}`).join('\n')+(failed.length>10?`\nAnd ${failed.length-10} more failed files.`:'')+(retained?'\nOnly failed or waiting books remain selected. Saved books will not be imported again by Retry/Continue.':'\nChoose the failed or waiting files again; the file picker could not retain them.'):(retained?'':'Choose the waiting files again; the file picker could not retain them.');}
    else{$('book-files').value='';$('upload-dialog').close();toast(`${saved} ${saved===1?'book has':'books have'} found a home.${fallbackCount?` Embedded details or covers were unavailable for ${fallbackCount}; you can edit their details.`:''}`);}
  }catch(error){$('upload-error').textContent=storageError(error)+' Earlier books in this batch remain saved.';}
  finally{importRun=null;busy=false;$('save-book').disabled=false;$('book-files').disabled=false;$('pause-import').hidden=true;$('save-book').textContent=remaining.length?(run.paused?'Continue remaining books →':'Retry remaining books →'):'Add to my library →';if(!started)$('import-status').textContent='';render();resetIdle();}
}
async function makeCover(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPEG, PNG or WebP image under 10 MB.');const image=await createImageBitmap(file);try{if(!image.width||!image.height||image.width*image.height>50000000)throw new Error('Choose a smaller cover image.');const canvas=document.createElement('canvas');const scale=Math.min(1,720/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.82);}finally{image.close();}}
async function updateBook(id, changes) { const vaultKey = key; const task = metadataQueue.catch(() => {}).then(async () => { if (!vaultKey || key !== vaultKey) throw new Error('The library is locked'); const book = books.find(b => b.id === id), record = await getRecord(id); if (!book || !record) throw new Error('Book not found'); const patch=typeof changes==='function'?changes(book):changes;const next = {...book,...patch};if(patch.progress?.percent===100)next.status="finished"; record.meta = await seal(encoder.encode(JSON.stringify(next)),vaultKey); await transaction(['books'], tx => tx.objectStore('books').put(record)); if (key === vaultKey) { books = books.map(b => b.id === id ? next : b); refreshLibrary(); } return next; }); metadataQueue = task.catch(() => {}); return task; }
function showDetail(id) {
  activeBook = id; const book = books.find(b => b.id === id); if (!book) return;
  const content = $('book-detail'); content.replaceChildren();
  const cover = el('div','detail-cover'); cover.style.setProperty('--book-color',book.color); cover.append(el('span','',book.title),el('span','book-ornament','✦'),el('span','book-format',book.format));
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(book.cover||'')) {const image=el('img','detail-cover-image');image.src=book.cover;image.alt='';cover.append(image);}
  content.append(cover,el('h2','detail-title',book.title),el('p','detail-meta',`${book.author}\n${book.format}${book.pages?' · '+book.pages+' pages':''} · ${size(book.size)} · ${book.rating ? '★'.repeat(book.rating) : 'Not rated'}`));
  const actions = el('div','detail-actions'), read = el('button','primary','Open book →'), download = el('button','secondary','Download original ↓'); read.onclick = () => readBook(id); download.onclick = () => downloadBook(id); actions.append(read,download); content.append(actions);
  content.append(el('p','fine','Read and listen inside your library. Downloaded originals are unencrypted files.'));
  const form = el('form','detail-form');
  function field(labelText, input) { const label = el('label','',labelText); label.append(input); form.append(label); return input; }
  const title = field('Title',el('input')); title.value = book.title; title.required = true; title.maxLength = 200;
  const author = field('Author',el('input')); author.value = book.author; author.maxLength = 200;
  const publisher=field('Publisher (for citations)',el('input'));publisher.maxLength=200;publisher.value=book.publisher||'';
  const row = el('div','form-row'); form.append(row);
  const shelfSelect = el('select'); fillShelves(shelfSelect,book.shelfId); const shelfLabel = el('label','','Shelf'); shelfLabel.append(shelfSelect); row.append(shelfLabel);
  const status = el('select'); for (const [value,text] of [['unread','To read'],['reading','Currently reading'],['finished','Finished']]) { const o = el('option','',text); o.value = value; status.append(o); } status.value = book.status; const statusLabel = el('label','','Reading status'); statusLabel.append(status); row.append(statusLabel);
  const rating = field('Rating',el('select')); for (let n = 0; n <= 5; n++) { const o = el('option','',n ? '★'.repeat(n) : 'Not rated'); o.value = n; rating.append(o); } rating.value = book.rating;
  const notes = field('Reading note / bookmark',el('input')); notes.value = book.notes || ''; notes.maxLength = 1000; notes.placeholder = 'e.g. Continue at page 42…';
  const series=field('Series',el('input'));series.maxLength=200;series.value=book.series||'';const year=field('Release year',el('input'));year.type='number';year.min=0;year.max=9999;year.value=book.year||'';const tags=field('Tags',el('input'));tags.maxLength=400;tags.value=(book.tags||[]).join(' ');
  const coverInput=field('Custom cover (JPEG, PNG or WebP, up to 10 MB)',el('input'));coverInput.type='file';coverInput.accept='image/jpeg,image/png,image/webp';const clearCover=field('Remove custom cover',el('input'));clearCover.type='checkbox';
  const seriesNumber=field('Number in series',el('input'));seriesNumber.maxLength=30;seriesNumber.value=book.seriesNumber||'';
  let importedCover;
  if(['EPUB','PDF'].includes(book.format)&&window.ThingsImport){
    const detect=el('button','secondary','Read embedded book details');detect.type='button';
    detect.onclick=async()=>{if(busy)return;busy=true;detect.disabled=true;let data;try{
      data=await (await bookBlob(id)).arrayBuffer();const embedded=book.format==='PDF'?await window.ThingsImport.pdf(data):await window.ThingsImport.epub(data,makeCover);
      if(embedded.title)title.value=embedded.title;if(embedded.author)author.value=embedded.author;if(embedded.series)series.value=embedded.series;if(embedded.seriesNumber)seriesNumber.value=embedded.seriesNumber;if(embedded.year)year.value=embedded.year;
      if(embedded.cover){importedCover=embedded.cover;clearCover.checked=false;let image=cover.querySelector('img');if(!image){image=el('img','detail-cover-image');image.alt='';cover.append(image);}image.src=embedded.cover;}
      toast('Embedded details filled in. Choose Save details to keep them.'+(embedded.warnings.length?' Some embedded details or the cover were unavailable.':''));
    }catch{toast('Embedded details could not be read. You can enter details yourself.');}finally{if(data)new Uint8Array(data).fill(0);busy=false;detect.disabled=false;}};
    form.append(detect);
  }
  const save = el('button','primary wide','Save details'); form.append(save);
  form.onsubmit = async e => { e.preventDefault(); if (busy) return; busy = true; save.disabled = true; try { if (!title.value.trim()) throw new Error('Enter a title.'); let customCover=importedCover===undefined?book.cover||null:importedCover;if(clearCover.checked)customCover=null;if(coverInput.files[0])customCover=await makeCover(coverInput.files[0]);await updateBook(id,{cover:customCover,title:title.value.trim(),author:author.value.trim() || 'Unknown author',publisher:publisher.value.trim(),shelfId:shelfSelect.value,status:status.value,rating:Number(rating.value),notes:notes.value,series:series.value.trim(),seriesNumber:seriesNumber.value.trim(),year:year.value?Number(year.value):null,tags:window.SanctuaryCore?.tags(tags.value)||[]}); $('detail-dialog').close(); toast('Book details saved.'); } catch(e) { toast(e.message === 'Enter a title.' ? e.message : storageError(e)); } finally { busy = false; save.disabled = false; } };
  content.append(form); const remove = el('button','text-button danger','Remove this book'); remove.onclick = async () => { if (busy || !confirm(`Remove “${book.title}” and its stored file from this library?`)) return; busy = true; try { await transaction(['books','chunks'],tx => deleteBooks(tx,[id])); books = books.filter(b => b.id !== id); $('detail-dialog').close(); render(); toast('Book removed.'); } catch(e) { toast(storageError(e)); } finally { busy = false; } }; content.append(remove);
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
}
async function nativeTransfer(blob, filename, mode) {
  const bridge = window.ThingsBookAndroid;
  if (!bridge.beginTransfer(filename,blob.type,mode)) throw new Error('Finish the current file save first.');
  try { for (let offset = 0; offset < blob.size; offset += 96 * 1024) {
    const chunk = await blob.slice(offset,offset + 96 * 1024).arrayBuffer();
    if (!bridge.writeChunk(b64(chunk))) throw new Error('Could not stage this file. Check free space.');
  } if (!bridge.finishTransfer()) throw new Error('Could not finish staging this file.'); }
  catch(e) { bridge.cancelTransfer(); throw e; }
}
async function downloadBlob(blob, filename) { if (window.ThingsBookAndroid) return nativeTransfer(blob,filename,'export'); const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),60000); }
async function bookBlob(id) { const record = await getRecord(id), book = books.find(b => b.id === id); if (!record || !book) throw new Error('Missing book file'); const mime = book.format === 'PDF' ? 'application/pdf' : book.format === 'EPUB' ? 'application/epub+zip' : 'text/plain'; if (record.chunks) { let blob = new Blob([],{type:mime}); for (let index = 0; index < record.chunks.count; index++) blob = new Blob([blob,await ThingsChunks.piece(record,key,i => getChunk(id,i),index)],{type:mime}); return blob; } /* one decrypted piece held at a time */ return new Blob([await unseal(record.file)],{type:mime}); }
// A chunked book read by byte range: only the pieces asked for are decrypted, and the last few are
// cached. Used to open large PDFs without loading the whole file. close() drops the cache.
async function bookSource(id) {
  const record = await getRecord(id), book = books.find(b => b.id === id), vaultKey = key;
  if (!record?.chunks || !book || !vaultKey) return null;
  const SIZE = ThingsChunks.SIZE, size = record.chunks.bytes, cache = new Map(), stats = {decrypted:0,delivered:0};
  const piece = index => {
    let pending = cache.get(index);
    if (pending) cache.delete(index);
    else if (key !== vaultKey) pending = Promise.reject(new Error('The library is locked.')); /* no decryption after locking */
    else { pending = ThingsChunks.piece(record,vaultKey,i => getChunk(id,i),index); stats.decrypted++; pending.catch(() => cache.delete(index)); }
    cache.set(index,pending);
    while (cache.size > 4) cache.delete(cache.keys().next().value);
    return pending;
  };
  return {size,type:'application/pdf',stats,
    async read(begin,end) {
      begin = Math.max(0,begin); end = Math.min(size,end);
      const out = new Uint8Array(Math.max(0,end - begin));
      for (let index = Math.floor(begin / SIZE); index * SIZE < end; index++) {
        const bytes = new Uint8Array(await piece(index)), start = index * SIZE;
        const from = Math.max(begin,start) - start, to = Math.min(end,start + bytes.length) - start;
        out.set(bytes.subarray(from,to),start + from - begin);
      }
      stats.delivered += out.length;
      return out;
    },
    async arrayBuffer() { return (await bookBlob(id)).arrayBuffer(); },
    close() { cache.clear(); }};
}
async function downloadBook(id) { if (busy) return; busy = true; try { const book = books.find(b => b.id === id); await downloadBlob(await bookBlob(id),book.filename); toast(window.ThingsBookAndroid ? 'Choose where to save your original. This copy is unencrypted.' : 'Original downloaded. Keep this unencrypted copy somewhere private.'); } catch { toast('Could not decrypt or save this book. Check free space and try again.'); } finally { busy = false; resetIdle(); } }
async function readBook(id) { if (busy) return; busy = true; try { const book = books.find(b => b.id === id), blob = (book?.format === 'PDF' && await bookSource(id)) || await bookBlob(id); if (book.status === 'unread') await updateBook(id,{status:'reading'}); await closeReader(); $('detail-dialog').close(); if (!$('reader-dialog').open) $('reader-dialog').showModal(); await ThingsReader.open(book,blob,changes => updateBook(id,changes)); } catch(e) { const message=e.message || 'Could not open this book. Check its format or download the original.'; $('reader-message').textContent=message;const notice=el('p','reading-error',message);$('reader-content').replaceChildren(notice);$('reader-save-status').textContent='Book could not be opened';toast(message); } finally { busy = false; resetIdle(); } }
async function prepareBackup() {
  if (busy || !key) return;
  busy = true;
  try {
    await closeReader(); await metadataQueue;
    // close() precedes showModal() so the summary can never be hidden by a reader.
    $('reader-dialog').close();
    const recovery = config.recovery ? decoder.decode(await unseal(config.recovery)) : '';
    $('backup-summary').textContent = `${books.length} books · ${shelves.length} shelves · ${size(books.reduce((total,book)=>total+book.size,0))} of original files. Includes reading positions, notes, highlights and imported covers/fonts. Books and metadata stay encrypted.`;
    $('backup-storage').textContent=storageDescription(await ThingsStorage.inspect(0))+' Backup files are larger than the originals because of encryption and encoding. Check space in your chosen save folder; its free space is not reported here.';
    $('backup-recovery').value = recovery; $('recovery-details').hidden = !recovery;
    $('backup-ack').checked = false; $('backup-export').disabled = true;
    $('backup-dialog').showModal();
  } catch { toast('Could not prepare your backup. Check free space and try again.'); }
  finally { busy = false; resetIdle(); }
}
async function downloadRecovery() {
  if (busy || !key || !$('backup-recovery').value) return;
  busy = true;
  try {
    const text = 'ThingsBook recovery code\n\n'+$('backup-recovery').value+'\n\nKeep this separately from your encrypted .thingsbook backup. Anyone with both can read that backup. Use the exact code, including hyphens, when restoring on another device. Clearing app data or uninstalling can remove device access.\n';
    await downloadBlob(new Blob([text],{type:'text/plain'}),'ThingsBook-recovery-code.txt');
    toast('Save the recovery code somewhere safe, separately from the backup.');
  } catch { toast('Recovery code was not saved. Try again before moving your library.'); }
  finally { busy = false; resetIdle(); }
}
// Ciphertext sizes of every stored book, reading one record at a time.
async function recordSizes() { return new Promise((resolve,reject) => {
  const sizes = [], cursor = db.transaction('books').objectStore('books').openCursor();
  cursor.onerror = () => reject(cursor.error);
  cursor.onsuccess = () => { const current = cursor.result; if (!current) { resolve(sizes); return; } const r = current.value; sizes.push({id:r.id,meta:r.meta.data.byteLength,file:r.chunks ? ThingsChunks.sealedBytes(r.chunks) : r.file.data.byteLength,chunked:!!r.chunks}); current.continue(); };
}); }
// Small libraries of whole-file books keep backup version 1 so older releases can restore them.
// Larger libraries, and any library with chunked books (which version 1 cannot hold), stream as version 2.
async function backupBlob(created) { const sizes = await recordSizes(); if (!sizes.some(s => s.chunked) && ThingsBackup.fitsLegacy(sizes,config)) return ThingsBackup.legacy(await allRecords(),config,created); return ThingsBackup.stream(config,sizes.map(s => s.id),async id => { const record = await getRecord(id); if (record?.chunks) { /* two passes: piece details first, then one piece's bytes at a time */ record.partInfo = []; for (let index = 0; index < record.chunks.count; index++) { const part = await getChunk(id,index); if (!part) throw new Error('A book file is incomplete. Restore it from a backup before backing up.'); record.partInfo.push({book:part.book,index:part.index,iv:part.iv,size:part.data.byteLength}); } record.partData = index => getChunk(id,index); } return record; },created); }
async function backup() { if (busy || !key) return; busy = true; try { await closeReader(); await metadataQueue; const created = new Date().toISOString(); await downloadBlob(await backupBlob(created),`ThingsBook-backup-${created.slice(0,10)}.thingsbook`); $('backup-dialog').close(); $('backup-recovery').value = ''; toast(window.ThingsBookAndroid ? 'Choose where to save your encrypted backup. Keep its recovery code separately.' : 'Encrypted backup exported. Keep the recovery code separately for another device.'); } catch { toast('Could not export the backup. Check free space, close other apps and try again.'); } finally { busy = false; resetIdle(); } }
async function restoreFile(file) { if (!file || busy) return; busy = true; try {
  const restored = await ThingsBackup.read(file); // version 1 or 2, fully validated
  if (config && !confirm(`Restore ${restored.books.length} books? This replaces the library on this device only after every book is verified. Export a current backup first to keep both collections. Continue?`)) return;
  pendingBackup = restored; busy = false; await lock(); gateState(); toast('Enter the recovery code or original backup password. Your existing library stays intact until verification succeeds.');
} catch (e) { toast(e?.code === 'newer' || e?.code === 'truncated' ? e.message : 'This is not a valid ThingsBook encrypted backup.'); } finally { busy = false; $('backup-file').value = ''; } }
async function init() {
  try { if (!crypto.subtle || !window.indexedDB) throw new Error('Use Start ThingsBook.cmd to open this app at its localhost address.');
    // Version 2 only adds the "chunks" store; existing settings and books are untouched.
    const opening = indexedDB.open(DB_NAME,DB_VERSION); opening.onupgradeneeded = () => { if(!opening.result.objectStoreNames.contains('settings'))opening.result.createObjectStore('settings');if(!opening.result.objectStoreNames.contains('books'))opening.result.createObjectStore('books',{keyPath:'id'});if(!opening.result.objectStoreNames.contains('chunks'))opening.result.createObjectStore('chunks',{keyPath:['book','index']}); }; db = await request(opening); db.onversionchange = () => { db.close(); location.reload(); }; config = await request(db.transaction('settings').objectStore('settings').get('vault')); hasDeviceAccess = !!(config && await request(db.transaction('settings').objectStore('settings').get('device-access'))); gateState();
  } catch(e) { $('gate-error').textContent = e.message || 'Browser storage is unavailable. Use a normal browser window.'; $('unlock-button').disabled = true; return; }
  $('unlock-form').addEventListener('submit',unlock); $('lock').onclick = lock;
  $('cancel-restore').onclick = () => { if (!busy) { pendingBackup = null; gateState(); } };
  $('backup-ack').onchange = () => { $('backup-export').disabled = !$('backup-ack').checked; };
  $('backup-export').onclick = () => { if ($('backup-ack').checked) backup(); };
  $('recovery-download').onclick = downloadRecovery;
  $('backup-dialog').addEventListener('close',() => { if (!$('backup-dialog').open) { $('backup-recovery').value = ''; $('backup-ack').checked = false; $('recovery-details').open = false; } });
  $('all-books').onclick = () => { filter = 'all'; render(); }; $('reading-filter').onclick = () => { filter = 'reading'; render(); };
  $('search').oninput = scheduleLibrarySearch;
  new MutationObserver(()=>{if(!key){libraryNeedsRender=false;return;}if(libraryNeedsRender&&!$('reader-dialog').open)render();}).observe($('reader-dialog'),{attributes:true,attributeFilter:['open']}); $('sort').onchange = render;
  function switchView(next) { view = next; for (const v of ['shelf','grid']) { $(`${v}-view`).classList.toggle('selected',view === v); $(`${v}-view`).setAttribute('aria-pressed',String(view === v)); } render(); }
  $('shelf-view').onclick = () => switchView('shelf'); $('grid-view').onclick = () => switchView('grid');
  $('add-book').onclick = () => openUpload(); $('upload-form').onsubmit = upload; $('pause-import').onclick=pauseImport; $('book-files').onchange = fileSummary;
  $('new-shelf').onclick = () => { $('shelf-form').reset(); $('shelf-error').textContent = ''; $('shelf-dialog').showModal(); };
  // Mobile users can create shelves from the upload form as well.
  const addShelf = el('button','text-button','+ Create a new shelf'); addShelf.type = 'button'; addShelf.onclick = () => $('new-shelf').click(); $('shelf-select').after(addShelf);
  $('shelf-form').onsubmit = async e => { e.preventDefault(); if (busy) return; const name = $('shelf-name').value.trim(); if (!name) return; busy = true; try { await saveShelves([...shelves,{id:crypto.randomUUID(),name}]); $('shelf-dialog').close(); if ($('upload-dialog').open) fillShelves($('shelf-select'),shelves.at(-1).id); render(); toast('Your new shelf is ready.'); } catch(e) { $('shelf-error').textContent = storageError(e); } finally { busy = false; } };
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
