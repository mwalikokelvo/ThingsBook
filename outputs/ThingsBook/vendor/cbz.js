'use strict';
// Comic book archives (.cbz: a zip of page images, optionally with ComicInfo.xml) are converted to an
// EPUB with one page per image, in natural file-name order, so they open in the existing reader and
// travel in backups. Packaging is vendor/epub-writer.js. Runs in the page.
const ThingsComic = (() => {
  const IMAGES = {jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', avif:'image/avif'};
  const STYLE = 'body { margin: 0; text-align: center; }\nimg { max-width: 100%; max-height: 100vh; height: auto; }\n';
  const extension = name => name.split('.').pop().toLowerCase();
  const isPage = name => !name.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(name) && IMAGES[extension(name)];
  const order = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});

  // The archive's page images, or null when it is not a comic (anything else besides ComicInfo.xml).
  function pages(names) {
    const files = names.filter(name => !name.endsWith('/') && !/(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/i.test(name));
    const images = files.filter(isPage);
    if (!images.length || files.some(name => !isPage(name) && !/(^|\/)ComicInfo\.xml$/i.test(name))) return null;
    return images.sort(order.compare);
  }

  function info(bytes) {
    try {
      const text = new TextDecoder().decode(bytes);
      if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) return {};
      const doc = new DOMParser().parseFromString(text, 'application/xml'), value = name => doc.getElementsByTagName(name)[0]?.textContent.trim() || '';
      const series = value('Series'), number = value('Number');
      return {title:value('Title') || (series ? `${series}${number ? ` #${number}` : ''}` : ''), authors:value('Writer').split(/\s*,\s*/).filter(Boolean),
        description:value('Summary'), language:value('LanguageISO'), date:value('Year')};
    } catch { return {}; }
  }

  function toEPUB(data, {zip = globalThis.ThingsArchiveLib, name = ''} = {}) {
    const files = zip.unzipSync(new Uint8Array(data));
    const list = pages(Object.keys(files));
    if (!list) throw Object.assign(new Error('This archive is not a comic book: it should contain only page images.'), {code:'cbz'});
    const infoName = Object.keys(files).find(n => /(^|\/)ComicInfo\.xml$/i.test(n));
    const meta = infoName ? info(files[infoName]) : {};
    const title = meta.title || String(name).replace(/\.[^.]+$/, '') || 'Untitled comic';
    const resources = [{path:'styles/comic.css', type:'text/css', data:STYLE}], parts = [];
    for (const [index, page] of list.entries()) {
      const path = `pages/p${String(index + 1).padStart(4, '0')}.${extension(page)}`;
      resources.push({path, type:IMAGES[extension(page)], data:files[page], ...(index === 0 ? {properties:'cover-image'} : {})});
      parts.push({path:`page${index + 1}.xhtml`, title:`Page ${index + 1}`, xhtml:ThingsEpubWriter.xhtml(`Page ${index + 1}`, `<img src="${path}" alt="Page ${index + 1}"/>`, ['styles/comic.css'])});
    }
    const toc = [{href:parts[0].path, label:title, children:[]}];
    return {epub:ThingsEpubWriter.build({title, authors:meta.authors, language:meta.language, description:meta.description, date:meta.date, parts, resources, toc}, zip), kind:'CBZ', title, parts:parts.length};
  }

  return Object.freeze({toEPUB, pages});
})();
if (typeof module !== 'undefined') module.exports = ThingsComic;
