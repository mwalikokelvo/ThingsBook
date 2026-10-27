'use strict';
// Content fingerprints for spotting a book that is already in the library, whatever its file name.
// "c1:" + SHA-256 over the file size and the SHA-256 of each 4 MiB piece, in order: every byte counts,
// yet the file is read one piece at a time, so a 500 MB PDF is never held in memory (imports promise at
// most 4 MiB per read). Uses the browser's native SHA-256. The fingerprint is kept inside the book's
// encrypted details, like its title, and only compared on this device.
// A source is {size, read(begin, end) -> Uint8Array | ArrayBuffer}.
const ThingsFingerprint = (() => {
  const PIECE = 4 * 1024 * 1024;
  const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');

  async function of(source) {
    const size = Number(source?.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('A fingerprint needs the file size.');
    const header = new TextEncoder().encode(`ThingsBook fingerprint v1\n${size}\n`);
    const count = Math.max(1, Math.ceil(size / PIECE));
    const digests = new Uint8Array(header.length + count * 32);
    digests.set(header);
    for (let index = 0; index < count; index++) {
      const begin = index * PIECE, end = Math.min(size, begin + PIECE);
      const value = await source.read(begin, end), bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      if (bytes.length !== end - begin) throw new Error('The file changed while it was being read.');
      try { digests.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), header.length + index * 32); } finally { bytes.fill(0); }
    }
    return 'c1:' + hex(await crypto.subtle.digest('SHA-256', digests));
  }

  const ofFile = file => of({size:file.size, read:async (begin, end) => new Uint8Array(await file.slice(begin, end).arrayBuffer())});

  return Object.freeze({of, ofFile, PIECE});
})();
if (typeof module !== 'undefined') module.exports = ThingsFingerprint;
