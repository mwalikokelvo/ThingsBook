// Recognized page text is kept with the book, in real Chromium: text saved for a page without a text
// layer (as page recognition does) is used when the page is shown again after closing, locking and
// unlocking; it makes the page searchable library-wide; a record moved to another page is ignored;
// and removing the book removes its recognized text. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, syntheticPdf} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-ocr-'));
const PASSWORD = 'Recognition test password 1';

async function until(page, check, arg, timeout = 30000) { const end = Date.now() + timeout; for (;;) { const value = await page.evaluate(check, arg); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 200)); } }
const transcript = page => page.evaluate(() => [...document.querySelectorAll('#reader-content .reading-article p')].map(p => p.textContent).join('\n'));
async function openPage(page, id, location) {
  await page.evaluate(id => readBook(id), id);
  await until(page, () => !!ThingsReader.context()?.pdf);
  await page.evaluate(location => ThingsReader.jump(location), location);
  await until(page, location => ThingsReader.context()?.location === location && !ThingsReader.context()?.loading && !!document.querySelector('.pdf-transcript-label'), location);
}

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(p => { $('password').value = $('confirm-password').value = p; return unlock({preventDefault(){}}); }, PASSWORD);
  await page.waitForFunction(() => !!key);
  await page.setInputFiles('#book-files', {name:'Scanned Log.pdf', mimeType:'application/pdf', buffer:syntheticPdf(5, 32 * 1024, [3])});
  await page.evaluate(() => upload({preventDefault(){}}));
  const id = await until(page, () => books[0]?.id);
  const report = [];

  // Page 3 has no text layer; save recognized text for it, as page recognition does.
  await openPage(page, id, 2);
  assert.doesNotMatch(await transcript(page), /harbour ledger/);
  await page.evaluate(id => saveRecognizedPage(id, 2, {text:'Recognized harbour ledger entry for the third page.', confidence:91}), id);
  const stored = await page.evaluate(() => request(db.transaction('ocr').objectStore('ocr').getAll()));
  assert.equal(stored.length, 1); assert(!JSON.stringify(stored).includes('harbour ledger'), 'recognized text is stored encrypted');
  await page.evaluate(() => closeReader());

  // It survives closing the book, and locking and unlocking the library.
  await page.evaluate(() => lock()); await page.waitForFunction(() => !key);
  await page.evaluate(p => { $('password').value = p; return unlock({preventDefault(){}}); }, PASSWORD); await page.waitForFunction(() => !!key);
  await openPage(page, id, 2);
  assert.match(await transcript(page), /Recognized harbour ledger entry/);
  assert.match(await page.evaluate(() => document.querySelector('.pdf-transcript-label').textContent), /RECOGNIZED PAGE TEXT/);
  await page.evaluate(() => closeReader());
  report.push('recognized text for a scanned page is stored encrypted and shown again after closing, locking and unlocking');

  // Library search finds the recognized words and opens that page.
  const found = await page.evaluate(async () => {
    const dialog = document.getElementById('native-search-dialog'), button = label => [...dialog.querySelectorAll('button')].find(b => b.textContent === label);
    dialog.querySelector('input[type=search]').value = 'harbour ledger'; button('Search').click();
    for (let i = 0; i < 300 && (button('Search').disabled || !/Showing|No matching/.test(dialog.querySelector('p[role=status]').textContent)); i++) await new Promise(r => setTimeout(r, 100));
    return [...dialog.querySelectorAll('.command-results button span')].map(s => s.textContent);
  });
  assert(found.some(text => /harbour ledger/.test(text)), JSON.stringify(found));
  report.push('library search finds words recognized on a scanned page');

  // A record moved to another page is ignored there.
  await page.evaluate(async id => { const record = await request(db.transaction('ocr').objectStore('ocr').get([id, 2])); await transaction(['ocr'], tx => tx.objectStore('ocr').put({...record, page:3})); }, id);
  assert.equal(await page.evaluate(id => loadRecognizedPage(id, 3), id), null);
  assert.notEqual(await page.evaluate(id => loadRecognizedPage(id, 2), id), null);
  report.push('a recognized-text record moved to another page is ignored');

  // Removing the book removes its recognized text.
  await page.evaluate(id => transaction(['books', 'chunks', 'ocr'], tx => deleteBooks(tx, [id])), id);
  assert.equal(await page.evaluate(() => request(db.transaction('ocr').objectStore('ocr').count())), 0);
  report.push('removing the book removes its recognized text');
  // A removal through a transaction without the "ocr" store still works; the leftover text goes at the next unlock.
  await page.setInputFiles('#book-files', {name:'Second Log.pdf', mimeType:'application/pdf', buffer:syntheticPdf(2, 1024, [1])});
  await page.evaluate(() => upload({preventDefault(){}}));
  const second = await until(page, () => books.find(b => b.title === 'Second Log')?.id);
  await page.evaluate(id => saveRecognizedPage(id, 0, {text:'left behind', confidence:50}), second);
  await page.evaluate(id => transaction(['books', 'chunks'], tx => deleteBooks(tx, [id])), second);
  assert.equal(await page.evaluate(() => request(db.transaction('ocr').objectStore('ocr').count())), 1);
  await page.evaluate(() => lock()); await page.waitForFunction(() => !key);
  await page.evaluate(p => { $('password').value = p; return unlock({preventDefault(){}}); }, PASSWORD); await page.waitForFunction(() => !!key);
  await until(page, () => request(db.transaction('ocr').objectStore('ocr').count()).then(n => n === 0));
  report.push('recognized text left by a removal without the "ocr" store is cleaned up at the next unlock');
  assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { fs.rmSync(profile, {recursive:true, force:true}); setTimeout(() => process.exit(), 500).unref(); });
