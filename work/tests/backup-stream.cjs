// Backup containers: version 1 stays byte-identical to earlier releases, version 2 streams
// libraries past the browser string cap. Set THINGSBOOK_LARGE_BACKUP=1 to also round-trip
// a ~450 MB library, larger than version 1 can ever hold.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
globalThis.crypto ??= crypto.webcrypto;
const ThingsVault = require(path.join(root, 'outputs/ThingsBook/vendor/vault.js'));
const ThingsBackup = require(path.join(root, 'outputs/ThingsBook/vendor/backup.js'));

const enc = new TextEncoder();
const same = (a, b) => Buffer.from(new Uint8Array(a)).equals(Buffer.from(new Uint8Array(b)));
const codeOf = async promise => { try { await promise; } catch (e) { return e.code || e.message; } return 'resolved'; };

// Records exactly as app.js stores them.
async function library(key, sizes) {
  const config = {version:1, salt:crypto.getRandomValues(new Uint8Array(16)), check:await ThingsVault.seal(enc.encode('ThingsBook vault v1'), key), library:await ThingsVault.sealJSON([{id:'s', name:'Shelf'}], key), recovery:await ThingsVault.seal(enc.encode('code'), key)};
  const records = [], plain = new Map();
  for (const [i, size] of sizes.entries()) {
    const id = crypto.randomUUID(), bytes = crypto.randomBytes(size);
    plain.set(id, bytes);
    records.push({id, meta:await ThingsVault.sealJSON({id, title:`Book ${i}`, cover:'data:image/png;base64,' + 'A'.repeat(200000)}, key), file:await ThingsVault.seal(bytes, key)});
  }
  return {config, records, plain};
}
const sizesOf = records => records.map(r => ({id:r.id, meta:r.meta.data.byteLength, file:r.file.data.byteLength}));
const streamOf = (lib, created) => ThingsBackup.stream(lib.config, lib.records.map(r => r.id), async id => lib.records.find(r => r.id === id), created);

// Reproduction of the pre-1.12.6 backup writer, to prove version 1 output is unchanged.
function previousWriter(records, config, created) {
  const b64 = buffer => Buffer.from(new Uint8Array(buffer)).toString('base64'), pack = r => ({iv:b64(r.iv), data:b64(r.data)});
  return JSON.stringify({format:'ThingsBook encrypted backup', version:1, created, config:{version:1, salt:b64(config.salt), check:pack(config.check), library:pack(config.library), ...(config.recovery ? {recovery:pack(config.recovery)} : {})}, books:records.map(r => ({id:r.id, meta:pack(r.meta), file:pack(r.file)}))});
}

// Edits bytes of a backup without touching the original.
async function mutate(blob, edit) { const bytes = new Uint8Array(await blob.arrayBuffer()); edit(bytes); return new Blob([bytes]); }
// A Blob stand-in that records the largest single read.
function tracked(blob) { const reads = []; return {size:blob.size, reads, slice:(a, b) => { reads.push(Math.min(b, blob.size) - a); return blob.slice(a, b); }, text:() => blob.text()}; }

