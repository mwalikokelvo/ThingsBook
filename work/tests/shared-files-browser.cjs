// Books opened with, or shared to, ThingsBook on Android, in real Chromium with a stand-in for the Android
// bridge (MainActivity.sharedFiles and its /shared-file tickets). Files that arrive while the library is
// locked wait for the unlock; then the import dialog opens with them selected (names kept, so Markdown is
// recognized by its extension) and nothing is saved until "Add to my library". A ticket that no longer
// works is reported. Files shared while the dialog is open wait until it closes.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, cleanup} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-shared-'));
const EPUB = fs.readFileSync(path.join(__dirname, 'fixtures/kindle/sample.epub'));
const MD = Buffer.from('# Shared notes\n\nSent from another app.\n');
const until = async (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, {timeout, polling:200});

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true});
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', d => d.accept());
  const problems = []; page.on('pageerror', e => problems.push(e.message));
  const served = {'11111111-1111-1111-1111-111111111111':EPUB, '22222222-2222-2222-2222-222222222222':MD, '44444444-4444-4444-4444-444444444444':EPUB};
  const fetched = [];
  await page.route(/\/shared-file\?ticket=/, route => {
    const ticket = new URL(route.request().url()).searchParams.get('ticket'); fetched.push(ticket);
    const body = served[ticket]; delete served[ticket];  // one-time, like MainActivity
    return body ? route.fulfill({status:200, contentType:'application/octet-stream', body}) : route.fulfill({status:404, body:''});
  });
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  const report = [];

  // Files arrive before the library is unlocked.
  await page.evaluate(() => {
    window.__shared = [[{ticket:'11111111-1111-1111-1111-111111111111', name:'harbour.epub', size:1}, {ticket:'22222222-2222-2222-2222-222222222222', name:'shared notes.md', size:1}, {ticket:'33333333-3333-3333-3333-333333333333', name:'gone.pdf', size:1}]];
    ThingsSharedFiles.attach({sharedFiles:() => JSON.stringify(window.__shared.shift() || [])});
  });
  await page.waitForTimeout(1200);
  assert.equal(fetched.length, 0, 'nothing is fetched while the library is locked');
  assert.equal(await page.evaluate(() => $('upload-dialog').open), false);
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Shared files password 1'; return unlock({preventDefault(){}}); });
  await until(page, () => $('upload-dialog').open);
  const chosen = await page.evaluate(() => ({files:[...$('book-files').files].map(f => f.name), toast:$('toast').textContent, books:books.length}));
  assert.deepEqual(chosen.files, ['harbour.epub', 'shared notes.md']); assert.equal(chosen.books, 0, 'nothing is saved before confirming');
  assert.match(chosen.toast, /Could not open this shared file: gone\.pdf/);
  report.push('files shared while locked wait for the unlock, then open the import dialog with their names; nothing is saved yet; a dead ticket is reported');

  // A file shared while the dialog is open waits for it to close.
  await page.evaluate(() => { window.__shared.push([{ticket:'44444444-4444-4444-4444-444444444444', name:'later.epub', size:1}]); window.nativeSharedFiles(); });
  await page.waitForTimeout(1200);
  assert.deepEqual(await page.evaluate(() => [...$('book-files').files].map(f => f.name)), ['harbour.epub', 'shared notes.md'], 'the open import is not replaced');
  await page.evaluate(() => upload({preventDefault(){}}));
  const saved = await page.evaluate(() => books.map(b => ({title:b.title, source:b.sourceFormat || b.format})));
  assert.equal(saved.length, 2); assert(saved.some(b => b.source === 'MD'), 'the shared Markdown file was recognized by its name');
  report.push('"Add to my library" saves the shared EPUB and Markdown file');
  await until(page, () => $('upload-dialog').open && [...$('book-files').files].some(f => f.name === 'later.epub'));
  report.push('a file shared while the dialog was open is offered once it closes');

  assert.deepEqual(problems, []);
  await context.close();
  console.log(report.map(line => `PASS ${line}`).join('\n'));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { cleanup(profile); setTimeout(() => process.exit(), 500).unref(); });
