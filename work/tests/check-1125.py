"""Record relevant tests for the 1.12.5 source; no private profiles are used."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
results=[]
previous=None
if '--failed' in sys.argv:
    previous=json.loads((ROOT/'work/tests/verification-1125.json').read_text())
    for name,digest in previous['source_sha256'].items():
        assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest,'Production source changed; run a full fresh verification'
commands=[['node','work/tests/'+name] for name in ('provider-1125.cjs','catalog-1125.cjs','dependency-lock-1125.cjs','reader-checkpoint-1125.cjs','pdf-import-196.cjs','excerpt-export-1125.cjs','voice-catalog.cjs','verify-storage-1125.cjs','storage-preflight-1125.cjs','vault.cjs','device-access.cjs','listening.cjs','native-desktop.cjs','reader-loading.cjs','ocr-controller.cjs','sanctuary.cjs','research.cjs')]
commands += [['node','work/tests/llama-recovery-1125.cjs']]
commands += [['node','work/tests/'+name] for name in ('rechunk-1125.cjs','reader-end-checkpoint-1125.cjs','scanned-pdf-1125.cjs')]
commands += [['node','work/tests/reader-continuous.cjs',str(path)] for path in ('outputs/ThingsBook/reader.js','work/thingsbook-desktop/web/reader.js')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/import-electron.cjs',path] for path in ('outputs/ThingsBook','work/thingsbook-desktop/web')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/voice-cancel-race-1125.cjs']]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/pdf-import-electron-1125.cjs']]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/excerpt-export-electron-1125.cjs',path] for path in ('outputs/ThingsBook','work/thingsbook-desktop/web')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/storage-preflight-electron-1125.cjs',path] for path in ('outputs/ThingsBook','work/thingsbook-desktop/web')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/ui-efficiency-electron-1125.cjs',path] for path in ('outputs/ThingsBook','work/thingsbook-desktop/web')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/dock-electron-1125.cjs']]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/import-recovery-electron-1125.cjs',path] for path in ('outputs/ThingsBook','work/thingsbook-desktop/web')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/discovery-electron-1125.cjs',path] for path in ('outputs/ThingsBook','work/thingsbook-desktop/web')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/provider-electron-1125.cjs',path] for path in ('outputs/ThingsBook','work/thingsbook-desktop/web')]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/android-neural-electron-1125.cjs']]
commands += [[str(ROOT/'work/thingsbook-desktop/node_modules/electron/dist/electron.exe'),'work/tests/llama-integration-1125.cjs']]
for command in commands:
    old=next((v for v in previous['tests'] if v['command']==command),None) if previous else None
    if old and old['exit_code']==0:
        results.append(old)
        continue
    result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=100)
    results.append({'command':command,'exit_code':result.returncode,'stdout':result.stdout.strip(),'stderr':result.stderr.strip()})
    print(('PASS' if result.returncode==0 else 'FAIL')+': '+' '.join(command),flush=True)
    if result.returncode:
        print(result.stdout+result.stderr,flush=True)
report={'version':'1.12.5','tests':results,'source_sha256':{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (ROOT/'outputs/ThingsBook').rglob('*.js')}}
if previous:report['prior_attempts']=previous.get('prior_attempts',[])+[previous['tests']]
(ROOT/'work/tests/verification-1125.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
if any(item['exit_code'] for item in results):raise SystemExit(1)
