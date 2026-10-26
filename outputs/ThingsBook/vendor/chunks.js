'use strict';
// Chunked book files. UI-independent; no storage access here.
//
// A book is stored as fixed-size plaintext pieces, each sealed separately with
// AES-GCM. The book id, piece index and piece count are bound in as additional
// authenticated data, so pieces cannot be swapped between books, reordered,
// dropped or have the count edited without decryption failing.
//
// Stored piece:  {book, index, iv, data}   (IndexedDB "chunks" store, key [book, index])
// Book record:   {id, meta, chunks:{count, bytes}}   instead of {id, meta, file}
const ThingsChunks = (() => {
  const SIZE = 4 * 1024 * 1024;
  const encoder = new TextEncoder();
  const aad = (id, index, count) => encoder.encode(`ThingsBook chunk v1\n${id}\n${index}\n${count}`);
  const count = bytes => Math.max(1, Math.ceil(bytes / SIZE));
  const damaged = () => new Error('This book file is damaged or incomplete. Restore it from a backup.');

  async function seal(plain, key, id, index, total) {
    if (!key) throw new Error('Unlock your library before saving.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return {book:id, index, iv, data:await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad(id, index, total)}, key, plain)};
  }
  async function open(part, key, id, index, total) {
    if (!key) throw new Error('Unlock your library before reading.');
    if (!part || part.book !== id || part.index !== index) throw damaged();
    try { return await crypto.subtle.decrypt({name:'AES-GCM', iv:part.iv, additionalData:aad(id, index, total)}, key, part.data); }
    catch { throw damaged(); }
  }

  // source: ArrayBuffer, typed array or Blob. put(part) stores one piece; only one is held at a time.
  async function write(source, key, id, put) {
    const blob = typeof source.byteLength !== 'number' && typeof source.arrayBuffer === 'function';
    const bytes = blob ? source.size : source.byteLength, total = count(bytes);
    const view = blob ? null : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
    for (let index = 0; index < total; index++) {
      const start = index * SIZE, end = Math.min(bytes, start + SIZE);
      const plain = view ? view.subarray(start, end) : new Uint8Array(await source.slice(start, end).arrayBuffer());
      await put(await seal(plain, key, id, index, total));
      if (!view) plain.fill(0);
    }
    return {count:total, bytes};
  }

  // get(index) loads one stored piece. Returns decrypted pieces in order.
  async function read(record, key, get) {
    const {count:total, bytes} = record.chunks, pieces = [];
    let length = 0;
    for (let index = 0; index < total; index++) {
      const piece = await open(await get(index), key, record.id, index, total);
      length += piece.byteLength; pieces.push(piece);
    }
    if (length !== bytes) throw damaged();
    return pieces;
  }

  // Checks every piece of a record whose pieces are already in memory, e.g. from a backup.
  async function verify(record, parts, key) {
    if (!record.chunks || !Array.isArray(parts) || parts.length !== record.chunks.count) throw damaged();
    let length = 0;
    for (const [index, part] of parts.entries()) length += (await open(part, key, record.id, index, record.chunks.count)).byteLength;
    if (length !== record.chunks.bytes) throw damaged();
  }

  // Ciphertext size of a chunked record, as it would appear in a backup.
  const sealedBytes = chunks => chunks.bytes + 16 * chunks.count;
  const valid = chunks => !!chunks && Number.isInteger(chunks.count) && chunks.count >= 1 && Number.isInteger(chunks.bytes) && chunks.bytes >= 0 && chunks.count === count(chunks.bytes);

  return Object.freeze({SIZE, count, write, read, verify, sealedBytes, valid});
})();
if (typeof module !== 'undefined') module.exports = ThingsChunks;
