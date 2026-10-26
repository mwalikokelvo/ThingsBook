// Comparing two different PDF books, in real Chromium: one PDF is open in the reader, another is
// chosen in the comparison pane (read by byte range); its pages are listed and a page's text shows.
// Switching the comparison to an EPUB and closing it work without page errors. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, syntheticPdf} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-compare-'));

async function importFile(page, name, buffer) {
  const before = await page.evaluate(() => books.length);
  await page.setInputFiles('#book-files', {name, mimeType:'application/octet-stream', buffer});
  await page.evaluate(() => upload({preventDefault(){}}));
  assert.equal(await page.evaluate(n => books.length - n, before), 1, await page.evaluate(() => $('upload-error').textContent));
  return page.evaluate(n => books[n].id, before);
}
async function until(page, check, arg, timeout = 30000) { const end = Date.now() + timeout; for (;;) { const value = await page.evaluate(check, arg); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 200)); } }

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Compare test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const first = await importFile(page, 'First Atlas.pdf', syntheticPdf(4, 64 * 1024));
  const second = await importFile(page, 'Second Atlas.pdf', syntheticPdf(12, 64 * 1024));
  const epub = await importFile(page, 'Lantern.epub', fs.readFileSync(path.join(__dirname, 'fixtures/kindle/sample.epub')));
  const report = [];

  await page.evaluate(id => readBook(id), first);
  await until(page, () => ThingsReader.context()?.pdf?.numPages === 4);
  await page.evaluate(() => [...document.querySelectorAll('.sanctuary-reader-tools button')].find(b => b.textContent === 'Compare').click());
  await until(page, () => !document.querySelector('.comparison-pane').hidden && document.querySelector('[aria-label="Comparison book"]').options.length > 0);
  const offered = await page.evaluate(() => [...document.querySelector('[aria-label="Comparison book"]').options].map(o => o.textContent));
  assert(offered.includes('Second Atlas') && offered.includes('The Lantern Keeper'), `PDFs are offered for comparison: ${offered}`);
  const choose = (label, value) => page.evaluate(({label, value}) => { const select = document.querySelector(`[aria-label="${label}"]`); select.value = value; select.dispatchEvent(new Event('change')); }, {label, value});
  await choose('Comparison book', second);
  await until(page, () => document.querySelector('[aria-label="Comparison chapter"]').options.length === 12);
  await until(page, () => /Page 1 of 12: marker-1/.test(document.querySelector('.comparison-content').textContent));
  await choose('Comparison chapter', '5');
  const shown = await until(page, () => /Page 5 of 12: marker-5/.test(document.querySelector('.comparison-content').textContent) && document.querySelector('.comparison-content').textContent);
  assert(!/marker-1\b/.test(shown));
  report.push('with one PDF open, a second PDF compares side by side: its 12 pages are listed and page 5 shows its own text');

  await choose('Comparison book', epub);
  await until(page, () => /Lantern Keeper|Mara kept/.test(document.querySelector('.comparison-content').textContent));
  await page.evaluate(() => [...document.querySelectorAll('.comparison-pane button')].find(b => b.textContent === 'Close comparison').click());
  assert.equal(await page.evaluate(() => document.querySelector('.comparison-pane').hidden), true);
  report.push('switching the comparison to an EPUB and closing it work');
  assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { fs.rmSync(profile, {recursive:true, force:true}); setTimeout(() => process.exit(), 500).unref(); });
