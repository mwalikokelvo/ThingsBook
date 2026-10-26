'use strict';
// Kindle books (MOBI 6, KF8/AZW3 and combined MOBI files) are converted to a self-contained EPUB 3
// at import time, so the existing EPUB reader, search, narration, notes and backups work unchanged.
// Parsing is foliate-js's (vendor/foliate-mobi.js); zipping uses fflate (ThingsArchiveLib).
// Runs in the page (DOMParser, XMLSerializer). DRM-protected books are refused, never decrypted.
const ThingsKindle = (() => {
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const encoder = new TextEncoder();
  const resourcePattern = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/g;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const failure = message => Object.assign(new Error(message), {code:'kindle'});

  const extensions = {'image/jpeg':'jpg', 'image/png':'png', 'image/gif':'gif', 'image/bmp':'bmp', 'image/webp':'webp', 'image/svg+xml':'svg',
    'font/ttf':'ttf', 'font/otf':'otf', 'font/woff':'woff', 'font/woff2':'woff2', 'application/x-font-ttf':'ttf', 'application/x-font-otf':'otf',
    'application/vnd.ms-opentype':'otf', 'application/font-woff':'woff', 'text/css':'css', 'audio/mpeg':'mp3', 'video/mp4':'mp4'};
  function sniff(bytes) {
    const tag = String.fromCharCode(...bytes.subarray(0, 4));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes[0] === 0x89 && tag.slice(1) === 'PNG') return 'image/png';
    if (tag.startsWith('GIF')) return 'image/gif';
    if (tag.startsWith('BM')) return 'image/bmp';
    if (tag === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
    if (tag === 'OTTO') return 'font/otf';
    if (tag === 'wOFF') return 'font/woff';
    if (tag === 'wOF2') return 'font/woff2';
    if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return 'font/ttf';
    if (bytes[0] === 0x3c) return 'image/svg+xml';
    return 'application/octet-stream';
  }
  async function replaceAsync(text, pattern, replace) {
    const parts = []; let last = 0;
    for (const match of text.matchAll(pattern)) { parts.push(text.slice(last, match.index), await replace(match[0])); last = match.index + match[0].length; }
    parts.push(text.slice(last));
    return parts.join('');
  }

  // DRM is flagged in record 0 of the PalmDOC header; check before parsing anything else.
  async function protectedBook(file) {
    const head = new DataView(await file.slice(0, 86).arrayBuffer());
    if (head.byteLength < 86) return false;
    const record0 = head.getUint32(78);
    const palm = new DataView(await file.slice(record0, record0 + 16).arrayBuffer());
    return palm.byteLength >= 14 && palm.getUint16(12) !== 0;
  }

  function parseMarkup(text) {
    const parser = new DOMParser();
    let doc = parser.parseFromString(text, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.namespaceURI !== XHTML) doc = parser.parseFromString(text, 'text/html');
    return doc;
  }
  // A clean XHTML document for one section: head title and stylesheets, then the original body.
  function serialize(doc, title, stylesheets) {
    const out = document.implementation.createDocument(XHTML, 'html', null);
    const html = out.documentElement, head = out.createElementNS(XHTML, 'head'), heading = out.createElementNS(XHTML, 'title');
    heading.textContent = title; head.append(heading);
    for (const href of stylesheets) { const link = out.createElementNS(XHTML, 'link'); link.setAttribute('rel', 'stylesheet'); link.setAttribute('type', 'text/css'); link.setAttribute('href', href); head.append(link); }
    for (const style of doc.querySelectorAll('head style')) { const copy = out.createElementNS(XHTML, 'style'); copy.textContent = style.textContent; head.append(copy); }
    html.append(head, out.importNode(doc.body || doc.querySelector('body') || out.createElementNS(XHTML, 'body'), true));
    // Books carry no active content.
    for (const el of out.querySelectorAll('script, iframe, object, embed')) el.remove();
    for (const el of out.getElementsByTagName('*')) for (const name of el.getAttributeNames()) if (/^on/i.test(name) || /^\s*javascript:/i.test(el.getAttribute(name))) el.removeAttribute(name);
    return '<?xml version="1.0" encoding="utf-8"?>\n' + new XMLSerializer().serializeToString(out);
  }

  async function toEPUB(input, {zip = globalThis.ThingsArchiveLib} = {}) {
    const file = input instanceof Blob ? input : new Blob([input]);
    if (!await ThingsFoliateMobi.isMOBI(file)) throw failure('This is not a Kindle (MOBI or AZW3) book.');
    if (await protectedBook(file)) throw failure('This Kindle book is DRM-protected. ThingsBook only opens DRM-free books; use a copy without DRM.');
    const mobi = new ThingsFoliateMobi.MOBI({unzlib:zip.unzlibSync});
    let book;
    try { book = await mobi.open(file); } catch { throw failure('This Kindle book could not be read. It may be damaged or use an unsupported variant.'); }
    const kf8 = typeof book.loadFlow === 'function';

    const files = new Map(), manifest = [], cache = new Map();
    let counter = 0;
    const add = (path, type, data, properties) => { files.set(`OEBPS/${path}`, data instanceof Uint8Array ? data : encoder.encode(data)); manifest.push({id:`item${manifest.length}`, path, type, properties}); return path; };

    // Resources: paths are relative to OEBPS (where the sections live); stylesheets sit in styles/.
    async function embedded(index, mime) {
      const key = `embed:${index}`;
      if (!cache.has(key)) cache.set(key, (async () => {
        const bytes = new Uint8Array(await mobi.loadResource(index));
        const type = mime && extensions[mime] ? mime : sniff(bytes);
        return add(`res/r${index}.${extensions[type] || 'bin'}`, type, bytes);
      })());
      return cache.get(key);
    }
    async function kindleResource(uri) {
      const [, kind, id, mime] = uri.match(new RegExp(resourcePattern.source));
      const index = parseInt(id, 32);
      if (kind === 'embed') return embedded(index - 1, mime);
      const key = `flow:${index}`;
      if (!cache.has(key)) cache.set(key, (async () => {
        const raw = await book.loadFlow(index);
        let text = mobi.decode(raw);
        if (mime === 'text/css' || !mime) {
          text = await replaceAsync(text, resourcePattern, async inner => `../${await kindleResource(inner)}`);
          return add(`styles/flow${index}.css`, 'text/css', text);
        }
        text = await replaceAsync(text, resourcePattern, async inner => `../${await kindleResource(inner)}`);
        return add(`res/flow${index}.${extensions[mime] || 'xml'}`, mime, text);
      })());
      return cache.get(key);
    }

    // Sections. KF8 marks some sections non-linear without content; those are skipped.
    const parts = [];
    const mobiStyle = kf8 ? [] : [add('styles/mobi.css', 'text/css', 'blockquote { margin-block: 0; margin-inline: 1em 0; }\nimg { max-width: 100%; }\n')];
    for (const [index, section] of book.sections.entries()) {
      if (typeof section.loadText !== 'function') continue;
      let text = await section.loadText();
      if (kf8) text = await replaceAsync(text, resourcePattern, kindleResource);
      const doc = parseMarkup(text.replace(/<\s*(?:mbp:)?pagebreak[^>]*>/gi, ''));
      if (!kf8) {
        for (const img of doc.querySelectorAll('img[recindex]')) { try { img.setAttribute('src', await embedded(Number(img.getAttribute('recindex')) - 1)); } catch { img.remove(); } img.removeAttribute('recindex'); }
        for (const media of doc.querySelectorAll('[mediarecindex]')) media.remove();
      }
      parts.push({index, path:`part${index}.xhtml`, doc, title:doc.querySelector('h1, h2, h3, title')?.textContent?.trim() || `Part ${parts.length + 1}`});
    }
    if (!parts.length) throw failure('This Kindle book has no readable text.');
    const byIndex = new Map(parts.map(part => [part.index, part]));

    // Internal links and the table of contents point at a part and, when found, an element id.
    async function target(href) {
      let resolved;
      try { resolved = kf8 ? await book.resolveHref(href) : book.resolveHref(href); } catch { return null; }
      const part = byIndex.get(resolved?.index);
      if (!part) return null;
      const el = resolved.anchor?.(part.doc);
      if (!el) return part.path;
      if (!el.id) el.id = `tb-${++counter}`;
      return `${part.path}#${el.id}`;
    }
    for (const part of parts) {
      for (const a of part.doc.querySelectorAll('a[href^="kindle:pos"], a[filepos]')) {
        const href = a.hasAttribute('filepos') ? `filepos:${a.getAttribute('filepos')}` : a.getAttribute('href');
        const local = await target(href);
        if (local) a.setAttribute('href', local); else a.removeAttribute('href');
        a.removeAttribute('filepos');
      }
    }
    async function navList(items) {
      const entries = [];
      for (const item of items || []) {
        const href = item.href ? await target(item.href) : null, children = await navList(item.subitems);
        const label = escape(item.label?.trim() || 'Untitled');
        entries.push(`<li>${href ? `<a href="${escape(href)}">${label}</a>` : `<span>${label}</span>`}${children}</li>`);
      }
      return entries.length ? `<ol>${entries.join('')}</ol>` : '';
    }
    const toc = await navList(book.toc) || `<ol>${parts.map(part => `<li><a href="${part.path}">${escape(part.title)}</a></li>`).join('')}</ol>`;

    // Package.
    const meta = book.metadata || {}, title = meta.title || 'Untitled';
    for (const part of parts) {
      const own = [...part.doc.querySelectorAll('link[href]')].filter(link => /stylesheet/i.test(link.getAttribute('rel') || '') || /\.css$/i.test(link.getAttribute('href'))).map(link => link.getAttribute('href'));
      add(part.path, 'application/xhtml+xml', serialize(part.doc, part.title, [...mobiStyle, ...own.filter(href => files.has(`OEBPS/${href}`))]));
    }
    add('nav.xhtml', 'application/xhtml+xml', `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1>${toc}</nav></body></html>`, 'nav');
    let coverId = '';
    try {
      const cover = await book.getCover?.();
      if (cover) { const bytes = new Uint8Array(await cover.arrayBuffer()), type = sniff(bytes); if (type.startsWith('image/')) { add(`res/cover.${extensions[type]}`, type, bytes, 'cover-image'); coverId = manifest.at(-1).id; } }
    } catch { /* a book without a usable cover still imports */ }
    const authors = (Array.isArray(meta.author) ? meta.author : meta.author ? [meta.author] : []).map(name => `<dc:creator>${escape(name)}</dc:creator>`).join('');
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:thingsbook:kindle:${escape(meta.identifier || 'unknown')}</dc:identifier><dc:title>${escape(title)}</dc:title>${authors}
<dc:language>${escape(meta.language || 'und')}</dc:language>${meta.publisher ? `<dc:publisher>${escape(meta.publisher)}</dc:publisher>` : ''}${meta.description ? `<dc:description>${escape(meta.description)}</dc:description>` : ''}${meta.published ? `<dc:date>${escape(meta.published)}</dc:date>` : ''}
${coverId ? `<meta name="cover" content="${coverId}"/>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata>
<manifest>${manifest.map(item => `<item id="${item.id}" href="${escape(item.path)}" media-type="${escape(item.type)}"${item.properties ? ` properties="${item.properties}"` : ''}/>`).join('')}</manifest>
<spine>${parts.map(part => `<itemref idref="${manifest.find(item => item.path === part.path).id}"/>`).join('')}</spine></package>`;
    const entries = {mimetype:[encoder.encode('application/epub+zip'), {level:0}],
      'META-INF/container.xml':encoder.encode('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
      'OEBPS/content.opf':encoder.encode(opf)};
    for (const [path, data] of files) entries[path] = data;
    book.destroy?.();
    return {epub:zip.zipSync(entries, {level:6}), kind:kf8 ? 'AZW3' : 'MOBI', title, parts:parts.length};
  }

  return Object.freeze({toEPUB});
})();
if (typeof module !== 'undefined') module.exports = ThingsKindle;
