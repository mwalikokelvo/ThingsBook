// Read aloud in real Chromium with a fake offline device voice (each passage "ends" after a few ms):
// long book paragraphs stay whole with their italics; turning a screen, page or chapter while reading
// carries on reading; Follow text never moves the view backwards; Read aloud starts at the screen being
// read; stopping clears the "Reading…" status; a blank PDF page is called blank and whole-book
// narration goes past it. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {serve, syntheticPdf, cleanup} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-narration-'));
// Every sentence is unique (paragraph and sentence number), so spoken text can be found on the page.
let paragraphNumber = 0;
const long = n => { const p = ++paragraphNumber; return `Paragraph ${p} began *slowly* that year. ` + Array.from({length:n}, (_, i) => `Sentence ${p}-${i + 1} walks a little further along the quiet harbour road before the evening bell.`).join(' '); };
const MD = `# Arrival\n\n${long(14)}\n\nA short line.\n\n${[1,2,3,4,5,6].map(() => long(14)).join('\n\n')}\n\n# Departure\n\nThe second chapter opens here.\n\n${[1,2,3].map(() => long(14)).join('\n\n')}\n`;

async function until(page, check, arg, timeout = 20000) { const end = Date.now() + timeout; for (;;) { const value = await page.evaluate(check, arg); if (value) return value; if (Date.now() > end) throw new Error(`Timed out waiting for: ${check}`); await new Promise(r => setTimeout(r, 100)); } }
const fakeVoice = () => {
  // Installed before the app loads: one local voice; every utterance ends shortly after it starts.
  window.__spoken = [];
  class Utterance { constructor(text) { this.text = text; } }
  window.SpeechSynthesisUtterance = Utterance;
  const voice = {voiceURI:'fake-voice', name:'Fake offline voice', localService:true, lang:'en-US'};
  let timer = null;
  Object.defineProperty(window, 'speechSynthesis', {configurable:true, value:{
    paused:false, speaking:false, getVoices:() => [voice], addEventListener() {},
    speak(u) { window.__spoken.push(u.text); clearTimeout(timer); timer = setTimeout(() => u.onend?.(), window.__speakMs ?? 40); },
    cancel() { clearTimeout(timer); }, pause() { this.paused = true; }, resume() { this.paused = false; }
  }});
};

