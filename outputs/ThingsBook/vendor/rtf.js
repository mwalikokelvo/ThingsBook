'use strict';
// Rich Text Format (.rtf: WordPad, TextEdit, Word, pandoc) is converted to EPUB at import, so the reader,
// search, narration, notes and backups work unchanged. Runs in the page; nothing in the file is run.
//
// A small reader for the parts of RTF that carry a book: paragraphs, headings (\outlinelevel or "heading N"
// styles), bold/italic/underline/strike/super/subscript, lists (bullet or number text before a tab),
// tables, hyperlinks (HYPERLINK fields), PNG/JPEG pictures, footnotes (gathered into a Notes chapter),
// \u Unicode, \'hh bytes in the document's or font's code page, and the title/author from \info.
// Fonts, colours, page layout, headers/footers, OLE objects and other destinations are skipped.
const ThingsRtf = (() => {
  const STYLE = 'table { border-collapse: collapse; margin: 1em 0; } td { border: 1px solid currentColor; padding: 0.25em 0.5em; vertical-align: top; }\n' +
    'img { max-width: 100%; height: auto; }\n.tb-notes li { margin-bottom: 0.5em; }\n';
  // Destinations whose content is not text of the book.
  const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata',
    'colorschememapping', 'latentstyles', 'datastore', 'mmathPr', 'pgdsctbl', 'operator', 'header', 'headerl', 'headerr', 'headerf', 'footer',
    'footerl', 'footerr', 'footerf', 'object', 'objdata', 'nonshppict', 'bkmkend', 'xe', 'tc', 'txe', 'private', 'revtbl', 'filetbl', 'userprops',
    'docvar', 'ftnsep', 'ftnsepc', 'ftncn', 'aftnsep', 'aftnsepc', 'aftncn', 'pnseclvl', 'pntxta', 'pntxtb', 'listpicture', 'wgrffmtfilter', 'info']);
  const CHARSETS = {0:1252, 77:10000, 128:932, 129:949, 134:936, 136:950, 161:1253, 162:1254, 163:1258, 177:1255, 178:1256, 186:1257, 204:1251, 222:874, 238:1250};
  const LABELS = {932:'shift_jis', 936:'gbk', 949:'euc-kr', 950:'big5', 10000:'macintosh', 874:'windows-874'};
  const decoders = new Map();
  function decoder(page) {
    const label = LABELS[page] || (page >= 1250 && page <= 1258 ? `windows-${page}` : 'windows-1252');
    if (!decoders.has(label)) { let d; try { d = new TextDecoder(label); } catch { d = new TextDecoder('windows-1252'); } decoders.set(label, d); }
    return decoders.get(label);
  }

  const isRtf = bytes => bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '{\\rtf';

  function parse(text) {
    const doc = document.implementation.createHTMLDocument('');
    const make = (tag, value) => { const el = doc.createElement(tag); if (value != null) el.textContent = value; return el; };
    const fonts = new Map(), styles = new Map(), info = {}, resources = [], notes = [];
    let codepage = 1252;
    const fresh = () => ({bold:false, italic:false, underline:false, strike:false, script:'', link:null, font:null, uc:1, dest:null, skip:false, field:null, note:null});
    let state = fresh(), stack = [], skipChars = 0, pending = [];
    // Paragraphs: {nodes, level, indent, table}
    const blocks = [];
    let para = {nodes:[], level:0, indent:0, style:null, intbl:false};
    let row = null, cell = [], table = null, styleNumber = null, fontNumber = null, pictHex = [], pictType = null;

    const pageOf = () => { const font = fonts.get(state.font); return font?.charset != null && CHARSETS[font.charset] ? CHARSETS[font.charset] : codepage; };
    const target = () => state.note ?? null;
    function emit(value) {
      if (!value) return;
      if (state.dest === 'pict') return;
      if (state.dest === 'fldinst') { state.field.inst += value; return; }
      if (state.dest === 'title' || state.dest === 'author' || state.dest === 'subject') { info[state.dest] = (info[state.dest] || '') + value; return; }
      if (state.dest === 'fontname') { const f = fonts.get(fontNumber); if (f) f.name = (f.name || '') + value; return; }
      if (state.dest === 'stylename') { const s = styles.get(styleNumber); if (s) s.name = (s.name || '') + value; return; }
      if (state.skip) return;
      let node = doc.createTextNode(value);
      const wrap = tag => { const el = doc.createElement(tag); el.append(node); node = el; };
      if (state.strike) wrap('s'); if (state.underline && !state.link) wrap('u'); if (state.italic) wrap('em'); if (state.bold) wrap('strong'); if (state.script) wrap(state.script);
      if (state.link) { const a = doc.createElement('a'); a.setAttribute('href', state.link); a.append(node); node = a; }
      (target() ? target().nodes : para.nodes).push(node);
    }
    function flushBytes() {
      if (!pending.length) return;
      const bytes = Uint8Array.from(pending); pending = [];
      emit(decoder(pageOf()).decode(bytes));
    }
    function addText(value) {
      for (let i = 0; i < value.length; i++) {
        if (skipChars > 0) { skipChars--; continue; }
        pending.push(value.charCodeAt(i) & 255);
      }
    }
    function endParagraph() {
      flushBytes();
      if (state.note) { state.note.nodes.push(doc.createTextNode(' ')); return; }
      const p = para;
      para = {nodes:[], level:p.level, indent:p.indent, style:p.style, intbl:p.intbl};
      if (p.intbl) { if (cell.length) cell.push(make('br')); cell.push(...p.nodes); return; }
      blocks.push({nodes:p.nodes, level:p.level || headingOf(p.style), indent:p.indent});
    }
    function headingOf(style) {
      const name = styles.get(style)?.name?.trim().replace(/;$/, '').toLowerCase() || '';
      const m = /^heading\s*([1-6])$/.exec(name);
      return m ? Number(m[1]) : name === 'title' ? 1 : 0;
    }
    function endCell() {
      flushBytes();
      if (para.nodes.length) { if (cell.length) cell.push(make('br')); cell.push(...para.nodes); para.nodes = []; }
      (row ??= []).push(cell); cell = [];
    }
    function endRow() {
      if (row?.length) { if (!table) { table = {rows:[]}; blocks.push({table}); } table.rows.push(row); }
      row = null; cell = [];
    }
    // Paragraph and table structure inside a skipped group (a page header, a comment) must not end or
    // reshape the paragraph of the book text around it.
    const STRUCTURE = new Set(['par', 'sect', 'page', 'line', 'pard', 'intbl', 'cell', 'nestcell', 'row', 'nestrow', 'outlinelevel', 'li', 'footnote', 'field', 'fldrslt']);
    function word(name, param, hasParam) {
      if (state.skip && STRUCTURE.has(name)) return;
      const on = !hasParam || param !== 0;
      switch (name) {
        case 'ansicpg': codepage = param; return;
        case 'mac': codepage = 10000; return;
        case 'pca': codepage = 850; return;
        case 'uc': state.uc = Math.max(0, param); return;
        case 'u': flushBytes(); emit(String.fromCodePoint(param < 0 ? param + 65536 : param)); skipChars = state.uc; return;
        case 'par': case 'sect': case 'page': endParagraph(); if (!para.intbl && table) table = null; return;
        case 'line': flushBytes(); (state.note ? state.note.nodes : para.nodes).push(make('br')); return;
        case 'tab': addText('\t'); return;
        case 'emdash': flushBytes(); emit('—'); return; case 'endash': flushBytes(); emit('–'); return;
        case 'lquote': flushBytes(); emit('‘'); return; case 'rquote': flushBytes(); emit('’'); return;
        case 'ldblquote': flushBytes(); emit('“'); return; case 'rdblquote': flushBytes(); emit('”'); return;
        case 'bullet': flushBytes(); emit('•'); return;
        case 'pard': flushBytes(); para.level = 0; para.indent = 0; para.style = null; para.intbl = false; return;
        case 'intbl': para.intbl = true; return;
        case 'cell': case 'nestcell': endCell(); return;
        case 'row': case 'nestrow': endRow(); return;
        case 'outlinelevel': para.level = Math.min(6, Math.max(0, param) + 1); return;
        case 's': if (state.dest === 'stylesheet' || state.dest === 'stylename') { styleNumber = param; styles.set(param, {name:''}); state.dest = 'stylename'; } else para.style = param; return;
        case 'li': para.indent = param; return;
        case 'f': flushBytes(); if (state.dest === 'fonttbl' || state.dest === 'fontname') { fontNumber = param; fonts.set(param, {}); state.dest = 'fontname'; } else state.font = param; return;
        case 'fcharset': { const f = fonts.get(fontNumber); if (f) f.charset = param; return; }
        case 'plain': flushBytes(); Object.assign(state, {bold:false, italic:false, underline:false, strike:false, script:''}); return;
        case 'b': flushBytes(); state.bold = on; return;
        case 'i': flushBytes(); state.italic = on; return;
        case 'ulnone': flushBytes(); state.underline = false; return;
        case 'strike': case 'striked': flushBytes(); state.strike = on; return;
        case 'super': flushBytes(); state.script = on ? 'sup' : ''; return;
        case 'sub': flushBytes(); state.script = on ? 'sub' : ''; return;
        case 'nosupersub': flushBytes(); state.script = ''; return;
        case 'pngblip': pictType = 'png'; return;
        case 'jpegblip': pictType = 'jpeg'; return;
        case 'field': state.field = {inst:''}; return;
        case 'fldrslt': { flushBytes(); const m = /HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(state.field?.inst || ''); const href = m?.[1]?.trim();
          if (href && /^(?:https?:|mailto:)/i.test(href)) state.link = href; return; }
        case 'footnote': flushBytes(); {
          const number = notes.length + 1, sup = make('sup'), a = make('a', String(number));
          a.setAttribute('href', `#tb-note-${number}`); a.id = `tb-ref-${number}`; sup.append(a);
          (para.nodes).push(sup); const note = {nodes:[]}; notes.push(note); state.note = note; return; }
      }
      if (name.startsWith('ul') && name !== 'ulnone') { flushBytes(); state.underline = !(hasParam && param === 0); }
    }

    const token = /\\([a-zA-Z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/y;
    let starred = false, i = 0;
    while (i < text.length) {
      token.lastIndex = i;
      const m = token.exec(text);
      if (!m) { i++; continue; }
      i = token.lastIndex;
      if (m[5] === '{') { flushBytes(); stack.push({...state}); starred = false; continue; }
      if (m[5] === '}') {
        flushBytes();
        // A picture ends when the group that opened it closes; inner groups (\*\picprop, \*\blipuid) do not end it.
        const endsPicture = state.dest === 'pict' && stack.at(-1)?.dest !== 'pict';
        if (endsPicture && pictType && pictHex.length) {
          const hex = pictHex.join('').replace(/[^0-9a-fA-F]/g, ''), data = new Uint8Array(hex.length >> 1);
          for (let j = 0; j < data.length; j++) data[j] = parseInt(hex.substr(j * 2, 2), 16);
          if (data.length && data.length <= 20 * 1024 * 1024) {
            const path = `res/img${resources.length}.${pictType === 'png' ? 'png' : 'jpg'}`;
            resources.push({path, type:pictType === 'png' ? 'image/png' : 'image/jpeg', data});
            const img = make('img'); img.setAttribute('src', path); img.setAttribute('alt', '');
            (stack.at(-1)?.note ? stack.at(-1).note.nodes : para.nodes).push(img);
          }
        }
        if (endsPicture) { pictHex = []; pictType = null; }
        const closingNote = state.note && !stack.at(-1)?.note;
        state = stack.pop() || fresh();
        if (closingNote) state.note = null;
        skipChars = 0;
        continue;
      }
      if (m[1]) {
        const name = m[1], hasParam = m[2] != null, param = hasParam ? Number(m[2]) : 0;
        if (name === 'bin') { i += Math.max(0, param); continue; }
        if (skipChars > 0 && name !== 'u') { skipChars--; continue; }
        const dest = name === 'pict' || name === 'fldinst' || name === 'title' || name === 'author' || name === 'subject' ? name : null;
        if (dest) { flushBytes(); state.dest = dest; if (dest === 'pict') { pictHex = []; pictType = null; } starred = false; continue; }
        if (name === 'fonttbl' || name === 'stylesheet') { flushBytes(); state.dest = name; state.skip = true; starred = false; continue; }
        // \info stays skipped as a whole; its \title, \author and \subject are read as destinations above.
        if (SKIP.has(name) || (starred && !['shppict', 'fldinst', 'bkmkstart', 'footnote'].includes(name))) { flushBytes(); state.skip = true; starred = false; continue; }
        if (name === 'bkmkstart') { flushBytes(); state.skip = true; starred = false; continue; }
        starred = false;
        word(name, param, hasParam);
        continue;
      }
      if (m[3]) { if (skipChars > 0) { skipChars--; continue; } if (state.dest === 'pict') continue; pending.push(parseInt(m[3], 16)); continue; }
      if (m[4]) {
        const c = m[4];
        if (c === '*') { starred = true; continue; }
        if (c === '\\' || c === '{' || c === '}') { addText(c); continue; }
        if (c === '~') { addText(' '); continue; }
        if (c === '_') { flushBytes(); emit('‑'); continue; }
        if (c === '\n' || c === '\r') { endParagraph(); continue; }
        continue; // \- optional hyphen, \: subentry and the like
      }
      if (m[6]) { if (state.dest === 'pict') { if (!state.skip) pictHex.push(m[6]); continue; } addText(m[6]); continue; }
    }
    flushBytes();
    if (para.nodes.length) endParagraph();
    if (row?.length) endRow();
    return {doc, blocks, info, resources, notes};
  }

  function build({doc, blocks, notes}) {
    const body = doc.body, make = (tag, value) => { const el = doc.createElement(tag); if (value != null) el.textContent = value; return el; };
    let list = null;
    for (const block of blocks) {
      if (block.table) {
        list = null;
        const table = make('table'), tbody = make('tbody');
        for (const row of block.table.rows) { const tr = make('tr'); for (const cell of row) { const td = make('td'); td.append(...cell); tr.append(td); } tbody.append(tr); }
        table.append(tbody); body.append(table); continue;
      }
      const holder = make('div'); holder.append(...block.nodes);
      const plain = holder.textContent;
      if (!plain.trim() && !holder.querySelector('img')) { list = null; continue; }
      if (block.level) { list = null; const h = make(`h${block.level}`); h.append(...holder.childNodes);
        for (const strong of [...h.querySelectorAll('strong')]) strong.replaceWith(...strong.childNodes);  // heading styles are bold anyway
        h.normalize(); body.append(h); continue; }
      // List items: a bullet or number, then a tab (or a space after a bullet), at the start of an indented paragraph.
      // Letters ("a.") only count before a tab, so an indented "A. Smith wrote" stays a paragraph.
      const marker = /^\s*(?:([•·▪◦‣o\-*])\s+|(\d{1,3}|[a-zA-Z])[.)]\t\s*|(\d{1,3})[.)]\s+(?=\S))/.exec(plain);
      if (marker && (block.indent > 0 || /\t/.test(plain.slice(0, 8)))) {
        const kind = marker[1] ? 'ul' : 'ol';
        if (!list || list.nodeName.toLowerCase() !== kind) { list = make(kind); body.append(list); }
        const li = make('li'); li.append(...holder.childNodes); strip(li, marker[0].length); list.append(li); continue;
      }
      list = null;
      const p = make('p'); p.append(...holder.childNodes); body.append(p);
    }
    for (const el of body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td')) for (const t of walk(el)) t.data = t.data.replace(/\t/g, ' ');
    if (notes.length) {
      body.append(make('h1', 'Notes'));
      const ol = make('ol'); ol.className = 'tb-notes';
      notes.forEach((note, index) => {
        const li = make('li'); li.id = `tb-note-${index + 1}`; li.append(...note.nodes);
        for (const t of walk(li)) t.data = t.data.replace(/^\s+/, '');
        const back = make('a', '↩'); back.setAttribute('href', `#tb-ref-${index + 1}`); li.append(' ', back); ol.append(li);
      });
      body.append(ol);
    }
    return body;
  }
  function* walk(el) { const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) yield n; }
  function strip(el, count) { for (const t of walk(el)) { if (count <= 0) break; const cut = Math.min(count, t.data.length); t.data = t.data.slice(cut); count -= cut; } }

  async function toEPUB(data, {zip = globalThis.ThingsArchiveLib, name = ''} = {}) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (!isRtf(bytes)) throw new Error('This is not an RTF document.');
    let text = '';
    for (let i = 0; i < bytes.length; i += 65536) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 65536));  // bytes as Latin-1; code pages applied per font
    const parsed = parse(text);
    const body = build(parsed);
    if (!body.textContent.trim() && !body.querySelector('img')) throw new Error('This RTF document has no readable text.');
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const title = (clean(parsed.info.title) || clean(body.querySelector('h1')?.textContent) || String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled').slice(0, 300);
    const {parts, toc} = ThingsEpubWriter.chapters(body, {fallback:title, stylesheets:['styles/rtf.css']});
    if (!parts.length) throw new Error('This RTF document has no readable text.');
    const resources = [{path:'styles/rtf.css', type:'text/css', data:STYLE}, ...parsed.resources];
    const epub = ThingsEpubWriter.build({title, authors:clean(parsed.info.author) ? [clean(parsed.info.author)] : [], description:clean(parsed.info.subject) || undefined, parts, resources, toc}, zip);
    return {epub, kind:'RTF', title, parts:parts.length, notes:parsed.notes.length};
  }

  return Object.freeze({toEPUB, isRtf, parse});
})();
if (typeof module !== 'undefined') module.exports = ThingsRtf;
