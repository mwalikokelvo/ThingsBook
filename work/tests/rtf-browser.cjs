// RTF in real Chromium, from two writers: work/tests/fixtures/rtf/pandoc.rtf (made by pandoc) and word.rtf
// (Word/WordPad shapes; see make-fixtures.py there). Both import as EPUBs with chapters at their headings,
// character formatting, lists, tables and links; word.rtf also keeps its \info title and author, its
// Cyrillic font text, its PNG picture and its footnote (in a linked Notes chapter), and leaves out the page
// header, other \info fields, picture properties and the WMF fallback. Both open in the reader.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, cleanup} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-rtf-'));
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/rtf', name));

async function importFile(page, name, bytes) {
  const before = await page.evaluate(() => books.length);
  await page.evaluate(() => { $('upload-error').textContent = ''; });
  await page.setInputFiles('#book-files', {name, mimeType:'application/octet-stream', buffer:Buffer.from(bytes)});
  await page.evaluate(() => upload({preventDefault(){}}));
  return {added:await page.evaluate(n => books.length - n, before), error:await page.evaluate(() => $('upload-error').textContent), id:await page.evaluate(n => books[n]?.id, before)};
}
const unpack = (page, id) => page.evaluate(async id => {
  const zip = ThingsArchiveLib.unzipSync(new Uint8Array(await (await bookBlob(id)).arrayBuffer()));
  const text = name => new TextDecoder().decode(zip[name]);
  const parts = Object.keys(zip).filter(n => /OEBPS\/part\d+\.xhtml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xhtml/)[1]) - Number(b.match(/(\d+)\.xhtml/)[1]));
  return {names:Object.keys(zip), files:parts.map(n => n.replace('OEBPS/', '')), parts:parts.map(text), nav:text('OEBPS/nav.xhtml'), opf:text('OEBPS/content.opf'),
    strict:parts.every(n => !new DOMParser().parseFromString(text(n), 'application/xhtml+xml').getElementsByTagName('parsererror').length)};
}, id);

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const outside = []; await context.route(url => !/^http:\/\/127\.0\.0\.1:8765\//.test(String(url)), route => { outside.push(route.request().url()); route.abort(); });
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const problems = []; page.on('pageerror', e => problems.push(e.message));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'RTF test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  // Word / WordPad shapes.
  const word = await importFile(page, 'ledger.rtf', fixture('word.rtf'));
  assert.equal(word.added, 1, word.error);
  const meta = await page.evaluate(id => books.find(b => b.id === id), word.id);
  assert.equal(meta.sourceFormat, 'RTF'); assert.equal(meta.title, 'The Lighthouse Ledger'); assert.equal(meta.author, 'Wren Fixture');
  const w = await unpack(page, word.id), all = w.parts.join('\n');
  assert(w.strict, 'parts are well-formed XHTML');
  assert.match(w.nav, /First watch[\s\S]*Supplies[\s\S]*Second watch[\s\S]*Notes/, 'headings from the "heading 1/2" styles');
  assert.match(all, /<strong>bright<\/strong>/); assert.match(all, /<em>calm<\/em>/); assert.match(all, /café au lait/);
  assert.match(all, /H<sub>2<\/sub>O/); assert.match(all, /x<sup>2<\/sup>/);
  assert.match(all, /Привет, маяк/, 'Cyrillic bytes decoded with the font\'s code page');
  assert.match(all, /<ul><li>Fog horn<\/li><li>Spare glass<\/li><\/ul>/, 'WordPad \\pntext and Word \\listtext bullets become a list');
  assert.match(all, /<td>Item<\/td><td>Count<\/td>[\s\S]*<td>Oil<\/td><td>12<\/td>/);
  assert.match(all, /<img src="res\/img\d+\.png"/); assert.equal(w.names.filter(n => /OEBPS\/res\/img/.test(n)).length, 1, 'one picture (the WMF fallback is ignored)');
  assert.match(all, /<a href="https:\/\/example\.org\/lighthouses">the society<\/a>/);
  const notes = w.files[w.parts.findIndex(p => p.includes('A footnote about the lamp oil'))];
  assert(notes, 'footnote text kept'); assert.match(all, new RegExp(`href="${notes}#tb-note-1"`), 'footnote marker links to Notes');
  assert.doesNotMatch(all, /PAGE-HEADER-TEXT|LEAKED-KEYWORDS|PICPROP-TEXT|0123456789abcdef|Calibri|Normal;|Default Paragraph/, 'no header, metadata, picture properties or tables of fonts/styles');
  await page.evaluate(id => readBook(id), word.id);
  await page.waitForFunction(() => /First watch/.test($('reader-content')?.textContent || ''), null, {timeout:20000, polling:250});
  await page.evaluate(() => closeReader());
  report.push(`word.rtf → EPUB (${w.parts.length} parts): \\info title/author, styled headings, formatting, cp1251 Cyrillic, bullets, table, PNG, link, footnote in Notes; header, keywords, picture properties and WMF left out; opens in the reader`);

  // pandoc.
  const pan = await importFile(page, 'keeper.rtf', fixture('pandoc.rtf'));
  assert.equal(pan.added, 1, pan.error);
  const p = await unpack(page, pan.id), text = p.parts.join('\n');
  assert(p.strict);
  assert.match(p.nav, /First watch[\s\S]*Supplies[\s\S]*Second watch/, 'headings from \\outlinelevel');
  assert.notEqual(p.files[p.parts.findIndex(x => x.includes('First watch'))], p.files[p.parts.findIndex(x => x.includes('Second watch'))], 'chapters split at level-1 headings');
  assert.match(text, /Café, Ελληνικά, 日本語/, '\\u Unicode with ? fallbacks skipped');
  assert.match(text, /<ul><li>one<\/li><li>two<\/li><\/ul>/); assert.match(text, /<ol><li>trim<\/li><li>polish<\/li><\/ol>/);
  assert.match(text, /<td>Item<\/td><td>Count<\/td>/); assert.match(text, /<a href="https:\/\/example\.org\/">\s*the society\s*<\/a>/);
  assert.doesNotMatch(text, /Helvetica|Courier/);
  report.push('pandoc.rtf → EPUB: \\outlinelevel chapters, \\u Unicode (Greek, Japanese), bullet and numbered lists, table and link');

  const plain = await importFile(page, 'not-rtf.rtf', Buffer.from('Just text pretending.'));
  assert.equal(plain.added, 0); assert(plain.error);
  report.push('a file named .rtf that is not RTF is refused');

  assert.deepEqual(outside, []); assert.deepEqual(problems, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
