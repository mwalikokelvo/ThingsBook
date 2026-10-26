'use strict';
/* Read embedded metadata locally. Never resolve URLs or execute book markup. */
window.ThingsImport = (() => {
  const clean = (value, limit = 200) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  function member(data, name, limit) {
    let count = 0, total = 0;
    const files = ThingsArchiveLib.unzipSync(new Uint8Array(data), {filter: entry => {
      if (++count > 6000 || entry.originalSize > 40 * 1024 * 1024 || (total += entry.originalSize) > 180 * 1024 * 1024)
        throw new Error('This EPUB is too large when unpacked.');
      if (entry.name.includes('\\') || entry.name.startsWith('/') || entry.name.split('/').includes('..'))
        throw new Error('This EPUB contains invalid file paths.');
      if (entry.name !== name) return false;
      if (entry.originalSize > limit) throw new Error('The embedded metadata or cover is too large.');
      return true;
    }});
    const bytes = files[name];
    if (!bytes) throw new Error('Embedded book details are missing.');
    return bytes;
  }
  function format(name,data){
    const bytes=new Uint8Array(data),extension=String(name).split('.').pop().toLowerCase();
    if(new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))return 'PDF'
    // Kindle (MOBI 6, KF8/AZW3, combined): PalmDB type/creator 'BOOKMOBI'; converted to EPUB on import.
    if(bytes.length>68&&String.fromCharCode(...bytes.subarray(60,68))==='BOOKMOBI')return 'MOBI';
    // FictionBook (FB2): an XML book whose root element is <FictionBook>; converted to EPUB on import.
    {const start=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?3:0;if(/^\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<FictionBook[\s>]/.test(String.fromCharCode(...bytes.subarray(start,start+4096))))return 'FB2';}
    if(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4){
      let container;
      try{container=member(data,'META-INF/container.xml',1024*1024);const doc=xml(container);if([...doc.getElementsByTagName('*')].some(n=>n.localName==='rootfile'&&n.getAttribute('full-path')))return 'EPUB';}
      catch{}
      finally{container?.fill(0);}
      // Word (.docx): converted to EPUB on import.
      let types;
      try{types=member(data,'[Content_Types].xml',1024*1024);if(new TextDecoder().decode(types).includes('wordprocessingml.document.main+xml'))return 'DOCX';}
      catch{}
      finally{types?.fill(0);}
      // Zipped FictionBook (.fb2.zip, .fbz): exactly one .fb2 inside. Names are listed without extracting.
      try{const names=[];ThingsArchiveLib.unzipSync(bytes,{filter:file=>{names.push(file.name);return false;}});if(names.filter(n=>/\.fb2$/i.test(n)).length===1)return 'FB2';}catch{}
      throw new Error('This file does not appear to be an EPUB archive.');
    }
    // Compound File (legacy .doc, or an encrypted .docx): not readable without Word.
    if(bytes.length>8&&[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((b,i)=>bytes[i]===b))throw new Error('Older Word (.doc) files and password-protected Word documents are not supported. Save it as a .docx without a password, then import it.');
    if(extension==='pdf')throw new Error('This file does not appear to be a valid PDF.');
    if(extension==='epub')throw new Error('This file does not appear to be an EPUB archive.');
    if(extension==='txt')return 'TXT';
    throw new Error('Choose PDF, EPUB or TXT books, or DRM-free Kindle (MOBI/AZW3) Word (.docx) and FictionBook (.fb2) books; the file contents were not recognized.');
  }
  function xml(bytes) {
    const text = ReaderCore.decodeText(bytes);
    if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw new Error('Unsupported metadata declarations.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Embedded book details are damaged.');
    return doc;
  }
  async function epub(data, convertCover) {
    const buffers = [];
    const read = (name, limit) => {const bytes = member(data, name, limit); buffers.push(bytes); return bytes;};
    try {
      const container = xml(read('META-INF/container.xml', 1024 * 1024));
      const root = [...container.getElementsByTagName('*')].find(n => n.localName === 'rootfile');
      const path = ReaderCore.cleanPath('', root?.getAttribute('full-path') || '');
      if (!path) throw new Error('The EPUB package is invalid.');
      const doc = xml(read(path, 2 * 1024 * 1024));
      if (doc.documentElement.localName !== 'package') throw new Error('The EPUB package is invalid.');
      const nodes = [...doc.getElementsByTagName('*')];
      const metadata = nodes.find(n => n.localName === 'metadata');
      if (!metadata) throw new Error('Embedded book details are missing.');
      const fields = [...metadata.children];
      const values = name => fields.filter(n => n.localName === name && (!n.namespaceURI || n.namespaceURI === 'http://purl.org/dc/elements/1.1/')).map(n => clean(n.textContent)).filter(Boolean);
      const meta = fields.filter(n => n.localName === 'meta');
      const property = (name, legacy) => meta.find(n => n.getAttribute('property') === name) || meta.find(n => n.getAttribute('name') === legacy);
      const field = node => clean(node?.getAttribute('content') || node?.textContent);
      const date = values('date')[0] || '', year = date.match(/^(\d{4})(?:-|$)/)?.[1];
      const result = {title: values('title')[0] || '', author: clean(values('creator').join(', ')),
        series: field(property('belongs-to-collection', 'calibre:series')),
        seriesNumber: field(property('group-position', 'calibre:series_index')),
        year: year ? Number(year) : null, language: values('language')[0] || '', cover: null, warnings: []};
      const legacyCover = meta.find(n => n.getAttribute('name') === 'cover')?.getAttribute('content');
      const cover = nodes.find(n => n.localName === 'item' && n.getAttribute('properties')?.split(/\s+/).includes('cover-image')) ||
        nodes.find(n => n.localName === 'item' && legacyCover && n.getAttribute('id') === legacyCover);
      if (cover && convertCover) {
        try {
          const type = cover.getAttribute('media-type'), coverPath = ReaderCore.cleanPath(path, cover.getAttribute('href') || '');
          if (!coverPath || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Unsupported embedded cover.');
          result.cover = await convertCover(new Blob([read(coverPath, 10 * 1024 * 1024)], {type}));
        } catch {result.warnings.push('The embedded cover could not be used.');}
      }
      return result;
    } finally {for (const bytes of buffers) bytes.fill(0);}
  }
  // source: {size, read(begin,end)} reads a PDF by byte range instead of from data held in memory.
  async function pdf(data,{timeoutMs=10000,source=null}={}) {
    const result={title:'',author:'',year:null,language:'',pages:null,cover:null,warnings:[]};
    const controller=new AbortController();let doc,render,canvas,timer;
    const destroy=()=>{try{if(doc)Promise.resolve(doc.destroy()).catch(()=>{});}catch{}};
    const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();try{render?.cancel();}catch{}destroy();reject(Object.assign(new Error('PDF details took too long'),{name:'TimeoutError'}));},Math.max(1,Math.min(10000,timeoutMs)));});
    const job=(async()=>{
      doc=await ThingsReader.inspectPdf(data,controller.signal,source);if(controller.signal.aborted){await doc.destroy();return;}
      result.pages=Number.isSafeInteger(doc.numPages)&&doc.numPages>0?doc.numPages:null;
      try{const metadata=await doc.getMetadata();if(controller.signal.aborted)return;const info=metadata.info||{},xmp=metadata.metadata;const value=(name)=>{try{return xmp?.get(name);}catch{return '';}};
        result.title=clean(typeof value('dc:title')==='string'?value('dc:title'):info.Title);
        result.author=clean(Array.isArray(value('dc:creator'))?value('dc:creator').filter(v=>typeof v==='string').join(', '):info.Author);
        result.language=clean(typeof value('dc:language')==='string'?value('dc:language'):info.Language,40);
        const date=clean(value('xmp:CreateDate')||info.CreationDate,40),year=date.match(/^(?:D:)?(\d{4})/);result.year=year?Number(year[1]):null;
      }catch{if(!controller.signal.aborted)result.warnings.push('Embedded PDF details were unavailable.');}
      if(controller.signal.aborted)return;
      try{const page=await doc.getPage(1);if(controller.signal.aborted)return;const base=page.getViewport({scale:1});if(!Number.isFinite(base.width)||!Number.isFinite(base.height)||base.width<=0||base.height<=0)throw new Error('Invalid PDF dimensions');
        const viewport=page.getViewport({scale:Math.min(1,480/base.width,640/base.height)});canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));if(canvas.width>481||canvas.height>641)throw new Error('Invalid cover dimensions');
        render=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#ffffff',annotationMode:0});await render.promise;
        if(!controller.signal.aborted){const cover=canvas.toDataURL('image/jpeg',.8);if(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(cover)&&cover.length<=1024*1024)result.cover=cover;else throw new Error('Invalid PDF cover');}
      }catch{if(!controller.signal.aborted)result.warnings.push('The first-page cover could not be created.');}
    })();
    try{await Promise.race([job,expired]);}catch(error){result.warnings.push(error.name==='PasswordException'?'Protected PDF: open the book to enter its document password.':error.name==='TimeoutError'?'PDF details timed out; the original book is still saved.':'PDF details could not be read; you can edit them yourself.');}
    finally{clearTimeout(timer);controller.abort();try{render?.cancel();}catch{}destroy();if(canvas){canvas.width=0;canvas.height=0;}}
    return {...result,warnings:[...result.warnings]};
  }
  return {format,epub,pdf};
})();
