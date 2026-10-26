// Shared by the Chromium tests: serves an app folder through its own server.py on 127.0.0.1:8765.
// Fails loudly when the port is taken (a leftover server would otherwise serve different code), and
// stops every server it started when the test exits, including on SIGINT/SIGTERM from a timeout.
'use strict';
const {spawn} = require('node:child_process');
const http = require('node:http');
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

module.exports = {serve, stopAll};
