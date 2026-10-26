'use strict';
// Word (.docx) books are converted to EPUB at import time, so the existing EPUB reader, search,
// narration, notes and backups work unchanged. Conversion uses mammoth.js (BSD-2-Clause,
// github.com/mwilliamson/mammoth.js), loaded only when a .docx is imported. Runs in the page.
const ThingsDocx = (() => {
  const SCRIPT = 'vendor/mammoth.browser.min.js';
  const types = {'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/bmp':'bmp', 'image/webp':'webp', 'image/svg+xml':'svg', 'image/tiff':'tif', 'image/x-emf':'emf', 'image/x-wmf':'wmf'};
  const shown = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml']);
  const STYLE = 'table { border-collapse: collapse; margin: 1em 0; } td, th { border: 1px solid currentColor; padding: 0.25em 0.5em; vertical-align: top; }\nimg { max-width: 100%; height: auto; }\n';
  let loading = null;

  function load() {
    if (globalThis.mammoth) return Promise.resolve(globalThis.mammoth);
    loading ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.onload = () => globalThis.mammoth ? resolve(globalThis.mammoth) : reject(new Error('The Word converter could not be loaded.'));
      script.onerror = () => { loading = null; script.remove(); reject(new Error('The Word converter could not be loaded.')); };
      document.head.append(script);
    });
    return loading;
  }

  // Title, authors and language from docProps/core.xml, when present.
  function properties(data, zip) {
    try {
      const files = zip.unzipSync(new Uint8Array(data), {filter:file => file.name === 'docProps/core.xml' && file.originalSize < 1024 * 1024});
      const text = new TextDecoder().decode(files['docProps/core.xml']);
      if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) return {};
      const doc = new DOMParser().parseFromString(text, 'application/xml'), value = name => [...doc.getElementsByTagName('*')].filter(n => n.localName === name).map(n => n.textContent.trim()).filter(Boolean);
      return {title:value('title')[0], authors:value('creator').flatMap(name => name.split(/\s*;\s*/)), language:value('language')[0], description:value('description')[0]};
    } catch { return {}; }
  }

  async function toEPUB(data, {zip = globalThis.ThingsArchiveLib, name = ''} = {}) {
    const mammoth = await load();
    const resources = [{path:'styles/docx.css', type:'text/css', data:STYLE}];
    const convertImage = mammoth.images.imgElement(async image => {
      const type = (image.contentType || '').toLowerCase();
      if (!shown.has(type)) return {src:'', alt:image.altText || 'Image (format not shown)'};
      const path = `res/img${resources.length}.${types[type]}`;
      resources.push({path, type, data:new Uint8Array(await image.read())});
      return {src:path, ...(image.altText ? {alt:image.altText} : {})};
    });
    let result;
    try { result = await mammoth.convertToHtml({arrayBuffer:data}, {convertImage}); }
    catch { throw new Error('This Word document could not be read. It may be damaged; try saving it again as .docx.'); }

    // Chapters start at each top-level heading; the table of contents uses h1 and h2.
    const body = new DOMParser().parseFromString(`<!doctype html><body>${result.value}</body>`, 'text/html').body;
    for (const img of body.querySelectorAll('img[src=""]')) img.replaceWith(Object.assign(body.ownerDocument.createElement('span'), {textContent:`[${img.getAttribute('alt')}]`}));
    for (const a of body.querySelectorAll('a[href]')) if (!/^(?:https?:|mailto:|#)/i.test(a.getAttribute('href'))) a.removeAttribute('href');
    const meta = properties(data, zip);
    const fallback = meta.title || String(name).replace(/\.[^.]+$/, '') || 'Untitled';
    const {parts, toc} = ThingsEpubWriter.chapters(body, {fallback, stylesheets:['styles/docx.css']});
    if (!parts.length) throw new Error('This Word document has no readable text.');
    const epub = ThingsEpubWriter.build({title:fallback, authors:meta.authors?.length ? meta.authors : [], language:meta.language, description:meta.description, parts, resources, toc}, zip);
    return {epub, kind:'DOCX', title:fallback, parts:parts.length, warnings:result.messages.filter(m => m.type === 'warning').length};
  }

  return Object.freeze({toEPUB, load});
})();
if (typeof module !== 'undefined') module.exports = ThingsDocx;
