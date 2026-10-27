'use strict';
// Content fingerprints for spotting a book that is already in the library, whatever its file name.
// A fingerprint is a SHA-256 over the file's bytes: all of them up to 64 MiB ("f1:"), or for larger files
// (big PDFs) the size plus three 2 MiB samples from the start, middle and end ("s1:"), so a 500 MB PDF is
// never read whole. It is kept inside the book's encrypted details, like its title, and only compared on
// this device. A source is {size, read(begin, end) -> Uint8Array | ArrayBuffer}.
const ThingsFingerprint = (() => {
  const FULL = 64 * 1024 * 1024, SAMPLE = 2 * 1024 * 1024;
  const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
  const bytes = async (source, begin, end) => { const value = await source.read(begin, end); return value instanceof Uint8Array ? value : new Uint8Array(value); };

  async function of(source) {
    const size = Number(source?.size);
    if (!Number.isFinite(size) || size < 0) throw new Error('A fingerprint needs the file size.');
    if (size <= FULL) {
      const all = await bytes(source, 0, size);
      try { return 'f1:' + hex(await crypto.subtle.digest('SHA-256', all)); } finally { all.fill(0); }
    }
    const middle = Math.floor(size / 2 - SAMPLE / 2);
    const parts = [await bytes(source, 0, SAMPLE), await bytes(source, middle, middle + SAMPLE), await bytes(source, size - SAMPLE, size)];
    const header = new TextEncoder().encode(`ThingsBook sampled fingerprint\n${size}\n`);
    const joined = new Uint8Array(header.length + parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of [header, ...parts]) { joined.set(part, offset); offset += part.length; }
    try { return 's1:' + hex(await crypto.subtle.digest('SHA-256', joined)); } finally { joined.fill(0); for (const part of parts) part.fill(0); }
  }

  const ofFile = file => of({size:file.size, read:async (begin, end) => new Uint8Array(await file.slice(begin, end).arrayBuffer())});

  return Object.freeze({of, ofFile, FULL, SAMPLE});
})();
if (typeof module !== 'undefined') module.exports = ThingsFingerprint;
