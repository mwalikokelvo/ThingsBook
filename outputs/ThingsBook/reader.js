'use strict';
/* All imported book markup is rebuilt from a small inert whitelist. */
const ReaderCore = {
  decodeText(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
    return new TextDecoder(encoding).decode(bytes);
  },
  speechChunks(text, limit = 600) {
    const chunks = []; let rest = text.trim();
    while (rest.length > limit) {
      const prefix = rest.slice(0,limit), endings = [...prefix.matchAll(/[.!?]["'”’)]*\s+/g)];
      let end = endings.length ? endings[endings.length-1].index + endings[endings.length-1][0].length : 0;
      if (end < limit / 2) end = prefix.lastIndexOf(' ');
      if (end < limit / 2) end = limit;
      if (/^[\uD800-\uDBFF]$/.test(rest[end-1])) end--;
      chunks.push(rest.slice(0,end).trim()); rest = rest.slice(end).trim();
    }
    if (rest) chunks.push(rest); return chunks;
  },
  cleanPath(base, relative) {
    let plain;try{plain=decodeURIComponent(relative.split('#')[0].split('?')[0]);}catch{return null;}
    if (/^(?:[a-z]+:|\/|\\)/i.test(plain) || plain.includes('\\')) return null;
    const pieces = base.split('/').slice(0,-1);
    for (const piece of plain.split('/')) { if (!piece || piece === '.') continue; if (piece === '..') { if (!pieces.length) return null; pieces.pop(); } else pieces.push(piece); }
    return pieces.join('/');
  },
  // Long plain-text paragraphs are split for reading and narration, always at the end of a sentence when
  // there is one (never mid-sentence unless a single sentence runs past 1000 characters).
  paragraphs(text) { return text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(t => t.trim()).filter(Boolean).flatMap(t => ReaderCore.sentenceSplit(t)); },
  sentenceSplit(t, limit = 650) {
    if (t.length <= limit) return [t]; const output = []; let rest = t;
    const ends = window => { let stop = -1; for (const m of window.matchAll(/[.!?\u2026]["'\u201d\u2019)\]]*\s+(?=["'\u201c\u2018(\[]?[A-Z0-9\u00c0-\u024f])/g)) stop = m.index + m[0].length; return stop; };
    while (rest.length > limit) {
      let stop = ends(rest.slice(0,limit));
      if (stop < limit / 3) { const later = rest.slice(limit,1000).search(/[.!?\u2026]["'\u201d\u2019)\]]*\s+/); if (later >= 0) stop = limit + later + rest.slice(limit + later).match(/^[.!?\u2026]["'\u201d\u2019)\]]*\s+/)[0].length; }
      if (stop < limit / 3) stop = rest.lastIndexOf(' ',limit); if (stop < 200) stop = limit;
      if (rest.length - stop < 80 && rest.length <= 1000) break;
      output.push(rest.slice(0,stop).trim()); rest = rest.slice(stop).trim();
    }
    if (rest) output.push(rest); return output;
  },
  // Rebuild PDF page text from item positions: pieces of one word are joined without a space, a line
  // ending in a hyphen joins the next line, and paragraphs are found from indents, short last lines and
  // larger gaps, instead of adding a space after every text piece.
  pdfText(items) {
    const lines = []; let line = null, eol = false;
    for (const item of items) {
      if (!item || typeof item.str !== 'string') continue;
      const t = item.transform || [1,0,0,1,0,0], x = t[4], y = t[5], size = Math.max(1,Math.hypot(t[2],t[3]) || item.height || 10), width = Number(item.width) || 0;
      if (!item.str) { if (item.hasEOL) eol = true; continue; }
      const same = line && !eol && Math.abs(y - line.y) < size * .55 && x > line.end - size * 2;
      if (!same) { line = {x, y, size, end:x + width, text:''}; lines.push(line); }
      else if (!/\s$/.test(line.text) && !/^\s/.test(item.str) && x - line.end > size * .12) line.text += ' ';
      line.text += item.str; line.end = Math.max(line.end, x + width); line.size = Math.max(line.size, size); eol = !!item.hasEOL;
    }
    const rows = lines.map(l => ({...l, text:l.text.replace(/\s+/g,' ').trim()})).filter(l => l.text);
    if (!rows.length) return '';
    const gaps = rows.slice(1).map((l,i) => Math.abs(rows[i].y - l.y)).filter(g => g > 0).sort((a,b) => a - b), gap = gaps[Math.floor(gaps.length / 2)] || rows[0].size * 1.2;
    const xs = rows.map(l => l.x).sort((a,b) => a - b), left = xs[Math.floor(xs.length * .2)], right = Math.max(...rows.map(l => l.end));
    let out = rows[0].text;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i-1], cur = rows[i], dy = Math.abs(prev.y - cur.y);
      const breaks = dy > gap * 1.45 || cur.x > left + cur.size * .8 || prev.end < right - cur.size * 4 || prev.size > cur.size * 1.15;
      if (breaks) out += '\n\n' + cur.text;
      else if (/[A-Za-z\u00c0-\u024f]-$/.test(out) && /^[a-z\u00df-\u024f]/.test(cur.text)) out = out.slice(0,-1) + cur.text;
      else out += ' ' + cur.text;
    }
    return out;
  },
  archive(data) {
    let total = 0, count = 0;
    const files = ThingsArchiveLib.unzipSync(new Uint8Array(data),{filter:entry => {
      if (++count > 6000 || entry.originalSize > 40 * 1024 * 1024 || (total += entry.originalSize) > 180 * 1024 * 1024) throw new Error('This EPUB is too large when unpacked.');
      if (entry.name.includes('\\') || entry.name.split('/').includes('..') || entry.name.startsWith('/')) throw new Error('This EPUB contains invalid file paths.');
      return !entry.name.endsWith('/');
    }});
    return files;
  },
  epub(data) {
    const files = ReaderCore.archive(data), decode = path => { if (!files[path]) throw new Error('A required EPUB file is missing.');const bytes=files[path];const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';return new TextDecoder(encoding).decode(bytes); };
    const parser = new DOMParser(), container = parser.parseFromString(decode('META-INF/container.xml'),'application/xml');
    const root = [...container.getElementsByTagName('*')].find(n => n.localName === 'rootfile');
    const opfPath = root?.getAttribute('full-path'); if (!opfPath || opfPath.split('/').includes('..')) throw new Error('The EPUB package is invalid.');
    const packageDoc = parser.parseFromString(decode(opfPath),'application/xml');
    const manifest = new Map(); for (const n of packageDoc.getElementsByTagName('*')) if (n.localName === 'item') manifest.set(n.getAttribute('id'),n);
    // Chapter names come from the book's table of contents (EPUB 3 nav, else the EPUB 2 NCX) when it
    // names that file; reading order is always the spine's, as the EPUB standard requires.
    const tocTitles = new Map(), all = doc => [...doc.getElementsByTagName('*')];
    try {
      const navItem = [...manifest.values()].find(n => (n.getAttribute('properties') || '').split(/\s+/).includes('nav')), navPath = navItem && ReaderCore.cleanPath(opfPath,navItem.getAttribute('href') || '');
      if (navPath && files[navPath]) {
        const doc = parser.parseFromString(decode(navPath),'application/xhtml+xml'), navs = all(doc).filter(n => n.localName === 'nav');
        const toc = navs.find(n => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttributeNS?.('http://www.idpf.org/2007/ops','type') || '')) || navs[0];
        for (const a of toc ? all(toc).filter(n => n.localName === 'a') : []) { const target = ReaderCore.cleanPath(navPath,a.getAttribute('href') || ''), label = a.textContent.replace(/\s+/g,' ').trim(); if (target && label && !tocTitles.has(target)) tocTitles.set(target,label); }
      }
      const spine = all(packageDoc).find(n => n.localName === 'spine'), ncxItem = manifest.get(spine?.getAttribute('toc')) || [...manifest.values()].find(n => n.getAttribute('media-type') === 'application/x-dtbncx+xml'), ncxPath = !tocTitles.size && ncxItem && ReaderCore.cleanPath(opfPath,ncxItem.getAttribute('href') || '');
      if (ncxPath && files[ncxPath]) for (const point of all(parser.parseFromString(decode(ncxPath),'application/xml')).filter(n => n.localName === 'navPoint')) {
        const label = all(point).find(n => n.localName === 'text')?.textContent.replace(/\s+/g,' ').trim(), content = all(point).find(n => n.localName === 'content'), target = content && ReaderCore.cleanPath(ncxPath,content.getAttribute('src') || '');
        if (target && label && !tocTitles.has(target)) tocTitles.set(target,label);
      }
    } catch {}
    const chapters = [];
    for (const n of packageDoc.getElementsByTagName('*')) if (n.localName === 'itemref') {
      const item = manifest.get(n.getAttribute('idref')); if (!item || n.getAttribute('linear') === 'no') continue;
      const path = ReaderCore.cleanPath(opfPath,item.getAttribute('href') || ''); if (!path || !files[path]) continue;
      const source=decode(path);let html=parser.parseFromString(source,'application/xhtml+xml');
      const bodyOf=doc=>[...doc.getElementsByTagName('*')].find(node=>node.localName.toLowerCase()==='body');
      if(html.getElementsByTagName('parsererror').length||!bodyOf(html))html=parser.parseFromString(source.replace(/<title(\s[^>]*)?\s*\/>/gi,'<title$1></title>'),'text/html');
      const body=bodyOf(html);if(!body)continue;
      const heading=[...body.getElementsByTagName('*')].find(node=>['h1','h2','h3'].includes(node.localName.toLowerCase()));
      const headTitle=[...html.getElementsByTagName('*')].find(node=>node.localName.toLowerCase()==='title');
      const title=tocTitles.get(path)||heading?.textContent.replace(/\s+/g,' ').trim()||headTitle?.textContent.trim()||`Chapter ${chapters.length+1}`;
      chapters.push({path,title:title.slice(0,160),html,body});
    }
    if (!chapters.length) throw new Error('No readable chapters were found. This EPUB may be protected or damaged.');
    return {files,chapters};
  },
  safeChapter(chapter, files, urls) {
    const host = document.createElement('article'); host.className = 'reading-article';
    const allowed = new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','SPAN','EM','STRONG','B','I','U','BR','HR','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TD','TH','SUP','SUB','FIGURE','FIGCAPTION','A']);
    const denied = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','LINK','META','SVG','MATH','AUDIO','VIDEO']);
    function copy(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
      const tag=(node.localName||node.tagName||'').toUpperCase();
      if (node.nodeType !== Node.ELEMENT_NODE || denied.has(tag)) return;
      if (tag === 'IMG') {
        const path = ReaderCore.cleanPath(chapter.path,node.getAttribute('src') || ''), bytes = path && files[path];
        if (!bytes || bytes.length > 12 * 1024 * 1024) return;
        const ext = path.split('.').pop().toLowerCase(), mime = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'}[ext]; if (!mime) return;
        const image = document.createElement('img'), url = URL.createObjectURL(new Blob([bytes],{type:mime})); urls.push(url); image.src = url; image.alt = node.getAttribute('alt') || ''; parent.append(image); return;
      }
      const next = document.createElement(allowed.has(tag) ? tag.toLowerCase() : 'span');
      const id=node.getAttribute('id');if(id)next.id='epub-'+id;
      if (tag === 'A') { const href=node.getAttribute('href')||'';if(href.includes('#')&&!/^(?:[a-z]+:|\/\/)/i.test(href)){next.href=href.startsWith('#')?'#epub-'+href.slice(1):'#';next.onpointerenter=()=>window.ThingsResearch?.peek(href,chapter.path);next.onclick=e=>{e.preventDefault();if(window.ThingsResearch?.peek(href,chapter.path))return;if(href.startsWith('#'))host.querySelector(`[id="${CSS.escape('epub-'+href.slice(1))}"]`)?.scrollIntoView({block:'start'});};} }

      for (const child of node.childNodes) copy(child,next); parent.append(next);
    }
    for (const child of chapter.body.childNodes) copy(child,host);
    return host;
  }
};

const ThingsReader = (() => {
  const personalBridge=()=>window.ThingsBookDesktop||window.ThingsAndroidNeural;
  const q = id => document.getElementById(id);
  let session = null, epoch = 0, voiceOptions = [], voiceLoadEpoch = 0, speechEpoch = 0, utterance, audio, audioUrl, sleepTimer, fadeTimer, sleepDeadline=0, sleepTotal=0, fadeLevel=1;
  let playing = false, paused = false, speechController = null, completedSpeechEpoch = -1, selectionNarration = null, preparedNarration = null, preparedQueue=[], preparationEpoch=0;
  // An optional action (for example "Recognize this page") is offered right beside the message.
  const say = (text, action) => { const host=q('reader-message');host.textContent = text; if(action&&typeof document.createElement==='function'&&host.append)for(const item of [].concat(action)){const button=document.createElement('button');button.type='button';button.className='text-button reader-message-action';button.textContent=item.label;button.onclick=()=>item.run();host.append(' ',button);} };
  const spokenText = text => window.ThingsSpeechText?.spoken(text) ?? text;
  const listeningLevel=()=>window.ListeningCore?.level(q('narrator-volume')?.value,1)??1;
  // Short personal phrases start sooner; saved text offsets are remapped on resume.
  function speechLimit(text,location=session?.location,paragraph=session?.paragraph){if(q('narrator-voice').value.startsWith('custom:'))return 100;const saved=session?.progress.listening;if(saved&&saved.location===location&&saved.paragraph===paragraph&&saved.fingerprint===window.ListeningCore?.fingerprint(text))return [100,220].includes(saved.chunkLimit)?saved.chunkLimit:600;return 600;}
  const narrationChunks=(text,location,paragraph)=>ReaderCore.speechChunks(text,speechLimit(text,location,paragraph));
  // WebView owns media audio focus. A second native focus request competes with
  // Chromium and makes Android send our own player a pause at startup.
  // Native system TTS acquires its focus separately in MainActivity.speak().
  async function playAudio(){await audio.play();}
  function releaseAudioUrl(url){if(!url)return;if(url.startsWith('thingsbook:')||url.startsWith('/personal-audio?'))personalBridge()?.releaseCustomStream?.(url);else URL.revokeObjectURL(url);}
  function discardSlot(slot){if(slot){slot.cancelled=true;releaseAudioUrl(slot.url);}}
  function discardPrepared(){preparationEpoch++;for(const slot of preparedQueue)discardSlot(slot);preparedQueue=[];preparedNarration=null;}
  function captureListening(){if(!session||selectionNarration||!playing)return;const text=passages()[session.paragraph]?.textContent||'';const saved=window.ListeningCore?.checkpoint({location:session.location,paragraph:session.paragraph,chunk:session.narrationChunk||0,character:session.narrationChar||0},text);if(saved){saved.chunkLimit=speechLimit(text);if(audio&&Number.isFinite(audio.currentTime))saved.audioSeconds=Math.max(0,audio.currentTime);session.progress.listening=saved;}}
  function resumeListening(){if(!session)return {chunk:0,character:0};const text=passages()[session.paragraph]?.textContent||'',at={location:session.location,paragraph:session.paragraph};let saved=session.progress.listening;const chunks=narrationChunks(text);if(q('narrator-voice').value.startsWith('custom:')&&saved&&saved.chunkLimit!==100&&window.ListeningCore?.rechunk){const oldChunks=ReaderCore.speechChunks(text,saved.chunkLimit===220?220:600);const mapped=window.ListeningCore.rechunk(saved,at,text,oldChunks,chunks);if(mapped!==saved){saved={...mapped,chunkLimit:100};session.progress.listening=saved;}}const position=window.ListeningCore?.resume(saved,at,text,chunks)||{chunk:0,character:0};return {...position,audioSeconds:position.valid&&position.chunk===saved?.chunk&&saved?.location===session.location&&saved?.paragraph===session.paragraph&&Number.isFinite(saved?.audioSeconds)?Math.max(0,saved.audioSeconds):0};}
  function volumeChanged(){if(audio)audio.volume=listeningLevel()*fadeLevel;if(utterance)utterance.volume=listeningLevel()*fadeLevel;if(window.ThingsBookAndroid?.setSpeechVolume)window.ThingsBookAndroid.setSpeechVolume(listeningLevel()*fadeLevel);scheduleSave();}
  function observeAudio(expected,resumeSeconds=0,node,text){const player=audio;const active=()=>player===audio&&expected===speechEpoch&&playing&&!paused;player.onwaiting=player.onstalled=()=>{if(active()){window.ThingsSanctuary?.narrationStopped();say('Preparing the next words in your voice… Reading continues automatically.');q('reader-dialog').dataset.narration='buffering';}};player.onplaying=()=>{if(active()){window.ThingsSanctuary?.narrating(node,text);say(q('narrator-voice').value.startsWith('custom:')?'Reading in your personal voice.':'Reading with your offline Windows voice.');q('reader-dialog').dataset.narration='playing';}};player.volume=listeningLevel()*fadeLevel;player.onloadedmetadata=()=>{if(player!==audio||expected!==speechEpoch)return;if(resumeSeconds&&Number.isFinite(player.duration))player.currentTime=Math.min(resumeSeconds,Math.max(0,player.duration-.05));window.ThingsListening?.stateChanged();};player.ondurationchange=()=>{if(player===audio&&expected===speechEpoch)window.ThingsListening?.stateChanged();};player.ontimeupdate=()=>{if(player===audio&&expected===speechEpoch)captureListening();};window.ThingsListening?.stateChanged();}
  function seekSeconds(seconds){if(!audio||!Number.isFinite(audio.duration)){say('Time seeking is available while generated audio is playing. Use passage controls with device voices.');return false;}audio.currentTime=Math.max(0,Math.min(audio.duration-.05,audio.currentTime+seconds));captureListening();scheduleSave();return true;}
  async function restartListening(){captureListening();const next=resumeListening();await speakCurrent(next.chunk,next.character,next.audioSeconds);}
  function progress() {
    if (!session) return;
    captureListening();
    const scrollHost=session.pdf&&q('reader-layout').value==='concurrent'?(session.pdfTranscript?.parentElement||q('reader-content')):q('reader-content');const count = session.count; let fraction = Math.max(0,Math.min(1,scrollHost[isPaged()?'scrollLeft':'scrollTop'] / Math.max(1,isPaged()?scrollHost.scrollWidth-scrollHost.clientWidth:scrollHost.scrollHeight-scrollHost.clientHeight)));
    const scrolled=fraction;if(playing)fraction=(session.paragraph/Math.max(1,passages().length));
    const percent = session.completed ? 100 : Math.min(100,Math.round(100 * (session.location + fraction) / count));
    session.progress = {...session.progress,passageScheme:2,location:session.location,paragraph:session.paragraph,scroll:scrolled,percent,theme:q('reader-theme').value,fontSize:Number(q('reader-size').value),voice:q('narrator-voice').value,speed:Number(q('narrator-speed').value),layout:q('reader-layout').value,typeface:q('reader-typeface').value,lineHeight:Number(q('reader-spacing').value),follow:q('narrator-follow').checked,scope:q('narrator-scope').value,ocr:q('narrator-ocr').checked,sleep:Number(q('narrator-sleep').value),tracking:Number(q('reader-tracking').value),measure:Number(q('reader-measure').value),alignment:q('reader-alignment').value,volume:listeningLevel(),sleepFade:q('narrator-fade')?.checked!==false,updated:Date.now()};
    q('reader-progress').textContent = `${session.pdf ? 'Page' : 'Chapter'} ${session.location + 1} of ${count} · ${percent}%`;
  }
  function scheduleSave() { if (!session || session.disposing || session.loading) return; progress(); clearTimeout(session.saveTimer); const current = session; q('reader-save-status').textContent = 'Saving your place…'; current.saveTimer = setTimeout(() => persist(current).catch(() => {}),500); }
  async function persist(current) {
    clearTimeout(current.saveTimer); current.saveTimer = null;
    const snapshot = JSON.parse(JSON.stringify(current.progress));
    current.saveQueue = current.saveQueue.catch(() => {}).then(() => current.save({progress:snapshot,highlights:current.highlights,bookmarks:current.bookmarks,lastRead:Date.now()}));
    try { await current.saveQueue; if (session === current) q('reader-save-status').textContent = 'Your place is saved'; }
    catch { if (session === current) { q('reader-save-status').textContent = 'Could not save your place'; say('Your progress could not be saved. Check storage space before closing.'); } throw new Error('Could not save reader progress'); }
  }
  function applyTheme() { q('reader-dialog').dataset.theme = q('reader-theme').value; q('reader-content').style.setProperty('--reader-font-size',q('reader-size').value + 'px'); if(session&&!session.loading)applyLayout();scheduleSave(); }
  function passages() { return [...q('reader-content').querySelectorAll('.reader-passage')]; }
  function setPassage(index, offset = 0) { if (!session) return; const nodes = passages(); session.paragraph = Math.max(0,Math.min(index,nodes.length-1)); nodes.forEach((n,i) => n.classList.toggle('speaking',playing && i === session.paragraph)); if (playing && q('narrator-follow').checked && q('reader-layout').value!=='fitpage') followText(nodes[session.paragraph],offset); updateScreen(); scheduleSave(); }
  // Where a character of a passage is on screen (null when it is not laid out, e.g. a hidden transcript).
  function textRect(node, offset = 0) {
    if (!node || typeof document.createTreeWalker !== 'function' || !node.getClientRects) return null; const walker = document.createTreeWalker(node,4); let seen = 0;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) { if (seen + t.data.length > offset) { const range = document.createRange(), at = Math.max(0,offset - seen); range.setStart(t,at); range.setEnd(t,Math.min(t.data.length,at + 1)); const rect = [...range.getClientRects()].find(r => r.width || r.height); if (rect) return rect; } seen += t.data.length; }
    const rect = node.getClientRects()[0]; return rect && (rect.width || rect.height) ? rect : null;
  }
  function viewRect() { return (session?.pdf && q('reader-layout').value === 'concurrent' && session.pdfTranscript ? session.pdfTranscript.parentElement : q('reader-content')).getBoundingClientRect(); }
  const onScreen = (rect, view = viewRect()) => !!rect && rect.bottom > view.top + 8 && rect.top < view.bottom - 8 && rect.right > view.left + 8 && rect.left < view.right - 8;
  // Character offset where each narration chunk starts inside its passage text.
  function chunkOffsets(text, chunks) { const offsets = []; let from = 0; for (const chunk of chunks) { const at = text.indexOf(chunk.slice(0,40), from); offsets.push(at >= 0 ? at : from); from = (at >= 0 ? at : from) + Math.max(1,chunk.length - 2); } return offsets; }
  // Follow text: move only when the words being read leave the screen, and then to the screen holding
  // them, so the view never jumps back to the start of a long paragraph while it is read.
  function followText(node, offset = 0) {
    if (!node) return; const rect = textRect(node,offset); if (!rect) { revealPassage(node,true); return; }
    const view = viewRect(); if (rect.top >= view.top + 8 && rect.bottom <= view.bottom - Math.min(90,view.height * .12) && rect.left >= view.left && rect.right <= view.right) return;
    if (isPaged()) { const content = q('reader-content'), origin = content.getBoundingClientRect().left + parseFloat(getComputedStyle(content).paddingLeft) + content.clientLeft, span = pageSpan(); content.scrollTo({left:Math.max(0,Math.floor((rect.left - origin + content.scrollLeft + 2) / span) * span),behavior:'smooth'}); return; }
    const host = session.pdf && q('reader-layout').value === 'concurrent' && session.pdfTranscript ? session.pdfTranscript.parentElement : q('reader-content');
    host.scrollTo({top:Math.max(0,host.scrollTop + rect.top - view.top - view.height * .25),behavior:'smooth'});
  }
  // The first words on screen: the first passage that starts on screen, or the chunk of a long passage
  // that does. Read aloud and page turns during narration start here.
  function visibleStart() {
    const nodes = passages(), view = viewRect(); if (!nodes.length || !view.height) return null;
    for (let i = 0; i < nodes.length; i++) {
      const box = nodes[i].getBoundingClientRect(); if (box.bottom < view.top || box.top > view.bottom || box.right < view.left || box.left > view.right) { if (box.top > view.bottom && !isPaged()) break; continue; }
      const text = selectionNarration || nodes[i].textContent, chunks = narrationChunks(text,session.location,i), offsets = chunkOffsets(text,chunks);
      for (let c = 0; c < chunks.length; c++) if (onScreen(textRect(nodes[i],offsets[c]),view)) return {paragraph:i,chunk:c};
    }
    return null;
  }
  // Whether the words narration would resume from (passage and chunk) are on screen.
  function startVisible(chunk = 0) { const node = passages()[session.paragraph]; if (!node) return true; const text = node.textContent, offsets = chunkOffsets(text,narrationChunks(text)), rect = textRect(node,offsets[Math.min(chunk,offsets.length-1)] || 0); return !rect || onScreen(rect); }
  function paragraphize(host) {
    let candidates = [...host.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,pre')].filter(n => n.textContent.trim() && !n.querySelector('p,li,blockquote,pre'));
    if (!candidates.length && host.textContent.trim()) { const text = host.textContent; host.replaceChildren(); for (const p of ReaderCore.paragraphs(text)) { const node = document.createElement('p'); node.textContent = p; host.append(node); } candidates = [...host.children]; }
    // Book paragraphs stay whole so their italics, links and sentences are kept; narration splits long
    // passages into sentences on its own. Only extreme blocks (no paragraph markup at all) are split.
    candidates = candidates.flatMap(n => { if (n.textContent.length <= 20000) return [n]; const nodes = ReaderCore.paragraphs(n.textContent).map(text => { const p=document.createElement('p');p.textContent=text;return p; });n.replaceWith(...nodes);return nodes; });
    candidates.forEach((n,i) => { n.classList.add('reader-passage'); n.dataset.passage = i; n.onclick=()=>{if(!playing){setPassage(i);candidates.forEach((p,j)=>p.classList.toggle('selected-passage',i===j));}}; });
    return candidates;
  }
  async function showLocation(location, restore = false) {
    const current = session; if (!current || current.disposing) return;
    window.ThingsOCR?.cancel();current.pdfCanvas=null;current.pdfTranscript=null;q('reader-ocr').hidden=!current.pdf;q('narrator-ocr-label').hidden=!current.pdf;q('reader-ocr').disabled=true;q('reader-ocr-cancel').hidden=true;
    const requestEpoch = ++epoch; current.loading=true;current.completed=restore && current.progress.percent===100;current.location = Math.max(0,Math.min(location,current.count-1));
    let savedParagraph = restore ? current.progress.paragraph || 0 : 0;const savedScroll = restore ? current.progress.scroll || 0 : 0;
    current.paragraph = savedParagraph; q('reader-location').value = current.location;
    q('reader-previous').disabled = current.location === 0; q('reader-next').disabled = current.location === current.count-1;
    const staging=document.createElement('div'),previousUrls=current.urls.slice();let needsRecognition=false;q('reader-content').setAttribute('aria-busy','true');say('Opening your chapter…');
    if (current.renderTask) { current.renderTask.cancel(); try { await current.renderTask.promise; } catch {} current.renderTask = null; }
    if (current.pdf) {
      const page = await current.pdf.getPage(current.location+1); if (session !== current || requestEpoch !== epoch) return;
      const base = page.getViewport({scale:1}); const scale = Math.min(2,1300/base.width,Math.sqrt(4500000/(base.width*base.height)));
      const viewport = page.getViewport({scale}), canvas = document.createElement('canvas'); canvas.className='pdf-canvas';canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-label',`Page ${current.location+1}`);staging.append(canvas);
      // A newer page load cancels this render; the cancellation is expected, so this load simply stops.
      // Rendering for display waits for animation frames, which never come while the screen is off or the app
      // is in the background; there the page is drawn in one go (print intent), so whole-book reading continues.
      current.renderTask = page.render({canvasContext:canvas.getContext('2d'),viewport,...(document.hidden?{intent:'print'}:{})}); try { await current.renderTask.promise; } catch (error) { if (error?.name === 'RenderingCancelledException' || session !== current || requestEpoch !== epoch) return; throw error; } current.renderTask = null;
      const content = await page.getTextContent();page.cleanup?.(); if (session !== current || requestEpoch !== epoch) return;
      let text=ReaderCore.pdfText(content.items);current.blankPage=!text.trim()&&blankCanvas(canvas);
      const transcript=document.createElement('article');transcript.className='reading-article';const label=document.createElement('p');label.className='pdf-transcript-label';label.textContent='PAGE TEXT · SELECT, HIGHLIGHT OR LISTEN';const split=document.createElement('div'),visual=document.createElement('section'),textPane=document.createElement('section');split.className='reader-split-view';visual.className='reader-pane-visual';textPane.className='reader-pane-text';visual.setAttribute('aria-label','PDF page image');textPane.setAttribute('aria-label','Readable PDF text');visual.tabIndex=textPane.tabIndex=0;visual.append(canvas);textPane.append(label,transcript);split.append(visual,textPane);staging.replaceChildren(split);textPane.addEventListener('scroll',()=>{if(q('reader-layout').value==='concurrent'){scheduleSave();rememberVisiblePassage();}},{passive:true});
      current.pdfCanvas=canvas;current.pdfTranscript=transcript;current.pdfTextLabel=label;
      // Text recognized earlier is kept with the book; use it when this page was recognized before.
      if(!current.ocrPages?.has(current.location)&&typeof loadRecognizedPage==='function'){const saved=await loadRecognizedPage(current.id,current.location).catch(()=>null);if(session!==current||requestEpoch!==epoch)return;if(saved){current.ocrPages ||= new Map();current.ocrPages.set(current.location,saved);}}
      const cached=current.ocrPages?.get(current.location);if(cached){text=cached.text;label.textContent='RECOGNIZED PAGE TEXT · CHECK FOR RECOGNITION ERRORS';}
      for (const p of ReaderCore.paragraphs(text)) { const node=document.createElement('p');node.textContent=p;transcript.append(node); } paragraphize(transcript);
      if(text.trim())say(q('reader-layout').value==='fitpage'?'PDF page ready. Read aloud reads the text of this page.':'PDF page ready. Narration uses the page text shown below.');
      else if(current.blankPage)say('This page appears to be blank.');
      else say('This page is a scanned image. Use Recognize page to read it aloud.',[{label:'Recognize this page',run:()=>{stop();recognizePage().catch(()=>{});}},{label:'Always recognize scanned pages',run:()=>{q('narrator-ocr').checked=true;scheduleSave();stop();recognizePage().catch(()=>{});}}]);
      needsRecognition=!text.trim()&&!current.blankPage&&q('narrator-ocr').checked;
    } else {
      let host;
      if (current.epub) host=ReaderCore.safeChapter(current.epub.chapters[current.location],current.epub.files,current.urls);
      else { host=document.createElement('article');host.className='reading-article';for (const text of current.textChapters[current.location]) { const p=document.createElement('p');p.textContent=text;host.append(p); } }
      const whole=paragraphize(host);if(restore&&current.epub&&current.progress.passageScheme!==2)savedParagraph=legacyPassage(whole,savedParagraph);staging.append(host);say('Your place is saved automatically. Tap a passage or select text to highlight it. Search finds text in this chapter or PDF page.');
    }
    if (session !== current || requestEpoch !== epoch) return;
    q('reader-content').replaceChildren(...staging.childNodes);q('reader-content').setAttribute('aria-busy','false');for(const url of previousUrls)URL.revokeObjectURL(url);current.urls=current.urls.filter(url=>!previousUrls.includes(url));if(!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)q('reader-content').animate?.([{opacity:.82},{opacity:1}],{duration:140,easing:'ease-out'});
    if(needsRecognition)await recognizePage(true);if(session!==current||requestEpoch!==epoch)return;
    const nodes=passages();current.paragraph=Math.max(0,Math.min(savedParagraph,nodes.length-1));
    for (const mark of current.highlights) if (mark.location===current.location) markPassage(locateMark(nodes,mark),mark);
    q('reader-content').scrollTop=savedScroll*Math.max(0,q('reader-content').scrollHeight-q('reader-content').clientHeight);current.loading=false;q('reader-ocr').disabled=!current.pdf;applyLayout(false);if(q('reader-layout').value==='concurrent'&&current.pdfTranscript)current.pdfTranscript.parentElement.scrollTop=savedScroll*Math.max(0,current.pdfTranscript.parentElement.scrollHeight-current.pdfTranscript.parentElement.clientHeight);const restoredOffset=savedScroll*Math.max(0,isPaged()?q('reader-content').scrollWidth-q('reader-content').clientWidth:q('reader-content').scrollHeight-q('reader-content').clientHeight);q('reader-content')[isPaged()?'scrollLeft':'scrollTop']=isPaged()?Math.round(restoredOffset/pageSpan())*pageSpan():restoredOffset;progress();renderNotes();updateScreen();scheduleSave();window.ThingsSanctuary?.locationChanged(current);
  }
  // A page with no text layer whose image is (almost) all one light colour is blank, not a scan.
  function blankCanvas(canvas){try{const w=64,h=Math.max(1,Math.round(64*canvas.height/Math.max(1,canvas.width))),small=document.createElement('canvas');small.width=w;small.height=h;const ctx=small.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);const data=ctx.getImageData(0,0,w,h).data;let ink=0;for(let i=0;i<data.length;i+=4){if(data[i+3]>16&&(data[i]+data[i+1]+data[i+2])/3<225)ink++;}return ink/(w*h)<.003;}catch{return false;}}
  // Before 1.14.1 book paragraphs over 650 characters were shown as several passages, and saved places
  // count passages. Map an old passage number to the whole paragraph that now holds it.
  function legacyPassage(nodes,index){let old=0;for(let i=0;i<nodes.length;i++){const text=nodes[i].textContent;let count=1;if(text.length>650){count=0;for(const part of text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(t=>t.trim()).filter(Boolean)){let rest=part;count++;while(rest.length>650){let stop=rest.lastIndexOf(' ',650);if(stop<200)stop=650;rest=rest.slice(stop).trim();if(rest)count++;}}count=Math.max(1,count);}if(index<old+count)return i;old+=count;}return Math.max(0,nodes.length-1);}
  function isPaged(){return !!session&&!session.pdf&&['paged','spread'].includes(q('reader-layout').value);}
  async function recognizePage(automatic=false) {
    const current=session,location=current?.location,requestEpoch=epoch;
    if(!current?.pdf||!current.pdfCanvas||current.disposing||(!automatic&&current.loading))return false;
    current.ocrError=null;if(!window.ThingsOCR){current.ocrError={location,message:'The offline text recognition engine is missing. Install the latest update.'};say(current.ocrError.message);return false;}
    const fresh=()=>session===current&&!current.disposing&&current.location===location&&epoch===requestEpoch;
    q('reader-ocr').disabled=true;q('reader-ocr-cancel').hidden=false;
    try {
      const result=await window.ThingsOCR.recognize(current.pdfCanvas,message=>{if(fresh())say(message);});
      if(!fresh())return false;
      if(!result.text){say('No English text was recognized on this page. The scan may be unclear or contain only an illustration.');return false;}
      if(result.text.length>40000){throw new Error('This page contains too much recognized text. Use a smaller page scan.');}const text=result.text;current.ocrPages ||= new Map();current.ocrPages.delete(location);current.ocrPages.set(location,{text,confidence:result.confidence});if(typeof saveRecognizedPage==='function')saveRecognizedPage(current.id,location,{text,confidence:result.confidence}).catch(()=>{});
      while(current.ocrPages.size>64)current.ocrPages.delete(current.ocrPages.keys().next().value);
      current.pdfTranscript.replaceChildren();for(const value of ReaderCore.paragraphs(text)){const p=document.createElement('p');p.textContent=value;current.pdfTranscript.append(p);}paragraphize(current.pdfTranscript);
      current.pdfTextLabel.textContent='RECOGNIZED PAGE TEXT · CHECK FOR RECOGNITION ERRORS';current.paragraph=0;
      for(const mark of current.highlights)if(mark.location===location)markPassage(locateMark(passages(),mark),mark);
      applyLayout(false);scheduleSave();say('English text recognized privately. You can now search, highlight or read aloud. Recognition can make mistakes; check the transcript.');return true;
    } catch(error) {if(fresh()){const message=error.message||'Text recognition could not finish. Try again on a clearer page.';if(!message.includes('cancelled'))current.ocrError={location,message};say(message);}return false;}
    finally {if(fresh()){q('reader-ocr').disabled=false;q('reader-ocr-cancel').hidden=true;}}
  }
  function rememberVisiblePassage(){
    if(!session||session.loading||playing||q('reader-layout').value==='fitpage')return;
    const rect=(session.pdf&&q('reader-layout').value==='concurrent'?session.pdfTranscript.parentElement:q('reader-content')).getBoundingClientRect(),nodes=passages();
    const index=nodes.findIndex(node=>{const box=node.getBoundingClientRect();return box.bottom>rect.top+22&&box.top<rect.bottom-22&&box.right>rect.left+22&&box.left<rect.right-22;});
    if(index>=0)session.paragraph=index;
  }
  function pageSpan(){const content=q('reader-content'),style=getComputedStyle(content);return Math.max(1,content.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+40);}
  function revealPassage(node,smooth=false){
    if(!node)return;
    if(!isPaged()){node.scrollIntoView({block:'center',behavior:smooth?'smooth':'auto'});return;}
    const content=q('reader-content'),rect=node.getClientRects()[0];if(!rect)return;
    const origin=content.getBoundingClientRect().left+parseFloat(getComputedStyle(content).paddingLeft)+content.clientLeft;
    const span=pageSpan(),left=Math.max(0,Math.floor((rect.left-origin+content.scrollLeft+2)/span)*span);
    content.scrollTo({left,behavior:smooth?'smooth':'auto'});
  }
  function updateScreen(){
    if(!session)return;const content=q('reader-content'),paged=isPaged(),size=paged?pageSpan():Math.max(1,content.clientHeight-32);
    const offset=paged?content.scrollLeft:content.scrollTop,total=paged?content.scrollWidth:content.scrollHeight;
    const screens=paged?Math.ceil(Math.max(0,total-content.clientWidth)/size)+1:Math.max(1,Math.ceil((total-32)/size)),screen=Math.min(screens,Math.floor((offset+2)/size)+1);
    q('reader-screen-status').textContent=session.pdf?'PDF page '+(session.location+1)+' of '+session.count:'Screen '+screen+' of '+screens;
    q('reader-screen-previous').disabled=offset<2&&session.location===0;
    q('reader-screen-next').disabled=offset+size>=total-2&&session.location===session.count-1;
    const remaining=passages().slice(session.paragraph).reduce((n,p)=>n+p.textContent.trim().split(/\s+/).length,0);
    q('reader-time').textContent=remaining?Math.max(1,Math.ceil(remaining/(180*Number(q('narrator-speed').value))))+' min left in '+(session.pdf?'page':'chapter'):'';
  }
  function applyLayout(preserve=true){
    if(!session)return;const dialog=q('reader-dialog'),content=q('reader-content');
    // Typeface and spacing only change text; a PDF shows its text only in page + text layout.
    for(const id of ['reader-typeface','reader-spacing','reader-tracking','reader-measure','reader-alignment']){const label=q(id)?.closest('label');if(label)label.hidden=!!session.pdf&&q('reader-layout').value!=='concurrent';}dialog.dataset.layout=q('reader-layout').value;dialog.dataset.typeface=q('reader-typeface').value;content.style.scrollBehavior=isPaged()?'auto':'';
    content.style.setProperty('--reader-leading',q('reader-spacing').value);content.style.setProperty('--reader-tracking',q('reader-tracking').value+'em');content.style.setProperty('--reader-measure',q('reader-measure').value+'ch');content.style.setProperty('--reader-alignment',q('reader-alignment').value);
    const padding= parseFloat(getComputedStyle(content).paddingLeft)+parseFloat(getComputedStyle(content).paddingRight);
    const height=content.clientHeight-parseFloat(getComputedStyle(content).paddingTop)-parseFloat(getComputedStyle(content).paddingBottom);
    const columns=q('reader-layout').value==='spread'&&content.clientWidth>=720?2:1;
    content.style.setProperty('--page-height',Math.max(80,height)+'px');content.style.setProperty('--column-width',Math.max(100,(content.clientWidth-padding-40*(columns-1))/columns)+'px');
    content.style.setProperty('--pdf-height',Math.max(80,height)+'px');
    if(preserve)revealPassage(passages()[session.paragraph]);else if(isPaged()){const span=pageSpan();content.scrollLeft=Math.round(content.scrollLeft/span)*span;}
    updateScreen();scheduleSave();
  }
  // Moving to another screen, page or chapter while reading aloud carries on reading from the first
  // words of the new screen instead of stopping. When paused or stopped it only moves.
  let moveEpoch=0;
  async function moveTo(action){
    if(!session)return;const resume=playing&&!paused&&!selectionNarration,move=++moveEpoch;
    if(!resume){stop();await action(false);return;}
    clearSpeech();passages().forEach(n=>n.classList.remove('speaking'));q('reader-dialog').dataset.narration='preparing';
    await action(true);if(!session||!playing||paused||move!==moveEpoch)return;
    const start=visibleStart();session.paragraph=start?.paragraph??0;session.progress.listening=null;await speakCurrent(start?.chunk||0);
  }
  function turnScreen(direction){return moveTo(reading=>turnScreenNow(direction,reading));}
  async function turnScreenNow(direction,reading=false){
    if(!session||session.loading)return;const content=q('reader-content'),paged=isPaged(),size=paged?pageSpan():Math.max(1,content.clientHeight-32),offset=paged?content.scrollLeft:content.scrollTop,total=paged?content.scrollWidth:content.scrollHeight;
    if((session.pdf&&q('reader-layout').value==='fitpage')||(direction>0?offset+size>=total-2:offset<2)){
      const next=session.location+direction;if(next<0||next>=session.count)return;await showLocation(next);
      if(direction<0&&!session.pdf)content[paged?'scrollLeft':'scrollTop']=Math.max(0,(paged?content.scrollWidth:content.scrollHeight)-size);
    }else content.scrollTo(paged?{left:Math.max(0,Math.round(offset/size)*size+direction*size),behavior:reading?'auto':'smooth'}:{top:Math.max(0,offset+direction*size),behavior:reading?'auto':'smooth'});
    updateScreen();scheduleSave();
  }
  function nativeVoices() { try { return JSON.parse(window.ThingsBookAndroid?.getSpeechVoices() || '[]'); } catch {return [];} }
  async function refreshVoices() {
    let selected=session?.progress.voice || q('narrator-voice').value;
    const request=++voiceLoadEpoch,owner=session;
    const fresh=()=>request===voiceLoadEpoch&&owner===session&&!owner?.disposing;
    const populate=choice=>{if(!fresh())return;q('narrator-voice').replaceChildren();for(const voice of voiceOptions){const option=document.createElement('option');option.value=voice.id;option.textContent=voice.label;q('narrator-voice').append(option);}if(voiceOptions.some(v=>v.id===choice))q('narrator-voice').value=choice;};
    const native=window.ThingsBookAndroid?.getSpeechVoices;
    if(window.ThingsBookDesktop){
      const recorded=await window.ThingsBookDesktop.customVoices();if(!fresh())return;
      if(recorded.length){
        const personal=recorded.map(v=>({id:'custom:'+v.id,label:v.name}));
        if(owner&&!owner.progress.personalVoiceReady){if(!selected?.startsWith('custom:'))selected=personal.find(v=>v.id==='custom:always-forever')?.id||personal[0].id;owner.progress.voice=selected;owner.progress.personalVoiceReady=true;}
        const saved=selected?.startsWith('windows:')?{id:selected,label:'Saved Windows voice'}:null;
        voiceOptions=saved?[...personal,saved]:personal;populate(selected);if(selected?.startsWith('custom:'))window.ThingsBookDesktop.warmCustom?.(selected.slice(7)).catch(()=>{});
        // System enumeration can stall for 90 seconds. Personal voices are usable
        // immediately; late system results cannot change an active selection.
        window.ThingsBookDesktop.voices().then(voices=>{if(!fresh())return;const chosen=q('narrator-voice').value;const system=voices.map(v=>({id:'windows:'+v.id,label:v.name}));if(saved&&!system.some(v=>v.id===saved.id))system.unshift(saved);voiceOptions=[...personal,...system];populate(chosen);}).catch(()=>{});
        return;
      }
      const voices=await window.ThingsBookDesktop.voices();if(!fresh())return;voiceOptions=voices.map(v=>({id:'windows:'+v.id,label:v.name}));
    }else if(window.ThingsAndroidNeural){
      const recorded=await window.ThingsAndroidNeural.customVoices();if(!fresh())return;
      const personal=recorded.map(v=>({id:'custom:'+v.id,label:v.name}));
      if(personal.length&&owner&&!owner.progress.personalVoiceReady){if(!selected?.startsWith('custom:'))selected=personal.find(v=>v.id==='custom:always-forever')?.id||personal[0].id;owner.progress.voice=selected;owner.progress.personalVoiceReady=true;}
      voiceOptions=[...personal,...nativeVoices().map(v=>({id:'android:'+v.id,label:v.name,language:v.language}))];
      if(personal.length&&selected?.startsWith('custom:'))window.ThingsAndroidNeural.warmCustom().catch(()=>{});
    }else voiceOptions = native ? nativeVoices().map(v=>({id:'android:'+v.id,label:v.name,language:v.language})) : (window.speechSynthesis?.getVoices() || []).filter(v=>v.localService).map(v=>({id:'device:'+v.voiceURI,label:v.name,voice:v}));
    if (!voiceOptions.length) voiceOptions.push({id:'unavailable',label:'No offline device voice installed'});
    if (!window.ThingsBookAndroid&&!window.ThingsBookDesktop) { try { const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1200);let response;try{response=await fetch('/speech/status',{signal:controller.signal});}finally{clearTimeout(timer);}if(!fresh())return;if(response.ok){const status=await response.json();if(status.ready) for(const v of status.voices)voiceOptions.unshift({id:'custom:'+v.id,label:v.name});}}catch{} }
    populate(selected);
  }
  // Two bounded segments ahead prevent a short paragraph tail from delaying the
  // next page. Read inert text only; do not render or run OCR ahead.
  async function narrationTextAt(owner,location){
    if(location===owner.location)return passages().map(node=>({text:node.textContent,kind:/^H[1-6]$/.test(node.tagName)?'heading':'prose'}));
    if(owner.textChapters)return (owner.textChapters[location]||[]).map(text=>({text,kind:'prose'}));
    if(owner.epub?.chapters){const urls=[];try{return paragraphize(ReaderCore.safeChapter(owner.epub.chapters[location],owner.epub.files,urls)).map(node=>({text:node.textContent,kind:/^H[1-6]$/.test(node.tagName)?'heading':'prose'}));}finally{for(const url of urls)URL.revokeObjectURL(url);}}
    if(owner.pdf?.getPage){let text=owner.ocrPages?.get(location)?.text;if(!text){const page=await owner.pdf.getPage(location+1),content=await page.getTextContent();page.cleanup?.();text=ReaderCore.pdfText(content.items);}return ReaderCore.paragraphs(text).map(text=>({text,kind:'prose'}));}
    return [];
  }
  async function prepareNextNarration(selected){
    if(!personalBridge()||!session||!playing||selectionNarration)return;
    const owner=session,request=++preparationEpoch,expected=speechEpoch,targets=[];let location=owner.location,paragraph=owner.paragraph,chunk=(owner.narrationChunk||0)+1;
    while(targets.length<2){
      const rows=await narrationTextAt(owner,location);if(session!==owner||request!==preparationEpoch||expected!==speechEpoch||!playing)return;
      for(;paragraph<rows.length&&targets.length<2;paragraph++,chunk=0){const row=rows[paragraph],chunks=narrationChunks(row.text,location,paragraph);for(;chunk<chunks.length&&targets.length<2;chunk++)targets.push({owner,location,paragraph,chunk,text:chunks[chunk],kind:row.kind,selected});}
      if(targets.length===2||q('narrator-scope').value!=='book'||location+1>=owner.count)break;
      // An unread scanned page must wait for its own OCR; never synthesize past it.
      if(!rows.length&&location!==owner.location&&owner.pdf)break;
      location++;paragraph=0;chunk=0;
    }
    const previous=preparedQueue;preparedQueue=targets.map(target=>previous.find(slot=>!slot.cancelled&&slot.owner===owner&&slot.location===target.location&&slot.paragraph===target.paragraph&&slot.chunk===target.chunk&&slot.text===target.text&&slot.selected===selected&&slot.kind===target.kind)||target);preparedNarration=preparedQueue[0]||null;
    for(const slot of previous)if(!preparedQueue.includes(slot))discardSlot(slot);
    let submitted=Promise.resolve();for(const slot of preparedQueue){if(slot.result){submitted=slot.result;continue;}const earlier=submitted;slot.result=earlier.then(async()=>{
      if(slot.cancelled||session!==owner||!playing||(!slot.claimed&&!preparedQueue.includes(slot)))return null;
      const result=personalBridge().streamCustom?{url:await personalBridge().streamCustom(spokenText(slot.text),selected.slice(7),slot.kind)}:{bytes:await personalBridge().synthesizeCustom(spokenText(slot.text),selected.slice(7),slot.kind)};
      slot.url=result.url;if(slot.cancelled||session!==owner||!playing||(!slot.claimed&&!preparedQueue.includes(slot))){releaseAudioUrl(result.url);return null;}return result;
    }).catch(()=>null);submitted=slot.result;}
  }
  function clearSpeech(cancelGeneration=true) { captureListening();speechEpoch++; speechController?.abort();speechController=null;window.speechSynthesis?.cancel();window.ThingsBookAndroid?.stopSpeech?.();if(cancelGeneration){discardPrepared();personalBridge()?.stopSpeech(!!session?.disposing);}if(audio){audio.onended=null;audio.onerror=null;audio.ontimeupdate=null;audio.onloadedmetadata=null;audio.ondurationchange=null;audio.onplaying=null;audio.onwaiting=null;audio.onstalled=null;audio.pause();audio.removeAttribute('src');audio.load();audio=null;}releaseAudioUrl(audioUrl);audioUrl=null;utterance=null; }
  function stop() { if(playing&&session&&!session.disposing)say('Narration stopped. Your place is saved.');q('reader-dialog').dataset.narration='stopped';window.ThingsSanctuary?.narrationStopped();selectionNarration=null;window.ThingsOCR?.cancel();clearSpeech();playing=false;paused=false;clearTimeout(sleepTimer);if(typeof clearInterval==='function')clearInterval(fadeTimer);sleepDeadline=0;fadeLevel=1;window.ThingsSanctuary?.fadeAmbient?.(1);window.ThingsListening?.stateChanged();q('narrator-play').textContent='▶ Read aloud';passages().forEach(n=>n.classList.remove('speaking'));if(session)scheduleSave(); }
  async function nextPassage(expected) {
    if(sleepDeadline&&Date.now()>=sleepDeadline&&playing){stop();window.ThingsSanctuary?.sleepFinished?.();say('Sleep timer finished. Your place is saved.');return;}
    if(!session||!playing||paused||expected!==speechEpoch||completedSpeechEpoch===expected)return;completedSpeechEpoch=expected;
    const chunks=narrationChunks(selectionNarration||passages()[session.paragraph]?.textContent||'');
    if((session.narrationChunk||0)+1<chunks.length){await speakCurrent((session.narrationChunk||0)+1);return;}
    if(selectionNarration){stop();say('Selected text finished.');return;}
    const count=passages().length;if(session.paragraph+1<count){clearSpeech(false);session.paragraph++;await speakCurrent();return;}
    if(q('narrator-scope').value==='chapter'){stop();say('This chapter is finished. Choose Whole book to continue automatically.');return;}
    if(session.location+1<session.count){clearSpeech(false);await showLocation(session.location+1);if(playing&&!paused)await speakCurrent();}
    else{session.completed=true;stop();say('You reached the end of the book.');scheduleSave();}
  }
  async function speakCurrent(chunkIndex=0,startCharacter=0,resumeSeconds=0) {
    if(!session||!playing||paused)return;clearSpeech(false);const myEpoch=speechEpoch;
    let node=passages()[session.paragraph];
    if(!node&&session.pdf&&!session.blankPage&&q('narrator-ocr').checked){await recognizePage(true);if(!playing||paused||!session||myEpoch!==speechEpoch)return;node=passages()[session.paragraph];}
    if(session.ocrError?.location===session.location){const message=session.ocrError.message;stop();say('Narration stopped on this page. '+message);return;}
    if(!node&&session.pdf&&!session.blankPage&&!q('narrator-ocr').checked){stop();say('This PDF page is a scanned image. Use Recognize page to read it aloud.',{label:'Recognize this page',run:()=>{recognizePage().catch(()=>{});}});return;}
    let blankScans=0;
    while(!node&&q('narrator-scope').value==='book'&&session.location+1<session.count){if(session.pdf&&!session.blankPage&&blankScans++>=2){stop();say('No text was recognized on three scanned pages. Choose a clear text page and use Recognize page before continuing.');return;}await showLocation(session.location+1);if(!playing||paused||!session||myEpoch!==speechEpoch)return;if(session.ocrError?.location===session.location){const message=session.ocrError.message;stop();say('Narration stopped on this page. '+message);return;}node=passages()[session.paragraph];}
    if(!node){stop();say('No readable text on this page. Move to a text page or choose another chapter.');return;}
    const chunks=narrationChunks(selectionNarration||node.textContent);session.narrationChunk=Math.min(chunkIndex,Math.max(0,chunks.length-1));
    const offsets=selectionNarration?[]:chunkOffsets(node.textContent,chunks);setPassage(session.paragraph,(offsets[session.narrationChunk]||0)+(startCharacter||0));const completeText=chunks[session.narrationChunk]||'';const character=window.ListeningCore?.safeOffset(completeText,startCharacter)||0;session.narrationChar=character;const text=completeText.slice(character);session.spokenStart=character;if(!text.trim()){await nextPassage(myEpoch);return;}const selected=q('narrator-voice').value,rate=Number(q('narrator-speed').value);q('reader-dialog').dataset.narration='preparing';if(/^(custom|windows):/.test(selected))window.ThingsSanctuary?.narrationStopped();else window.ThingsSanctuary?.narrating(node,text);
    try{
      if(selected.startsWith('windows:')){
        say('Preparing narration with your offline Windows voice…');const bytes=await window.ThingsBookDesktop.synthesize(text,selected.slice(8));if(myEpoch!==speechEpoch||!playing)return;audioUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));audio=new Audio(audioUrl);audio.playbackRate=rate;observeAudio(myEpoch,resumeSeconds,node,text);audio.onended=()=>nextPassage(myEpoch).catch(e=>{stop();say(e.message);});audio.onerror=()=>{if(myEpoch===speechEpoch&&playing){stop();say('The generated narration could not play.');}};await playAudio();if(myEpoch===speechEpoch&&playing)say('Reading with your offline Windows voice.');
      }else if(selected.startsWith('custom:')){
        say('Preparing '+(voiceOptions.find(v=>v.id===selected)?.label||'your selected voice')+' on this device…');let blob,sourceUrl;if(personalBridge()){
        const kind=/^H[1-6]$/.test(node.tagName)?'heading':'prose',prepared=preparedQueue.shift();preparedNarration=preparedQueue[0]||null;
        const match=prepared&&prepared.owner===session&&prepared.location===session.location&&prepared.paragraph===session.paragraph&&prepared.chunk===session.narrationChunk&&prepared.selected===selected;
        if(match)prepared.claimed=true;else if(prepared){discardSlot(prepared);discardPrepared();}
        const candidate=match?await prepared.result:null,ready=candidate&&prepared.text===text&&prepared.kind===kind?candidate:null;
        if(myEpoch!==speechEpoch||!playing){releaseAudioUrl(candidate?.url);return;}if(candidate&&!ready)releaseAudioUrl(candidate.url);
        if(ready?.url&&!resumeSeconds){sourceUrl=ready.url;}else if(!ready&&!resumeSeconds&&personalBridge().streamCustom){sourceUrl=await personalBridge().streamCustom(spokenText(text),selected.slice(7),kind);}else{if(ready?.url)releaseAudioUrl(ready.url);const bytes=ready?.bytes||await personalBridge().synthesizeCustom(spokenText(text),selected.slice(7),kind);blob=new Blob([bytes],{type:'audio/wav'});}}else{speechController=new AbortController();
        const response=await fetch('/speech/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:selected.slice(7),text:spokenText(text)}),signal:speechController.signal});
        if(!response.ok)throw new Error('The local custom voice engine is unavailable. Choose an installed device voice or start the voice pack.');
        blob=await response.blob();}if(myEpoch!==speechEpoch||!playing||paused){releaseAudioUrl(sourceUrl);return;}audioUrl=sourceUrl||(blob?URL.createObjectURL(blob):null);audio=new Audio(audioUrl);audio.playbackRate=rate;observeAudio(myEpoch,resumeSeconds,node,text);audio.onended=()=>nextPassage(myEpoch).catch(e=>{stop();say(e.message);});audio.onerror=()=>{if(myEpoch===speechEpoch&&playing){stop();say('The generated audio could not be played.');}};await playAudio();if(myEpoch===speechEpoch&&playing){say('Reading in your personal voice.');prepareNextNarration(selected).catch(()=>{});}
      }else if(selected.startsWith('android:')){
        volumeChanged();if(!window.ThingsBookAndroid.speak(text,selected.slice(8),rate,String(myEpoch)))throw new Error('Android narration is not ready. Install an offline voice in your device speech settings.');say('Reading aloud with your offline Android voice.');
      }else{
        const option=voiceOptions.find(v=>v.id===selected);if(!option?.voice||!window.speechSynthesis)throw new Error('No offline narrator is available. Install a device voice in your speech settings.');
        utterance=new SpeechSynthesisUtterance(text);utterance.voice=option.voice;utterance.rate=rate;utterance.volume=listeningLevel()*fadeLevel;utterance.onboundary=event=>{if(myEpoch===speechEpoch&&event.name==='word'){session.narrationChar=character+event.charIndex;captureListening();window.ThingsSanctuary?.narrating(node,text,event.charIndex,event.charLength||text.slice(event.charIndex).match(/^\S+/)?.[0]?.length||1);}};utterance.onend=()=>nextPassage(myEpoch).catch(e=>{stop();say(e.message);});utterance.onerror=e=>{if(myEpoch===speechEpoch&&e.error!=='canceled'&&e.error!=='interrupted'){stop();say('The device voice could not read this passage. Try another installed voice.');}};window.speechSynthesis.speak(utterance);say('Reading aloud. Your text stays on this device.');
      }
    }catch(e){if(myEpoch===speechEpoch&&!paused){stop();say(e.message || 'Narration could not start.');}}
  }
  async function playPause() {
    if(!session)return;
    if(playing&&!paused){captureListening();paused=true;q('reader-dialog').dataset.narration='paused';if(audio)audio.pause();else if(/^(android|windows):/.test(q('narrator-voice').value))clearSpeech();else if(speechController||personalBridge())clearSpeech();else window.speechSynthesis?.pause();q('narrator-play').textContent='▶ Resume';window.ThingsListening?.stateChanged();say('Narration paused.');scheduleSave();return;}
    if(playing&&paused){paused=false;if(audio)await playAudio();else if(utterance&&window.speechSynthesis?.paused)window.speechSynthesis.resume();else {const saved=resumeListening();await speakCurrent(saved.chunk,saved.character,saved.audioSeconds);}q('narrator-play').textContent='Ⅱ Pause';window.ThingsListening?.stateChanged();return;}
    let saved=resumeListening();if(!selectionNarration&&!startVisible(saved.chunk)){const start=visibleStart();if(start){session.paragraph=start.paragraph;session.progress.listening=null;saved={chunk:start.chunk,character:0,audioSeconds:0};}}
    playing=true;paused=false;q('narrator-play').textContent='Ⅱ Pause';setSleep();await speakCurrent(saved.chunk,saved.character,saved.audioSeconds);window.ThingsListening?.stateChanged();
  }
  function setSleep(){clearTimeout(sleepTimer);if(typeof clearInterval==='function')clearInterval(fadeTimer);fadeLevel=1;window.ThingsSanctuary?.fadeAmbient?.(1);const minutes=Number(q('narrator-sleep').value);sleepTotal=minutes*60000;sleepDeadline=playing&&minutes?Date.now()+sleepTotal:0;
    if(!sleepDeadline)return;
    if(typeof setInterval==='function')fadeTimer=setInterval(()=>{if(!sleepDeadline)return;fadeLevel=q('narrator-fade')?.checked===false?1:(window.ListeningCore?.fade(sleepDeadline-Date.now(),sleepTotal)||0);if(audio)audio.volume=listeningLevel()*fadeLevel;if(utterance)utterance.volume=listeningLevel()*fadeLevel;window.ThingsSanctuary?.fadeAmbient?.(fadeLevel);},250);
    sleepTimer=setTimeout(()=>{stop();window.ThingsSanctuary?.sleepFinished?.();say('Sleep timer finished. Your place is saved.');},sleepTotal);
  }
  function renderNotes(){const host=q('reader-saved-notes');host.replaceChildren();if(!session)return;for(const item of [...session.bookmarks.map(b=>({...b,kind:'bookmark'})),...session.highlights.map(h=>({...h,kind:'highlight'}))]){const row=document.createElement('div');row.className='saved-note';const jump=document.createElement('button');jump.className='secondary';jump.textContent=`${session.pdf?'Page':'Chapter'} ${item.location+1}`;jump.onclick=()=>{stop();showLocation(item.location).then(()=>{const nodes=passages(),probe=String(item.text||'').slice(0,60).trim(),found=probe&&!nodes[item.paragraph||0]?.textContent.includes(probe)?nodes.findIndex(n=>n.textContent.includes(probe)):-1;session.paragraph=found>=0?found:item.paragraph||0;revealPassage(passages()[session.paragraph]);scheduleSave();});};const text=document.createElement('p');text.textContent=item.text||'Saved bookmark';const remove=document.createElement('button');remove.className='text-button danger';remove.textContent='Remove';remove.onclick=()=>{session[item.kind==='bookmark'?'bookmarks':'highlights']=session[item.kind==='bookmark'?'bookmarks':'highlights'].filter(n=>n.id!==item.id);renderNotes();{const nodes=passages();nodes.forEach(unmarkPassage);for(const h of session.highlights)if(h.location===session.location)markPassage(locateMark(nodes,h),h);}scheduleSave();};const content=document.createElement('div');content.className='note-content';const note=document.createElement('textarea');note.placeholder='Add a private note…';note.setAttribute('aria-label','Private note for '+item.kind+' on '+(session.pdf?'page ':'chapter ')+(item.location+1));note.maxLength=2000;note.value=item.note||'';note.oninput=()=>{const original=session[item.kind==='bookmark'?'bookmarks':'highlights'].find(n=>n.id===item.id);if(original){original.note=note.value;scheduleSave();}};content.append(text,note);if(item.kind==='highlight'){const link=document.createElement('button');link.type='button';link.className='secondary';link.textContent='Links';link.onclick=()=>window.ThingsResearch?.linkHighlight(session.id,item.id).catch(e=>say(e.message));content.append(link);}row.append(jump,content,remove);host.append(row);}if(!host.children.length)host.textContent='Your saved bookmarks and highlighted passages will appear here.';}
  function addHighlight(){
    if(!session)return;const selection=window.getSelection();const selected=selection?.toString().trim();
    const inBook=selected && q('reader-content').contains(selection.anchorNode);
    const node=inBook?(selection.anchorNode.nodeType===Node.ELEMENT_NODE?selection.anchorNode:selection.anchorNode.parentElement).closest('.reader-passage'):passages()[session.paragraph];
    const text=inBook?selected:node?.textContent.trim();if(!text){say('Choose a passage inside the book first.');return;}
    if(session.highlights.length>=200){say('This book already has 200 highlights. Remove one before adding more.');return;}
    const span=inBook?selectionSpan(node,selection):null,mark={id:crypto.randomUUID(),location:session.location,paragraph:Number(node?.dataset.passage)||0,text:text.slice(0,3000),...(span?{start:span.start,end:span.end}:{}),created:Date.now()};
    session.highlights.push(mark);markPassage(node,mark);selection?.removeAllRanges();renderNotes();scheduleSave();say('Highlight saved privately with this book.');
  }
  function findText(){if(!session)return;const needle=q('reader-search').value.trim().toLocaleLowerCase();if(!needle)return;const nodes=passages();const matches=nodes.map((node,index)=>({node,index})).filter(item=>item.node.textContent.toLocaleLowerCase().includes(needle));if(!matches.length){say('No match in this chapter or PDF page.');return;}const next=matches.find(item=>item.index>session.paragraph)||matches[0];stop();setPassage(next.index);nodes.forEach(node=>node.classList.remove('search-match'));next.node.classList.add('search-match');revealPassage(next.node,true);say(`${matches.length} matching passages in this chapter or PDF page.`);}
  function init(){for(const id of ['reader-tracking','reader-measure','reader-alignment'])q(id).onchange=()=>applyLayout();q('reader-ocr').onclick=async()=>{stop();await recognizePage();};q('reader-ocr-cancel').onclick=()=>{stop();say('Text recognition cancelled. Your place is saved.');};q('narrator-ocr').onchange=()=>{if(!q('narrator-ocr').checked)window.ThingsOCR?.cancel();scheduleSave();};if(window.ResizeObserver)new ResizeObserver(()=>{if(session&&!session.loading)applyLayout(false);}).observe(q('reader-content'));q('reader-content').addEventListener('scroll',rememberVisiblePassage,{passive:true});q('reader-layout').onchange=()=>applyLayout();q('reader-typeface').onchange=()=>applyLayout();q('reader-spacing').onchange=()=>applyLayout();q('narrator-follow').onchange=scheduleSave;q('narrator-scope').onchange=scheduleSave;q('reader-screen-previous').onclick=()=>turnScreen(-1).catch(e=>say(e.message));q('reader-screen-next').onclick=()=>turnScreen(1).catch(e=>say(e.message));window.addEventListener('resize',()=>{if(session&&!session.loading)applyLayout();});q('reader-content').addEventListener('scroll',updateScreen,{passive:true});q('reader-content').onkeydown=e=>{if(!session||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;if(['ArrowRight','PageDown','ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();turnScreen(['ArrowRight','PageDown'].includes(e.key)?1:-1).catch(error=>say(error.message));}};q('narrator-settings').onclick=()=>{if(window.ThingsBookAndroid?.openSpeechSettings)window.ThingsBookAndroid.openSpeechSettings();else if(window.ThingsBookDesktop)say('Your personal neural narrators are included in the private voice edition. Choose one from Voice and use 1× for the original pitch. Headings, dialogue and punctuation guide delivery; the next passage is prepared while you listen. The installed model is English. Initial preparation and later pauses depend on your computer. Windows voices remain available below.');else say('Choose an installed offline device voice. Personal voices require a compatible local engine on this platform.');};q('reader-focus').onclick=()=>{const focus=q('reader-dialog').dataset.focus!=='true';q('reader-dialog').dataset.focus=String(focus);q('reader-focus').textContent=focus?'Controls':'Focus';applyLayout();};q('reader-find').onclick=findText;q('reader-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();findText();}};q('reader-content').addEventListener('scroll',scheduleSave,{passive:true});q('reader-theme').onchange=applyTheme;q('reader-size').oninput=applyTheme;q('reader-previous').onclick=()=>moveTo(()=>showLocation(session.location-1)).catch(e=>say(e.message));q('reader-next').onclick=()=>moveTo(()=>showLocation(session.location+1)).catch(e=>say(e.message));q('reader-location').onchange=()=>moveTo(()=>showLocation(Number(q('reader-location').value))).catch(e=>say(e.message));q('narrator-play').onclick=async()=>{if(!playing)await refreshVoices();await playPause();};q('narrator-stop').onclick=stop;for(const [id,step]of[['narrator-previous',-1],['narrator-next',1]])q(id).onclick=()=>{if(!session)return;const wasPlaying=playing;clearSpeech();setPassage(session.paragraph+step);if(wasPlaying){paused=false;speakCurrent();}};q('narrator-speed').onchange=()=>{scheduleSave();if(audio)audio.playbackRate=Number(q('narrator-speed').value);else if(playing&&!paused)restartListening();};q('narrator-voice').onchange=()=>{scheduleSave();if(playing&&!paused)restartListening();else if(q('narrator-voice').value.startsWith('custom:'))personalBridge()?.warmCustom?.(q('narrator-voice').value.slice(7)).catch(()=>{});};q('narrator-sleep').onchange=()=>{setSleep();scheduleSave();};q('reader-mark').onclick=addHighlight;q('reader-bookmark').onclick=()=>{if(!session)return;if(session.bookmarks.length>=100){say('This book already has 100 bookmarks.');return;}session.bookmarks.push({id:crypto.randomUUID(),location:session.location,paragraph:session.paragraph,text:passages()[session.paragraph]?.textContent.slice(0,100)||'Saved bookmark',created:Date.now()});renderNotes();scheduleSave();say('Bookmark saved.');};q('reader-fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await q('reader-dialog').requestFullscreen();applyLayout();}catch{say('Full screen is unavailable in this reading window.');}};window.speechSynthesis?.addEventListener?.('voiceschanged',refreshVoices);window.nativeSpeechReady=refreshVoices;window.nativeSpeechEnded=id=>nextPassage(Number(id)).catch(e=>{stop();say(e.message);});window.nativeSpeechBoundary=(id,start)=>{if(Number(id)!==speechEpoch||!session||!playing)return;session.narrationChar=(session.spokenStart||0)+Math.max(0,Number(start)||0);captureListening();};window.nativeSpeechError=id=>{if(Number(id)!==speechEpoch)return;stop();say('Android could not read this passage. Choose another offline voice.');};}
  async function close(){window.ThingsSanctuary?.closed();const current=session;if(!current)return;if(current.closing)return current.closing;current.disposing=true;progress();stop();epoch++;current.closing=(async()=>{if(!current.failed)await persist(current);if(current.renderTask){current.renderTask.cancel();try{await current.renderTask.promise;}catch{}}if(current.pdf)await current.pdf.destroy();current.source?.close?.();for(const url of current.urls)URL.revokeObjectURL(url);window.ThingsResearch?.purge(current);for(const bytes of Object.values(current.epub?.files||{}))bytes.fill(0);current.textChapters=[];current.ocrCache?.clear();if(session===current)session=null;window.ThingsListening?.stateChanged();})().catch(e=>{current.disposing=false;current.closing=null;throw e;});return current.closing;}
  let pdfCompatibility;
  function askPdfPassword(incorrect){return new Promise((resolve,reject)=>{const dialog=q('pdf-password-dialog'),input=q('pdf-password');input.value='';q('pdf-password-message').textContent=incorrect?'That document password did not work. Try again.':'Enter the document password to open this PDF. It will not be saved.';let settled=false;const cancel=()=>{if(!settled){settled=true;input.value='';dialog.close();reject(new Error('Opening the password-protected PDF was cancelled.'));}};q('pdf-password-cancel').onclick=cancel;dialog.oncancel=e=>{e.preventDefault();cancel();};q('pdf-password-form').onsubmit=e=>{e.preventDefault();settled=true;const password=input.value;input.value='';dialog.close();resolve(password);};dialog.showModal();input.focus();});}
  function localPdfEngine(){
    if(globalThis.pdfjsWorker?.WorkerMessageHandler)return Promise.resolve();
    if(!pdfCompatibility)pdfCompatibility=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/pdf-main-thread.js';script.onload=()=>resolve();script.onerror=()=>{pdfCompatibility=null;script.remove();reject(new Error('The bundled PDF compatibility engine could not load. Install the latest ThingsBook update.'));};document.head.append(script);});
    return pdfCompatibility;
  }
  // Precise highlights: a highlight made from a selection inside one passage keeps the selection's start and
  // end (offsets in the passage text) and only that span is marked. Highlights without a span, or whose span
  // no longer matches the passage text, mark the whole passage as before. Marks never change passage text.
  function selectionSpan(node,selection){if(!node||!selection?.rangeCount)return null;const range=selection.getRangeAt(0);if(!node.contains(range.startContainer)||!node.contains(range.endContainer))return null;
    const before=document.createRange();before.selectNodeContents(node);before.setEnd(range.startContainer,range.startOffset);let start=before.toString().length,end=start+range.toString().length;
    const text=node.textContent;while(start<end&&/\s/.test(text[start]))start++;while(end>start&&/\s/.test(text[end-1]))end--;return end>start?{start,end}:null;}
  // Passages are numbered per chapter; when the numbering changed (1.14.1 keeps long paragraphs whole),
  // a highlight is found again by its text.
  function locateMark(nodes,mark){const node=nodes[mark.paragraph],probe=String(mark.text||'').slice(0,80).trim();if(!probe||node?.textContent.includes(probe))return node;return nodes.find(n=>n.textContent.includes(probe))||node;}
  function markPassage(node,mark){if(!node)return;const text=node.textContent;
    if(Number.isInteger(mark.start)&&Number.isInteger(mark.end)&&mark.start>=0&&mark.end>mark.start&&mark.end<=text.length&&text.slice(mark.start,mark.end)===String(mark.text)){wrapSpan(node,mark.start,mark.end,mark.id);return;}
    {const wanted=String(mark.text||'').trim();if(wanted&&wanted.length<text.trim().length){const at=text.indexOf(wanted);if(at>=0){wrapSpan(node,at,at+wanted.length,mark.id);return;}}}
    node.classList.add('saved-highlight');}
  function wrapSpan(node,start,end,id){const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);const pieces=[];let offset=0;
    for(let t=walker.nextNode();t;t=walker.nextNode()){const from=Math.max(start,offset),to=Math.min(end,offset+t.data.length);if(from<to)pieces.push([t,from-offset,to-offset]);offset+=t.data.length;if(offset>=end)break;}
    for(const [t,a,b] of pieces){const middle=t.splitText(a);middle.splitText(b-a);const mark=document.createElement('mark');mark.className='saved-highlight-range';mark.dataset.highlight=id;middle.replaceWith(mark);mark.append(middle);}}
  function unmarkPassage(node){node.classList.remove('saved-highlight');for(const mark of node.querySelectorAll('mark.saved-highlight-range'))mark.replaceWith(...mark.childNodes);node.normalize();}
  // source: {size, read(begin,end)} reads a chunked book by byte range, so large PDFs open without loading the whole file.
  async function loadPdf(data,{signal,prompt=true,source=null}={}){
    if(typeof ThingsReaderLib==='undefined')throw new Error('The PDF engine did not load. Update Android System WebView or Microsoft Edge, then reopen ThingsBook.');
    const pdfjs=ThingsReaderLib.pdfjs;pdfjs.GlobalWorkerOptions.workerSrc='pdf.worker.mjs';
    let rangeFailure=null,failLoad=()=>{};
    const ranged=()=>{const transport=new pdfjs.PDFDataRangeTransport(source.size,null);transport.requestDataRange=(begin,end)=>{source.read(begin,end).then(bytes=>transport.onDataRange(begin,bytes),error=>{rangeFailure=error;failLoad();});};return {range:transport,length:source.size,disableAutoFetch:true,disableStream:true,rangeChunkSize:256*1024};};
    const options=()=>({...(source?ranged():{data:new Uint8Array(data).slice()}),cMapUrl:'cmaps/',cMapPacked:true,standardFontDataUrl:'standard_fonts/',wasmUrl:'wasm/',isEvalSupported:false});
    if(window.ThingsBookAndroid||window.ThingsBookDesktop)await localPdfEngine();
    const cancelled=()=>Object.assign(new Error('PDF inspection cancelled'),{name:'AbortError'});
    if(signal?.aborted)throw cancelled();
    let password,compatible=!!(window.ThingsBookAndroid||window.ThingsBookDesktop);
    for(;;){if(signal?.aborted)throw cancelled();const task=pdfjs.getDocument({...options(),password,...(!prompt?{disableAutoFetch:true,enableXfa:false}:{})});let rejectLoad;const failed=new Promise((resolve,reject)=>{rejectLoad=reject;});failed.catch(()=>{});failLoad=()=>{rejectLoad(rangeFailure);Promise.resolve(task.destroy()).catch(()=>{});};const abort=()=>{Promise.resolve(task.destroy()).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});try{const document=await (source?Promise.race([task.promise,failed]):task.promise);if(signal?.aborted){await document.destroy();throw cancelled();}return document;}catch(error){
      await task.destroy();if(signal?.aborted)throw cancelled();if(rangeFailure)throw rangeFailure;
      if(error.name==='PasswordException'){if(!prompt)throw error;password=await askPdfPassword(error.code===2);continue;}
      if(error.name==='InvalidPDFException'||compatible)throw error;
      await localPdfEngine();compatible=true;
    }finally{signal?.removeEventListener('abort',abort);}}
  }
  async function open(book,blob,save){await close();const current={id:book.id,location:book.progress?.location||0,paragraph:book.progress?.paragraph||0,progress:{...book.progress},highlights:book.highlights||[],bookmarks:book.bookmarks||[],urls:[],save,saveQueue:Promise.resolve(),count:1,loading:true};session=current;q('reader-dialog').dataset.focus='false';q('reader-focus').textContent='Focus';q('reader-search').value='';q('reader-content').replaceChildren();q('reader-title').textContent=book.title;{const eyebrow=q('reader-dialog').querySelector('.dialog-heading .eyebrow');if(eyebrow)eyebrow.textContent=[book.author&&book.author!=='Unknown author'?book.author:'',book.format==='PDF'?'PDF':''].filter(Boolean).join(' · ')||'ONE MORE CHAPTER';}q('reader-location').replaceChildren();q('reader-theme').value=book.progress?.theme||'paper';q('reader-size').value=book.progress?.fontSize||20;q('narrator-speed').value=book.progress?.speed||1;if(q('narrator-volume'))q('narrator-volume').value=book.progress?.volume??1;if(q('narrator-fade'))q('narrator-fade').checked=book.progress?.sleepFade!==false;q('narrator-sleep').value=book.progress?.sleep||0;q('reader-layout').value=book.progress?.layout||(book.format==='PDF'?'fitpage':window.innerWidth>=1280?'spread':'scroll');q('reader-typeface').value=book.progress?.typeface||'serif';q('reader-spacing').value=String(Math.max(1.2,Math.min(2.2,Math.round((book.progress?.lineHeight||1.8)*10)/10)));q('reader-tracking').value=book.progress?.tracking||0;q('reader-measure').value=book.progress?.measure||68;q('reader-alignment').value=book.progress?.alignment||'left';q('narrator-follow').checked=book.progress?.follow!==false;q('narrator-scope').value=book.progress?.scope||'book';q('narrator-ocr').checked=book.progress?.ocr===true;for(const option of q('reader-layout').options)option.disabled=book.format==='PDF'?['paged','spread'].includes(option.value):['fitpage','fitwidth','concurrent'].includes(option.value);if(q('reader-layout').selectedOptions[0]?.disabled)q('reader-layout').value=book.format==='PDF'?'fitpage':'scroll';applyTheme();say('Opening your book…');try{const ranged=book.format==='PDF'&&typeof blob.read==='function';if(ranged)current.source=blob;const data=ranged?null:await blob.arrayBuffer();if(book.format==='PDF'){current.pdf=await loadPdf(data,{source:ranged?blob:null});current.count=current.pdf.numPages;}else if(book.format==='EPUB'){if(typeof ThingsArchiveLib==='undefined')throw new Error('The EPUB engine did not load. Install the latest ThingsBook update.');current.epub=ReaderCore.epub(data);current.count=current.epub.chapters.length;}else{const paragraphs=ReaderCore.paragraphs(ReaderCore.decodeText(data));current.textChapters=[];for(let i=0;i<paragraphs.length;i+=40)current.textChapters.push(paragraphs.slice(i,i+40));if(!current.textChapters.length)current.textChapters=[['This file contains no text.']];current.count=current.textChapters.length;}for(let i=0;i<current.count;i++){const option=document.createElement('option');option.value=i;option.textContent=current.epub?current.epub.chapters[i].title:current.pdf?`Page ${i+1}`:`Part ${i+1}`;q('reader-location').append(option);}await showLocation(current.location,true);window.ThingsSanctuary?.opened(current,book);refreshVoices().catch(()=>{});}catch(e){current.failed=true;clearTimeout(current.saveTimer);say(e.message||'This book could not be opened.');q('reader-save-status').textContent='Book could not be opened';throw e;}}
  return {init,open,close,stop,active:()=>!!session,isSpeaking:()=>playing&&!paused,context:()=>session,inspectPdf:(data,signal,source)=>loadPdf(data,{signal,prompt:false,source}),volumeChanged,seekSeconds,togglePlayback:playPause,canSeek:()=>!!audio&&Number.isFinite(audio.duration),remember:scheduleSave,flush:async()=>{if(session){progress();await persist(session);}},relayout:applyLayout,annotationsChanged:()=>{renderNotes();scheduleSave();},seek:async(index)=>{const resume=playing&&!paused;stop();setPassage(Number(index));if(resume)await playPause();},jump:async(location,paragraph=0)=>{stop();await showLocation(location);setPassage(paragraph);revealPassage(passages()[session.paragraph]);},speakSelection:async(text)=>{if(!session||!text)return;stop();selectionNarration=String(text).slice(0,20000);playing=true;paused=false;q('narrator-play').textContent='Ⅱ Pause';await refreshVoices();setSleep();await speakCurrent();}};
})();
