// OpenDocument text in real Chromium. work/tests/fixtures/odt/sample.odt (made by odfpy, see
// make-fixtures.py there) imports as an EPUB with its metadata, chapters at level-1 headings, character
// formatting from automatic styles, numbered and bulleted lists, a table with a header and a spanned
// cell, its embedded image, links, and the footnote moved to a linked "Notes" chapter; the generated
// table of contents, the comment and the tracked deletion are left out. It opens in the reader.
// A password-protected document is refused with an explanation.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-odt-'));
const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures/odt/sample.odt'));

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
  const outside = [];
  await context.route(url => !/^http:\/\/127\.0\.0\.1:8765\//.test(String(url)), route => { outside.push(route.request().url()); route.abort(); });
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const problems = []; page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'OpenDocument test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  const odt = await importFile(page, 'ledger.odt', SAMPLE);
  assert.equal(odt.added, 1, odt.error);
  const meta = await page.evaluate(id => books.find(b => b.id === id), odt.id);
  assert.equal(meta.format, 'EPUB'); assert.equal(meta.sourceFormat, 'ODT'); assert.equal(meta.filename, 'ledger.epub');
  assert.equal(meta.title, 'The Lighthouse Keeper’s Ledger'); assert.equal(meta.author, 'Odile Fixture');
  const book = await page.evaluate(async id => {
    const zip = ThingsArchiveLib.unzipSync(new Uint8Array(await (await bookBlob(id)).arrayBuffer()));
    const text = name => new TextDecoder().decode(zip[name]);
    const parts = Object.keys(zip).filter(n => /OEBPS\/part\d+\.xhtml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xhtml/)[1]) - Number(b.match(/(\d+)\.xhtml/)[1]));
    const docs = parts.map(n => new DOMParser().parseFromString(text(n), 'application/xhtml+xml'));
    return {names:Object.keys(zip), files:parts.map(n => n.replace('OEBPS/', '')), parts:parts.map(text), strict:docs.every(d => !d.getElementsByTagName('parsererror').length),
      opf:text('OEBPS/content.opf'), nav:text('OEBPS/nav.xhtml')};
  }, odt.id);
  assert(book.strict, 'parts are well-formed XHTML');
  const all = book.parts.join('\n');
  const partWith = needle => book.files[book.parts.findIndex(p => p.includes(needle))];
  assert.match(book.nav, /First watch[\s\S]*Supplies[\s\S]*Second watch[\s\S]*Notes/, 'contents list chapters, the level-2 heading and Notes');
  assert.notEqual(partWith('First watch'), partWith('Second watch'), 'chapters split at level-1 headings');
  assert.match(all, /<strong>bright<\/strong>/); assert.match(all, /<em>calm<\/em>/); assert.match(all, /H<sup>2<\/sup>O/);
  assert.match(all, /Café, naïve, Ελληνικά, 日本語/);
  assert.match(all, /<ol><li>Trim the wick<\/li><li>Polish the lens<\/li><li>Log the weather<\/li><\/ol>/, 'numbered list');
  assert.match(all, /<ul><li>Fog horn<\/li><li>Spare glass<\/li><\/ul>/, 'bulleted list');
  assert.match(all, /<thead><tr><th>Item<\/th><th>Count<\/th><\/tr><\/thead>/); assert.match(all, /<td colspan="2">Spanned total row<\/td>/);
  assert.match(all, /<img src="res\/img\d+\.png" alt="the brass lamp"\s*\/>/); assert(book.names.some(n => /OEBPS\/res\/img\d+\.png$/.test(n)));
  assert.match(all, /href="https:\/\/example\.org\/lighthouses"/);
  const notes = partWith('A footnote about the lamp oil');
  assert.match(book.parts[book.files.indexOf(partWith('bright'))], new RegExp(`href="${notes}#tb-note-1"`), 'footnote marker links to the Notes chapter');
  assert.match(book.parts[book.files.indexOf(notes)], new RegExp(`href="${partWith('bright')}#tb-ref-1"`), 'note links back to the text');
  assert.doesNotMatch(all, /GENERATED-TOC|PRIVATE-COMMENT|DELETED-DRAFT/, 'generated contents, comments and tracked deletions are left out');
  assert.match(book.opf, /<dc:language>en<\/dc:language>/);
  await page.evaluate(id => readBook(id), odt.id);
  await page.waitForFunction(() => /Lighthouse Keeper/.test($('reader-content')?.textContent || ''), null, {timeout:20000, polling:250});
  await page.evaluate(() => closeReader());
  report.push(`ledger.odt → EPUB (${book.parts.length} parts): title and author from meta.xml, bold/italic/superscript, numbered and bulleted lists, table header and spanned cell, embedded image with its description, link, footnote in a linked Notes chapter; no generated contents, comment or tracked deletion; opens in the reader`);

  const locked = await page.evaluate(() => Array.from(ThingsArchiveLib.zipSync({
    mimetype:[new TextEncoder().encode('application/vnd.oasis.opendocument.text'), {level:0}],
    'META-INF/manifest.xml':new TextEncoder().encode('<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1/1K" manifest:checksum="x"/></manifest:file-entry></manifest:manifest>'),
    'content.xml':new Uint8Array([1, 2, 3, 4]),
  })));
  const refused = await importFile(page, 'secret.odt', locked);
  assert.equal(refused.added, 0); assert.match(refused.error, /password-protected/);
  report.push('a password-protected .odt is refused with how to make a usable copy');

  assert.deepEqual(outside, []); assert.deepEqual(problems, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { fs.rmSync(profile, {recursive:true, force:true}); setTimeout(() => process.exit(), 500).unref(); });
