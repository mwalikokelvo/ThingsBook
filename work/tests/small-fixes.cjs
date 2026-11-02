// Small regressions found in an audit: citation punctuation and BibTeX escaping, spoken one-digit and
// single cents, and an accessible name on every dialog in index.html. Node only, no browser.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const app = path.join(__dirname, '../../outputs/ThingsBook');
const load = name => { const context = {window:{}}; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(app, name), 'utf8'), context); return context.window; };

const {format} = load('vendor/citation.js').ThingsCitation;
// A missing year must not leave a double full stop ("n.d..") in MLA and Chicago drafts.
assert.equal(format({title:'A', author:'B'}, 'MLA'), 'B. A. n.d.');
assert.equal(format({title:'A', author:'B', year:'2001', publisher:'P'}, 'Chicago'), 'B. A. P, 2001.');
assert.equal(format({title:'A', author:'B', year:'2001'}, 'MLA', 5), 'B. A. 2001. Page 5.');
assert.equal(format({title:'A', author:'B'}, 'APA'), 'B. (n.d.). A.');
// BibTeX: & % # _ $ break LaTeX unless escaped; braces and backslashes are still dropped.
const bib = format({id:'x1', title:'R&D 100% {fun}_\\#1', author:'B & C', year:2000}, 'bibtex');
assert.match(bib, /title = \{R\\&D 100\\% fun\\_\\\\#1\}|title = \{R\\&D 100\\% fun\\_\\#1\}/);
assert(bib.includes('author = {B \\& C}'));
assert(!/[^\\][&%#_$]/.test(bib.replace(/@book\{thingsbook_[^,]*,/, '')), 'every special character in BibTeX values is escaped');

const {spoken} = load('vendor/speech-text.js').ThingsSpeechText;
assert.equal(spoken('$1,234.5'), 'one thousand two hundred thirty-four dollars fifty cents');
assert.equal(spoken('$0.05'), 'zero dollars five cents');
assert.equal(spoken('$0.01'), 'zero dollars one cent');
assert.equal(spoken('$5.50'), 'five dollars fifty cents');
assert.equal(spoken('$5.'), 'five dollars.');

const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no duplicate ids');
const dialogs = [...html.matchAll(/<dialog\b([^>]*)>/g)];
assert(dialogs.length >= 6, 'dialogs found');
for (const [, attrs] of dialogs) {
  const name = attrs.match(/\baria-label="([^"]+)"/), by = attrs.match(/\baria-labelledby="([^"]+)"/);
  assert(name || by, `dialog ${attrs.trim()} needs an accessible name`);
  if (by) assert(ids.includes(by[1]), `aria-labelledby="${by[1]}" must point at an element in index.html`);
}

// BibTeX keys: an id with no letters or digits must still give a unique, stable key; page is written as pages.
{
  const key = b => format(b, 'bibtex').match(/@book\{([^,]+),/)[1];
  assert.equal(key({id:'ab-12'}), 'thingsbook_ab12', 'ordinary ids keep their existing key');
  const keys = ['---', '___', '日本', '日本語', ''].map(id => key({id}));
  assert.equal(new Set(keys.slice(0, 4)).size, 4, 'ids without [a-z0-9] get different keys');
  assert.deepEqual(keys.slice(0, 4), ['---', '___', '日本', '日本語'].map(id => key({id})), 'and the keys are stable');
  assert(keys.slice(0, 4).every(k => /^thingsbook_x[0-9a-f]{8}$/.test(k)));
  assert.equal(key({}), 'thingsbook_book');
  assert(!/pages =/.test(format({id:'q', title:'T', author:'A'}, 'bibtex')), 'no page, no pages field');
  assert(format({id:'q', title:'T', author:'A', year:1999}, 'bibtex', '12-14').includes('pages = {12--14}'));
  assert(format({id:'q', title:'T', author:'A', year:1999}, 'BibTeX', 7).includes('pages = {7}'));
}

// Spoken text: fractions, phone numbers and titles.
{
  const cases = [
    ['1/2 cup', 'one half cup'], ['2 1/2 cups', 'two and a half cups'], ['3/4 full', 'three quarters full'],
    ['on 1/2/2020', 'on one/two/two thousand twenty'], ['11/2', 'eleven/two'],
    ['Call 555-1234 now', 'Call five five five, one two three four now'],
    ['(555) 223-4567', 'five five five, two two three, four five six seven'],
    ['pages 11-15', 'pages eleven to fifteen'], ['1990-1995', 'nineteen ninety to nineteen ninety-five'],
    ['Mr. Smith and Mrs. Jones', 'Mister Smith and Missus Jones'],
    ['Mr. and Mrs. Smith', 'Mister and Missus Smith'], ['Dr. or Mr. Lee', 'Doctor or Mister Lee'],
    ['Mr. and the cat', 'Mr. and the cat'],
  ];
  for (const [input, output] of cases) assert.equal(spoken(input), output, input);
}

// Global error handler in app.js: benign rejections are ignored, others show one generic toast.
{
  const src = fs.readFileSync(path.join(app, 'app.js'), 'utf8');
  const part = src.slice(src.indexOf('// error-guard:start'), src.indexOf('// error-guard:end'));
  assert(part.includes('unhandledrejection'), 'error-guard block found in app.js');
  const listeners = {}, toasts = [], logged = [];
  const sandbox = {window:{addEventListener:(type, fn) => { listeners[type] = fn; }}, toast:m => toasts.push(m), console:{error:e => logged.push(e)}, Date:{now:() => sandbox.now}, now:1e6};
  vm.createContext(sandbox); vm.runInContext(part, sandbox);
  const reject = reason => listeners.unhandledrejection({reason});
  const cancelled = new Error('Rendering cancelled, page 3'); cancelled.name = 'RenderingCancelledException';
  reject(cancelled); reject(new Error('Rendering cancelled')); reject(null);
  const abort = new Error('x'); abort.name = 'AbortError'; reject(abort);
  listeners.error({target:sandbox.window, message:'ResizeObserver loop completed with undelivered notifications.'});
  assert.equal(toasts.length, 0, 'benign errors show no toast'); assert.equal(logged.length, 0);
  reject(new Error('secret book text'));
  assert.equal(toasts.length, 1); assert(!/secret/.test(toasts[0]), 'toast is generic');
  reject(new Error('again')); assert.equal(toasts.length, 1, 'repeats within 10 seconds are not shown');
  sandbox.now += 11000; listeners.error({target:sandbox.window, error:new TypeError('boom')}); assert.equal(toasts.length, 2);
  listeners.error({target:{tagName:'IMG'}, message:'img failed'}); assert.equal(toasts.length, 2, 'resource load errors are ignored');
}

console.log('PASS citation punctuation, BibTeX escaping, unique BibTeX keys and pages, spoken fractions/phones/titles, the global error toast, spoken cents, and a named, unique-id dialog set in index.html (' + dialogs.length + ' dialogs).');
