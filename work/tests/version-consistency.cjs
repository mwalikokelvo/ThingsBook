// Every place that states ThingsBook's version agrees with work/thingsbook-desktop/package.json
// (work/set-version.py --check). 1.13.0 first shipped with the Windows app still reporting 1.12.5
// because the desktop preload and package-lock.json were not updated.
'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(__dirname, '../set-version.py'), '--check'], {encoding:'utf8'});
if (r.status !== 0) { console.error((r.stdout || '') + (r.stderr || '')); process.exit(1); }
console.log(`PASS ${r.stdout.trim()}`);
