// Comic archives in real Chromium: a .cbz built in the page (pages named page10, page2, page1, each a
// different width, plus ComicInfo.xml) imports as an EPUB with pages in natural order, metadata and a
// cover, and opens in the reader. A zip that also holds other files is not taken for a comic.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-cbz-'));

async function importFile(page, name, bytes) {
  const before = await page.evaluate(() => books.length);
  await page.evaluate(() => { $('upload-error').textContent = ''; });
  await page.setInputFiles('#book-files', {name, mimeType:'application/octet-stream', buffer:Buffer.from(bytes)});
  await page.evaluate(() => upload({preventDefault(){}}));
  return {added:await page.evaluate(n => books.length - n, before), error:await page.evaluate(() => $('upload-error').textContent), id:await page.evaluate(n => books[n]?.id, before)};
}

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const problems = []; page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Comic test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  const archive = await page.evaluate(async () => {
    const png = async width => { const c = document.createElement('canvas'); c.width = width; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#31534a'; g.fillRect(0, 0, width, 40); return new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); };
    const info = new TextEncoder().encode('<?xml version="1.0"?><ComicInfo><Series>Harbour Lights</Series><Number>3</Number><Writer>Fixture Artist</Writer><LanguageISO>en</LanguageISO><Summary>Three panels.</Summary></ComicInfo>');
    return Array.from(ThingsArchiveLib.zipSync({'Harbour/page10.png':await png(100), 'Harbour/page2.png':await png(20), 'Harbour/page1.png':await png(10), 'ComicInfo.xml':info}));
  });
  const comic = await importFile(page, 'harbour-lights-3.cbz', archive);
  assert.equal(comic.added, 1, comic.error);
  const meta = await page.evaluate(id => books.find(b => b.id === id), comic.id);
  assert.equal(meta.format, 'EPUB'); assert.equal(meta.sourceFormat, 'CBZ');
  assert.equal(meta.title, 'Harbour Lights #3'); assert.equal(meta.author, 'Fixture Artist'); assert(meta.cover, 'first page is the cover');
  const epub = await page.evaluate(async id => {
    const zip = ThingsArchiveLib.unzipSync(new Uint8Array(await (await bookBlob(id)).arrayBuffer()));
    const parse = name => new DOMParser().parseFromString(new TextDecoder().decode(zip[name]), 'application/xhtml+xml');
    const parts = Object.keys(zip).filter(n => /OEBPS\/page\d+\.xhtml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xhtml/)[1]) - Number(b.match(/(\d+)\.xhtml/)[1]));
    const widths = [];
    for (const part of parts) { const src = 'OEBPS/' + parse(part).querySelector('img').getAttribute('src'); const bitmap = await createImageBitmap(new Blob([zip[src]], {type:'image/png'})); widths.push(bitmap.width); }
    return {widths, strict:parts.every(p => !parse(p).getElementsByTagName('parsererror').length)};
  }, comic.id);
  assert.deepEqual(epub.widths, [10, 20, 100], 'pages in natural order: page1, page2, page10'); assert(epub.strict);
  await page.evaluate(id => readBook(id), comic.id);
  await page.waitForFunction(() => [...($('reader-content')?.querySelectorAll('img') || [])].some(img => img.complete && img.naturalWidth > 0), null, {timeout:20000, polling:250});
  await page.evaluate(() => closeReader());
  report.push('harbour-lights-3.cbz → EPUB: 3 pages in natural order, title "Harbour Lights #3" and writer from ComicInfo.xml, first page as cover; opens in the reader');

  const mixed = await page.evaluate(async () => Array.from(ThingsArchiveLib.zipSync({'page1.png':new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'notes.txt':new TextEncoder().encode('not a comic')})));
  const rejected = await importFile(page, 'mixed.cbz', mixed);
  assert.equal(rejected.added, 0); assert(rejected.error);
  report.push('a zip holding other files besides page images is not imported as a comic');
  assert.deepEqual(problems, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { require('./browser-helpers.cjs').cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
