// FictionBook import in real Chromium: Calibre-made FB2 (plain and zipped) and a hand-written
// windows-1251 FB2 with footnotes are converted to EPUB by the app's import path and open in the
// reader, with no Content Security Policy violations. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const fixtures = path.join(__dirname, 'fixtures/fb2');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-fb2-'));
const servers = new Set();

const {serve} = require('./browser-helpers.cjs');
async function importFile(page, name, buffer) {
  const before = await page.evaluate(() => books.length);
  await page.evaluate(() => { $('upload-error').textContent = ''; });
  await page.setInputFiles('#book-files', {name, mimeType:'application/octet-stream', buffer});
  await page.evaluate(() => upload({preventDefault(){}}));
  return {added:await page.evaluate(n => books.length - n, before), error:await page.evaluate(() => $('upload-error').textContent), id:await page.evaluate(n => books[n]?.id, before)};
}
const inspect = (page, id) => page.evaluate(async id => {
  const zip = ThingsArchiveLib.unzipSync(new Uint8Array(await (await bookBlob(id)).arrayBuffer()));
  const names = Object.keys(zip), text = name => new TextDecoder().decode(zip[name]);
  const parse = name => new DOMParser().parseFromString(text(name), 'application/xhtml+xml');
  const parts = names.filter(n => /OEBPS\/part\d+\.xhtml$/.test(n)), docs = parts.map(parse);
  const all = docs.map(d => d.documentElement.textContent).join('\n');
  const marked = el => { for (let node = el; node; node = node.nextElementSibling || node.parentElement?.nextElementSibling) if (node.textContent.trim()) return node.textContent; return null; };
  const resolve = href => { const [file, frag] = href.split('#'); if (!zip['OEBPS/' + file]) return null; const doc = parse('OEBPS/' + file); return frag ? (doc.getElementById(frag) ? marked(doc.getElementById(frag)) : null) : doc.documentElement.textContent; };
  const nav = parse('OEBPS/nav.xhtml');
  return {first:names[0], parts:parts.length, strict:docs.filter(d => !d.getElementsByTagName('parsererror').length).length, all,
    images:docs.flatMap(d => [...d.querySelectorAll('img')].map(img => !!zip['OEBPS/' + img.getAttribute('src')])),
    links:docs.flatMap(d => [...d.querySelectorAll('a[href]')].map(a => ({href:a.getAttribute('href'), target:resolve(a.getAttribute('href'))}))),
    toc:[...nav.querySelectorAll('a')].map(a => ({label:a.textContent, ok:!!resolve(a.getAttribute('href'))})),
    em:docs.reduce((n, d) => n + d.querySelectorAll('em').length, 0), strong:docs.reduce((n, d) => n + d.querySelectorAll('strong').length, 0),
    css:names.includes('OEBPS/styles/fb2.css'), opf:text('OEBPS/content.opf'), active:/<script|\son\w+=|blob:/i.test(parts.map(text).join(''))};
}, id);

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'FB2 test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  for (const name of ['sample.fb2', 'sample.fb2.zip']) {
    const result = await importFile(page, name, fs.readFileSync(path.join(fixtures, name)));
    assert.equal(result.added, 1, `${name}: ${result.error}`);
    const meta = await page.evaluate(id => books.find(b => b.id === id), result.id);
    assert.equal(meta.format, 'EPUB'); assert.equal(meta.sourceFormat, 'FB2'); assert.equal(meta.filename, 'sample.epub');
    assert.equal(meta.title, 'The Lantern Keeper'); assert.equal(meta.author, 'Test Author'); assert(meta.cover, `${name}: cover`);
    const epub = await inspect(page, result.id);
    assert.equal(epub.first, 'mimetype'); assert(epub.parts >= 1 && epub.strict === epub.parts, `${name}: ${epub.strict}/${epub.parts} valid XHTML`);
    for (const s of ['Mara kept the lantern', 'café, naïve, façade', 'Ελληνικά', 'Русский', '日本語', 'every boat came home']) assert(epub.all.includes(s), `${name}: missing ${s}`);
    assert(epub.images.length >= 1 && epub.images.every(Boolean), `${name}: images`);
    assert(epub.toc.length >= 3 && epub.toc.every(t => t.ok), `${name}: toc ${JSON.stringify(epub.toc)}`);
    assert(epub.css); assert.equal(epub.active, false); assert.match(epub.opf, /properties="cover-image"/);
    report.push(`${name}: FB2 → EPUB, ${epub.parts} part(s), ${epub.images.length} image(s), ${epub.toc.length} TOC entries, cover, multilingual text`);
  }

  const notes = await importFile(page, 'Маяк.fb2', fs.readFileSync(path.join(fixtures, 'notes-cp1251.fb2')));
  assert.equal(notes.added, 1, notes.error);
  const meta = await page.evaluate(id => books.find(b => b.id === id), notes.id);
  assert.equal(meta.title, 'Маяк и море'); assert.equal(meta.author, 'Анна Тестова'); assert.equal(meta.language, 'ru');
  const epub = await inspect(page, notes.id);
  for (const s of ['Смотритель маяка вёл журнал', 'Ветер над водой', 'свет над тёмной волной', 'Журнал хранился в деревянном ящике']) assert(epub.all.includes(s), `missing ${s}`);
  const footnote = epub.links.find(l => /Журнал хранился/.test(l.target || ''));
  assert(footnote, `footnote link reaches the note: ${JSON.stringify(epub.links)}`);
  assert(epub.em >= 1 && epub.strong >= 1); assert.equal(epub.strict, epub.parts);
  await page.evaluate(id => readBook(id), notes.id);
  await page.waitForFunction(() => /Смотритель маяка/.test($('reader-content')?.textContent || ''), null, {timeout:20000, polling:250});
  await page.evaluate(() => closeReader());
  report.push('windows-1251 FB2: Cyrillic title/author/text decoded, footnote link reaches its note, poem and emphasis kept; opens in the reader');

  const two = await page.evaluate(() => Array.from(ThingsArchiveLib.zipSync({'a.fb2':new TextEncoder().encode('<FictionBook/>'), 'b.fb2':new TextEncoder().encode('<FictionBook/>')})));
  const rejected = await importFile(page, 'two.fb2.zip', Buffer.from(two));
  assert.equal(rejected.added, 0); assert(rejected.error, 'an archive with two books is rejected');
  report.push('an archive with two FB2 books is rejected; nothing stored');
  // A text file that only mentions the FB2 root element is still a text book.
  const text = await importFile(page, 'about-fb2.txt', Buffer.from('Notes on e-book formats.\nAn FB2 file starts with <FictionBook xmlns=...> after its XML declaration.\n'));
  assert.equal(text.added, 1, text.error); assert.equal(await page.evaluate(id => books.find(b => b.id === id).format, text.id), 'TXT');
  report.push('a .txt that merely mentions <FictionBook> imports as text, not FB2');
  assert.deepEqual(problems, []);
  report.push('no Content Security Policy violations or page errors');
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { for (const proc of servers) proc.kill(); fs.rmSync(profile, {recursive:true, force:true}); setTimeout(() => process.exit(), 500).unref(); });