async function main() {
  const key = await ThingsVault.derive('Test-only backup password', crypto.getRandomValues(new Uint8Array(16)));
  const lib = await library(key, [17, 300000, 2 * 1024 * 1024 + 5]);
  const created = '2026-10-26T05:00:00.000Z';

  // Version 1: identical to earlier releases, still read back.
  assert.equal(ThingsBackup.fitsLegacy(sizesOf(lib.records), lib.config), true);
  const v1 = ThingsBackup.legacy(lib.records, lib.config, created);
  assert.equal(await v1.text(), previousWriter(lib.records, lib.config, created));
  assert.equal(v1.type, 'application/json');
  const fromV1 = await ThingsBackup.read(v1);
  assert.equal(fromV1.books.length, 3);

  // The choice flips at the limit, and a library past the browser string cap never uses version 1.
  assert.equal(ThingsBackup.fitsLegacy(sizesOf(lib.records), lib.config, 1000), false);
  const huge = Array.from({length:4}, (_, i) => ({id:`b${i}`, meta:1000, file:100 * 1024 * 1024}));
  assert.equal(ThingsBackup.fitsLegacy(huge, lib.config), false, '400 MB must stream');
  assert.equal(ThingsBackup.fitsLegacy(huge.slice(0, 1), lib.config), true, '100 MB stays version 1');

  // Version 2 round trip, byte for byte, and the ciphertext still decrypts.
  const v2 = await streamOf(lib, created);
  assert((await v2.slice(0, 31).text()) === ThingsBackup.MAGIC);
  assert(!(await v2.text()).includes('Book 0'), 'metadata stays encrypted');
  const fromV2 = await ThingsBackup.read(v2);
  assert.equal(fromV2.books.length, 3);
  for (const restored of [fromV1, fromV2]) {
    assert(same(restored.config.salt, lib.config.salt));
    for (const name of ['check', 'library', 'recovery']) { assert(same(restored.config[name].iv, lib.config[name].iv)); assert(same(restored.config[name].data, lib.config[name].data)); }
    for (const [i, book] of restored.books.entries()) {
      const original = lib.records[i];
      assert.equal(book.id, original.id);
      assert(same(book.file.data, original.file.data)); assert(same(book.meta.data, original.meta.data)); assert.equal(book.file.iv.length, 12);
      assert(same(await ThingsVault.unseal(book.file, key), lib.plain.get(book.id)));
      assert.equal((await ThingsVault.readJSON(book.meta, key)).id, book.id);
    }
  }
  assert.equal((await ThingsBackup.read(await ThingsBackup.stream(lib.config, [], async () => null, created))).books.length, 0, 'empty library');

  // Reads go one book at a time: no single read is larger than the largest book.
  const watch = tracked(v2); await ThingsBackup.read(watch);
  assert(Math.max(...watch.reads) <= 2 * 1024 * 1024 + 5 + 16, `largest read ${Math.max(...watch.reads)}`);
  assert(watch.reads.reduce((a, b) => a + b, 0) <= v2.size, 'each byte read once');

  // Tampered ciphertext parses but fails authentication, as in version 1.
  const trailer = 4 + Buffer.byteLength(JSON.stringify({end:true, books:3}));
  const fileStart = v2.size - trailer - lib.records[2].file.data.byteLength + 10; // inside the last book's ciphertext
  const tampered = await ThingsBackup.read(await mutate(v2, b => { b[fileStart] ^= 1; }));
  await assert.rejects(ThingsVault.unseal(tampered.books[2].file, key));

  // Truncation anywhere is reported as incomplete, never as a smaller library.
  for (const cut of [1, 20, lib.records[2].file.data.byteLength, v2.size - 40]) assert.equal(await codeOf(ThingsBackup.read(v2.slice(0, v2.size - cut))), 'truncated', `cut ${cut}`);
  assert.equal(await codeOf(ThingsBackup.read(new Blob([v2, 'x']))), 'invalid', 'trailing bytes');

  // Malformed containers are rejected before any large allocation.
  const header = async () => { const b = new Uint8Array(await v2.arrayBuffer()); const n = new DataView(b.buffer).getUint32(31, true); return {b, n, json:JSON.parse(Buffer.from(b.subarray(35, 35 + n)).toString())}; };
  const withHeader = async change => { const {b, n, json} = await header(); change(json); const next = Buffer.from(JSON.stringify(json)), len = Buffer.alloc(4); len.writeUInt32LE(next.length); return new Blob([b.subarray(0, 31), len, next, b.subarray(35 + n)]); };
  assert.equal(await codeOf(ThingsBackup.read(await withHeader(h => { h.version = 3; }))), 'newer');
  assert.equal(await codeOf(ThingsBackup.read(await withHeader(h => { h.format = 'Other'; }))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(await withHeader(h => { h.books = 2; }))), 'invalid', 'count mismatch');
  assert.equal(await codeOf(ThingsBackup.read(await withHeader(h => { h.config.salt = 'AAAA'; }))), 'invalid', 'short salt');
  assert.equal(await codeOf(ThingsBackup.read(await mutate(v2, b => { new DataView(b.buffer).setUint32(31, 0xffffffff, true); }))), 'invalid', 'huge frame length');
  assert.equal(await codeOf(ThingsBackup.read(await mutate(v2, b => { b[40] = 0xff; }))), 'invalid', 'corrupt frame');
  assert.equal(await codeOf(ThingsBackup.read(new Blob(['not a backup']))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(new Blob([]))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(new Blob(['{"format":"ThingsBook encrypted backup","version":3}']))), 'newer');

  // Duplicate books and chunked books (reserved) are refused; a bad iv is invalid.
  const dup = {...lib, records:[lib.records[0], lib.records[0]]};
  assert.equal(await codeOf(ThingsBackup.read(await ThingsBackup.stream(dup.config, [lib.records[0].id, lib.records[0].id], async () => lib.records[0], created))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(ThingsBackup.legacy(dup.records, lib.config, created))), 'invalid');
  const one = {...lib, records:[lib.records[0]]}, single = await streamOf(one, created);
  const entry = async change => { const b = new Uint8Array(await single.arrayBuffer()); const h = new DataView(b.buffer).getUint32(31, true), at = 35 + h, n = new DataView(b.buffer).getUint32(at, true); const json = JSON.parse(Buffer.from(b.subarray(at + 4, at + 4 + n)).toString()); change(json); const next = Buffer.from(JSON.stringify(json)), len = Buffer.alloc(4); len.writeUInt32LE(next.length); return new Blob([b.subarray(0, at), len, next, b.subarray(at + 4 + n)]); };
  assert.equal(await codeOf(ThingsBackup.read(await entry(e => { e.file.segments.push({...e.file.segments[0]}); }))), 'newer');
  assert.equal(await codeOf(ThingsBackup.read(await entry(e => { e.file.segments[0].iv = 'AAAA'; }))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(await entry(e => { e.id = 'x'.repeat(101); }))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(await entry(e => { e.file.segments[0].size += 1; }))), 'invalid', 'size that disagrees with the file');

  // Android saves exports through MainActivity.beginTransfer, which accepts only listed types:
  // both backup versions must be on that list or Android backups fail.
  const fs = require('node:fs');
  const java = fs.readFileSync(path.join(root, 'outputs/ThingsBook/android/java/com/thingsbook/library/MainActivity.java'), 'utf8');
  const allowed = JSON.parse('[' + java.match(/beginTransfer[\s\S]*?Arrays\.asList\(([^)]*)\)\.contains\(mime\)/)[1] + ']');
  for (const blob of [v1, v2]) assert(allowed.includes(blob.type), `Android export allowlist is missing ${blob.type}`);

  // A book removed mid-backup stops the export instead of writing a partial library.
  assert.match(await codeOf(ThingsBackup.stream(lib.config, ['gone'], async () => undefined, created)), /changed while the backup/);

  // The whole app path in version 2: back up, lock, wrong password, restore, read the book.
  const app = spawnSync(process.execPath, [path.join(__dirname, 'verify-storage-1125.cjs')], {cwd:root, encoding:'utf8', env:{...process.env, THINGSBOOK_TEST_STREAM_BACKUP:'1'}});
  assert.equal(app.status, 0, (app.stdout + app.stderr).slice(-2000));

  if (process.env.THINGSBOOK_LARGE_BACKUP === '1') {
    const big = crypto.randomBytes(50 * 1024 * 1024), records = [];
    for (let i = 0; i < 9; i++) records.push({id:`large-${i}`, meta:lib.records[0].meta, file:{iv:crypto.getRandomValues(new Uint8Array(12)), data:big.buffer.slice(big.byteOffset, big.byteOffset + big.length)}});
    assert.equal(ThingsBackup.fitsLegacy(sizesOf(records), lib.config), false);
    const blob = await ThingsBackup.stream(lib.config, records.map(r => r.id), async id => records.find(r => r.id === id), created);
    assert(blob.size > 450 * 1024 * 1024, `size ${blob.size}`);
    const watchBig = tracked(blob), back = await ThingsBackup.read(watchBig);
    assert.equal(back.books.length, 9); assert(same(back.books[8].file.data, big));
    assert(Math.max(...watchBig.reads) <= big.length, 'one book per read');
    console.log(`PASS (large): ${(blob.size / 2 ** 20).toFixed(0)} MiB library streamed and restored; largest single read ${(Math.max(...watchBig.reads) / 2 ** 20).toFixed(0)} MiB.`);
  }
  console.log('PASS: version 1 unchanged and still restorable, version 2 streams past the string cap, byte-exact round trip, authenticated ciphertext, truncation/trailing/oversize/corrupt/newer/duplicate rejection, one-book-at-a-time reads, and the full app backup/restore path in version 2.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