async function main() {
  await serve(app);
  const context = await chromium.launchPersistentContext(profile, {headless:true, viewport:{width:1280, height:720}});
  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(fakeVoice);
  page.on('dialog', d => d.accept());
  const errors = []; page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
  await page.evaluate(() => { $('password').value = $('confirm-password').value = 'Narration test password 1'; return unlock({preventDefault(){}}); });
  await page.waitForFunction(() => !!key);
  await page.setInputFiles('#book-files', [{name:'Harbour.md', mimeType:'text/markdown', buffer:Buffer.from(MD)}, {name:'Pages.pdf', mimeType:'application/pdf', buffer:syntheticPdf(4, 1000, [], [2])}]);
  await page.evaluate(() => upload({preventDefault(){}}));
  await until(page, () => books.length === 2);
  const [epub, pdf] = await page.evaluate(() => [books.find(b => b.format === 'EPUB').id, books.find(b => b.format === 'PDF').id]);
  const report = [];
  const open = async id => { await page.evaluate(id => readBook(id), id); await until(page, () => !ThingsReader.context()?.loading && (document.querySelectorAll('#reader-content .reader-passage').length > 0 || !!document.querySelector('#reader-content canvas'))); };

  // Long paragraphs stay whole and keep their italics.
  await open(epub);
  const passages = await page.evaluate(() => [...document.querySelectorAll('#reader-content .reader-passage')].map(p => ({length:p.textContent.length, em:!!p.querySelector('em'), end:p.textContent.trim().slice(-20)})));
  assert.equal(passages.length, 9, 'heading, seven long paragraphs and a short one');
  assert(passages[1].length > 1000 && passages[1].em, `a long paragraph is one passage with its italics (${JSON.stringify(passages[1])})`);
  assert(passages.every(p => /[.!?]$|Arrival$/.test(p.end)), `no passage ends mid-sentence: ${JSON.stringify(passages.map(p => p.end))}`);
  report.push('long book paragraphs stay whole (no mid-sentence splits) and keep their italics');

  // Read aloud starts at the screen being looked at.
  // Larger text, so the first long paragraph runs on from screen 1 onto screen 2.
  await page.evaluate(() => { $('reader-size').value = 26; $('reader-size').oninput(); $('reader-layout').value = 'paged'; $('reader-layout').onchange(); });
  await page.waitForTimeout(300);
  await page.click('#reader-screen-next'); await until(page, () => $('reader-content').scrollLeft >= 1000 && !/^Screen 1 /.test($('reader-screen-status').textContent));
  const screen = await page.evaluate(() => $('reader-screen-status').textContent);
  assert(await page.evaluate(() => $('reader-content').scrollLeft > 0), 'the next screen is shown');
  assert.doesNotMatch(screen, /^Screen 1 /, 'the screen counter follows the page turn');
  await page.evaluate(() => { window.__speakMs = 400; window.__spoken = []; });
  await page.click('#narrator-play');
  await until(page, () => window.__spoken.length >= 1);
  const firstOnScreen = await page.evaluate(() => { const spoken = window.__spoken[0].slice(0, 40), view = $('reader-content').getBoundingClientRect(); const walker = document.createTreeWalker($('reader-content'), NodeFilter.SHOW_TEXT); for (let t = walker.nextNode(); t; t = walker.nextNode()) { const at = t.data.indexOf(spoken); if (at >= 0) { const r = document.createRange(); r.setStart(t, at); r.setEnd(t, at + 1); const box = r.getClientRects()[0]; return !!box && box.left >= view.left - 2 && box.right <= view.right + 2; } } return false; });
  assert(firstOnScreen, `Read aloud on ${screen} starts with words on that screen, not the saved place (first words: ${await page.evaluate(() => window.__spoken[0].slice(0, 60))})`);
  assert.notEqual(await page.evaluate(() => window.__spoken[0]), 'Arrival', 'not from the start of the chapter');
  report.push(`Read aloud on "${screen}" starts with words on that screen`);

  // Follow text never moves backwards while reading goes on.
  await page.evaluate(() => { window.__speakMs = 30; window.__left = []; window.__watch = setInterval(() => window.__left.push($('reader-content').scrollLeft), 20); });
  await until(page, () => window.__spoken.length >= 14, null, 30000);
  const lefts = await page.evaluate(() => { clearInterval(window.__watch); return window.__left; });
  for (let i = 1; i < lefts.length; i++) assert(lefts[i] >= lefts[i - 1] - 2, `view moved back from ${lefts[i - 1]} to ${lefts[i]}`);
  assert(lefts.at(-1) > lefts[0], `the view followed the reading forward (${lefts[0]} → ${lefts.at(-1)})`);
  report.push(`Follow text only moved forward (${lefts[0]} → ${lefts.at(-1)} px) while reading`);

  // Turning the screen and the chapter while reading keeps reading.
  await page.evaluate(() => { window.__speakMs = 400; });
  await page.click('#reader-screen-next');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => ThingsReader.isSpeaking()), true, 'next screen keeps reading');
  const before = await page.evaluate(() => window.__spoken.length);
  await until(page, n => window.__spoken.length > n, before);
  await page.evaluate(() => $('reader-next').click());
  await until(page, () => ThingsReader.context().location === 1 && !ThingsReader.context().loading);
  await until(page, () => /Departure|second chapter/.test(window.__spoken.at(-1)));
  assert.equal(await page.evaluate(() => ThingsReader.isSpeaking()), true, 'next chapter keeps reading');
  report.push('turning a screen or chapter while reading carries on reading from the new place');

  // Stopping clears the reading status.
  await page.click('#narrator-stop');
  const message = await page.evaluate(() => $('reader-message').textContent);
  assert.match(message, /stopped/i); assert.doesNotMatch(message, /Reading/);
  report.push(`stopping says "${message}"`);
  await page.evaluate(() => closeReader());

  // PDF: blank page 2 is called blank; whole-book reading goes from page 1 past it to page 3.
  await open(pdf);
  await page.evaluate(() => { $('narrator-scope').value = 'book'; window.__speakMs = 30; window.__spoken = []; });
  await page.evaluate(() => $('reader-next').click());
  await until(page, () => ThingsReader.context().location === 1 && !ThingsReader.context().loading);
  assert.match(await page.evaluate(() => $('reader-message').textContent), /blank/i);
  await page.evaluate(() => $('reader-previous').click());
  await until(page, () => ThingsReader.context().location === 0 && !ThingsReader.context().loading);
  await page.click('#narrator-play');
  await until(page, () => window.__spoken.some(t => t.includes('marker-3')), null, 20000);
  report.push('a blank PDF page says it is blank, and whole-book reading continues past it');
  await page.evaluate(() => ThingsReader.stop());

  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: narration in Chromium:\n  - ' + report.join('\n  - '));
}
main().then(() => { cleanup(profile); process.exit(0); }, error => { console.error(error); cleanup(profile); process.exit(1); });
