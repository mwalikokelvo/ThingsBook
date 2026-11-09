// Shelf lifecycle in real Chromium: the desktop Edit control and the mobile Shelves control open the
// same manager; renaming updates the sidebar and heading, empty or duplicate names are refused inline,
// and deleting a shelf moves its books (never deletes them). Deleting the last shelf leaves the
// library's default shelf with every book on it. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { try { ({chromium} = require('playwright-core')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); } }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, cleanup} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-shelves-'));
const wait = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, {timeout});

async function renameRow(page, index, value) {
  await wait(page, () => !busy);
  await page.evaluate(([i, v]) => { const row = [...document.querySelectorAll('#shelves-list .shelf-edit-row')][i]; const input = row.querySelector('input'); input.value = v; [...row.querySelectorAll('button')].find(button => button.textContent === 'Save').click(); }, [index, value]);
}
async function deleteRow(page, index) {
  await wait(page, () => !busy);
  await page.evaluate(i => { const row = [...document.querySelectorAll('#shelves-list .shelf-edit-row')][i]; [...row.querySelectorAll('button')].find(button => button.textContent === 'Delete').click(); }, index);
}
async function openManager(page, control) {
  await wait(page, () => !busy);
  await page.evaluate(sel => {
    const target = document.querySelector(sel);
    const details = target?.closest('details');
    if (details && !details.open) details.open = true;
  }, control);
  const loc = page.locator(control);
  await loc.scrollIntoViewIfNeeded();
  await loc.waitFor({state: 'visible', timeout: 10000});
  await loc.click({force: true});
  await wait(page, () => $('shelves-dialog').open);
  await page.waitForFunction(() => document.querySelectorAll('#shelves-list .shelf-edit-row').length > 0);
}

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
    viewport: {width:1280, height:900}
  });
  const page = context.pages()[0] || await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const problems = []; page.on('pageerror', error => problems.push(error.message));
  await page.goto('http://127.0.0.1:8765/');
  await wait(page, () => typeof db !== 'undefined' && !!db);
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Shelf test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  const report = [];

  // Create a second shelf through the existing dialog, then manage both.
  await page.click('#new-shelf');
  await page.fill('#shelf-name', 'Essays');
  await page.evaluate(() => $('shelf-form').requestSubmit());
  await wait(page, () => shelves.length === 2 && !!shelves.find(shelf => shelf.name === 'Essays'));

  await openManager(page, '#edit-shelves');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#shelves-list .shelf-edit-row').length), 2, 'the manager lists both shelves');

  // Rename the first shelf; the sidebar and, once selected, the heading follow.
  const firstId = await page.evaluate(() => shelves[0].id);
  await renameRow(page, 0, '  Favourites  ');
  await wait(page, ([id, name]) => shelves.find(shelf => shelf.id === id)?.name === name, [firstId, 'Favourites']);
  assert.match(await page.evaluate(() => $('shelf-nav').textContent), /Favourites/, 'the sidebar shows the new name');
  await page.evaluate(id => { filter = id; render(); }, firstId);
  assert.equal(await page.evaluate(() => $('library-heading').textContent), 'Favourites', 'the shelf heading shows the new name');
  report.push('the desktop Edit control renames a shelf and the sidebar/heading follow');

  // Empty and duplicate names are refused inline, without changing the shelf.
  await renameRow(page, 0, '   ');
  await wait(page, () => $('shelves-error').textContent.length > 0);
  assert.match(await page.evaluate(() => $('shelves-error').textContent), /Enter a shelf name/);
  await renameRow(page, 0, 'essays');
  await wait(page, () => /already has that name/.test($('shelves-error').textContent));
  assert.equal(await page.evaluate(id => shelves.find(shelf => shelf.id === id).name, firstId), 'Favourites', 'a refused rename leaves the shelf unchanged');
  report.push('empty and duplicate (case-insensitive) names are refused inline and change nothing');

  // A book on the renamed shelf moves to the remaining shelf when that shelf is deleted.
  await wait(page, () => !busy);
  await page.evaluate(() => $('shelves-dialog').close());
  await page.setInputFiles('#book-files', [{name:'Shelf test.txt', mimeType:'text/plain', buffer:Buffer.from('A private shelf chapter for the test.')}]);
  await page.evaluate(() => upload({preventDefault(){}}));
  await wait(page, () => books.length === 1, null, 30000);
  const bookId = await page.evaluate(() => books[0].id);
  const secondId = await page.evaluate(() => shelves.find(shelf => shelf.name === 'Essays').id);
  await page.evaluate(async ([id, shelfId]) => { await updateBook(id, {shelfId}); }, [bookId, firstId]);
  await page.evaluate(id => { filter = id; render(); }, firstId);

  await openManager(page, '#edit-shelves');
  await deleteRow(page, 0);
  await wait(page, () => shelves.length === 1 && shelves[0].name === 'Essays');
  assert.equal(await page.evaluate(id => books.find(book => book.id === id).shelfId, bookId), secondId, 'the book is reassigned, not deleted');
  assert.equal(await page.evaluate(id => !!document.querySelector(`#shelves [data-book-id="${id}"]`), bookId), true, 'the moved book is still visible in the library');
  assert.equal(await page.evaluate(() => $('library-heading').textContent), 'Essays', 'the view returns to the target shelf');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#shelves-list .shelf-edit-row').length), 1, 'the manager shows the remaining shelf');
  report.push('deleting a shelf reassigns its books, keeps them visible, and returns the view to a valid shelf');

  // Deleting the last shelf creates the default shelf; no book is orphaned.
  await deleteRow(page, 0);
  await wait(page, () => shelves.length === 1 && shelves[0].name === 'My collection');
  assert.equal(await page.evaluate(id => books.find(book => book.id === id).shelfId, bookId), await page.evaluate(() => shelves[0].id), 'the book moves to the default shelf');
  assert.equal(await page.evaluate(() => books.every(book => shelves.some(shelf => shelf.id === book.shelfId))), true, 'no book points at a missing shelf');
  assert.equal(await page.evaluate(id => !!document.querySelector(`#shelves [data-book-id="${id}"]`), bookId), true, 'the book stays visible on the default shelf');
  report.push('deleting the last shelf leaves a default shelf with every book on it');

  // On a phone the mobile Shelves control opens the same manager and can rename.
  await page.evaluate(() => $('shelves-dialog').close());
  await page.setViewportSize({width:390, height:844});
  await page.waitForFunction(() => matchMedia('(max-width:720px)').matches);
  await page.waitForFunction(() => {
    const disclosure = document.querySelector('.library-tools-disclosure');
    if (disclosure && !disclosure.open) disclosure.open = true;
    const btn = document.getElementById('mobile-shelves');
    return btn && btn.offsetParent !== null;
  });
  await openManager(page, '#mobile-shelves');
  const mobileId = await page.evaluate(() => shelves[0].id);
  await renameRow(page, 0, 'Phone shelf');
  await wait(page, ([id, name]) => shelves.find(shelf => shelf.id === id)?.name === name, [mobileId, 'Phone shelf']);
  assert.match(await page.evaluate(() => $('shelf-nav').textContent), /Phone shelf/, 'the mobile rename reaches the same library');
  report.push('the mobile Shelves control opens the manager and renames a shelf');

  assert.deepEqual(problems, [], `no page errors: ${problems.join('; ')}`);
  console.log(`PASS shelf lifecycle in Chromium:\n- ${report.join('\n- ')}`);
  await context.close();
}

main().then(() => { cleanup(profile); process.exit(0); }, error => { console.error(error); cleanup(profile); process.exit(1); });