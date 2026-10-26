// Kindle import in real Chromium: genuine Calibre-made MOBI 6, KF8 (AZW3) and combined files are
// converted to EPUB by the app's own import path and open in the reader. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const fixtures = path.join(__dirname, 'fixtures/kindle');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-kindle-'));
const servers = new Set();

const {serve} = require('./browser-helpers.cjs');
async function importFile(page, name, buffer) {
  const before = await page.evaluate(() => books.length);
  await page.evaluate(() => { $('upload-error').textContent = ''; });
  await page.setInputFiles('#book-files', {name, mimeType:'application/octet-stream', buffer});
  await page.evaluate(() => upload({preventDefault(){}}));
  return {added:await page.evaluate(n => books.length - n, before), error:await page.evaluate(() => $('upload-error').textContent), id:await page.evaluate(n => books[n]?.id, before)};
}
// Inspects the stored EPUB: what the converter produced, read back through the encrypted library.
const inspect = (page, id) => page.evaluate(async id => {
  const zip = ThingsArchiveLib.unzipSync(new Uint8Array(await (await bookBlob(id)).arrayBuffer()));
  const names = Object.keys(zip), text = name => new TextDecoder().decode(zip[name]);
  const parse = name => new DOMParser().parseFromString(text(name), 'application/xhtml+xml');
  const parts = names.filter(n => /OEBPS\/part\d+\.xhtml$/.test(n));
  const strict = parts.filter(n => !parse(n).getElementsByTagName('parsererror').length).length;
  const all = parts.map(text).join('\n');
  const images = parts.flatMap(n => [...parse(n).getElementsByTagName('img')].map(img => 'OEBPS/' + img.getAttribute('src')));
  const links = parts.flatMap(n => [...parse(n).getElementsByTagName('a')].map(a => a.getAttribute('href')).filter(Boolean));
  // MOBI 6 marks targets with an empty <a id="filepos…"> just before the destination, so read what it marks.
  const marked = el => { for (let node = el; node; node = node.nextElementSibling || node.parentElement?.nextElementSibling) if (node.textContent.trim()) return node.textContent; return el?.parentElement?.textContent || null; };
  const resolve = href => { const [file, frag] = href.split('#'); const doc = parse('OEBPS/' + file); if (!frag) return doc.getElementsByTagName('body')[0]?.textContent || null; const el = doc.getElementById(frag); return el ? marked(el) : null; };
  const nav = parse('OEBPS/nav.xhtml'), toc = [...nav.getElementsByTagName('a')].map(a => ({label:a.textContent, target:!!resolve(a.getAttribute('href'))}));
  const opf = text('OEBPS/content.opf');
  return {first:names[0], mimetype:text('mimetype'), parts:parts.length, strict, images:images.map(src => !!zip[src]), links:links.map(href => ({href, target:resolve(href)})), toc, opf,
    hasText:['Mara kept the lantern', 'café, naïve, façade', 'Ελληνικά', 'Русский', '日本語', 'every boat came home'].filter(s => !all.includes(s)),
    css:names.filter(n => n.endsWith('.css')).map(text).join('\n'), active:/<script|\son\w+=/i.test(all)};
}, id);

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Kindle test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  for (const [name, kind] of [['sample.mobi', 'MOBI'], ['sample.azw3', 'AZW3'], ['sample-combo.mobi', 'AZW3']]) {
    const result = await importFile(page, name, fs.readFileSync(path.join(fixtures, name)));
    assert.equal(result.added, 1, `${name}: ${result.error}`);
    const meta = await page.evaluate(id => books.find(b => b.id === id), result.id);
    assert.equal(meta.format, 'EPUB'); assert.equal(meta.sourceFormat, kind); assert.equal(meta.sourceFilename, name);
    assert.equal(meta.filename, name.replace(/\.[^.]+$/, '.epub'));
    assert.equal(meta.title, 'The Lantern Keeper'); assert.equal(meta.author, 'Test Author');
    assert(meta.cover, `${name}: cover extracted`);
    assert.equal(await page.evaluate(id => { showDetail(id); const label = [...$('book-detail').querySelectorAll('button')].find(b => /Download/.test(b.textContent))?.textContent; $('detail-dialog').close(); return label; }, result.id), 'Download EPUB ↓', 'converted books offer the EPUB, not an original');
    const epub = await inspect(page, result.id);
    assert.equal(epub.first, 'mimetype'); assert.equal(epub.mimetype, 'application/epub+zip');
    assert.deepEqual(epub.hasText, [], `${name}: text missing`);
    assert(epub.parts >= 1 && epub.strict === epub.parts, `${name}: ${epub.strict}/${epub.parts} parts are valid XHTML`);
    assert(epub.images.length >= 1 && epub.images.every(Boolean), `${name}: images ${JSON.stringify(epub.images)}`);
    const ending = epub.links.find(link => /every boat came home/.test(link.target || ''));
    assert(ending, `${name}: the "ending" link reaches the final paragraph: ${JSON.stringify(epub.links)}`);
    assert(epub.toc.length >= 3 && epub.toc.every(entry => entry.target), `${name}: toc ${JSON.stringify(epub.toc)}`);
    assert.match(epub.opf, /<dc:publisher>Fixture Press<\/dc:publisher>/); assert.match(epub.opf, /properties="cover-image"/);
    if (kind === 'AZW3') assert.match(epub.css, /italic/, `${name}: book styles kept`);
    assert.equal(epub.active, false);
    // The stored EPUB opens in the reader.
    await page.evaluate(id => readBook(id), result.id);
    // The first screen is the book's opening: chapter text (MOBI 6) or the cover page (KF8 keeps it as a section).
    await page.waitForFunction(() => { const c = $('reader-content'); return /Mara kept the lantern/.test(c?.textContent || '') || [...(c?.querySelectorAll('img') || [])].some(img => img.complete && img.naturalWidth > 0); }, null, {timeout:20000, polling:250});
    await page.evaluate(() => closeReader());
    report.push(`${name}: ${kind} → EPUB, ${epub.parts} part(s), ${epub.images.length} image(s), ${epub.toc.length} TOC entries, cross-chapter link and cover kept, opens in the reader`);
  }

  // A DRM-flagged copy is refused with an explanation; nothing is stored.
  const drm = Buffer.from(fs.readFileSync(path.join(fixtures, 'sample.azw3')));
  drm.writeUInt16BE(2, drm.readUInt32BE(78) + 12);
  const refused = await importFile(page, 'protected.azw3', drm);
  assert.equal(refused.added, 0); assert.match(refused.error, /DRM-protected/);
  // A non-Kindle file named .mobi is not recognized.
  const fake = await importFile(page, 'fake.mobi', Buffer.from('not a kindle book at all'.repeat(10)));
  assert.equal(fake.added, 0); assert.match(fake.error, /not recognized|Kindle/);
  report.push('DRM-flagged AZW3 refused with an explanation; a fake .mobi is rejected; nothing stored for either');
  assert.deepEqual(errors, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { for (const proc of servers) proc.kill(); fs.rmSync(profile, {recursive:true, force:true}); setTimeout(() => process.exit(), 500).unref(); });
