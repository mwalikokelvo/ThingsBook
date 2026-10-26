'use strict';
// Packages converted documents as a self-contained EPUB 3 (used by vendor/docx.js).
// Runs in the page (DOMParser, XMLSerializer); zips with fflate (ThingsArchiveLib).
const ThingsEpubWriter = (() => {
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const encoder = new TextEncoder();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

  // A well-formed XHTML document from an HTML body fragment, with active content removed.
  function xhtml(title, bodyHTML, stylesheets = []) {
    const source = new DOMParser().parseFromString(`<!doctype html><html><body>${bodyHTML}</body></html>`, 'text/html');
    const out = document.implementation.createDocument(XHTML, 'html', null);
    const head = out.createElementNS(XHTML, 'head'), heading = out.createElementNS(XHTML, 'title');
    heading.textContent = title; head.append(heading);
    for (const href of stylesheets) { const link = out.createElementNS(XHTML, 'link'); link.setAttribute('rel', 'stylesheet'); link.setAttribute('type', 'text/css'); link.setAttribute('href', href); head.append(link); }
    out.documentElement.append(head, out.importNode(source.body, true));
    for (const el of out.querySelectorAll('script, iframe, object, embed, form')) el.remove();
    for (const el of out.getElementsByTagName('*')) for (const name of el.getAttributeNames()) if (/^on/i.test(name) || /^\s*(?:javascript|vbscript|data:text\/html)/i.test(el.getAttribute(name))) el.removeAttribute(name);
    return '<?xml version="1.0" encoding="utf-8"?>\n' + new XMLSerializer().serializeToString(out);
  }

  // Splits an HTML body into EPUB parts: a new part starts at each top-level h1 that follows content,
  // and the table of contents lists h1 and h2. Internal "#id" links are pointed at the part holding
  // the id. Returns {parts:[{path, title, xhtml}], toc}.
  function chapters(body, {fallback = 'Untitled', stylesheets = []} = {}) {
    const doc = body.ownerDocument, chunks = [];
    for (const node of [...body.childNodes]) {
      if ((node.nodeName === 'H1' && chunks.at(-1)?.nodes.some(n => n.textContent.trim() || n.querySelector?.('img'))) || !chunks.length) chunks.push({nodes:[]});
      chunks.at(-1).nodes.push(node);
    }
    let anchor = 0;
    const parts = [], toc = [];
    for (const [index, chunk] of chunks.entries()) {
      const path = `part${index}.xhtml`, container = doc.createElement('div');
      container.append(...chunk.nodes);
      if (!container.textContent.trim() && !container.querySelector('img, table')) continue;
      for (const heading of container.querySelectorAll('h1, h2')) {
        if (!heading.id) heading.id = `tb-h${++anchor}`;
        const entry = {href:`${path}#${heading.id}`, label:heading.textContent.trim() || 'Untitled', children:[]};
        if (heading.nodeName === 'H2' && toc.length) toc.at(-1).children.push(entry); else toc.push(entry);
      }
      const title = container.querySelector('h1, h2')?.textContent.trim() || (parts.length ? `Part ${parts.length + 1}` : fallback);
      parts.push({path, title, xhtml:xhtml(title, container.innerHTML, stylesheets)});
    }
    const located = new Map();
    for (const part of parts) for (const id of part.xhtml.matchAll(/\sid="([^"]+)"/g)) located.set(id[1], part.path);
    for (const part of parts) part.xhtml = part.xhtml.replace(/href="#([^"]+)"/g, (all, id) => located.has(id) ? `href="${located.get(id)}#${id}"` : all);
    return {parts, toc};
  }

  // book: {title, authors[], language, publisher, description, date, identifier,
  //        parts:[{path, title, xhtml}], resources:[{path, type, data, properties}], toc:[{href, label, children}]}
  function build(book, zip = globalThis.ThingsArchiveLib) {
    if (!book.parts?.length) throw new Error('The converted book has no readable text.');
    const items = [], entries = {mimetype:[encoder.encode('application/epub+zip'), {level:0}]};
    const add = (path, type, data, properties) => { const id = `item${items.length}`; items.push({id, path, type, properties}); entries[`OEBPS/${path}`] = data instanceof Uint8Array ? data : encoder.encode(data); return id; };
    for (const resource of book.resources || []) add(resource.path, resource.type, resource.data, resource.properties);
    const spine = book.parts.map(part => add(part.path, 'application/xhtml+xml', part.xhtml));
    const list = nodes => nodes?.length ? `<ol>${nodes.map(n => `<li><a href="${escape(n.href)}">${escape(n.label || 'Untitled')}</a>${list(n.children)}</li>`).join('')}</ol>` : '';
    const toc = list(book.toc?.length ? book.toc : book.parts.map(part => ({href:part.path, label:part.title})));
    add('nav.xhtml', 'application/xhtml+xml', `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1>${toc}</nav></body></html>`, 'nav');
    const cover = items.find(item => item.properties === 'cover-image');
    const optional = (tag, value) => value ? `<dc:${tag}>${escape(value)}</dc:${tag}>` : '';
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${escape(book.identifier || `urn:uuid:${crypto.randomUUID()}`)}</dc:identifier><dc:title>${escape(book.title || 'Untitled')}</dc:title>${(book.authors || []).map(name => optional('creator', name)).join('')}
<dc:language>${escape(book.language || 'und')}</dc:language>${optional('publisher', book.publisher)}${optional('description', book.description)}${optional('date', book.date)}
${cover ? `<meta name="cover" content="${cover.id}"/>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata>
<manifest>${items.map(item => `<item id="${item.id}" href="${escape(item.path)}" media-type="${escape(item.type)}"${item.properties ? ` properties="${item.properties}"` : ''}/>`).join('')}</manifest>
<spine>${spine.map(id => `<itemref idref="${id}"/>`).join('')}</spine></package>`;
    entries['META-INF/container.xml'] = encoder.encode('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    entries['OEBPS/content.opf'] = encoder.encode(opf);
    return zip.zipSync(entries, {level:6});
  }

  return Object.freeze({build, xhtml, escape, chapters});
})();
if (typeof module !== 'undefined') module.exports = ThingsEpubWriter;
