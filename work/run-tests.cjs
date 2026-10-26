#!/usr/bin/env node
'use strict';
// Platform-neutral regression runner.
// Runs every test in work/tests that can execute on this machine and reports the rest
// as SKIPPED with a reason, so a green run is meaningful on Linux/macOS/Windows alike.
//
//   node work/run-tests.cjs            run all portable tests
//   node work/run-tests.cjs research   run only tests whose name contains "research"
//   node work/run-tests.cjs --list     show what would run / be skipped, without running
//
// Exit code is 1 if any test that ran failed; skipped tests never fail the run.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(__dirname, 'tests');
const desktopDir = path.join(__dirname, 'thingsbook-desktop');
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const filters = args.filter(a => !a.startsWith('--'));
const TIMEOUT_MS = 120000;

// Tests that need something specific, even though they look portable by name.
const requirements = {
  'dependency-lock-1125.cjs': {
    ok: () => fs.existsSync(path.join(desktopDir, 'node_modules', '.package-lock.json')),
    reason: 'needs `npm ci` in work/thingsbook-desktop (node_modules missing)'
  },
  'provider-1125.cjs': {
    ok: () => process.platform === 'win32',
    reason: 'needs Windows device protection (DPAPI)'
  }
};

function classify(file) {
  const ext = path.extname(file);
  const full = path.join(testsDir, file);
  if (!fs.statSync(full).isFile()) return null;
  if (/-helpers?\.cjs$/.test(file)) return null; // shared code for tests, not a test
  if (ext === '.py') return { skip: 'Python launcher for the packaged Windows EXE' };
  if (ext === '.js') return { skip: 'browser-page test; needs a browser harness' };
  if (ext !== '.cjs') return null;
  const source = fs.readFileSync(full, 'utf8');
  if (/electron/.test(file) || /require\(\s*['"]electron['"]\s*\)/.test(source) || /-live[-.]/.test(file)) {
    return { skip: 'needs the Electron desktop runtime or live network' };
  }
  const req = requirements[file];
  if (req && !req.ok()) return { skip: req.reason };
  return { run: true };
}

const files = fs.readdirSync(testsDir).sort()
  .filter(f => !filters.length || filters.some(q => f.includes(q)));

const results = { pass: [], fail: [], skip: [] };
for (const file of files) {
  const c = classify(file);
  if (!c) continue;
  if (c.skip) { results.skip.push({ file, reason: c.skip }); continue; }
  if (listOnly) { results.pass.push({ file, listed: true }); continue; }
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(testsDir, file)], {
    cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = r.status === 0 && !r.error;
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-6).join('\n');
  (ok ? results.pass : results.fail).push({ file, secs, tail, timedOut: r.error && r.error.code === 'ETIMEDOUT' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  (${secs}s)${!ok ? (r.error && r.error.code === 'ETIMEDOUT' ? '  TIMED OUT' : '') : ''}`);
  if (!ok) console.log(tail.split('\n').map(l => '      ' + l.slice(0, 200)).join('\n'));
}

for (const s of results.skip) console.log(`SKIP  ${s.file}  - ${s.reason}`);
if (listOnly) {
  for (const p of results.pass) console.log(`RUN   ${p.file}`);
}
console.log(`\n${results.pass.length} ${listOnly ? 'would run' : 'passed'}, ${results.fail.length} failed, ${results.skip.length} skipped`);
process.exit(results.fail.length ? 1 : 0);
