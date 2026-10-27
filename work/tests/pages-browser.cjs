// Runs the browser-page regression scripts (work/tests/*-browser-1125.js) in Chromium, as their
// Electron wrappers do: a fresh profile per script, all non-local network requests blocked, the
// script evaluated in the app page, then its entry function called. Skips without Playwright.
'use strict';
let chromium; try { ({chromium} = require('playwright')); } catch { console.log('SKIP: Playwright is not installed.'); process.exit(0); }
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {serve} = require('./browser-helpers.cjs');
const app = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/ThingsBook'));
const only = process.argv.slice(3);
const SCRIPTS = [
  ['excerpt-export-browser-1125.js', 'testExcerptExport()'],
  ['import-recovery-browser-1125.js', 'testImportRecovery(false)'],
  ['provider-browser-1125.js', 'testProviderUi()'],
  ['storage-preflight-browser-1125.js', 'testStoragePreflight()'],
  ['ui-efficiency-browser-1125.js', 'testUiEfficiency(false)'],
  ['discovery-browser-1125.js', 'testDiscovery()'],
].filter(([file]) => !only.length || only.some(name => file.includes(name)));

async function run(file, call) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-pages-'));
  const context = await chromium.launchPersistentContext(profile, {headless:true, viewport:{width:430, height:900}});
  const blocked = [];
  await context.route(url => !/^http:\/\/127\.0\.0\.1:8765\//.test(String(url)), route => { blocked.push(route.request().url()); route.abort(); });
  try {
    const page = context.pages()[0] || await context.newPage();
    page.on('dialog', d => d.accept());
    const errors = []; page.on('pageerror', e => errors.push(`${e.name}: ${e.message}`));
    await page.goto('http://127.0.0.1:8765/');
    await page.waitForFunction(() => typeof db !== 'undefined' && !!db, null, {timeout:20000});
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const result = await page.evaluate(code => (0, eval)(code), `${source}\n${call}`);
    return {ok:!errors.length, result, errors, blocked};
  } catch (error) {
    return {ok:false, error:String(error.message || error).split('\n')[0].slice(0, 300), blocked};
  } finally { await context.close().catch(() => {}); require('./browser-helpers.cjs').cleanup(profile); }
}

async function main() {
  await serve(app);
  let failed = 0;
  for (const [file, call] of SCRIPTS) {
    const outcome = await run(file, call);
    if (!outcome.ok) failed++;
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'} ${file}${outcome.ok ? '' : `: ${outcome.error || outcome.errors.join('; ')}`}${outcome.blocked.length ? ` (blocked ${outcome.blocked.length} outside requests)` : ''}`);
  }
  process.exitCode = failed ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 500).unref());
