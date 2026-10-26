// Markdown and saved web pages in real Chromium. A Markdown file with front matter, two chapters, a
// table, an embedded image and hostile raw HTML imports as a two-chapter EPUB with its metadata and none
// of the active content. A windows-1252 web page with site navigation, an outside image, a frame, a form
// and event handlers imports as its article only, decoded correctly, and neither importing nor reading
// it contacts any outside address. A page with no text is refused.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-webdoc-'));

// 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const MARKDOWN = `---
title: "Notes on Tides"
author:
  - Ada Fixture
  - Ben Sample
lang: en
---

# Spring tides

The moon and sun align. ![a small square](data:image/png;base64,${PNG})

| Phase | Range |
| ----- | ----- |
| New   | High  |

<script>window.pwned = 1</script><img src="x" onerror="window.pwned = 2" alt="broken">
[a bad link](javascript:window.pwned=3) and [a good link](https://example.org/) and [ahead](#neap-tides).

# Neap tides

Quarter moons give the smallest range.
`;
const PAGE = Buffer.from(`<!doctype html><html lang="fr"><head><meta charset="windows-1252">
<title>Caf\xe9 society - Example News</title><meta property="og:title" content="Caf\xe9 society"><meta name="author" content="Chlo\xe9 Writer">
<style>body{color:red}</style><script>window.pwned = 4</script><link rel="stylesheet" href="https://tracker.example/x.css"></head>
<body onload="window.pwned = 5"><header>Example News masthead</header><nav>Site menu Home About</nav>
<article><h1>Caf\xe9 society</h1><p onclick="window.pwned = 6" style="color:blue" class="lead">Le caf\xe9 est ouvert.</p>
<img src="https://tracker.example/pixel.gif" alt="the terrace"><iframe src="https://tracker.example/frame"></iframe>
<form action="https://tracker.example/post"><input name="q"></form><h2>Second section</h2><p>Encore du texte.</p></article>
<footer>Copyright Example News</footer></body></html>`, 'latin1');

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
  const parts = Object.keys(zip).filter(n => /OEBPS\/part\d+\.xhtml$/.test(n)).sort();
  const docs = parts.map(n => new DOMParser().parseFromString(text(n), 'application/xhtml+xml'));
  return {names:Object.keys(zip), parts:parts.map(text), strict:docs.every(d => !d.getElementsByTagName('parsererror').length),
    opf:text('OEBPS/content.opf'), nav:text('OEBPS/nav.xhtml')};
}, id);

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
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Web document test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  // Markdown.
  const md = await importFile(page, 'tides.md', Buffer.from(MARKDOWN));
  assert.equal(md.added, 1, md.error);
  const mdMeta = await page.evaluate(id => books.find(b => b.id === id), md.id);
  assert.equal(mdMeta.format, 'EPUB'); assert.equal(mdMeta.sourceFormat, 'MD'); assert.equal(mdMeta.filename, 'tides.epub');
  assert.equal(mdMeta.title, 'Notes on Tides'); assert.match(mdMeta.author, /Ada Fixture/);
  const mdBook = await unpack(page, md.id);
  assert.equal(mdBook.parts.length, 2, 'one part per top-level heading'); assert(mdBook.strict, 'parts are well-formed XHTML');
  assert.match(mdBook.opf, /<dc:creator>Ben Sample<\/dc:creator>/); assert.match(mdBook.opf, /<dc:language>en<\/dc:language>/);
  assert.match(mdBook.nav, /Spring tides[\s\S]*Neap tides/);
  const all = mdBook.parts.join('\n');
  assert.match(all, /<table>[\s\S]*<td>New<\/td>/, 'GFM table kept');
  assert(mdBook.names.some(n => /OEBPS\/res\/img\d+\.png$/.test(n)), 'embedded image stored in the EPUB');
  assert.doesNotMatch(all, /<script|onerror|javascript:|pwned/i, 'no active content');
  assert.match(all, /href="https:\/\/example\.org\/"/); assert.match(all, /\[broken\]/, 'an image that is not embedded becomes its alt text');
  assert.match(mdBook.parts[0], /href="part1\.xhtml#neap-tides"/, 'heading link points at the chapter that holds it');
  await page.evaluate(id => readBook(id), md.id);
  await page.waitForFunction(() => /Spring tides/.test($('reader-content')?.textContent || ''), null, {timeout:20000, polling:250});
  assert.equal(await page.evaluate(() => $('reader-location').options.length), 2);
  await page.evaluate(() => closeReader());
  report.push('tides.md → EPUB: 2 chapters, title and both authors from front matter, table and embedded image kept, script/onerror/javascript: removed, cross-chapter link fixed; opens in the reader');

  // Saved web page.
  const web = await importFile(page, 'cafe-society.html', PAGE);
  assert.equal(web.added, 1, web.error);
  const webMeta = await page.evaluate(id => books.find(b => b.id === id), web.id);
  assert.equal(webMeta.sourceFormat, 'HTML'); assert.equal(webMeta.title, 'Café society'); assert.equal(webMeta.author, 'Chloé Writer');
  const webBook = await unpack(page, web.id);
  const text = webBook.parts.join('\n');
  assert(webBook.strict);
  assert.match(text, /Le café est ouvert\./, 'windows-1252 decoded'); assert.match(text, /Encore du texte/);
  assert.doesNotMatch(text, /masthead|Site menu|Copyright Example/, 'site chrome outside the article is left out');
  assert.doesNotMatch(text, /<script|<style|<iframe|<form|<input|onclick|onload|style=|class=|tracker\.example|pwned/i, 'no active content, styling or outside addresses');
  assert.match(text, /\[the terrace\]/, 'outside image replaced by its alt text');
  assert.match(webBook.opf, /<dc:language>fr<\/dc:language>/);
  await page.evaluate(id => readBook(id), web.id);
  await page.waitForFunction(() => /Le café est ouvert/.test($('reader-content')?.textContent || ''), null, {timeout:20000, polling:250});
  await page.evaluate(() => closeReader());
  assert.equal(await page.evaluate(() => window.pwned), undefined, 'nothing from the files ran');
  assert.deepEqual(outside, [], 'no outside address was requested');
  report.push('cafe-society.html (windows-1252) → EPUB: article only, title and author from meta tags, outside image as alt text, no script/style/frame/form/handlers; importing and reading made no outside requests');

  const empty = await importFile(page, 'empty.html', Buffer.from('<!doctype html><html><head><title>Nothing</title><script>1</script></head><body><nav>menu</nav></body></html>'));
  assert.equal(empty.added, 0); assert.match(empty.error, /no readable text/i);
  report.push('a page with no readable text is refused with an explanation');

  assert.deepEqual(problems, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { fs.rmSync(profile, {recursive:true, force:true}); setTimeout(() => process.exit(), 500).unref(); });
