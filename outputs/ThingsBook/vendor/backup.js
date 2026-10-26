'use strict';
// Encrypted backup containers. UI-independent; never decrypts anything.
//
// Version 1 is a single JSON document with base64 ciphertext. Browsers cap one
// string at ~512 Mi characters, so it cannot hold libraries over ~384 MB.
// It is still written whenever it fits, so older app versions can restore it.
//
// Version 2 streams: it is built and read one book at a time, so no single
// string or buffer ever holds the whole library.
//
//   "ThingsBook encrypted backup v2\n"
//   frame  header  {format, version:2, created, config, books:N}
//   N x  [frame  {id, meta, file:{segments:[{iv, size}]}}, then the raw ciphertext bytes of each segment]
//   frame  trailer {end:true, books:N}
//
// A frame is a 4-byte little-endian length followed by that many bytes of UTF-8 JSON.
// Ciphertext is AES-GCM sealed exactly as stored, so contents stay authenticated;
// the trailer and exact file length detect truncation.
const ThingsBackup = (() => {
  const FORMAT = 'ThingsBook encrypted backup';
  const MAGIC = 'ThingsBook encrypted backup v2\n';
  const LEGACY_LIMIT = 256 * 1024 * 1024; // JSON characters; half the browser string cap
  const MAX_FRAME = 32 * 1024 * 1024; // a book frame holds its sealed metadata, including a cover
  const MAX_SEGMENT = 1024 * 1024 * 1024;
  const MAX_BOOKS = 100000;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});

  function failure(code, message) { const error = new Error(message); error.code = code; return error; }
  const invalid = () => failure('invalid', 'This is not a valid ThingsBook encrypted backup.');
  const truncated = () => failure('truncated', 'This backup file is incomplete. Copy the whole file again and retry.');
  const newer = () => failure('newer', 'This backup was made by a newer ThingsBook. Update the app, then restore again.');

  function b64(buffer) { const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s); }
  function unb64(text) { if (typeof text !== 'string') throw invalid(); let s; try { s = atob(text); } catch { throw invalid(); } const result = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) result[i] = s.charCodeAt(i); return result; }
  const bytesOf = value => value instanceof Uint8Array ? value : new Uint8Array(value);
  const pack = record => ({iv:b64(record.iv), data:b64(record.data)});
  function unpack(record) {
    if (!record || typeof record.iv !== 'string' || typeof record.data !== 'string') throw invalid();
    const iv = unb64(record.iv), data = unb64(record.data);
    if (iv.length !== 12 || data.length < 16) throw invalid();
    return {iv, data:data.buffer};
  }
  const b64Length = n => 4 * Math.ceil(n / 3);

  function packConfig(config) {
    return {version:1, salt:b64(config.salt), check:pack(config.check), library:pack(config.library), ...(config.recovery ? {recovery:pack(config.recovery)} : {})};
  }
  function unpackConfig(value) {
    if (value?.version !== 1) throw invalid();
    const config = {version:1, salt:unb64(value.salt), check:unpack(value.check), library:unpack(value.library)};
    if (config.salt.length !== 16) throw invalid();
    if (value.recovery) config.recovery = unpack(value.recovery);
    return config;
  }
  function validId(id) { if (typeof id !== 'string' || !id.length || id.length > 100) throw invalid(); return id; }
  function finish(config, books) {
    if (new Set(books.map(b => b.id)).size !== books.length) throw invalid();
    return {config, books};
  }

  // sizes: [{id, meta, file}] ciphertext byte lengths. True when version 1 fits comfortably.
  function fitsLegacy(sizes, config, limit = LEGACY_LIMIT) {
    let chars = 400 + b64Length(config.salt.byteLength ?? config.salt.length);
    for (const record of [config.check, config.library, config.recovery]) if (record) chars += 40 + b64Length(12) + b64Length(record.data.byteLength);
    for (const size of sizes) {
      chars += 80 + String(size.id).length + 2 * b64Length(12) + b64Length(size.meta) + b64Length(size.file);
      if (chars > limit) return false;
    }
    return chars <= limit;
  }

  // Version 1, byte-for-byte the format earlier releases wrote.
  function legacy(records, config, created = new Date().toISOString()) {
    const payload = {format:FORMAT, version:1, created, config:packConfig(config), books:records.map(r => ({id:r.id, meta:pack(r.meta), file:pack(r.file)}))};
    return new Blob([JSON.stringify(payload)], {type:'application/json'});
  }

  function frame(value) {
    const json = encoder.encode(JSON.stringify(value));
    if (json.length > MAX_FRAME) throw new Error('A backup entry is too large.');
    const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, json.length, true);
    return [length, json];
  }

  // Version 2. load(id) returns one stored record; only one is held at a time.
  async function stream(config, ids, load, created = new Date().toISOString()) {
    let blob = new Blob([MAGIC, ...frame({format:FORMAT, version:2, created, config:packConfig(config), books:ids.length})]);
    for (const id of ids) {
      const record = await load(id);
      if (!record || record.id !== id) throw new Error('A book changed while the backup was being written. Try again.');
      const data = bytesOf(record.file.data);
      blob = new Blob([blob, ...frame({id, meta:pack(record.meta), file:{segments:[{iv:b64(record.file.iv), size:data.byteLength}]}}), data]);
    }
    return new Blob([blob, ...frame({end:true, books:ids.length})], {type:'application/octet-stream'});
  }

  async function readStream(file) {
    let position = MAGIC.length;
    const bytes = async (length) => {
      if (position + length > file.size) throw truncated();
      const view = new Uint8Array(await file.slice(position, position + length).arrayBuffer());
      if (view.length !== length) throw truncated();
      position += length; return view;
    };
    const next = async () => {
      const length = new DataView((await bytes(4)).buffer).getUint32(0, true);
      if (!length || length > MAX_FRAME) throw invalid();
      const raw = await bytes(length); // may report truncation
      let value; try { value = JSON.parse(decoder.decode(raw)); } catch { throw invalid(); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
      return value;
    };
    const header = await next();
    if (header.format !== FORMAT || !Number.isInteger(header.version)) throw invalid();
    if (header.version > 2) throw newer();
    if (header.version !== 2) throw invalid();
    const count = header.books;
    if (!Number.isInteger(count) || count < 0 || count > MAX_BOOKS) throw invalid();
    const config = unpackConfig(header.config), books = [];
    for (let i = 0; i < count; i++) {
      const entry = await next();
      const segments = entry.file?.segments;
      if (!Array.isArray(segments) || !segments.length) throw invalid();
      if (segments.length > 1) throw newer(); // reserved for chunked book storage
      const [segment] = segments, iv = unb64(segment.iv);
      if (iv.length !== 12 || !Number.isInteger(segment.size) || segment.size < 16 || segment.size > MAX_SEGMENT) throw invalid();
      const data = await bytes(segment.size);
      books.push({id:validId(entry.id), meta:unpack(entry.meta), file:{iv, data:data.buffer}});
    }
    const trailer = await next();
    if (trailer.end !== true || trailer.books !== count || position !== file.size) throw invalid();
    return finish(config, books);
  }

  function readLegacy(value) {
    if (value?.format !== FORMAT || !Number.isInteger(value.version)) throw invalid();
    if (value.version > 2) throw newer();
    if (value.version !== 1 || !Array.isArray(value.books)) throw invalid();
    const config = unpackConfig(value.config);
    return finish(config, value.books.map(r => ({id:validId(r?.id), meta:unpack(r.meta), file:unpack(r.file)})));
  }

  // Reads either version from a File or Blob.
  async function read(file) {
    if (!file || !(file.size > 0)) throw invalid();
    const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
    if (head.length === MAGIC.length && head.every((b, i) => b === MAGIC.charCodeAt(i))) return readStream(file);
    let first = 0; while (first < head.length && (head[first] === 0x20 || head[first] === 0x0a || head[first] === 0x0d || head[first] === 0x09)) first++;
    if (head[first] !== 0x7b) throw invalid(); // version 1 is a JSON object
    let value; try { value = JSON.parse(await file.text()); } catch { throw invalid(); }
    return readLegacy(value);
  }

  return Object.freeze({fitsLegacy, legacy, stream, read, MAGIC});
})();
if (typeof module !== 'undefined') module.exports = ThingsBackup;
