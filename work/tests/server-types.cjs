// outputs/ThingsBook/server.py sends fixed Content-Types for the app's files even when the operating
// system maps them wrongly. On Windows the registry often maps .js/.mjs to text/plain; with nosniff the
// browser then refuses the pdf.js worker and no PDF opens. The server is started here with .js and .mjs
// deliberately mis-registered, and the worker, a script, a stylesheet, the OCR wasm wrapper and a CMap
// are fetched from it.
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {spawn} = require('node:child_process');
const app = path.resolve(__dirname, '../../outputs/ThingsBook');
const PORT = 8771;

const code = `import mimetypes, sys
mimetypes.init(); mimetypes.add_type('text/plain', '.mjs'); mimetypes.add_type('text/plain', '.js')  # a broken registry
sys.path.insert(0, sys.argv[1]); import server
from http.server import ThreadingHTTPServer
ThreadingHTTPServer(('127.0.0.1', ${PORT}), server.Handler).serve_forever()`;
const get = route => new Promise((resolve, reject) => {
  http.get({host:'127.0.0.1', port:PORT, path:route, timeout:3000}, res => { res.resume(); resolve({status:res.statusCode, type:res.headers['content-type'], nosniff:res.headers['x-content-type-options']}); }).on('error', reject);
});

(async () => {
  const proc = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-c', code, app], {stdio:'ignore'});
  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) { try { await get('/'); ready = true; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert(ready, 'server started');
    const expected = {'/pdf.worker.mjs':'text/javascript', '/app.js':'text/javascript', '/style.css':'text/css', '/index.html':'text/html',
      '/vendor/ocr/tesseract-core-lstm.wasm.js':'text/javascript', '/cmaps/Adobe-Japan1-0.bcmap':'application/octet-stream'};
    for (const [route, type] of Object.entries(expected)) {
      const res = await get(route);
      assert.equal(res.status, 200, route); assert.equal(res.nosniff, 'nosniff', route);
      assert.equal(String(res.type).split(';')[0], type, `${route} must be served as ${type}`);
    }
    assert.equal((await get('/server.py')).status, 404, 'files outside the app stay private');
    console.log('PASS server.py serves the pdf.js worker, scripts, styles, OCR and CMap files with fixed types even when .js/.mjs are mis-registered; other files stay private');
  } finally { proc.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
