// Duplicate books in real Chromium. A book imported again under another name is skipped and the user is
// told which book it matches; a batch skips its duplicates and still imports the rest; a converted book
// (FictionBook) is matched by its original file; "Also import books already in my library" adds a copy.
// Large files are fingerprinted piece by piece (no read over 4 MiB), covering every byte. Books saved before fingerprints
// existed get one in the background.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, cleanup} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-duplicates-'));
const EPUB = fs.readFileSync(path.join(__dirname, 'fixtures/kindle/sample.epub'));
const FB2 = fs.readFileSync(path.join(__dirname, 'fixtures/fb2/sample.fb2.zip'));

async function importFiles(page, files, {copies = false} = {}) {
  const before = await page.evaluate(() => books.length);
  await page.evaluate(copies => { $('upload-error').textContent = ''; $('toast').textContent = ''; $('import-duplicates').checked = copies; if (!$('upload-dialog').open) $('upload-dialog').showModal(); }, copies);
  await page.setInputFiles('#book-files', files.map(([name, bytes]) => ({name, mimeType:'application/octet-stream', buffer:Buffer.from(bytes)})));
  await page.evaluate(() => upload({preventDefault(){}}));
  return page.evaluate(n => ({added:books.length - n, ids:books.slice(n).map(b => b.id), error:$('upload-error').textContent, toast:$('toast').textContent, status:$('import-status').textContent}), before);
}

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const problems = []; page.on('pageerror', e => problems.push(e.message));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Duplicate test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  const first = await importFiles(page, [['harbour.epub', EPUB]]);
  assert.equal(first.added, 1, first.error);
  const fingerprint = await page.evaluate(id => books.find(b => b.id === id).fingerprint, first.ids[0]);
  assert.match(fingerprint, /^c1:[0-9a-f]{64}$/);
  const title = await page.evaluate(id => books.find(b => b.id === id).title, first.ids[0]);

  const again = await importFiles(page, [['a renamed copy.epub', EPUB]]);
  assert.equal(again.added, 0, 'the same book under another name is not added again');
  assert.match(again.toast, /Already in your library, not added again: a renamed copy\.epub/);
  assert(again.toast.includes(title), 'the message names the book it matches');
  report.push('the same EPUB under another name is skipped, naming the book already in the library');

  const batch = await importFiles(page, [['x.epub', EPUB], ['tale.fb2.zip', FB2], ['y.epub', EPUB]]);
  assert.equal(batch.added, 1, 'only the new book in the batch is added');
  assert.match(batch.toast, /1 book has found a home/); assert.match(batch.toast, /x\.epub.*y\.epub/);
  const fb2 = await page.evaluate(id => books.find(b => b.id === id), batch.ids[0]);
  assert.equal(fb2.sourceFormat, 'FB2'); assert.match(fb2.fingerprint, /^c1:/);
  const fb2Again = await importFiles(page, [['tale-again.fb2.zip', FB2]]);
  assert.equal(fb2Again.added, 0, 'a converted book is matched by its original file');
  report.push('a batch skips its duplicates and imports the rest; a converted FictionBook is matched by its original file');

  const copy = await importFiles(page, [['deliberate copy.epub', EPUB]], {copies:true});
  assert.equal(copy.added, 1, 'a copy is added when asked for');
  report.push('"Also import books already in my library" adds a second copy');

  const large = await page.evaluate(async () => {
    const MB = 1024 * 1024, size = 41 * MB + 123;
    let largest = 0, total = 0;
    const source = flip => ({size, async read(begin, end) { largest = Math.max(largest, end - begin); total += end - begin; const out = new Uint8Array(end - begin); for (let i = 0; i < out.length; i++) out[i] = (begin + i) * 31 & 255; if (flip !== undefined && flip >= begin && flip < end) out[flip - begin] ^= 1; return out; }});
    const a = await ThingsFingerprint.of(source()), b = await ThingsFingerprint.of(source());
    const middle = await ThingsFingerprint.of(source(Math.floor(size / 2) + 5)), last = await ThingsFingerprint.of(source(size - 1));
    return {a, same:a === b, middle:a !== middle, last:a !== last, largest:largest / MB, readsEverything:total === 4 * size};
  });
  assert.match(large.a, /^c1:[0-9a-f]{64}$/); assert(large.same);
  assert(large.middle && large.last, 'changing any single byte changes the fingerprint');
  assert(large.largest <= 4, `no read over 4 MiB (largest ${large.largest} MiB)`); assert(large.readsEverything);
  report.push(`a 41 MB file is fingerprinted from every byte in reads of at most ${large.largest} MiB; one changed byte (middle or last) changes it`);

  const backfilled = await page.evaluate(async id => {
    await updateBook(id, {fingerprint:null});
    const count = await fingerprintBooks();
    return {count, value:books.find(b => b.id === id).fingerprint};
  }, first.ids[0]);
  assert(backfilled.count >= 1); assert.equal(backfilled.value, fingerprint, 'a book saved without a fingerprint gets the same one in the background');
  report.push('a book saved before fingerprints existed gets one in the background');

  assert.deepEqual(problems, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
