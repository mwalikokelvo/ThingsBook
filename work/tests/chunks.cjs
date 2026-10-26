// Chunked book storage: pieces are bound to their book, position and count, round-trip exactly,
// and travel through backup version 2 piece by piece.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
globalThis.crypto ??= crypto.webcrypto;
const ThingsVault = require(path.join(root, 'outputs/ThingsBook/vendor/vault.js'));
const ThingsChunks = require(path.join(root, 'outputs/ThingsBook/vendor/chunks.js'));
const ThingsBackup = require(path.join(root, 'outputs/ThingsBook/vendor/backup.js'));
const enc = new TextEncoder();
const join = pieces => Buffer.concat(pieces.map(p => Buffer.from(new Uint8Array(p))));

async function store(source, key, id) {
  const parts = [];
  const chunks = await ThingsChunks.write(source, key, id, async part => { parts.push(structuredClone(part)); });
  return {record:{id, chunks}, parts};
}
const reader = parts => index => parts[index];

async function main() {
  const key = await ThingsVault.derive('Test-only chunk password', crypto.getRandomValues(new Uint8Array(16)));
  const SIZE = ThingsChunks.SIZE, plain = crypto.randomBytes(2 * SIZE + 3);

  // Piece count and exact round trip, from a buffer and from a Blob.
  const a = await store(plain, key, 'book-a');
  assert.deepEqual(a.record.chunks, {count:3, bytes:plain.length});
  assert.deepEqual(a.parts.map(p => p.index), [0, 1, 2]);
  assert.equal(new Uint8Array(a.parts[2].data).length, 3 + 16);
  assert(join(await ThingsChunks.read(a.record, key, reader(a.parts))).equals(plain));
  const fromBlob = await store(new Blob([plain]), key, 'book-blob');
  assert(join(await ThingsChunks.read(fromBlob.record, key, reader(fromBlob.parts))).equals(plain));
  assert.equal(ThingsChunks.sealedBytes(a.record.chunks), a.parts.reduce((n, p) => n + p.data.byteLength, 0));
  assert(!join(a.parts.map(p => p.data)).includes(plain.subarray(0, 64)), 'pieces are encrypted');

  // Boundaries: exactly one piece, an exact multiple, and an empty file.
  for (const [length, count] of [[1, 1], [SIZE, 1], [SIZE + 1, 2], [2 * SIZE, 2], [0, 1]]) {
    const s = await store(crypto.randomBytes(length), key, `edge-${length}`);
    assert.equal(s.record.chunks.count, count, `count for ${length}`);
    assert.equal(join(await ThingsChunks.read(s.record, key, reader(s.parts))).length, length);
    assert(ThingsChunks.valid(s.record.chunks));
  }
  assert(!ThingsChunks.valid({count:2, bytes:5}) && !ThingsChunks.valid({count:0, bytes:0}) && !ThingsChunks.valid(null));

  // Every kind of rearrangement fails authentication.
  const b = await store(crypto.randomBytes(SIZE + 10), key, 'book-b');
  const rejects = async (record, parts, why) => assert.rejects(ThingsChunks.read(record, key, reader(parts)), /damaged or incomplete/, why);
  await rejects(a.record, [a.parts[1], a.parts[0], a.parts[2]], 'reordered');
  await rejects(a.record, [{...a.parts[1], index:0}, {...a.parts[0], index:1}, a.parts[2]], 'reordered with relabelled indexes');
  await rejects(a.record, [{...b.parts[0], book:'book-a'}, a.parts[1], a.parts[2]], 'piece from another book');
  await rejects(a.record, [a.parts[0], a.parts[1]], 'missing last piece');
  await rejects({...a.record, chunks:{count:2, bytes:2 * SIZE}}, a.parts, 'count edited to drop a piece');
  await rejects({...a.record, chunks:{count:3, bytes:plain.length - 1}}, a.parts, 'length edited');
  await rejects({...a.record, id:'book-b'}, a.parts, 'record id changed');
  const flipped = structuredClone(a.parts); new Uint8Array(flipped[1].data)[5] ^= 1;
  await rejects(a.record, flipped, 'flipped byte');
  await assert.rejects(ThingsChunks.read(a.record, null, reader(a.parts)), /Unlock/);
  await ThingsChunks.verify(a.record, a.parts, key);
  await assert.rejects(ThingsChunks.verify(a.record, a.parts.slice(0, 2), key), /damaged/);
  const otherKey = await ThingsVault.derive('Another password', crypto.getRandomValues(new Uint8Array(16)));
  await assert.rejects(ThingsChunks.verify(a.record, a.parts, otherKey), /damaged/);

  // Backup version 2 carries chunked books piece by piece; version 1 refuses them.
  const config = {version:1, salt:crypto.getRandomValues(new Uint8Array(16)), check:await ThingsVault.seal(enc.encode('ThingsBook vault v1'), key), library:await ThingsVault.sealJSON([{id:'s', name:'Shelf'}], key)};
  const books = [];
  for (const s of [a, b]) books.push({...s.record, meta:await ThingsVault.sealJSON({id:s.record.id}, key), parts:s.parts});
  const whole = {id:'whole', meta:await ThingsVault.sealJSON({id:'whole'}, key), file:await ThingsVault.seal(enc.encode('old layout'), key)};
  books.push(whole);
  assert.throws(() => ThingsBackup.legacy(books, config), /version 2/);
  const backup = await ThingsBackup.stream(config, books.map(r => r.id), async id => books.find(r => r.id === id));
  const restored = await ThingsBackup.read(backup);
  assert.equal(restored.books.length, 3);
  const [ra, rb, rw] = restored.books;
  assert.deepEqual(ra.chunks, a.record.chunks); assert.equal(ra.parts.length, 3); assert.equal(ra.file, undefined);
  assert(join(await ThingsChunks.read(ra, key, reader(ra.parts))).equals(plain));
  await ThingsChunks.verify(rb, rb.parts, key);
  assert.equal(Buffer.from(await ThingsVault.unseal(rw.file, key)).toString(), 'old layout');
  assert.equal(rw.chunks, undefined);

  // A backup whose piece list disagrees with its declared size or count is refused.
  const editEntry = async change => {
    const bytes = new Uint8Array(await backup.arrayBuffer()), view = new DataView(bytes.buffer);
    const at = 35 + view.getUint32(31, true), n = view.getUint32(at, true);
    const entry = JSON.parse(Buffer.from(bytes.subarray(at + 4, at + 4 + n)).toString()); change(entry);
    const next = Buffer.from(JSON.stringify(entry)), len = Buffer.alloc(4); len.writeUInt32LE(next.length);
    return new Blob([bytes.subarray(0, at), len, next, bytes.subarray(at + 4 + n)]);
  };
  const codeOf = async p => { try { await p; } catch (e) { return e.code || e.message; } return 'resolved'; };
  assert.equal(await codeOf(ThingsBackup.read(await editEntry(e => { e.chunks.count = 2; }))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(await editEntry(e => { e.chunks.bytes += 1; }))), 'invalid');
  assert.equal(await codeOf(ThingsBackup.read(await editEntry(e => { e.chunks = 'x'; }))), 'invalid');
  await assert.rejects(ThingsBackup.stream(config, ['book-a'], async () => ({...books[0], parts:books[0].parts.slice(1)})), /incomplete/);

  // The app paths: new chunked library and an earlier-release library, each with both backup versions.
  for (const env of [{}, {THINGSBOOK_TEST_LEGACY_LIBRARY:'1'}, {THINGSBOOK_TEST_LEGACY_LIBRARY:'1', THINGSBOOK_TEST_STREAM_BACKUP:'1'}]) {
    const run = spawnSync(process.execPath, [path.join(__dirname, 'verify-storage-1125.cjs')], {cwd:root, encoding:'utf8', env:{...process.env, ...env}});
    assert.equal(run.status, 0, `${JSON.stringify(env)}\n${(run.stdout + run.stderr).slice(-2000)}`);
  }
  console.log('PASS: chunked books round-trip exactly (buffer and Blob, all size boundaries), reject reordered/swapped/missing/miscounted/tampered pieces and wrong keys, travel through backup version 2 alongside whole-file books, and the app works with new and earlier-release libraries.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
