// Precise highlights in real Chromium: highlighting a few words marks only those words (not the whole
// passage), survives reopening the book, leaves the passage text unchanged, can be removed, and older
// whole-passage highlights still show as before. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-highlight-'));
const BOOK = 'The lantern shone over the harbour every night of the winter.\n\nThe ledger listed every boat that came home before dark.\n\nIn spring the keeper painted the door a bright blue.\n';

async function until(page, check, arg, timeout = 20000) { const end = Date.now() + timeout; for (;;) { const value = await page.evaluate(check, arg); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 150)); } }
const open = async (page, id) => { await page.evaluate(id => readBook(id), id); await until(page, () => document.querySelectorAll('#reader-content .reader-passage').length >= 3 && !ThingsReader.context()?.loading); };
const state = page => page.evaluate(() => [...document.querySelectorAll('#reader-content .reader-passage')].slice(0, 3).map(p => ({text:p.textContent, whole:p.classList.contains('saved-highlight'), marks:[...p.querySelectorAll('mark.saved-highlight-range')].map(m => m.textContent)})));

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Highlight test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  await page.setInputFiles('#book-files', {name:'Harbour.txt', mimeType:'text/plain', buffer:Buffer.from(BOOK)});
  await page.evaluate(() => upload({preventDefault(){}}));
  const id = await until(page, () => books[0]?.id);
  const report = [];

  // Select "lantern shone" inside the first passage and highlight it.
  await open(page, id);
  const before = await state(page);
  await page.evaluate(() => {
    const passage = document.querySelector('#reader-content .reader-passage'), walker = document.createTreeWalker(passage, NodeFilter.SHOW_TEXT);
    let node, offset; for (node = walker.nextNode(); node; node = walker.nextNode()) { offset = node.data.indexOf('lantern shone'); if (offset >= 0) break; }
    const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 'lantern shone'.length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.getElementById('reader-mark').click();
  });
  let now = await state(page);
  assert.deepEqual(now[0].marks, ['lantern shone']); assert.equal(now[0].whole, false, 'only the words are marked, not the passage');
  assert.deepEqual(now.map(p => p.text), before.map(p => p.text), 'passage text unchanged by marks');
  const saved = await page.evaluate(() => ThingsReader.context().highlights.at(-1));
  assert.equal(BOOK.split('\n\n')[0].slice(saved.start, saved.end), 'lantern shone');
  await page.evaluate(() => closeReader());
  await until(page, id => books.find(b => b.id === id).highlights?.length === 1, id);

  // Reopened, the same words are marked.
  await open(page, id);
  now = await state(page);
  assert.deepEqual(now[0].marks, ['lantern shone']); assert.equal(now[0].whole, false);
  report.push('highlighting "lantern shone" marks only those words, keeps the passage text unchanged, and is restored on reopening');

  // Removing it from the notes list removes the mark.
  await page.evaluate(() => [...document.querySelectorAll('#reader-saved-notes button')].find(b => b.textContent === 'Remove').click());
  now = await state(page);
  assert.deepEqual(now[0].marks, []); assert.equal(now[0].whole, false);
  assert.deepEqual(now.map(p => p.text), before.map(p => p.text));
  await page.evaluate(() => closeReader());
  report.push('removing the highlight removes its mark');

  // A highlight saved by an earlier version (no span) still marks its whole passage.
  await page.evaluate(id => updateBook(id, {highlights:[{id:'old', location:0, paragraph:1, text:'The ledger listed every boat that came home before dark.', created:1}]}), id);
  await open(page, id);
  now = await state(page);
  assert.equal(now[1].whole, true); assert.deepEqual(now[1].marks, []);
  await page.evaluate(() => closeReader());
  report.push('a highlight from an earlier version still marks its whole passage');
  assert.deepEqual(errors, [], `page errors: ${JSON.stringify(errors)}`);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { require('./browser-helpers.cjs').cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
