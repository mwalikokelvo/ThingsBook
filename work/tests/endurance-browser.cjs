// Whole-book listening with the screen off, in real Chromium: the page is hidden and gets no animation
// frames, as on a phone with the screen off or a minimised window. A fake offline voice "reads" each
// passage in a few milliseconds. Reading must go from the first to the last chapter of a 40-chapter book
// and from the first to the last page of a 60-page PDF without stopping, and memory and page size must
// stay flat (no growth per chapter or page). Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, syntheticPdf, cleanup} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-endurance-'));
const CHAPTERS = 40, PAGES = 60;
const MD = Array.from({length:CHAPTERS}, (_, c) => `# Chapter ${c + 1}\n\n` + Array.from({length:6}, (_, p) => `Chapter ${c + 1} paragraph ${p + 1} begins. ` + 'The tide came in slowly over the long grey sand while the lamps were lit. '.repeat(6)).join('\n\n')).join('\n\n');

async function until(page, check, arg, timeout = 30000) { const end = Date.now() + timeout; for (;;) { const value = await page.evaluate(check, arg); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 200)); } }
const fakeVoice = () => {
  window.__spoken = 0; window.__last = '';
  class Utterance { constructor(text) { this.text = text; } }
  window.SpeechSynthesisUtterance = Utterance;
  const voice = {voiceURI:'fake-voice', name:'Fake offline voice', localService:true, lang:'en-US'};
  let timer = null;
  Object.defineProperty(window, 'speechSynthesis', {configurable:true, value:{
    paused:false, speaking:false, getVoices:() => [voice], addEventListener() {},
    speak(u) { window.__spoken++; window.__last = u.text; clearTimeout(timer); timer = setTimeout(() => u.onend?.(), 3); },
    cancel() { clearTimeout(timer); }, pause() {}, resume() {}
  }});
};

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true, viewport:{width:1280, height:720}});
  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(fakeVoice);
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
  const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
  const measure = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const {metrics} = await cdp.send('Performance.getMetrics'); const m = Object.fromEntries(metrics.map(x => [x.name, x.value])); return {heap:m.JSHeapUsedSize / 1048576, nodes:m.Nodes, listeners:m.JSEventListeners}; };
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Endurance test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  await page.setInputFiles('#book-files', [{name:'Tides.md', mimeType:'text/markdown', buffer:Buffer.from(MD)}, {name:'Pages.pdf', mimeType:'application/pdf', buffer:syntheticPdf(PAGES, 1000)}]);
  await page.evaluate(() => upload({preventDefault(){}}));
  await until(page, () => books.length === 2);
  const [epub, pdf] = await page.evaluate(() => [books.find(b => b.format === 'EPUB').id, books.find(b => b.format === 'PDF').id]);
  const report = [];

  for (const [id, label, total] of [[epub, 'chapter', CHAPTERS], [pdf, 'page', PAGES]]) {
    await page.evaluate(id => readBook(id), id);
    await until(page, () => !ThingsReader.context()?.loading && !!(document.querySelector('#reader-content .reader-passage') || document.querySelector('#reader-content canvas')));
    assert.equal(await page.evaluate(() => ThingsReader.context().count), total);
    // Screen off: hidden page, no animation frames.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable:true, get:() => true}); Object.defineProperty(document, 'visibilityState', {configurable:true, get:() => 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); window.__raf ||= window.requestAnimationFrame; window.requestAnimationFrame = () => 0; $('narrator-scope').value = 'book'; $('narrator-follow').checked = true; });
    const started = Date.now(), before = await page.evaluate(() => window.__spoken);
    await page.click('#narrator-play');
    if (process.env.TB_DEBUG) { const watch = setInterval(async () => { try { console.log(await page.evaluate(() => [ThingsReader.context()?.location, ThingsReader.context()?.paragraph, window.__spoken, ThingsReader.isSpeaking(), $('reader-message').textContent, (window.__last||'').slice(0,40)].join(' | '))); } catch {} }, 2000); page.once('close', () => clearInterval(watch)); }
    await until(page, n => ThingsReader.context().location >= Math.min(5, n - 1), total, 60000);
    const early = await measure();
    await until(page, n => ThingsReader.context().location >= n - 1, total, 240000);
    await until(page, () => !ThingsReader.isSpeaking(), null, 60000);
    const late = await measure(), message = await page.evaluate(() => $('reader-message').textContent);
    assert.match(message, /end of the book/, `reading went on to the end (stopped with: ${message})`);
    assert(late.heap - early.heap < 25, `memory stayed flat: ${early.heap.toFixed(1)} → ${late.heap.toFixed(1)} MiB`);
    assert(late.nodes - early.nodes < 2000, `page size stayed flat: ${early.nodes} → ${late.nodes} nodes`);
    assert(late.listeners - early.listeners < 500, `event listeners stayed flat: ${early.listeners} → ${late.listeners}`);
    const spoken = await page.evaluate(() => window.__spoken) - before;
    report.push(`${label === 'chapter' ? 'EPUB' : 'PDF'}: ${spoken} passages over ${total} ${label}s with the screen off in ${((Date.now() - started) / 1000).toFixed(0)} s, to the end of the book; JS memory ${early.heap.toFixed(1)} → ${late.heap.toFixed(1)} MiB, ${early.nodes} → ${late.nodes} nodes`);
    await page.evaluate(() => { delete document.hidden; delete document.visibilityState; window.requestAnimationFrame = window.__raf; document.dispatchEvent(new Event('visibilitychange')); closeReader(); });
    await page.waitForTimeout(300);
  }
  // The screen turns off while a PDF page is being drawn for display (which waits for animation frames
  // that no longer come): the page is drawn again in one go and opens.
  await page.evaluate(id => readBook(id), pdf);
  await until(page, () => !ThingsReader.context()?.loading && !!document.querySelector('#reader-content canvas'));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; $('reader-location').value = '10'; $('reader-location').onchange(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable:true, get:() => true}); document.dispatchEvent(new Event('visibilitychange')); });
  await until(page, () => ThingsReader.context().location === 10 && !ThingsReader.context().loading && /marker-11/.test($('reader-content').textContent), null, 10000);
  await page.evaluate(() => { delete document.hidden; window.requestAnimationFrame = window.__raf; closeReader(); });
  report.push('a PDF page that was being drawn when the screen turned off is drawn again and opens');

  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: whole-book listening with the screen off:\n  - ' + report.join('\n  - '));
}
main().then(() => { cleanup(profile); process.exit(0); }, error => { console.error(error); cleanup(profile); process.exit(1); });
