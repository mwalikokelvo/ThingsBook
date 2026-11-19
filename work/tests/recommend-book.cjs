// window.recommendBookFromLibrary(): one sentence suggesting an unfinished book.
// Runs the function from app.js against a small list of books. Node only, no browser.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../../outputs/ThingsBook/app.js'), 'utf8').replace(/\r\n/g, '\n');
const m = source.match(/\nfunction recommendBookFromLibrary\(\)[\s\S]*?\n}\n/);
assert(m, 'recommendBookFromLibrary is in app.js');
assert(source.includes('window.recommendBookFromLibrary = recommendBookFromLibrary;'));

const run = books => { const context = {books}; vm.createContext(context); vm.runInContext(m[0], context); return vm.runInContext('recommendBookFromLibrary()', context); };

assert.equal(run([]), 'I could not find a book to recommend among your unfinished books. Rate or tag a few first.');
assert.equal(run([{title:'Plain', author:'A', rating:2}]), 'I could not find a book to recommend among your unfinished books. Rate or tag a few first.');
assert.equal(run([
  {title:'Finished great', author:'A', rating:5, status:'finished'},
  {title:'Whole', author:'B', rating:5, progress:{percent:100}},
  {title:'Good', author:'C', rating:4, added:9},
  {title:'Dune', author:'Frank Herbert', rating:5, added:1, progress:{percent:62.4}},
  {title:'Tagged', author:'D', tags:['sci-fi'], added:20},
]), 'You might enjoy Dune by Frank Herbert. You are 62 percent through it.');
assert.equal(run([
  {title:'Old tag', author:'Unknown author', tags:['x'], added:1},
  {title:'New tag', author:'Unknown author', tags:['y'], added:5},
]), 'You might enjoy New tag. You have not started it yet.');
const list = [{title:'B', author:'b', rating:4, added:1}, {title:'A', author:'a', rating:5, added:2}];
run(list);
assert.deepEqual(list.map(b => b.title), ['B', 'A'], 'the library order is left alone');
console.log('recommendBookFromLibrary checks passed.');
