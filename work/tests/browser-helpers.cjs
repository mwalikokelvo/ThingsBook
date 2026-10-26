// Shared by the Chromium tests: serves an app folder through its own server.py on 127.0.0.1:8765.
// Fails loudly when the port is taken (a leftover server would otherwise serve different code), and
// stops every server it started when the test exits, including on SIGINT/SIGTERM from a timeout.
'use strict';
const {spawn} = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const servers = new Set();

const stopAll = () => { for (const proc of servers) proc.kill(); servers.clear(); };
process.on('exit', stopAll);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopAll(); process.exit(1); });

const probe = () => new Promise(resolve => {
  const req = http.get({host:'127.0.0.1', port:8765, path:'/', timeout:500}, res => { res.resume(); resolve(true); });
  req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
});

async function serve(dir) {
  if (await probe()) throw new Error('Port 8765 is already in use (a leftover ThingsBook server?). Stop it, then rerun this test.');
  const code = `import sys; sys.path.insert(0, ${JSON.stringify(dir)}); import server; from http.server import ThreadingHTTPServer; ThreadingHTTPServer(('127.0.0.1', 8765), server.Handler).serve_forever()`;
  const proc = spawn('python3', ['-c', code], {stdio:'ignore'});
  servers.add(proc);
  let exited = false; proc.on('exit', () => { exited = true; servers.delete(proc); });
  for (let i = 0; i < 40 && !exited; i++) { if (await probe()) return {stop:() => new Promise(resolve => { if (exited) return resolve(); proc.once('exit', resolve); proc.kill(); })}; await new Promise(r => setTimeout(r, 100)); }
  proc.kill();
  throw new Error(`The test server for ${dir} did not start.`);
}

// A valid PDF: catalog, pages, one font, and per page a content stream followed by an unused filler stream.
// Pages listed in `blank` have no text layer, like a scanned page.
function syntheticPdf(PAGES = 12, FILLER = 2.5 * 1024 * 1024, blank = []) {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const catalog = add(null), pages = add(null), font = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  const kids = [];
  for (let n = 1; n <= PAGES; n++) {
    const text = Buffer.from(blank.includes(n) ? '0.5 g 72 72 468 648 re f' : `BT /F1 28 Tf 72 700 Td (Page ${n} of ${PAGES}: marker-${n}) Tj ET`);
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${text.length} >>\nstream\n`), text, Buffer.from('\nendstream')]));
    kids.push(add(Buffer.from(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`)));
    const filler = crypto.randomBytes(FILLER);
    add(Buffer.concat([Buffer.from(`<< /Length ${filler.length} >>\nstream\n`), filler, Buffer.from('\nendstream')]));
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  objects[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${PAGES} >>`);
  const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets = [];
  let length = parts[0].length;
  objects.forEach((body, i) => { offsets.push(length); const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]); parts.push(chunk); length += chunk.length; });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(xref)]);
}

module.exports = {serve, stopAll, syntheticPdf};
