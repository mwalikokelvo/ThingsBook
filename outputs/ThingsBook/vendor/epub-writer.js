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

  return Object.freeze({build, xhtml, escape});
})();
if (typeof module !== 'undefined') module.exports = ThingsEpubWriter;
