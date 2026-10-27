// Real Chromium + real IndexedDB: a library made by the released app is upgraded in place by the new code.
// usage: node work/tests/upgrade-browser.cjs [released ThingsBook dir] [new ThingsBook dir]
// The released dir defaults to $THINGSBOOK_RELEASED_DIR (e.g. a `git worktree` of the last release's
// outputs/ThingsBook); the new dir defaults to this checkout. Skips when either Playwright or the
// released copy is unavailable, so the portable runner stays green on machines without them.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const released = path.resolve(process.argv[2] || process.env.THINGSBOOK_RELEASED_DIR || '.missing-release');
const current = path.resolve(process.argv[3] || path.join(__dirname, '../../outputs/ThingsBook'));
if (!fs.existsSync(path.join(released, 'server.py'))) { console.log('SKIP: set THINGSBOOK_RELEASED_DIR to the previous release\'s outputs/ThingsBook.'); process.exit(0); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-upgrade-'));
const URL = 'http://127.0.0.1:8765/', PASSWORD = 'Upgrade-test password 1';
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const textBook = (label, bytes) => { let s = ''; let i = 0; while (s.length < bytes) s += `${label} paragraph ${i++}: the quick brown fox reads privately.\n`; return Buffer.from(s.slice(0, bytes)); };
const OLD_BOOK = textBook('Old', 6 * 1024 * 1024 + 7), NEW_BOOK = textBook('New', 9 * 1024 * 1024 + 11);

const servers = new Set();
const {serve} = require('./browser-helpers.cjs');
async function open(dir) {
  const server = await serve(dir);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  return {page, errors, close:async () => { await context.close(); await server.stop(); }};
}
async function importFile(page, name, buffer) {
  const before = await page.evaluate(() => books.length);
  await page.setInputFiles('#book-files', {name, mimeType:'text/plain', buffer});
  await page.evaluate(() => upload({preventDefault(){}}));
  await page.waitForFunction(n => books.length === n + 1, before, {timeout:30000});
  return page.evaluate(n => books[n].id, before);
}
// Polls an async page check until it resolves truthy (page.waitForFunction would accept the pending Promise itself).
async function until(page, check, arg, timeout = 60000) { const end = Date.now() + timeout; for (;;) { if (await page.evaluate(check, arg)) return; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 500)); } }
const readBook = (page, id) => page.evaluate(async id => { const b = new Uint8Array(await (await bookBlob(id)).arrayBuffer()); const h = await crypto.subtle.digest('SHA-256', b); return {length:b.length, hash:[...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('')}; }, id);
const unlockWith = async (page, password) => { await page.evaluate(p => { $('password').value = p; }, password); await page.evaluate(() => unlock({preventDefault(){}})); await page.waitForFunction(() => !!key, null, {timeout:30000}); };

async function main() {
  const report = []; const push = report.push.bind(report); report.push = line => { console.error(`.. ${line.slice(0, 90)}`); return push(line); };
  // 1. The released app creates a library and imports a book.
  let app = await open(released);
  assert.equal(await app.page.evaluate(() => typeof DB_VERSION), 'undefined', 'released code really is the old version');
  await app.page.evaluate(p => { $('password').value = p; $('confirm-password').value = p; }, PASSWORD);
  await app.page.evaluate(() => unlock({preventDefault(){}})); await app.page.waitForFunction(() => !!key);
  const oldId = await importFile(app.page, 'Old.txt', OLD_BOOK);
  await app.page.evaluate(id => updateBook(id, {notes:'note from 1.12.5'}), oldId);
  assert.equal(await app.page.evaluate(() => db.version), 1);
  assert.equal(await app.page.evaluate(id => getRecord(id).then(r => !!r.file), oldId), true);
  assert.deepEqual(app.errors, []);
  await app.close();
  report.push('released app: created library, imported a 6 MB book, saved a note (DB version 1)');

  // 2. The new code opens the same profile: upgrade, device-access unlock, old book intact.
  app = await open(current);
  const stores = await app.page.evaluate(() => ({version:db.version, stores:[...db.objectStoreNames]}));
  const expected = await app.page.evaluate(() => DB_VERSION);
  assert.equal(stores.version, expected);
  for (const name of ['books', 'chunks', 'settings']) assert(stores.stores.includes(name), `store ${name} exists after the upgrade`);
  await app.page.evaluate(() => unlock({preventDefault(){}})); await app.page.waitForFunction(() => !!key, null, {timeout:30000});
  assert.equal(await app.page.evaluate(() => books.length), 1);
  assert.equal(await app.page.evaluate(id => books.find(b => b.id === id).notes, oldId), 'note from 1.12.5');
  assert.deepEqual(await readBook(app.page, oldId), {length:OLD_BOOK.length, hash:sha(OLD_BOOK)});
  report.push(`new code: upgraded to DB version ${stores.version} (${stores.stores.join(', ')}); unlocked with saved device access; old book and note intact`);
  // Background conversion (when this build has it): the old whole-file book becomes chunks by itself.
  const converts = await app.page.evaluate(() => typeof migrateBooks === 'function');
  if (converts) {
    await until(app.page, id => getRecord(id).then(r => !!r.chunks && !r.file), oldId);
    assert.deepEqual(await readBook(app.page, oldId), {length:OLD_BOOK.length, hash:sha(OLD_BOOK)});
    assert.equal(await app.page.evaluate(id => books.find(b => b.id === id).notes, oldId), 'note from 1.12.5');
    report.push('background conversion: the 1.12.5 book was converted to 2 pieces while idle; bytes and note unchanged');
  }

  // 3. A new import is chunked; reading it is exact; a metadata save no longer rewrites the file.
  const newId = await importFile(app.page, 'New.txt', NEW_BOOK);
  const stored = await app.page.evaluate(async id => { const r = await getRecord(id); const keys = await request(db.transaction('chunks').objectStore('chunks').getAllKeys()); return {chunks:r.chunks, file:!!r.file, pieces:keys.filter(k => k[0] === id).length, recordBytes:r.meta.data.byteLength}; }, newId);
  assert.deepEqual(stored.chunks, {count:3, bytes:NEW_BOOK.length}); assert.equal(stored.file, false); assert.equal(stored.pieces, 3);
  assert.deepEqual(await readBook(app.page, newId), {length:NEW_BOOK.length, hash:sha(NEW_BOOK)});
  await app.page.evaluate(id => updateBook(id, {notes:'chunked note', progress:{location:2, percent:40}}), newId);
  assert.equal(await app.page.evaluate(id => getRecord(id).then(r => !r.file && r.chunks.count === 3), newId), true);
  assert.deepEqual(await readBook(app.page, newId), {length:NEW_BOOK.length, hash:sha(NEW_BOOK)});
  report.push(`new import: 9 MB book stored as 3 encrypted pieces, read back byte-exact; a progress save rewrote only the ${stored.recordBytes}-byte metadata`);

  // 4. Backup holds both layouts; removing a book removes its pieces; restore brings both back.
  await app.page.evaluate(async () => { window.__backup = await backupBlob(new Date().toISOString()); });
  const head = await app.page.evaluate(async () => ({v2:(await window.__backup.slice(0, 31).text()) === ThingsBackup.MAGIC, size:window.__backup.size, kinds:(await ThingsBackup.read(window.__backup)).books.map(b => b.chunks ? `chunked:${b.parts.length}` : 'whole')}));
  assert.equal(head.v2, true); assert.deepEqual(head.kinds.sort(), converts ? ['chunked:2', 'chunked:3'] : ['chunked:3', 'whole']);
  await app.page.evaluate(id => transaction(['books', 'chunks', 'ocr'], tx => deleteBooks(tx, [id])), newId);
  assert.equal(await app.page.evaluate(id => request(db.transaction('chunks').objectStore('chunks').getAllKeys()).then(k => k.filter(x => x[0] === id).length), newId), 0);
  await app.page.evaluate(() => restoreFile(new File([window.__backup], 'library.thingsbook')));
  await app.page.waitForFunction(() => !!pendingBackup && !key, null, {timeout:30000});
  await app.page.evaluate(() => { $('password').value = 'wrong password'; return unlock({preventDefault(){}}); });
  assert.equal(await app.page.evaluate(() => !!pendingBackup && !key), true, 'wrong password leaves restore pending');
  await unlockWith(app.page, PASSWORD);
  assert.equal(await app.page.evaluate(() => books.length), 2);
  assert.deepEqual(await readBook(app.page, oldId), {length:OLD_BOOK.length, hash:sha(OLD_BOOK)});
  assert.deepEqual(await readBook(app.page, newId), {length:NEW_BOOK.length, hash:sha(NEW_BOOK)});
  assert.equal(await app.page.evaluate(id => books.find(b => b.id === id).notes, newId), 'chunked note');
  report.push(`backup: ${(head.size / 2 ** 20).toFixed(1)} MiB version 2 file with ${converts ? 'a 2-piece and a 3-piece book' : 'one whole-file and one 3-piece book'}; deleting a book removed its pieces; restore rejected a wrong password, then brought both books back byte-exact`);

  // 5. Stray pieces from an interrupted import disappear at the next unlock.
  await app.page.evaluate(() => transaction(['chunks'], tx => tx.objectStore('chunks').put({book:'interrupted', index:0, iv:new Uint8Array(12), data:new ArrayBuffer(64)})));
  await app.page.evaluate(() => lock()); await app.page.waitForFunction(() => !key);
  await unlockWith(app.page, PASSWORD);
  await until(app.page, () => request(db.transaction('chunks').objectStore('chunks').getAllKeys()).then(k => !k.some(x => x[0] === 'interrupted')), null, 15000);
  assert.equal(await app.page.evaluate(() => request(db.transaction('chunks').objectStore('chunks').count())), converts ? 5 : 3);
  report.push(`interrupted import: stray pieces removed at unlock; the real books' ${converts ? 5 : 3} pieces kept`);
  assert.deepEqual(app.errors, []);
  await app.close();

  // 6. Downgrade, for the record: the released app on the upgraded profile.
  app = await open(released);
  await app.page.waitForFunction(() => typeof hasDeviceAccess !== 'undefined' && hasDeviceAccess, null, {timeout:10000}).catch(() => {});
  const down = await app.page.evaluate(async () => { try { await unlock({preventDefault(){}}); } catch {} return {key:!!key, books:books.length, error:$('gate-error')?.textContent || '', device:hasDeviceAccess}; });
  let oldReads = 'n/a', newReads = 'n/a';
  if (down.key) {
    oldReads = await readBook(app.page, oldId).then(r => r.hash === sha(OLD_BOOK) ? 'opens' : 'wrong bytes', e => `fails: ${e.message.split('\n')[0]}`);
    newReads = await readBook(app.page, newId).then(() => 'opens', e => `fails: ${e.message.split('\n')[0]}`);
  }
  report.push(`downgrade to released app: unlock ${down.key ? 'works' : `fails (${down.error || 'no message'}; device access ${down.device})`}, ${down.books} books listed; whole-file book ${oldReads}; chunked book ${newReads}`);
  await app.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { for (const proc of servers) proc.kill(); require('./browser-helpers.cjs').cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
