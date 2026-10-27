// Spoken text for personal voices (dates, years, numbers, titles, initials) and PDF page text rebuilt
// from item positions (no spaces inside words, hyphenated line ends joined, paragraphs found), plus
// sentence-boundary splitting of long plain-text paragraphs. Node only.
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const app = path.join(__dirname, '../../outputs/ThingsBook');
const context = {window:{}}; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(app, 'vendor/speech-text.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(app, 'vendor/metadata.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(app, 'reader.js'), 'utf8').split('const ThingsReader')[0] + '\nglobalThis.ReaderCore = ReaderCore;', context);
const {spoken} = context.window.ThingsSpeechText, core = context.ReaderCore;

for (const [input, output] of [
  ['published on August 22, 2022.', 'published on August twenty-second, twenty twenty-two.'],
  ['Dr. Lori Handrahan and R.A. "Kris" Millegan', 'Doctor Lori Handrahan and R. A. "Kris" Millegan'],
  ['about 5,000 people in 1997, 2000, 2005 and 1905', 'about five thousand people in nineteen ninety-seven, two thousand, two thousand five and nineteen oh five'],
  ['on 3 May 1999 at 10:30', 'on the third of May nineteen ninety-nine at ten thirty'],
  ['the 1960s cost $5.50, 50% of the 21st', 'the nineteen sixties cost five dollars fifty cents, fifty percent of the twenty-first'],
  ['pages 11-15 and No. 7 and 3.14', 'pages eleven to fifteen and number seven and three point one four'],
  ['e.g. the U.S. Army vs. the rest', 'for example, the U. S. Army versus the rest'],
  ['No numbers here, just words.', 'No numbers here, just words.'],
]) assert.equal(spoken(input), output);

const item = (str, x, y, width, size = 12) => ({str, transform:[size, 0, 0, size, x, y], width, height:size});
const text = core.pdfText([
  item('Peter', 100, 700, 30), item("'s brother said to him that there was", 131, 700, 369),
  item('five thou', 100, 686, 50), item('sand in all, and the fatig-', 151, 686, 349),
  item('ue of the march was great (Jn 6:5', 100, 672, 300), item('-', 400.5, 672, 4), item('11).', 405, 672, 20),
  item('En route to the Jubilee, he asked', 118, 658, 382), item('"Teacher', 100, 644, 50), item(',', 150.4, 644, 3), item(' where do you live?"', 154, 644, 120),
]);
assert.equal(text, 'Peter\'s brother said to him that there was five thousand in all, and the fatigue of the march was great (Jn 6:5-11).\n\nEn route to the Jubilee, he asked "Teacher, where do you live?"');

const long = 'The lantern shone over the harbour every night. '.repeat(30).trim();
const parts = core.paragraphs(long);
assert(parts.length > 1 && parts.every(p => p.endsWith('.')), 'long plain paragraphs split only at sentence ends');
assert.equal(parts.join(' '), long);
const {tidy} = context.window.ThingsMetadata;
for (const [input, output] of [
  [{title:'One Nation Under Blackmail, Volume 2 (Whitney Webb)Trine Day 2022', author:'Unknown author'}, {title:'One Nation Under Blackmail, Volume 2', author:'Whitney Webb'}],
  [{title:'Hope for the World: To Unite All Things in Christ (Cardinal Christoph Schönborn) Ignatius Press 2015', author:'Unknown author'}, {title:'Hope for the World: To Unite All Things in Christ', author:'Cardinal Christoph Schönborn'}],
  [{title:'Fulfilled in our hearing : history and method of Christian preaching', author:'DeBona, Guerric, 1955-'}, {title:'Fulfilled in our hearing: history and method of Christian preaching', author:'Guerric DeBona'}],
  [{title:'The Republic (Penguin Classics)', author:'Unknown author'}, {title:'The Republic (Penguin Classics)', author:'Unknown author'}],
  [{title:'Divine Love Made Flesh (Volume 2)', author:'Unknown author'}, {title:'Divine Love Made Flesh (Volume 2)', author:'Unknown author'}],
  [{title:'Five Loaves and Two Fish', author:'Francis-Xavier Nguyen Van Thuan'}, {title:'Five Loaves and Two Fish', author:'Francis-Xavier Nguyen Van Thuan'}],
]) assert.deepEqual({...tidy(input)}, output);
console.log('PASS: book titles and authors from download-site names and catalogue records are tidied; ordinary titles are left alone.');
console.log('PASS: spoken dates, years, numbers, titles and initials; PDF text joins split words and hyphenated lines and finds paragraphs; long paragraphs split at sentence ends.');
