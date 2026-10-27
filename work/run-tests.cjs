#!/usr/bin/env node
'use strict';
// Platform-neutral regression runner.
// Runs every test in work/tests that can execute on this machine and reports the rest
// as SKIPPED with a reason, so a green run is meaningful on Linux/macOS/Windows alike.
//
//   node work/run-tests.cjs            run all portable tests
//   node work/run-tests.cjs research   run only tests whose name contains "research"
//   node work/run-tests.cjs --list     show what would run / be skipped, without running
//   --require-browser                  fail (not skip) when a Chromium test cannot run for lack of Playwright
//   --no-skip                          fail when any selected test is skipped
//
// Playwright is found as usual or in work/test-tools (npm install --prefix work/test-tools playwright@1.63.0).
//
// Exit code is 1 if any test that ran failed; skipped tests never fail the run.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(__dirname, 'tests');
const desktopDir = path.join(__dirname, 'thingsbook-desktop');
const args = process.argv.slice(2);
const listOnly = args.includes('--list'), requireBrowser = args.includes('--require-browser'), noSkip = args.includes('--no-skip');
const testTools = path.join(__dirname, 'test-tools', 'node_modules');
const childEnv = fs.existsSync(testTools) ? {...process.env, NODE_PATH:[testTools, process.env.NODE_PATH].filter(Boolean).join(path.delimiter)} : process.env;
const filters = args.filter(a => !a.startsWith('--'));
const TIMEOUT_MS = 120000;

// Tests that need something specific, even though they look portable by name.
const requirements = {
  'dependency-lock-1125.cjs': {
    ok: () => fs.existsSync(path.join(desktopDir, 'node_modules', '.package-lock.json')),
    reason: 'needs `npm ci` in work/thingsbook-desktop (node_modules missing)'
  },
  'provider-1125.cjs': {
    ok: () => process.platform === 'win32' && fs.existsSync(path.join(desktopDir, 'native', 'ProviderProtection.exe')),
    reason: 'needs Windows and native/ProviderProtection.exe (built by `work/build-apps.py windows`)'
  }
};

function classify(file) {
  const ext = path.extname(file);
  const full = path.join(testsDir, file);
  if (!fs.statSync(full).isFile()) return null;
  if (/-helpers?\.cjs$/.test(file)) return null; // shared code for tests, not a test
  if (ext === '.py') return { skip: 'Python launcher for the packaged Windows EXE' };
  if (ext === '.js') return { skip: 'browser-page script; run in Chromium by pages-browser.cjs' };
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
    cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: childEnv
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  // A test that exits 0 after printing "SKIP: <reason>" did not run; count it as skipped, not passed.
  const selfSkip = r.status === 0 && !r.error && /^SKIP:\s*(.*)/.exec((r.stdout || '').trim());
  if (selfSkip && !(requireBrowser && /playwright/i.test(selfSkip[1]))) { results.skip.push({file, reason: selfSkip[1] || 'skipped itself', printed: true}); console.log(`SKIP  ${file}  - ${selfSkip[1]}`); continue; }
  if (selfSkip) r.stderr = `Chromium test did not run: ${selfSkip[1]} Install it with: npm install --prefix work/test-tools playwright@1.63.0, then node work/test-tools/node_modules/playwright/cli.js install chromium`;
  const ok = r.status === 0 && !r.error && !selfSkip;
  // The error line itself (often above a long assertion dump) plus the last lines of output.
  const lines = ((r.stdout || '') + (r.stderr || '')).trim().split('\n'), errorLine = lines.find(l => /(Error|ERR_)[^]*?:/.test(l) && !/^\s+at /.test(l));
  const tail = [...new Set([errorLine, ...lines.slice(-6)].filter(Boolean))].join('\n');
  (ok ? results.pass : results.fail).push({ file, secs, tail, timedOut: r.error && r.error.code === 'ETIMEDOUT' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  (${secs}s)${!ok ? (r.error && r.error.code === 'ETIMEDOUT' ? '  TIMED OUT' : '') : ''}`);
  if (!ok) console.log(tail.split('\n').map(l => '      ' + l.slice(0, 200)).join('\n'));
  // On GitHub Actions, failures also become annotations, readable from the API without the raw log.
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=FAIL ${file}::${(r.error && r.error.code === 'ETIMEDOUT' ? 'TIMED OUT. ' : '') + tail.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A').slice(0, 3000)}`);
}

for (const s of results.skip) if (!s.printed) console.log(`SKIP  ${s.file}  - ${s.reason}`);
if (listOnly) {
  for (const p of results.pass) console.log(`RUN   ${p.file}`);
}
console.log(`\n${results.pass.length} ${listOnly ? 'would run' : 'passed'}, ${results.fail.length} failed, ${results.skip.length} skipped`);
if (noSkip && results.skip.length && !listOnly) { console.log(`--no-skip: ${results.skip.length} selected test(s) did not run`); process.exit(1); }
process.exit(results.fail.length ? 1 : 0);
