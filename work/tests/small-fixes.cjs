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
console.log('PASS citation punctuation and BibTeX escaping, spoken cents, and a named, unique-id dialog set in index.html (' + dialogs.length + ' dialogs).');
