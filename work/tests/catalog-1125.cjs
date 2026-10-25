const assert=require('assert/strict'),{allowed,handle}=require('../thingsbook-desktop/catalog.cjs');
(async()=>{
 for(const u of ['https://www.gutenberg.org/ebooks/search.opds/?query=a%20b','https://www.gutenberg.org/ebooks/1342.opds','https://www.gutenberg.org/ebooks/1342.epub.noimages','https://www.gutenberg.org/cache/epub/1342/pg1342.epub'])assert(allowed(u),u);
 for(const u of ['http://www.gutenberg.org/ebooks/1.opds','https://127.0.0.1/ebooks/1.opds','https://www.gutenberg.org.evil.com/ebooks/1.opds','https://a@www.gutenberg.org/ebooks/1.opds','https://www.gutenberg.org:444/ebooks/1.opds','https://www.gutenberg.org/ebooks/1.opds?token=secret','https://www.gutenberg.org/files/1/test.js','https://www.gutenberg.org/ebooks/search.opds/?cookie=x'])assert(!allowed(u),u);
 const req=u=>new Request('https://app.local/catalog?url='+encodeURIComponent(u));let calls=0;
 let r=await handle(req('https://evil.com/book'),()=>{calls++;});assert.equal(r.status,403);assert.equal(calls,0);
 r=await handle(req('https://www.gutenberg.org/ebooks/1.opds'),async(u,o)=>{calls++;assert.equal(o.credentials,'omit');assert.equal(o.redirect,'manual');assert(!o.headers.Cookie&&!o.headers.Authorization);return new Response('feed')});assert.equal(await r.text(),'feed');
 calls=0;r=await handle(req('https://www.gutenberg.org/ebooks/1.epub.noimages'),async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})});assert.equal(r.status,502);assert.equal(calls,1);
 r=await handle(req('https://www.gutenberg.org/ebooks/1.epub.noimages'),async()=>new Response('x',{headers:{'content-length':40*1024*1024}}));assert.equal(r.status,502);
 r=await handle(req('https://www.gutenberg.org/ebooks/1.opds'),async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2100000));c.close();}})));assert.equal(r.status,502);
 console.log('PASS: public catalog allowlist, credentials omitted, redirect revalidation and actual streamed/declared size limits.');
})().catch(e=>{console.error(e);process.exit(1)});
