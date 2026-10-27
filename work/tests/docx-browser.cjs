// Word import in real Chromium, under the app's Content Security Policy: a python-docx fixture is
// converted to EPUB by the app's own import path and opens in the reader. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const {spawn} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const fixture = path.join(__dirname, 'fixtures/docx/sample.docx');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-docx-'));
const servers = new Set();

const {serve} = require('./browser-helpers.cjs');
async function importFile(page, name, buffer) {
  const before = await page.evaluate(() => books.length);
  await page.evaluate(() => { $('upload-error').textContent = ''; });
  await page.setInputFiles('#book-files', {name, mimeType:'application/octet-stream', buffer});
  await page.evaluate(() => upload({preventDefault(){}}));
  return {added:await page.evaluate(n => books.length - n, before), error:await page.evaluate(() => $('upload-error').textContent), id:await page.evaluate(n => books[n]?.id, before)};
}

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
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Word test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  assert.equal(await page.evaluate(() => typeof mammoth), 'undefined', 'converter is not loaded at startup');
  const result = await importFile(page, 'Harbour Notebook.docx', fs.readFileSync(fixture));
  assert.equal(result.added, 1, result.error);
  assert.equal(await page.evaluate(() => typeof mammoth), 'object', 'converter loaded on first Word import');
  const meta = await page.evaluate(id => books.find(b => b.id === id), result.id);
  assert.equal(meta.format, 'EPUB'); assert.equal(meta.sourceFormat, 'DOCX'); assert.equal(meta.filename, 'Harbour Notebook.epub');
  assert.equal(meta.title, 'The Harbour Notebook'); assert.equal(meta.author, 'Fixture Writer');

  const epub = await page.evaluate(async id => {
    const zip = ThingsArchiveLib.unzipSync(new Uint8Array(await (await bookBlob(id)).arrayBuffer()));
    const names = Object.keys(zip), text = name => new TextDecoder().decode(zip[name]);
    const parse = name => new DOMParser().parseFromString(text(name), 'application/xhtml+xml');
    const parts = names.filter(n => /OEBPS\/part\d+\.xhtml$/.test(n)).sort(), docs = parts.map(parse);
    const all = docs.map(d => d.documentElement.textContent).join('\n'), count = selector => docs.reduce((n, d) => n + d.querySelectorAll(selector).length, 0);
    const nav = parse('OEBPS/nav.xhtml'), top = [...nav.querySelectorAll('nav > ol > li')].map(li => ({label:li.querySelector('a').textContent, children:[...li.querySelectorAll(':scope > ol a')].map(a => a.textContent), target:(() => { const [file, frag] = li.querySelector('a').getAttribute('href').split('#'); return !!parse('OEBPS/' + file).getElementById(frag); })()}));
    const images = docs.flatMap(d => [...d.querySelectorAll('img')].map(img => !!zip['OEBPS/' + img.getAttribute('src')]));
    return {first:names[0], parts:parts.length, strict:docs.filter(d => !d.getElementsByTagName('parsererror').length).length, top, images,
      bold:count('strong'), italic:count('em'), items:count('ul > li'), rows:count('table tr'), links:docs.flatMap(d => [...d.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))),
      missing:['ferry reached the harbour', 'café, naïve, façade', 'Ελληνικά', 'Русский', '日本語', '18:40', 'The notebook ends here'].filter(s => !all.includes(s)),
      css:names.some(n => n.endsWith('docx.css')), active:/<script|\son\w+=/i.test(parts.map(text).join(''))};
  }, result.id);
  assert.equal(epub.first, 'mimetype');
  assert.equal(epub.parts, 2, 'one part per top-level chapter'); assert.equal(epub.strict, 2);
  assert.deepEqual(epub.missing, []);
  assert.deepEqual(epub.top.map(t => t.label), ['First Chapter: Arrival', 'Second Chapter: The Tide Table']);
  assert.deepEqual(epub.top[1].children, ['Morning']); assert(epub.top.every(t => t.target));
  assert.deepEqual(epub.images, [true]);
  assert(epub.bold >= 1 && epub.italic >= 1, 'bold and italic kept'); assert.equal(epub.items, 3); assert.equal(epub.rows, 3);
  assert(epub.links.includes('https://example.org/tides'), JSON.stringify(epub.links));
  assert(epub.css); assert.equal(epub.active, false);

  await page.evaluate(id => readBook(id), result.id);
  await page.waitForFunction(() => /ferry reached the harbour/.test($('reader-content')?.textContent || ''), null, {timeout:20000, polling:250});
  await page.evaluate(() => closeReader());
  report.push('sample.docx → EPUB: 2 chapters split at headings, TOC with nested heading, image, list, table, bold/italic, external link and accents/scripts kept; title and author from document properties; opens in the reader');

  const legacy = await importFile(page, 'old.doc', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]));
  assert.equal(legacy.added, 0); assert.match(legacy.error, /Older Word \(\.doc\)/);
  const otherZip = await page.evaluate(() => Array.from(ThingsArchiveLib.zipSync({'notes.txt':new TextEncoder().encode('hello')})));
  const notBook = await importFile(page, 'archive.docx', Buffer.from(otherZip));
  assert.equal(notBook.added, 0); assert.match(notBook.error, /EPUB archive/);
  report.push('legacy .doc / password-protected files explain how to fix them; an unrelated zip is rejected; nothing stored');
  assert.deepEqual(problems, [], 'no page errors or Content Security Policy violations');
  report.push('no Content Security Policy violations or page errors while converting');
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { for (const proc of servers) proc.kill(); require('./browser-helpers.cjs').cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
