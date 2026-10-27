'use strict';
// Tidies book titles and authors that came from download-site file names or library catalogue records:
// "One Nation Under Blackmail, Volume 2 (Whitney Webb)Trine Day 2022" becomes the title
// "One Nation Under Blackmail, Volume 2" by "Whitney Webb"; "DeBona, Guerric, 1955-" becomes
// "Guerric DeBona"; "Fulfilled in our hearing : history" loses the space before the colon.
// Used at import and once for books already in the library; details the reader edits are kept.
window.ThingsMetadata = (() => {
  const unknown = value => !value || /^unknown( author)?$/i.test(String(value).trim());
  const notAName = /\b(classics?|edition|press|series|vol(ume)?|book|books|library|collection|publishing|publishers?|editions?|reprint|anniversary|revised|annotated|illustrated|unabridged|abridged|translated|epub|pdf|kindle|ebook|z-lib|anna'?s|archive|isbn)\b/i;
  const looksLikeName = value => { const text = value.trim(); if (!text || text.length > 80 || /\d/.test(text) || notAName.test(text)) return false; const words = text.split(/[\s,&;]+/).filter(Boolean); return words.length >= 1 && words.length <= 9 && /[A-Za-zÀ-ɏ]/.test(text); };
  function author(value) {
    if (unknown(value)) return value;
    return String(value).split(/\s*;\s*/).map(name => {
      let text = name.replace(/\s*,?\s*\(?\b(1[0-9]|20)\d\d\s*-\s*((1[0-9]|20)\d\d)?\)?\.?\s*$/, '').replace(/\s*,\s*(author|editor|ed\.|trans\.|translator)\.?$/i, '').trim();
      const parts = text.split(/\s*,\s*/);
      if (parts.length === 2 && !/\s/.test(parts[0]) && parts[1] && !/^(jr|sr|ii|iii|iv|phd|md)\.?$/i.test(parts[1])) text = parts[1] + ' ' + parts[0];
      return text.replace(/\s+/g, ' ').trim();
    }).filter(Boolean).join('; ') || value;
  }
  function tidy({title, author: who} = {}) {
    let text = String(title || '').replace(/\s+/g, ' ').trim(), by = who;
    if (!text) return {title, author:who};
    text = text.replace(/\s*[([](?:z-lib(?:rary)?(?:\.\w+)*|libgen[^)\]]*|anna'?s archive|epub|pdf|mobi|azw3|retail|ebook)[)\]]\s*/gi, ' ').replace(/\s+--\s+anna'?s archive.*$/i, '').trim();
    // "Title (Author) Publisher Year" from download sites.
    const match = text.match(/^(.{3,}?)\s*\(([^()]{2,80})\)\s*([^()]{0,60}?)\s*$/);
    if (match && looksLikeName(match[2]) && (!match[3] || /\b(1[5-9]|20)\d\d$/.test(match[3]) || match[3].split(/\s+/).length <= 5)) {
      const named = author(match[2]);
      if (unknown(by) || named.toLowerCase() === String(by).toLowerCase() || String(by).toLowerCase().includes(named.toLowerCase().split(' ').pop())) { text = match[1]; if (unknown(by)) by = named; }
    }
    // Catalogue style: "Title : subtitle / by Author."
    text = text.replace(/\s+\/\s+(by\s+)?[^/]{2,80}$/i, match => (unknown(by) ? match : '')).replace(/\s+([:;,])/g, '$1').replace(/[.\s]+$/, m => (m.includes('.') && /\b[A-Z]\.$/.test(text) ? '.' : '')).trim();
    return {title:text || title, author:unknown(by) ? who : author(by)};
  }
  return {tidy, author};
})();
