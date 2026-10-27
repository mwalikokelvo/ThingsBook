// The desktop personal-voice worker (custom-voice.py) with a stand-in model: a "cancel" message stops
// the passage being generated within a frame and drops queued ones, the same worker then reads the
// next passage, and the model is loaded only once. Stopping or turning a page used to restart the
// worker and reload the model, which delayed the next words by 10-20 seconds. Needs Python 3.
'use strict';
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const python = ['python3', 'python'].find(cmd => spawnSync(cmd, ['--version']).status === 0);
if (!python) { console.log('SKIP: Python 3 is not installed.'); process.exit(0); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-voice-worker-')), stubs = path.join(root, 'stubs'), pack = path.join(root, 'pack');
for (const dir of [stubs, path.join(pack, 'models'), path.join(pack, 'voices')]) fs.mkdirSync(dir, {recursive:true});
fs.writeFileSync(path.join(pack, 'ready.json'), JSON.stringify({engine:'pocket-tts', validated:true, voices:[{id:'test-voice', name:'Test voice'}]}));
fs.writeFileSync(path.join(pack, 'models/config.yaml'), JSON.stringify({weights_path:'model.safetensors', flow_lm:{lookup_table:{tokenizer_path:'tokenizer.json'}}}));
fs.writeFileSync(path.join(stubs, 'torch.py'), 'def set_num_threads(n):\n    pass\n');
fs.writeFileSync(path.join(stubs, 'yaml.py'), 'import json\ndef safe_load(text):\n    return json.loads(text)\n');
fs.writeFileSync(path.join(stubs, 'numpy.py'), [
  'class A:', '    def __mul__(self, other): return self', '    def astype(self, kind): return self', '    def tobytes(self): return bytes(200)', '    def all(self): return True',
  'def isfinite(a): return A()', 'def clip(a, low, high): return a', ''].join('\n'));
fs.writeFileSync(path.join(stubs, 'pocket_tts.py'), [
  'import os, time', 'class Chunk:', '    def detach(self): return self', '    def cpu(self): return self', '    def numpy(self):', '        import numpy', '        return numpy.A()',
  'class TTSModel:', '    sample_rate = 24000',
  '    @staticmethod', '    def load_model(config):', `        open(${JSON.stringify(path.join(root, 'loads.txt'))}, 'a').write('load\\n')`, '        return TTSModel()',
  '    def get_state_for_audio_prompt(self, path): return "state"',
  '    def generate_audio_stream(self, state, text):', '        for _ in range(40 if text.startswith("Long") else 3):', '            time.sleep(0.05)', '            yield Chunk()', ''].join('\n'));

const worker = spawn(python, ['-u', path.join(__dirname, '../thingsbook-desktop/custom-voice.py'), pack], {env:{...process.env, PYTHONPATH:stubs}, stdio:['pipe', 'pipe', 'inherit']});
const events = []; let buffer = '';
worker.stdout.on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); const value = JSON.parse(line); events.push({...value, at:Date.now()}); } });
const send = value => worker.stdin.write(JSON.stringify(value) + '\n');
const until = async (check, ms = 10000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + check); await new Promise(r => setTimeout(r, 20)); } };
const finished = id => events.find(e => e.id === id && (e.done || e.error));

(async () => {
  send({id:1, mode:'stream', voice:'test-voice', text:'Long passage that is stopped part way.'});
  await until(() => events.some(e => e.id === 1 && e.pcm));
  const cancelledAt = Date.now(); send({mode:'cancel', upto:1});
  await until(() => finished(1));
  assert.equal(finished(1).error, 'cancelled'); assert(finished(1).at - cancelledAt < 600, 'stops within a frame or two');
  const frames = events.filter(e => e.id === 1 && e.pcm).length; assert(frames < 40, `stopped after ${frames} of 40 frames`);
  send({id:2, mode:'stream', voice:'test-voice', text:'Next passage.'});
  send({id:3, mode:'stream', voice:'test-voice', text:'Queued passage that is released.'});
  send({id:4, mode:'stream', voice:'test-voice', text:'Passage after it.'});
  send({mode:'cancel', ids:[3]});
  await until(() => finished(2) && finished(3) && finished(4));
  assert.equal(finished(2).done, true); assert.equal(finished(3).error, 'cancelled'); assert.equal(finished(4).done, true);
  assert(!events.some(e => e.id === 3 && e.pcm), 'a released queued passage is never generated');
  worker.stdin.end(); await new Promise(r => worker.once('exit', r));
  assert.equal(fs.readFileSync(path.join(root, 'loads.txt'), 'utf8').trim().split('\n').length, 1, 'the model was loaded once');
  fs.rmSync(root, {recursive:true, force:true});
  console.log(`PASS: a cancelled passage stopped after ${frames} frames, a released queued passage was skipped, and the same worker (model loaded once) read the following passages.`);
})().catch(error => { console.error(error); worker.kill(); fs.rmSync(root, {recursive:true, force:true}); process.exit(1); });
