// Guards against damaged or truncated app files (several automated edits in November cut index.html,
// app.js and CHANGELOG.md short and rebuilt them from memory, losing the backup confirmation and the
// protected-PDF dialog). Checks that:
//  - every element id used by app.js ($('id')) and reader.js (q('id')) exists in index.html or is
//    created by a script;
//  - index.html is complete (closes </body></html>) and has no duplicate ids;
//  - the backup safety step (summary, recovery code, "I have saved" confirmation) and the protected-PDF
//    dialog are present;
//  - every script listed in index.html exists and parses;
//  - CHANGELOG.md still lists every released version back to 1.13.0.
// Node only.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '../..'), app = path.join(root, 'outputs/ThingsBook');
const read = file => fs.readFileSync(path.join(app, file), 'utf8');
const html = read('index.html');

assert.match(html.trim(), /<\/body><\/html>$/, 'index.html ends with </body></html>');
const idList = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]), ids = new Set(idList);
assert.deepEqual(idList.filter((id, i) => idList.indexOf(id) !== i), [], 'no duplicate ids in index.html');

const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
assert(scripts.length > 30, `index.html lists all its scripts (${scripts.length})`);
for (const src of scripts) { const file = path.join(app, src); assert(fs.existsSync(file), `${src} exists`); if (/\.js$/.test(src)) new vm.Script(fs.readFileSync(file, 'utf8'), {filename:src}); }

const vendor = fs.readdirSync(path.join(app, 'vendor')).filter(f => f.endsWith('.js')).map(f => read('vendor/' + f)).join('\n');
const everything = vendor + read('app.js') + read('reader.js');
const created = new Set([...everything.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g), ...everything.matchAll(/dialog\('([\w-]+)'/g)].map(m => m[1]));
for (const [file, pattern] of [['app.js', /\$\('([\w-]+)'\)/g], ['reader.js', /\bq\('([\w-]+)'\)/g]]) {
  const missing = [...new Set([...read(file).matchAll(pattern)].map(m => m[1]))].filter(id => !ids.has(id) && !created.has(id));
  assert.deepEqual(missing, [], `${file} uses ids that index.html no longer has`);
}
for (const id of ['backup-summary', 'backup-recovery', 'recovery-details', 'recovery-download', 'backup-ack', 'backup-export', 'pdf-password-dialog', 'pdf-password', 'pdf-password-cancel', 'reader-content', 'reader-message', 'narrator-play', 'sort', 'toast'])
  assert(ids.has(id), `index.html has #${id}`);
assert.match(html, /<input id="backup-file" type="file" accept="\.json,\.thingsbook"/, 'restore still accepts .json and .thingsbook backups');

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
for (const version of ['1.13.0', '1.14.0', '1.14.1', '1.14.2', '1.14.3']) assert.match(changelog, new RegExp(`^## ${version.replace(/\./g, '\\.')} `, 'm'), `CHANGELOG.md keeps ${version}`);
console.log(`PASS: index.html is complete (${ids.size} ids, ${scripts.length} scripts that parse), every id the app uses exists, the backup confirmation and protected-PDF dialog are present, and the changelog keeps every release.`);
