// Pure helpers in the two largest files, app.js and reader.js, that had no direct tests: byte formatting and
// base64 helpers, the benign-error filter behind the error toast, and ReaderCore text/path helpers.
// Node only; the helpers are cut out of the source by name so the files themselves are not changed.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const app = path.join(__dirname, '../../outputs/ThingsBook');
const appSrc = fs.readFileSync(path.join(app, 'app.js'), 'utf8');
const lineOf = start => { const l = appSrc.split('\n').find(x => x.startsWith(start)); assert(l, start + ' found in app.js'); return l; };

// app.js: size, b64/unb64 and the error filter.
{
  const guard = appSrc.slice(appSrc.indexOf('// error-guard:start'), appSrc.indexOf('// error-guard:end'));
  const sandbox = {atob, btoa, Uint8Array, String, Set, RegExp, console, Date, window:{}, toast() {}};
  vm.createContext(sandbox);
  vm.runInContext([lineOf('function size('), lineOf('function b64('), lineOf('function unb64('), guard,
    'globalThis.t = {size, b64, unb64, isBenignError};'].join('\n'), sandbox);
  const t = sandbox.t;
  assert.equal(t.size(0), '0 B'); assert.equal(t.size(1023), '1023 B'); assert.equal(t.size(1024), '1.0 KB');
  assert.equal(t.size(1536), '1.5 KB'); assert.equal(t.size(1048576), '1.0 MB'); assert.equal(t.size(5 * 1048576 + 524288), '5.5 MB');
  const bytes = Uint8Array.from({length:70000}, (_, i) => i % 256);   // larger than the 32768-byte chunk
  const round = t.unb64(t.b64(bytes.buffer));
  assert.equal(round.length, bytes.length); assert(round.every((v, i) => v === bytes[i]), 'base64 round trip over several chunks');
  assert.equal(t.b64(new Uint8Array(0).buffer), ''); assert.equal(t.unb64('').length, 0);
  assert.equal(t.b64(Uint8Array.of(104, 105).buffer), 'aGk=');
  // Benign: nothing, strings and Error objects naming a deliberate cancel. Not benign: ordinary failures.
  for (const benign of [null, undefined, 'Rendering cancelled', 'The operation was aborted.', {name:'AbortException'}, {name:'Error', message:'Worker was terminated'}, new Error('ResizeObserver loop limit exceeded')])
    assert.equal(t.isBenignError(benign), true, String(benign && (benign.message || benign.name || benign)));
  for (const real of ['disk full', new Error('QuotaExceededError'), {name:'TypeError', message:'x is undefined'}])
    assert.equal(t.isBenignError(real), false, String(real.message || real));
}

// reader.js: ReaderCore (everything before the DOM-bound ThingsReader).
{
  const context = {window:{}, TextDecoder, Uint8Array}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(app, 'reader.js'), 'utf8').split('const ThingsReader')[0] + '\nglobalThis.ReaderCore = ReaderCore;', context);
  const core = context.ReaderCore, plain = v => JSON.parse(JSON.stringify(v));
  const utf16le = Uint8Array.from([0xff, 0xfe, 0x48, 0, 0x69, 0]), utf16be = Uint8Array.from([0xfe, 0xff, 0, 0x48, 0, 0x69]);
  assert.equal(core.decodeText(new TextEncoder().encode('café')), 'café');
  assert(core.decodeText(utf16le).endsWith('Hi')); assert(core.decodeText(utf16be).endsWith('Hi'));
  assert.equal(core.decodeText(utf16le.buffer), core.decodeText(utf16le), 'ArrayBuffer and Uint8Array decode alike');

  // Relative EPUB paths: normalised, and anything escaping the book or pointing outside is refused.
  assert.equal(core.cleanPath('OEBPS/text/ch1.xhtml', '../images/a.png'), 'OEBPS/images/a.png');
  assert.equal(core.cleanPath('OEBPS/ch1.xhtml', './b.xhtml#note?x=1'), 'OEBPS/b.xhtml');
  assert.equal(core.cleanPath('ch1.xhtml', 'sub//c.xhtml'), 'sub/c.xhtml');
  assert.equal(core.cleanPath('OEBPS/ch1.xhtml', 'a%20b.xhtml'), 'OEBPS/a b.xhtml');
  for (const bad of ['../../etc/passwd', '/abs.xhtml', 'https://x.test/a', 'file:///c', 'a\\b.xhtml', '%E0%A4%A.xhtml'])
    assert.equal(core.cleanPath('ch1.xhtml', bad), null, bad);

  // Narration chunks stay under the limit, split after sentences, and lose no words.
  const prose = 'The harbour was quiet. A single lantern burned! Did anyone see it? '.repeat(20).trim();
  const chunks = core.speechChunks(prose, 200);
  assert(chunks.length > 1 && chunks.every(c => c.length <= 200), 'chunks respect the limit');
  assert(chunks.slice(0, -1).every(c => /[.!?]$/.test(c)), 'chunks end at sentence ends');
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), prose);
  assert.deepEqual(plain(core.speechChunks('  short  ')), ['short']); assert.deepEqual(plain(core.speechChunks('   ')), []);
  const nospace = 'x'.repeat(450); assert.deepEqual(plain(core.speechChunks(nospace, 200).map(c => c.length)), [200, 200, 50]);
  const emoji = '😀'.repeat(150); assert(core.speechChunks(emoji, 201).every(c => !/[\ud800-\udbff]$/.test(c)), 'no surrogate pair is cut in half');

  // Paragraphs: blank lines separate, short ones stay whole, long ones split at sentence ends.
  assert.deepEqual(plain(core.paragraphs('One.\r\n\r\n\r\nTwo.\n \nThree.')), ['One.', 'Two.', 'Three.']);
  assert.deepEqual(plain(core.paragraphs(' \n\n ')), []);
  assert.deepEqual(plain(core.sentenceSplit('Short text.')), ['Short text.']);
}
console.log('PASS app.js size/base64/error filter and reader.js ReaderCore text, path and chunk helpers.');
// Accessibility of the main reader controls: toggle buttons expose their state; the focusable text area is named.
{
  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8'), reader = fs.readFileSync(path.join(app, 'reader.js'), 'utf8');
  for (const id of ['reader-focus', 'reader-fullscreen']) assert(new RegExp('id="' + id + '"[^>]*aria-pressed="false"').test(html), id + ' starts unpressed');
  assert(/id="reader-content" tabindex="0" role="region" aria-label="Book text"/.test(html), 'reader text region is named');
  assert(reader.includes("q('reader-focus').setAttribute('aria-pressed',String(focus))"), 'focus toggle updates aria-pressed');
  assert(reader.includes("addEventListener('fullscreenchange'"), 'full screen state follows the browser (Escape included)');
  console.log('PASS reader toggle buttons expose aria-pressed and the book text region is named.');
}
