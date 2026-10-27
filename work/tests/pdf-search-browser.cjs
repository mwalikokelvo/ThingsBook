// Library-wide search covers PDF text, in real Chromium: a 12-page PDF (chunked, read by byte range)
// and an EPUB are indexed through the search dialog; a word found only on page 9 opens the reader on
// page 9, and EPUB matches still work. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, syntheticPdf} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-pdfsearch-'));

async function importFile(page, name, buffer) {
  const before = await page.evaluate(() => books.length);
  await page.setInputFiles('#book-files', {name, mimeType:'application/octet-stream', buffer});
  await page.evaluate(() => upload({preventDefault(){}}));
  assert.equal(await page.evaluate(n => books.length - n, before), 1, await page.evaluate(() => $('upload-error').textContent));
  return page.evaluate(n => books[n].id, before);
}
// Runs a library search through the dialog's own controls and returns the result rows.
async function search(page, words) {
  return page.evaluate(async words => {
    const dialog = document.getElementById('native-search-dialog'), input = dialog.querySelector('input[type=search]');
    const button = label => [...dialog.querySelectorAll('button')].find(b => b.textContent === label);
    input.value = words; button('Search').click();
    for (let i = 0; i < 400 && (button('Search').disabled || !dialog.querySelector('p[role=status]').textContent || /Indexing/.test(dialog.querySelector('p[role=status]').textContent)); i++) await new Promise(r => setTimeout(r, 100));
    return {status:dialog.querySelector('p[role=status]').textContent, rows:[...dialog.querySelectorAll('.command-results button')].map(row => ({title:row.querySelector('strong')?.textContent, text:row.querySelector('span')?.textContent}))};
  }, words);
}

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(`${e.name}: ${e.message} @ ${String(e.stack || '').split('\n').slice(0, 4).join(' | ')}`));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Search test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const pdfId = await importFile(page, 'Tide Atlas.pdf', syntheticPdf(12, 512 * 1024));
  await importFile(page, 'Lantern.epub', fs.readFileSync(path.join(__dirname, 'fixtures/kindle/sample.epub')));
  assert.equal(await page.evaluate(id => getRecord(id).then(r => !!r.chunks), pdfId), true);
  const report = [];

  const pdfHit = await search(page, 'marker-9');
  assert.match(pdfHit.status, /Showing 1 matching passage/);
  assert.equal(pdfHit.rows[0].title, 'Tide Atlas'); assert.match(pdfHit.rows[0].text, /Page 9 of 12: marker-9/);
  await page.evaluate(() => document.querySelector('#native-search-dialog .command-results button').click());
  const landed = await (async () => { for (let i = 0; i < 100; i++) { const location = await page.evaluate(() => ThingsReader.context()?.pdf ? ThingsReader.context().location : null); if (location === 8) return location; await new Promise(r => setTimeout(r, 200)); } return page.evaluate(() => ThingsReader.context()?.location); })();
  assert.equal(landed, 8, 'opened on page 9 (location 8)');
  await page.evaluate(() => closeReader());
  report.push('a word found only on page 9 of a chunked PDF is found library-wide and opens the reader on page 9');

  const epubHit = await search(page, 'lantern pier');
  assert(epubHit.rows.some(row => row.title === 'The Lantern Keeper'), JSON.stringify(epubHit));
  const none = await search(page, 'marker-99');
  assert.equal(none.rows.length, 0);
  report.push('EPUB matches still found alongside PDFs; a word in neither returns no results');
  assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { require('./browser-helpers.cjs').cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
