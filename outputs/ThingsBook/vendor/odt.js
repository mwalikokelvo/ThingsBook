'use strict';
// OpenDocument text (.odt: LibreOffice, OpenOffice, Google Docs, Word "OpenDocument") is converted to
// EPUB at import, so the reader, search, narration, notes and backups work unchanged. Runs in the page.
//
// The document's XML is read with DOMParser (no DTDs or entities) and the book is built element by
// element from what it means: headings, paragraphs, bold/italic/underline/super/subscript from the
// document's styles, lists, tables, links, images stored in the file and footnotes (collected into a
// "Notes" chapter). Generated tables of contents, comments and tracked deletions are left out.
// Password-protected documents are refused. Packaging is vendor/epub-writer.js.
const ThingsOdt = (() => {
  const NS = {
    office:'urn:oasis:names:tc:opendocument:xmlns:office:1.0', text:'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
    table:'urn:oasis:names:tc:opendocument:xmlns:table:1.0', draw:'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
    style:'urn:oasis:names:tc:opendocument:xmlns:style:1.0', fo:'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
    svg:'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', xlink:'http://www.w3.org/1999/xlink',
    meta:'urn:oasis:names:tc:opendocument:xmlns:meta:1.0', dc:'http://purl.org/dc/elements/1.1/',
  };
  const MIME = 'application/vnd.oasis.opendocument.text';
  const IMAGES = {png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp'};
  const STYLE = 'table { border-collapse: collapse; margin: 1em 0; } td, th { border: 1px solid currentColor; padding: 0.25em 0.5em; vertical-align: top; }\n' +
    'img { max-width: 100%; height: auto; }\n.tb-notes li { margin-bottom: 0.5em; }\n';
  const MAX_ENTRY = 60 * 1024 * 1024, MAX_TOTAL = 300 * 1024 * 1024, MAX_ENTRIES = 10000;
  const SKIP = new Set(['table-of-content', 'illustration-index', 'alphabetical-index', 'object-index', 'user-index', 'table-index', 'bibliography',
    'tracked-changes', 'soft-page-break', 'sequence-decls', 'variable-decls', 'user-field-decls', 'dde-connection-decls', 'note-citation']);
  const is = (node, ns, name) => node.nodeType === 1 && node.namespaceURI === NS[ns] && node.localName === name;
  const attr = (node, ns, name) => node.getAttributeNS(NS[ns], name);

  // The ODF mimetype member, read without extracting anything else.
  function isOdt(bytes, zip = globalThis.ThingsArchiveLib) {
    try { const files = zip.unzipSync(bytes, {filter:file => file.name === 'mimetype' && file.originalSize < 256}); return new TextDecoder().decode(files.mimetype || new Uint8Array()).trim() === MIME; }
    catch { return false; }
  }

  function parse(bytes) {
    const text = new TextDecoder().decode(bytes);
    if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw new Error('This OpenDocument file uses unsupported declarations.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This OpenDocument file is damaged; try saving it again.');
    return doc;
  }

  function unpack(data, zip) {
    let count = 0, total = 0;
    return zip.unzipSync(new Uint8Array(data), {filter:file => {
      if (++count > MAX_ENTRIES || file.originalSize > MAX_ENTRY || (total += file.originalSize) > MAX_TOTAL) throw new Error('This OpenDocument file is too large when unpacked.');
      if (file.name.includes('\\') || file.name.startsWith('/') || file.name.split('/').includes('..')) throw new Error('This OpenDocument file contains invalid file paths.');
      return /^(?:content|styles|meta)\.xml$|^META-INF\/manifest\.xml$|^Pictures\/[^/]+$/.test(file.name);
    }});
  }

  // Character and paragraph formatting from named and automatic styles, following parent styles.
  function styles(docs) {
    const table = new Map(), lists = new Map(), cache = new Map();
    for (const doc of docs) if (doc) {
      for (const el of doc.getElementsByTagNameNS(NS.style, 'style')) table.set(`${attr(el, 'style', 'family')}:${attr(el, 'style', 'name')}`, el);
      for (const el of doc.getElementsByTagNameNS(NS.text, 'list-style')) lists.set(attr(el, 'style', 'name'), el);
    }
    function resolve(family, name, depth = 0) {
      const key = `${family}:${name}`;
      if (!name || depth > 20) return {};
      if (cache.has(key)) return cache.get(key);
      const el = table.get(key);
      const result = el ? {...resolve(family, attr(el, 'style', 'parent-style-name'), depth + 1)} : {};
      if (el) {
        result.names = [...(result.names || []), name, attr(el, 'style', 'display-name')].filter(Boolean);
        const props = [...el.children].find(c => is(c, 'style', 'text-properties'));
        if (props) {
          const weight = attr(props, 'fo', 'font-weight'), slant = attr(props, 'fo', 'font-style'), underline = attr(props, 'style', 'text-underline-style');
          const through = attr(props, 'style', 'text-line-through-style'), position = attr(props, 'style', 'text-position');
          if (weight) result.bold = weight === 'bold' || Number(weight) >= 600;
          if (slant) result.italic = slant === 'italic' || slant === 'oblique';
          if (underline) result.underline = underline !== 'none';
          if (through) result.strike = through !== 'none';
          if (position) result.position = /^(?:super|[1-9])/.test(position) ? 'sup' : /^(?:sub|-)/.test(position) ? 'sub' : '';
        }
      }
      cache.set(key, result);
      return result;
    }
    return {text:name => resolve('text', name), paragraph:name => resolve('paragraph', name), list:name => lists.get(name)};
  }

  function metadata(doc) {
    if (!doc) return {};
    const value = (ns, name) => doc.getElementsByTagNameNS(NS[ns], name)[0]?.textContent.trim() || '';
    return {title:value('dc', 'title'), authors:[value('meta', 'initial-creator') || value('dc', 'creator')].filter(Boolean),
      language:value('dc', 'language'), description:value('dc', 'description'), date:(value('meta', 'creation-date') || value('dc', 'date')).slice(0, 10)};
  }

  async function toEPUB(data, {zip = globalThis.ThingsArchiveLib, name = ''} = {}) {
    const files = unpack(data, zip);
    if (files['META-INF/manifest.xml'] && new TextDecoder().decode(files['META-INF/manifest.xml']).includes('encryption-data'))
      throw new Error('This OpenDocument file is password-protected. Save a copy without a password, then import it.');
    if (!files['content.xml']) throw new Error('This OpenDocument file has no text content.');
    const content = parse(files['content.xml']);
    const style = styles([content, files['styles.xml'] && parse(files['styles.xml'])]);
    const meta = metadata(files['meta.xml'] && parse(files['meta.xml']));
    const out = document.implementation.createHTMLDocument('');
    const resources = [{path:'styles/odt.css', type:'text/css', data:STYLE}], pictures = new Map(), notes = [];
    const make = (tag, text) => { const el = out.createElement(tag); if (text != null) el.textContent = text; return el; };
    const safeId = value => (value = String(value || '').replace(/[^\w.-]+/g, '_')) && /^[A-Za-z_]/.test(value) ? value : value ? `b_${value}` : '';

    function wrap(node, formats) {
      let result = node;
      for (const [flag, tag] of [['strike', 's'], ['underline', 'u'], ['italic', 'em'], ['bold', 'strong']]) if (formats[flag]) { const el = make(tag); el.append(result); result = el; }
      if (formats.position) { const el = make(formats.position); el.append(result); result = el; }
      return result;
    }

    function image(frame) {
      const img = [...frame.children].find(c => is(c, 'draw', 'image'));
      const alt = [...frame.children].find(c => is(c, 'svg', 'title') || is(c, 'svg', 'desc'))?.textContent.trim() || attr(frame, 'draw', 'name') || '';
      const href = img && attr(img, 'xlink', 'href');
      const type = href && IMAGES[href.split('.').pop().toLowerCase()];
      if (href && type && files[href]) {
        if (!pictures.has(href)) { const path = `res/img${resources.length}.${href.split('.').pop().toLowerCase()}`; resources.push({path, type, data:files[href]}); pictures.set(href, path); }
        const el = make('img'); el.setAttribute('src', pictures.get(href)); el.setAttribute('alt', alt);
        return el;
      }
      return alt ? make('span', `[${alt}]`) : null;
    }

    // Inline content of a paragraph or span.
    function inline(node, target) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) { target.append(child.data); continue; }
        if (child.nodeType !== 1) continue;
        if (child.namespaceURI === NS.text) {
          const n = child.localName;
          if (n === 's') target.append(' '.repeat(Math.min(Number(attr(child, 'text', 'c')) || 1, 50)));
          else if (n === 'tab') target.append('\t');
          else if (n === 'line-break') target.append(make('br'));
          else if (n === 'span') { const holder = out.createDocumentFragment(); inline(child, holder); target.append(wrap(holder, style.text(attr(child, 'text', 'style-name')))); }
          else if (n === 'a') {
            const a = make('a'), href = (attr(child, 'xlink', 'href') || '').trim();
            if (/^(?:https?:|mailto:)/i.test(href)) a.setAttribute('href', href);
            else if (href.startsWith('#') && safeId(href.slice(1))) a.setAttribute('href', `#${safeId(href.slice(1))}`);
            inline(child, a); target.append(a);
          }
          else if (n === 'note') {
            const number = notes.length + 1, body = [...child.children].find(c => is(c, 'text', 'note-body'));
            const sup = make('sup'), a = make('a', String(number)); a.setAttribute('href', `#tb-note-${number}`); a.id = `tb-ref-${number}`; sup.append(a); target.append(sup);
            notes.push(body);
          }
          else if (n === 'bookmark' || n === 'bookmark-start') { const id = safeId(attr(child, 'text', 'name')); if (id) { const span = make('span'); span.id = id; target.append(span); } }
          else if (SKIP.has(n) || n === 'bookmark-end' || n.startsWith('change') || n === 'reference-mark-end') continue;
          else inline(child, target); // fields, sequences, references: their visible text
        } else if (is(child, 'draw', 'frame')) {
          const box = [...child.children].find(c => is(c, 'draw', 'text-box'));
          if (box) { const holder = out.createDocumentFragment(); blocks(box, holder, 0); target.append(...holder.childNodes); }
          else { const img = image(child); if (img) target.append(img); }
        } else if (is(child, 'draw', 'a')) inline(child, target);
      }
    }

    function paragraph(node, tag) {
      const formats = style.paragraph(attr(node, 'text', 'style-name'));
      const names = (formats.names || []).join(' ');
      if (tag === 'p' && /\bTitle\b/.test(names) && !/\bSubtitle\b/.test(names)) tag = 'h1';
      const el = make(tag); inline(node, el);
      if (tag === 'p' && (formats.bold || formats.italic)) { const holder = out.createDocumentFragment(); holder.append(...el.childNodes); el.append(wrap(holder, formats)); }
      if (tag !== 'p' && !el.textContent.trim()) return null;
      return el;
    }

    function list(node, depth, styleName) {
      styleName = attr(node, 'text', 'style-name') || styleName;
      const level = [...(style.list(styleName)?.children || [])].find(c => c.localName.startsWith('list-level-style') && Number(attr(c, 'text', 'level')) === depth + 1);
      const el = make(level?.localName === 'list-level-style-number' && attr(level, 'style', 'num-format') ? 'ol' : 'ul');
      for (const item of node.children) {
        if (!is(item, 'text', 'list-item') && !is(item, 'text', 'list-header')) continue;
        const li = make('li'); blocks(item, li, depth + 1, styleName);
        if (li.childNodes.length === 1 && li.firstChild.nodeName === 'P') li.firstChild.replaceWith(...li.firstChild.childNodes);
        el.append(li);
      }
      return el.children.length ? el : null;
    }

    function tableOf(node) {
      const el = make('table');
      let head = null;
      const body = make('tbody');
      const rows = (parent, into) => {
        for (const child of parent.children) {
          if (is(child, 'table', 'table-header-rows')) { head ??= make('thead'); rows(child, head); }
          else if (is(child, 'table', 'table-rows') || is(child, 'table', 'table-row-group')) rows(child, into);
          else if (is(child, 'table', 'table-row')) {
            const tr = make('tr');
            for (const cell of child.children) {
              if (!is(cell, 'table', 'table-cell')) continue;
              const td = make(into === head ? 'th' : 'td');
              const cols = Number(attr(cell, 'table', 'number-columns-spanned')) || 1, span = Number(attr(cell, 'table', 'number-rows-spanned')) || 1;
              if (cols > 1) td.setAttribute('colspan', String(Math.min(cols, 1000)));
              if (span > 1) td.setAttribute('rowspan', String(Math.min(span, 1000)));
              blocks(cell, td, 0);
              if (td.childNodes.length === 1 && td.firstChild.nodeName === 'P') td.firstChild.replaceWith(...td.firstChild.childNodes);
              const repeat = Math.min(Number(attr(cell, 'table', 'number-columns-repeated')) || 1, td.textContent.trim() ? 50 : 1);
              for (let i = 0; i < repeat; i++) tr.append(i ? td.cloneNode(true) : td);
            }
            // Spreadsheet-style trailing rows are often repeated thousands of times when empty.
            const repeat = Math.min(Number(attr(child, 'table', 'number-rows-repeated')) || 1, 100);
            if (tr.children.length && tr.textContent.trim()) for (let i = 0; i < repeat; i++) into.append(i ? tr.cloneNode(true) : tr);
          }
        }
      };
      rows(node, body);
      if (head) el.append(head);
      if (body.children.length) el.append(body);
      return el.querySelector('tr') ? el : null;
    }

    // Block content: headings, paragraphs, lists, tables, sections.
    function blocks(node, target, depth, listStyle) {
      for (const child of node.children) {
        let el = null;
        if (is(child, 'text', 'h')) el = paragraph(child, `h${Math.min(Math.max(Number(attr(child, 'text', 'outline-level')) || 1, 1), 6)}`);
        else if (is(child, 'text', 'p')) el = paragraph(child, 'p');
        else if (is(child, 'text', 'list')) el = list(child, depth, listStyle);
        else if (is(child, 'table', 'table')) el = tableOf(child);
        else if (is(child, 'text', 'section') || is(child, 'text', 'list-item')) { blocks(child, target, depth, listStyle); continue; }
        else if (is(child, 'draw', 'frame')) { const holder = make('p'); inline({childNodes:[child]}, holder); if (holder.childNodes.length) el = holder; }
        if (el) target.append(el);
      }
    }

    const body = content.getElementsByTagNameNS(NS.office, 'text')[0];
    if (!body) throw new Error('This OpenDocument file is not a text document.');
    blocks(body, out.body, 0);
    if (notes.length) {
      out.body.append(make('h1', 'Notes'));
      const ol = make('ol'); ol.className = 'tb-notes';
      for (const [index, note] of notes.entries()) {
        const li = make('li'); li.id = `tb-note-${index + 1}`;
        if (note) blocks(note, li, 0);
        const back = make('a', '↩'); back.setAttribute('href', `#tb-ref-${index + 1}`); (li.lastElementChild || li).append(' ', back);
        ol.append(li);
      }
      out.body.append(ol);
    }
    if (!out.body.textContent.trim() && !out.body.querySelector('img')) throw new Error('This OpenDocument file has no readable text.');

    const title = (meta.title || out.body.querySelector('h1')?.textContent.trim() || String(name).replace(/\.[^.]+$/, '') || 'Untitled').replace(/\s+/g, ' ').slice(0, 300);
    const {parts, toc} = ThingsEpubWriter.chapters(out.body, {fallback:title, stylesheets:['styles/odt.css']});
    if (!parts.length) throw new Error('This OpenDocument file has no readable text.');
    const language = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(meta.language || '') ? meta.language : undefined;
    const epub = ThingsEpubWriter.build({title, authors:meta.authors, language, description:meta.description, date:/^\d{4}-\d\d-\d\d$/.test(meta.date) ? meta.date : undefined, parts, resources, toc}, zip);
    return {epub, kind:'ODT', title, parts:parts.length, notes:notes.length};
  }

  return Object.freeze({toEPUB, isOdt, MIME});
})();
if (typeof module !== 'undefined') module.exports = ThingsOdt;
