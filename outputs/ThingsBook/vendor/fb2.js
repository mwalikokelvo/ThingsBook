'use strict';
// FictionBook (.fb2, and zipped .fb2.zip/.fbz) books are converted to EPUB at import time, so the
// existing EPUB reader, search, narration, notes and backups work unchanged. Parsing is foliate-js's
// (vendor/foliate-fb2.js); packaging is vendor/epub-writer.js. Runs in the page.
const ThingsFB2 = (() => {
  const XHTML = 'http://www.w3.org/1999/xhtml', XLINK = 'http://www.w3.org/1999/xlink';
  const LIMIT = 100 * 1024 * 1024;
  const extensions = {'image/jpeg':'jpg', 'image/jpg':'jpg', 'image/png':'png', 'image/gif':'gif', 'image/webp':'webp', 'image/svg+xml':'svg'};
  const failure = message => Object.assign(new Error(message), {code:'fb2'});

  // A zipped FictionBook holds exactly one .fb2 file.
  function unwrap(bytes, zip) {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return bytes;
    const files = zip.unzipSync(bytes, {filter:file => /\.fb2$/i.test(file.name) && file.originalSize <= LIMIT});
    const names = Object.keys(files);
    if (names.length !== 1) throw failure('This archive does not contain exactly one FB2 book.');
    return files[names[0]];
  }
  // Same encoding handling as foliate's parser: UTF-8 unless the XML declaration names another.
  function parse(bytes) {
    const text = new TextDecoder('utf-8').decode(bytes);
    const declared = text.match(/^\s*<\?xml\s+version\s*=\s*["']1.\d+["']\s+encoding\s*=\s*["']([A-Za-z0-9._-]*)["']/)?.[1];
    let decoded = text;
    if (declared && declared.toLowerCase() !== 'utf-8') { try { decoded = new TextDecoder(declared).decode(bytes); } catch { throw failure(`This FB2 book uses an unsupported text encoding (${declared}).`); } }
    const doc = new DOMParser().parseFromString(decoded, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'FictionBook') throw failure('This FB2 book could not be read. Its XML may be damaged.');
    return doc;
  }
  function dataBytes(src) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(src || '');
    if (!match) return null;
    const binary = atob(match[2].replace(/\s+/g, '')), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return {type:match[1].toLowerCase(), bytes};
  }

  async function toEPUB(data, {zip = globalThis.ThingsArchiveLib} = {}) {
    const bytes = unwrap(new Uint8Array(data), zip);
    const source = parse(bytes);
    let book;
    try { book = await ThingsFoliateFB2.makeFB2(new Blob([bytes])); } catch { throw failure('This FB2 book could not be read. Its XML may be damaged.'); }
    const resources = [{path:'styles/fb2.css', type:'text/css', data:ThingsFoliateFB2.STYLE_TEXT}];
    const images = new Map();
    const image = src => {
      if (images.has(src)) return images.get(src);
      const found = dataBytes(src), ext = found && extensions[found.type];
      const path = ext ? `res/img${images.size}.${ext}` : null;
      if (path) resources.push({path, type:found.type === 'image/jpg' ? 'image/jpeg' : found.type, data:found.bytes});
      images.set(src, path);
      return path;
    };

    // Sections (the main body split by section; each notes body is one section).
    const parts = [];
    for (const [index, section] of book.sections.entries()) {
      const doc = section.createDocument();
      if (doc.getElementsByTagName('parsererror').length) continue;
      for (const img of doc.querySelectorAll('img')) { const path = image(img.getAttribute('src')); if (path) img.setAttribute('src', path); else img.remove(); }
      parts.push({index, path:`part${index}.xhtml`, doc, title:doc.querySelector('.title, h1, h2, p')?.textContent.trim().slice(0, 120) || `Part ${parts.length + 1}`});
    }
    if (!parts.length) throw failure('This FB2 book has no readable text.');
    const byIndex = new Map(parts.map(part => [part.index, part]));
    let counter = 0;
    const target = href => {
      const resolved = book.resolveHref(href), part = byIndex.get(resolved?.index);
      if (!part) return null;
      const el = resolved.anchor?.(part.doc);
      if (!el) return part.path;
      if (!el.id) el.id = `tb-${++counter}`;
      return `${part.path}#${el.id}`;
    };
    for (const part of parts) for (const a of part.doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (href.startsWith('#')) { const local = target(href); if (local) a.setAttribute('href', local); else a.removeAttribute('href'); }
      else if (!/^(?:https?:|mailto:)/i.test(href)) a.removeAttribute('href');
    }
    const toc = (items = []) => items.map(item => ({label:item.label || 'Untitled', href:target(item.href) || parts[0].path, children:toc(item.subitems || [])}));

    // Serialize each section as XHTML with the FB2 stylesheet and no active content.
    for (const part of parts) {
      const doc = part.doc, head = doc.querySelector('head') || doc.documentElement.insertBefore(doc.createElementNS(XHTML, 'head'), doc.documentElement.firstChild);
      for (const link of head.querySelectorAll('link')) link.remove();
      const title = doc.createElementNS(XHTML, 'title'); title.textContent = part.title; head.prepend(title);
      const link = doc.createElementNS(XHTML, 'link'); link.setAttribute('rel', 'stylesheet'); link.setAttribute('type', 'text/css'); link.setAttribute('href', 'styles/fb2.css'); head.append(link);
      for (const el of doc.querySelectorAll('script, iframe, object, embed, form')) el.remove();
      for (const el of doc.getElementsByTagName('*')) for (const name of el.getAttributeNames()) if (/^on/i.test(name) || /^\s*javascript:/i.test(el.getAttribute(name))) el.removeAttribute(name);
      // The parsed document keeps its own XML declaration; serialize without it and write one.
      part.xhtml = '<?xml version="1.0" encoding="utf-8"?>\n' + new XMLSerializer().serializeToString(doc).replace(/^\s*<\?xml[^>]*\?>\s*/, '');
    }

    // Cover: the coverpage image's embedded binary.
    const coverRef = source.querySelector('coverpage image')?.getAttributeNS(XLINK, 'href') || source.querySelector('coverpage image')?.getAttribute('l:href');
    const binary = coverRef?.startsWith('#') ? [...source.getElementsByTagName('binary')].find(b => b.getAttribute('id') === coverRef.slice(1)) : null;
    const coverType = binary?.getAttribute('content-type')?.toLowerCase();
    if (binary && extensions[coverType] && coverType !== 'image/svg+xml') {
      const cover = dataBytes(`data:${coverType};base64,${binary.textContent}`);
      resources.push({path:`res/cover.${extensions[coverType]}`, type:coverType === 'image/jpg' ? 'image/jpeg' : coverType, data:cover.bytes, properties:'cover-image'});
    }

    const meta = book.metadata || {};
    const description = meta.description ? new DOMParser().parseFromString(`<!doctype html><body>${meta.description}`, 'text/html').body.textContent.trim() : '';
    const title = meta.title || 'Untitled';
    const epub = ThingsEpubWriter.build({title, authors:(meta.author || []).map(a => typeof a === 'string' ? a : a?.name).filter(Boolean), language:meta.language,
      publisher:meta.publisher, description, date:meta.published, identifier:meta.identifier ? `urn:thingsbook:fb2:${meta.identifier}` : undefined,
      parts:parts.map(({path, title, xhtml}) => ({path, title, xhtml})), resources, toc:toc(book.toc)}, zip);
    book.destroy?.();
    return {epub, kind:'FB2', title, parts:parts.length};
  }

  return Object.freeze({toEPUB});
})();
if (typeof module !== 'undefined') module.exports = ThingsFB2;
