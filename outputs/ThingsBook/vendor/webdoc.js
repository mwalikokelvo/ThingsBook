'use strict';
// Saved web pages (.html, .htm, .xhtml) and Markdown (.md, .markdown) are converted to EPUB at import,
// so the reader, search, narration, notes and backups work unchanged. Runs in the page.
//
// Nothing in the file is run or fetched: HTML is parsed by DOMParser (an inert document), then rebuilt
// from an allowlist of reading elements and attributes. Scripts, styles, forms, frames and media are
// dropped; images are kept only when embedded in the file (data: URLs), others become their alt text,
// so opening the book never contacts a website. Markdown is rendered by marked (MIT,
// github.com/markedjs/marked), loaded only when a Markdown file is imported, and its output goes
// through the same allowlist.
const ThingsWebDoc = (() => {
  const SCRIPT = 'vendor/marked.umd.js';
  const STYLE = 'table { border-collapse: collapse; margin: 1em 0; } td, th { border: 1px solid currentColor; padding: 0.25em 0.5em; vertical-align: top; }\n' +
    'img { max-width: 100%; height: auto; }\npre { white-space: pre-wrap; overflow-wrap: anywhere; }\ncode, kbd, samp, pre { font-family: monospace; }\n' +
    'blockquote { margin: 1em 0 1em 1em; padding-left: 1em; border-left: 3px solid currentColor; }\nfigure { margin: 1em 0; }\n';
  const KEEP = new Set(('P BR HR H1 H2 H3 H4 H5 H6 BLOCKQUOTE PRE CODE KBD SAMP VAR EM STRONG I B U S DEL INS MARK SMALL SUB SUP Q CITE ' +
    'ABBR DFN TIME SPAN DIV SECTION ARTICLE MAIN HEADER FOOTER ASIDE ADDRESS FIGURE FIGCAPTION UL OL LI DL DT DD TABLE THEAD TBODY ' +
    'TFOOT TR TH TD CAPTION COLGROUP COL A IMG RUBY RT RP BDI BDO WBR DETAILS SUMMARY').split(' '));
  // Removed with everything inside them.
  const DROP = new Set(('SCRIPT STYLE LINK META BASE TITLE HEAD NOSCRIPT TEMPLATE IFRAME FRAME FRAMESET OBJECT EMBED APPLET FORM INPUT ' +
    'BUTTON SELECT TEXTAREA OPTION OPTGROUP DATALIST OUTPUT CANVAS VIDEO AUDIO SOURCE TRACK SVG MATH NAV DIALOG MAP AREA PORTAL SLOT').split(' '));
  const ATTRIBUTES = {'*':['id', 'lang', 'dir', 'title'], A:['href'], IMG:['src', 'alt'], TD:['colspan', 'rowspan'], TH:['colspan', 'rowspan', 'scope'],
    COL:['span'], COLGROUP:['span'], OL:['start', 'reversed', 'type'], LI:['value'], TIME:['datetime'], DETAILS:['open']};
  const IMAGES = {'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp', 'image/avif':'avif', 'image/bmp':'bmp'};
  const MAX_IMAGE = 20 * 1024 * 1024, MAX_IMAGES = 150 * 1024 * 1024;
  let loading = null;

  function load() {
    if (globalThis.marked?.parse) return Promise.resolve(globalThis.marked);
    loading ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.onload = () => globalThis.marked?.parse ? resolve(globalThis.marked) : reject(new Error('The Markdown converter could not be loaded.'));
      script.onerror = () => { loading = null; script.remove(); reject(new Error('The Markdown converter could not be loaded.')); };
      document.head.append(script);
    });
    return loading;
  }

  // Text from a byte-order mark, a declared charset (HTML), or UTF-8, falling back to windows-1252.
  function decode(bytes, html) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (html) {
      const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096));
      const label = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i)?.[1] || head.match(/^<\?xml[^>]+encoding\s*=\s*["']([\w:.-]+)/i)?.[1];
      if (label && !/^utf-?16/i.test(label)) try { return new TextDecoder(label).decode(bytes); } catch {}
    }
    try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
  }

  function bytesFromDataUrl(url) {
    const match = /^data:([\w.+-]+\/[\w.+-]+)((?:;[\w.+-]+=[^;,]*)*)(;base64)?,(.*)$/is.exec(url.trim());
    if (!match || !IMAGES[match[1].toLowerCase()]) return null;
    try {
      const body = match[4];
      if (!match[3]) return {type:match[1].toLowerCase(), data:new TextEncoder().encode(decodeURIComponent(body))};
      const binary = atob(body.replace(/\s+/g, ''));
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
      return {type:match[1].toLowerCase(), data};
    } catch { return null; }
  }

  // Rebuilds `source` (a node of an inert document) into `doc`, keeping only reading content.
  function clean(source, doc, resources, state) {
    const out = doc.createDocumentFragment();
    for (const node of source.childNodes) {
      if (node.nodeType === 3) { out.append(doc.createTextNode(node.data)); continue; }
      if (node.nodeType !== 1) continue;
      const tag = node.nodeName.toUpperCase();
      if (DROP.has(tag) || (state.chrome && /^(?:HEADER|FOOTER|ASIDE)$/.test(tag)) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') continue;
      if (!KEEP.has(tag)) { out.append(clean(node, doc, resources, state)); continue; } // unwrap, keep contents
      if (tag === 'IMG') {
        const image = bytesFromDataUrl(node.getAttribute('src') || '');
        const alt = (node.getAttribute('alt') || '').trim();
        if (image && image.data.length <= MAX_IMAGE && state.imageBytes + image.data.length <= MAX_IMAGES) {
          state.imageBytes += image.data.length;
          const path = `res/img${resources.length}.${IMAGES[image.type]}`;
          resources.push({path, type:image.type, data:image.data});
          const img = doc.createElement('img'); img.setAttribute('src', path); img.setAttribute('alt', alt);
          out.append(img);
        } else {
          state.missingImages++;
          if (alt) out.append(Object.assign(doc.createElement('span'), {textContent:`[${alt}]`}));
        }
        continue;
      }
      const el = doc.createElement(tag.toLowerCase());
      for (const name of [...ATTRIBUTES['*'], ...(ATTRIBUTES[tag] || [])]) {
        const value = node.getAttribute(name);
        if (value == null || value.length > 2000) continue;
        if (name === 'href' && !/^(?:https?:|mailto:|#)/i.test(value.trim())) continue;
        if (name === 'id' && !/^[A-Za-z_][\w.-]*$/.test(value)) continue;
        el.setAttribute(name, value);
      }
      el.append(clean(node, doc, resources, state));
      out.append(el);
    }
    return out;
  }

  // Unwraps lone wrapper elements so chapters can start at top-level headings.
  function flatten(body) {
    for (;;) {
      const elements = [...body.children], text = [...body.childNodes].some(n => n.nodeType === 3 && n.data.trim());
      if (elements.length !== 1 || text || !/^(?:DIV|SECTION|ARTICLE|MAIN|SPAN)$/.test(elements[0].nodeName.toUpperCase())) return;
      elements[0].replaceWith(...elements[0].childNodes);
    }
  }

  const meta = (doc, ...selectors) => {
    for (const selector of selectors) { const value = doc.querySelector(selector)?.getAttribute('content')?.trim(); if (value) return value; }
    return '';
  };

  // Simple YAML front matter: title, author(s), lang/language, description, date.
  function frontMatter(text) {
    const match = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    if (!match) return {meta:{}, body:text};
    const meta = {}, unquote = v => v.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    let list = null;
    for (const line of match[1].split(/\r?\n/)) {
      const item = /^\s+-\s+(.+)$/.exec(line);
      if (item && list) { meta[list].push(unquote(item[1])); continue; }
      const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!pair) continue;
      const key = pair[1].toLowerCase(), value = pair[2].trim();
      list = null;
      if (!value && (key === 'author' || key === 'authors')) { meta.authors = []; list = 'authors'; continue; }
      if (key === 'author' || key === 'authors') meta.authors = value.startsWith('[') ? value.slice(1, -1).split(',').map(unquote).filter(Boolean) : [unquote(value)];
      else if (['title', 'description', 'date', 'lang', 'language'].includes(key)) meta[key === 'lang' ? 'language' : key] = unquote(value);
    }
    return {meta, body:text.slice(match[0].length)};
  }

  async function toEPUB(data, {name = '', kind = /\.(?:md|markdown|mdown|mkd)$/i.test(name) ? 'MD' : 'HTML', zip = globalThis.ThingsArchiveLib} = {}) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let html, info = {};
    if (kind === 'MD') {
      const marked = await load();
      const {meta: front, body} = frontMatter(decode(bytes, false));
      info = front;
      try { html = marked.parse(body, {gfm:true, async:false}); }
      catch { throw new Error('This Markdown file could not be read.'); }
    } else html = decode(bytes, true);

    const source = new DOMParser().parseFromString(html, 'text/html');
    if (kind === 'HTML') {
      const authors = meta(source, 'meta[name="author" i]', 'meta[name="dc.creator" i]', 'meta[property="article:author"]', 'meta[name="byl" i]');
      info = {title:meta(source, 'meta[property="og:title"]', 'meta[name="twitter:title" i]') || source.title?.trim(),
        authors:authors && !/^https?:/i.test(authors) ? [authors.replace(/^by\s+/i, '')] : [],
        language:source.documentElement.getAttribute('lang') || '', description:meta(source, 'meta[name="description" i]', 'meta[property="og:description"]'),
        date:meta(source, 'meta[property="article:published_time"]', 'meta[name="date" i]')};
    }
    // The page's main content when it marks one; otherwise the whole body without site navigation.
    const articles = source.querySelectorAll('article');
    const root = articles.length === 1 ? articles[0] : source.querySelector('main, [role="main"]') || source.body;
    const out = document.implementation.createHTMLDocument('');
    const resources = [{path:'styles/web.css', type:'text/css', data:STYLE}], state = {imageBytes:0, missingImages:0, chrome:root === source.body && kind === 'HTML'};
    out.body.append(clean(root, out, resources, state));
    flatten(out.body);
    // Headings get GitHub-style ids ("## Neap tides" → #neap-tides) so in-document links work.
    const used = new Set([...out.body.querySelectorAll('[id]')].map(el => el.id));
    for (const heading of out.body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (heading.id) continue;
      const base = heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-').replace(/[^\w.-]/g, '');
      if (!/^[A-Za-z_]/.test(base)) continue;
      let id = base, n = 0;
      while (used.has(id)) id = `${base}-${++n}`;
      used.add(id); heading.id = id;
    }
    if (!out.body.textContent.trim() && !out.body.querySelector('img')) throw new Error(kind === 'MD' ? 'This Markdown file has no readable text.' : 'This web page has no readable text.');

    const fileTitle = String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const title = (info.title || out.body.querySelector('h1')?.textContent.trim() || fileTitle || 'Untitled').replace(/\s+/g, ' ').slice(0, 300);
    const {parts, toc} = ThingsEpubWriter.chapters(out.body, {fallback:title, stylesheets:['styles/web.css']});
    if (!parts.length) throw new Error('This document has no readable text.');
    const language = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(info.language || '') ? info.language : undefined;
    const epub = ThingsEpubWriter.build({title, authors:(info.authors || []).filter(Boolean).slice(0, 10), language, description:info.description,
      date:/^\d{4}(?:-\d\d(?:-\d\d)?)?/.exec(info.date || '')?.[0], parts, resources, toc}, zip);
    return {epub, kind, title, parts:parts.length, missingImages:state.missingImages};
  }

  return Object.freeze({toEPUB, load, decode, frontMatter});
})();
if (typeof module !== 'undefined') module.exports = ThingsWebDoc;
