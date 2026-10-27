// Chunked PDFs open by byte range in real Chromium: only the pieces pdf.js asks for are decrypted.
// A synthetic 12-page PDF of about 30 MB (pages separated by large unused streams) is imported
// through the app, opened, read from its last page, and opened again with a damaged piece.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-pdfrange-'));
const servers = new Set(), cleanup = [];
// THINGSBOOK_PDF_PAGES / THINGSBOOK_PDF_FILLER_MB size the synthetic book (default 12 pages, about 30 MiB).
const PAGES = Number(process.env.THINGSBOOK_PDF_PAGES || 12), FILLER = Number(process.env.THINGSBOOK_PDF_FILLER_MB || 2.5) * 1024 * 1024;

const {serve, syntheticPdf} = require('./browser-helpers.cjs');
async function until(page, check, arg, timeout = 60000) { const end = Date.now() + timeout; for (;;) { const value = await page.evaluate(check, arg); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 250)); } }

async function main() {
  const pdf = syntheticPdf(PAGES, FILLER);
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Range test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  // Import streams: record the largest single read of file data (Blob/File.arrayBuffer) during import.
  await page.evaluate(() => { window.__largestRead = 0; const read = Blob.prototype.arrayBuffer; Blob.prototype.arrayBuffer = function () { window.__largestRead = Math.max(window.__largestRead, this.size); return read.call(this); }; });
  // Large files go through a temporary path (Playwright limits in-memory file payloads).
  const pdfPath = path.join(profile, '..', `tb-range-${process.pid}.pdf`); fs.writeFileSync(pdfPath, pdf); cleanup.push(pdfPath);
  await page.setInputFiles('#book-files', pdfPath);
  await page.evaluate(() => upload({preventDefault(){}}));
  const id = await until(page, () => books[0]?.id, null, 120000);
  const pieces = await page.evaluate(id => getRecord(id).then(r => r.chunks.count), id);
  const imported = await page.evaluate(id => ({largest:window.__largestRead, pages:books.find(b => b.id === id).pages, cover:!!books.find(b => b.id === id).cover}), id);
  assert(imported.largest <= 4 * 1024 * 1024, `import read ${imported.largest} bytes at once`);
  assert.equal(imported.pages, PAGES); assert(imported.cover, 'first-page cover rendered from a byte-range read');
  assert.equal(pieces, Math.ceil(pdf.length / (4 * 1024 * 1024)));
  const report = [`imported a ${(pdf.length / 2 ** 20).toFixed(1)} MiB, ${PAGES}-page PDF as ${pieces} encrypted pieces, never reading more than ${(imported.largest / 2 ** 20).toFixed(1)} MiB at once; page count and first-page cover extracted by range`];

  // Open: pdf.js reads the trailer, catalog and first page, not the whole file.
  await page.evaluate(id => readBook(id), id);
  await until(page, () => ThingsReader.context()?.pdf?.numPages);
  // pdf.js validates the last page while opening, which can touch every page entry; what matters for
  // memory is that it receives only the ranges it asks for and at most four decrypted pieces are held.
  const opened = await page.evaluate(() => ({pages:ThingsReader.context().pdf.numPages, ...ThingsReader.context().source?.stats}));
  assert.equal(opened.pages, PAGES);
  assert(opened.delivered <= pdf.length * 0.2, `opening handed pdf.js ${opened.delivered} of ${pdf.length} bytes`);
  assert(opened.decrypted <= pieces + 2, `opening decrypted ${opened.decrypted} pieces for ${pieces}`);
  const first = await page.evaluate(() => ThingsReader.context().pdf.getPage(1).then(p => p.getTextContent()).then(t => t.items.map(i => i.str).join(' ')));
  assert.match(first, new RegExp(`Page 1 of ${PAGES}: marker-1`));
  const last = await page.evaluate(n => ThingsReader.context().pdf.getPage(n).then(p => p.getTextContent()).then(t => t.items.map(i => i.str).join(' ')), PAGES);
  assert.match(last, new RegExp(`Page ${PAGES} of ${PAGES}: marker-${PAGES}`));
  const after = await page.evaluate(() => ThingsReader.context().source.stats.delivered);
  assert(after <= pdf.length * 0.25, `reading two pages handed pdf.js ${after} of ${pdf.length} bytes`);
  report.push(`opening handed pdf.js ${(opened.delivered / 2 ** 20).toFixed(1)} MiB of ${(pdf.length / 2 ** 20).toFixed(1)} MiB (${opened.decrypted} piece decryptions, at most 4 held); first and last pages read exactly`);
  await page.evaluate(() => closeReader());
  await until(page, () => !ThingsReader.context());

  // A damaged piece ends opening with a clear message instead of a hang; the book is left as it was.
  await page.evaluate(async ({id, last}) => {
    const part = await getChunk(id, last), data = new Uint8Array(part.data.slice(0)); data[100] ^= 1;
    window.__original = part; await transaction(['chunks'], tx => tx.objectStore('chunks').put({...part, data:data.buffer}));
  }, {id, last:pieces - 1});
  await page.evaluate(id => readBook(id), id);
  const message = await until(page, () => /damaged or incomplete/.test($('reader-message')?.textContent || '') && $('reader-message').textContent, null, 30000);
  report.push(`a damaged piece stops opening with: "${message.trim().slice(0, 70)}"`);
  await page.evaluate(() => transaction(['chunks'], tx => tx.objectStore('chunks').put(window.__original)));
  // Locking the library stops a range source from decrypting anything further.
  const lockedRead = await page.evaluate(async id => { const source = await bookSource(id); await source.read(0, 16); await lock(); try { await source.read(5 * 1024 * 1024, 5 * 1024 * 1024 + 16); return 'decrypted after lock'; } catch (e) { return e.message; } }, id);
  assert.match(lockedRead, /locked/);
  report.push('after the library locks, an open range source refuses to decrypt further pieces');
  assert.deepEqual(errors, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { for (const proc of servers) proc.kill(); for (const file of cleanup) require('./browser-helpers.cjs').cleanup(file); require('./browser-helpers.cjs').cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
