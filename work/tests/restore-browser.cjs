// Staged restore in real Chromium: a ~150 MiB library is backed up in one profile and restored into
// another profile that already has a book. The restore reads the backup piece by piece, swaps the
// library in one step, and a damaged backup leaves the existing library untouched.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const {spawn, execSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-restore-'));
const servers = new Set(), contexts = new Set();
const PASSWORD = 'Restore test password 1', BOOKS = Number(process.env.THINGSBOOK_RESTORE_BOOKS || 3), BOOK_MB = Number(process.env.THINGSBOOK_RESTORE_BOOK_MB || 50);

const {serve} = require('./browser-helpers.cjs');
async function until(page, check, arg, timeout = 120000) { const end = Date.now() + timeout; for (;;) { const value = await page.evaluate(check, arg); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 250)); } }
async function open(profile, password) {
  const context = await chromium.launchPersistentContext(profile, {headless:true, acceptDownloads:true}); contexts.add(context);
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(p => { $('password').value = $('confirm-password').value = p; return unlock({preventDefault(){}}); }, password);
  await page.waitForFunction(() => !!key);
  return {context, page, errors};
}
async function importText(page, name, buffer) {
  const file = path.join(temp, name); fs.writeFileSync(file, buffer);
  const before = await page.evaluate(() => books.length);
  await page.setInputFiles('#book-files', file);
  await page.evaluate(() => upload({preventDefault(){}}));
  await until(page, n => books.length === n + 1, before);
  return page.evaluate(n => books[n].id, before);
}
const digest = (page, id) => page.evaluate(async id => { const b = new Uint8Array(await (await bookBlob(id)).arrayBuffer()); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join(''); }, id);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
function rendererMiB() { try { return Math.round(Number(execSync("ps -eo rss,cmd | grep -v grep | grep -- '--type=renderer' | awk '{s+=$1} END {print s+0}'").toString()) / 1024); } catch { return 0; } }

async function main() {
  await serve(app);
  const report = [], originals = new Map();
  // 1. A library of large text books, backed up (version 2: chunked books).
  let a = await open(path.join(temp, 'a'), PASSWORD);
  for (let i = 0; i < BOOKS; i++) {
    const body = Buffer.from(crypto.randomBytes(BOOK_MB * 1024 * 1024 * 3 / 4).toString('base64'));
    const id = await importText(a.page, `Book ${i}.txt`, body); originals.set(id, sha(body));
  }
  const [firstId] = originals.keys();
  await a.page.evaluate(id => saveRecognizedPage(id, 4, {text:'Recognized words travel with the backup.', confidence:88}), firstId);
  const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.evaluate(() => backup())]);
  const backupPath = path.join(temp, 'library.thingsbook'); await download.saveAs(backupPath);
  const size = fs.statSync(backupPath).size;
  assert.equal(fs.readFileSync(backupPath).subarray(0, 31).toString(), 'ThingsBook encrypted backup v2\n');
  await a.context.close(); contexts.delete(a.context);
  report.push(`backed up ${BOOKS} chunked books: a ${(size / 2 ** 20).toFixed(0)} MiB version 2 backup`);

  // 2. Another profile with its own book restores that backup, reading it piece by piece.
  let b = await open(path.join(temp, 'b'), 'A different library password');
  await importText(b.page, 'Existing.txt', Buffer.from('A book that the restore replaces.'));
  await b.page.evaluate(() => { window.__largestRead = 0; const read = Blob.prototype.arrayBuffer; Blob.prototype.arrayBuffer = function () { window.__largestRead = Math.max(window.__largestRead, this.size); return read.call(this); }; });
  const baseline = rendererMiB();
  await b.page.setInputFiles('#backup-file', backupPath);
  await until(b.page, () => !!pendingBackup && !key);
  let peak = 0; const sampler = setInterval(() => { peak = Math.max(peak, rendererMiB()); }, 300);
  await b.page.evaluate(p => { $('password').value = p; return unlock({preventDefault(){}}); }, PASSWORD);
  await until(b.page, () => !!key, null, 300000);
  clearInterval(sampler);
  const largest = await b.page.evaluate(() => window.__largestRead);
  assert.equal(await b.page.evaluate(() => books.length), BOOKS);
  for (const [id, hash] of originals) assert.equal(await digest(b.page, id), hash, `book ${id} restored byte-exact`);
  assert.equal(await b.page.evaluate(() => request(db.transaction('staging').objectStore('staging').count())), 0);
  assert.equal((await b.page.evaluate(id => loadRecognizedPage(id, 4), firstId))?.text, 'Recognized words travel with the backup.', 'recognized text restored');
  assert(largest <= 4 * 1024 * 1024 + 64, `restore read ${largest} bytes of the backup at once`);
  report.push(`restored into a profile with its own library: ${BOOKS} books byte-exact plus recognized page text, the old book replaced, staging emptied; never read more than ${(largest / 2 ** 20).toFixed(1)} MiB of the backup at once; renderer memory ${baseline} → peak ${peak} MiB while restoring ${(size / 2 ** 20).toFixed(0)} MiB`);

  // 3. A damaged copy is refused after the password check; the restored library stays as it is.
  const damaged = fs.readFileSync(backupPath); damaged[Math.floor(damaged.length * 0.7)] ^= 1;
  const damagedPath = path.join(temp, 'damaged.thingsbook'); fs.writeFileSync(damagedPath, damaged);
  await b.page.setInputFiles('#backup-file', damagedPath);
  await until(b.page, () => !!pendingBackup && !key);
  await b.page.evaluate(p => { $('password').value = p; return unlock({preventDefault(){}}); }, PASSWORD);
  const message = await until(b.page, () => /could not be verified/.test($('gate-error').textContent) && $('gate-error').textContent, null, 300000);
  assert.equal(await b.page.evaluate(() => request(db.transaction('staging').objectStore('staging').count())), 0);
  await b.page.evaluate(() => { pendingBackup = null; gateState(); });
  await b.page.evaluate(() => unlock({preventDefault(){}}));
  await until(b.page, () => !!key);
  for (const [id, hash] of originals) assert.equal(await digest(b.page, id), hash, 'library unchanged after a refused restore');
  report.push(`a damaged backup is refused after staging began ("${message.trim().slice(0, 60)}…"); staging emptied and the library left intact`);
  assert.deepEqual([...a.errors, ...b.errors], []);
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { for (const c of contexts) await c.close().catch(() => {}); for (const proc of servers) proc.kill(); fs.rmSync(temp, {recursive:true, force:true}); setTimeout(() => process.exit(), 500).unref(); });
