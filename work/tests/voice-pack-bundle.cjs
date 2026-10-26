// work/build-apps.py --voice-pack safety checks (no Android tools needed): a pack in the app's installer
// format for the pinned model is accepted from outside the repository or from the ignored private-voices/
// folder; a pack git would track in the repository (it could be committed to the public repo; .zip files
// are already ignored repository-wide, so the test uses another name),
// a zip in the wrong order, and a pack for another model are refused.
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const pinned = /MODEL_HASH="([0-9a-f]{64})"/.exec(fs.readFileSync(path.join(root, 'outputs/ThingsBook/android/java/com/thingsbook/library/PersonalVoicePack.java'), 'utf8'))[1];
const python = process.platform === 'win32' ? 'python' : 'python3';

function check(pack) {
  const code = `import importlib.util, sys
spec = importlib.util.spec_from_file_location('build_apps', sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
try:
    module.check_voice_pack(module.Path(sys.argv[2]).resolve()); print('OK')
except RuntimeError as error:
    print('REFUSED', error)`;
  const r = spawnSync(python, ['-c', code, path.join(root, 'work/build-apps.py'), pack], {cwd:root, encoding:'utf8'});
  if (r.status !== 0) throw new Error(r.stderr || 'python failed');
  return r.stdout.trim();
}
function zip(file, entries) {
  const code = `import zipfile, sys, json
entries = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    for name, text in entries: z.writestr(name, text)`;
  const r = spawnSync(python, ['-c', code, file, JSON.stringify(entries)], {encoding:'utf8'});
  if (r.status !== 0) throw new Error(r.stderr);
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-voicepack-'));
const ignoredDir = path.join(root, 'private-voices'), createdIgnored = !fs.existsSync(ignoredDir);
const tracked = path.join(root, 'work/tests/voice-pack-should-not-be-here.voicepack');
const manifest = model => JSON.stringify({version:1, model_sha256:model, files:{}});
try {
  const good = path.join(outside, 'voices.zip');
  zip(good, [['manifest.json', manifest(pinned)], ['catalog.json', '{"voices":[]}'], ['models/config.yaml', 'x']]);
  assert.equal(check(good), 'OK', 'a pack outside the repository is accepted');

  fs.mkdirSync(ignoredDir, {recursive:true});
  const ignored = path.join(ignoredDir, 'voices.zip'); fs.copyFileSync(good, ignored);
  assert.equal(check(ignored), 'OK', 'a pack in the ignored private-voices/ folder is accepted');

  fs.copyFileSync(good, tracked);
  assert.match(check(tracked), /^REFUSED Keep the private voice pack outside the repository/, 'a pack where git would commit it is refused');

  const order = path.join(outside, 'order.zip');
  zip(order, [['catalog.json', '{}'], ['manifest.json', manifest(pinned)]]);
  assert.match(check(order), /^REFUSED This is not a ThingsBook private Android voice pack/);

  const other = path.join(outside, 'other.zip');
  zip(other, [['manifest.json', manifest('0'.repeat(64))], ['catalog.json', '{}']]);
  assert.match(check(other), /^REFUSED This voice pack is for a different voice model/);

  assert.match(check(path.join(outside, 'missing.zip')), /^REFUSED Voice pack not found/);
  console.log('PASS --voice-pack accepts the pinned-model pack from outside the repository or private-voices/, and refuses a committable location, a malformed pack, another model and a missing file');
} finally {
  fs.rmSync(outside, {recursive:true, force:true});
  fs.rmSync(tracked, {force:true});
  if (createdIgnored) fs.rmSync(ignoredDir, {recursive:true, force:true}); else fs.rmSync(path.join(ignoredDir, 'voices.zip'), {force:true});
}
