"""Run the real EXE using isolated, synthetic-only profiles and native UI tests."""
from pathlib import Path
import json
import os
import subprocess
import time
import uuid

ROOT=Path(__file__).resolve().parents[2]
folder=ROOT/'work'/('packaged-smoke-1125-'+uuid.uuid4().hex)
folder.mkdir()
result=folder/'result.json'
env=dict(os.environ,THINGSBOOK_TEST_RUNTIME=str(folder/'runtime'),THINGSBOOK_TEST_PROFILE=str(folder/'profile'),
         THINGSBOOK_TEST_HIDDEN='1',THINGSBOOK_SMOKE_NATIVE='1',THINGSBOOK_SMOKE_RESULT=str(result))
launch=subprocess.run([str(ROOT/'outputs/ThingsBook-Independent-1.12.5.exe')],env=env,timeout=120)
if launch.returncode:raise SystemExit('Packaged launcher failed: '+str(launch.returncode))
deadline=time.monotonic()+90
while not result.exists() and time.monotonic()<deadline:time.sleep(.25)
if not result.exists():raise SystemExit('Packaged app did not return its smoke result.')
data=json.loads(result.read_text(encoding='utf-8'))
assert not data.get('error'),data
assert all(data.get(name) for name in ('secure','storage','crypto','desktop','pdf','epub')),data
assert data['title']=='ThingsBook '+chr(183)+' Your private reading room',data
assert data['version']=='1.12.5' and all(data['native'].values()),data
reopen=folder/'restart.json'
env.pop('THINGSBOOK_SMOKE_NATIVE')
env.update(THINGSBOOK_SMOKE_REOPEN='1',THINGSBOOK_SMOKE_RESULT=str(reopen))
# Wait for the first Electron process to release its profile lock.
time.sleep(1)
subprocess.run([str(ROOT/'outputs/ThingsBook-Independent-1.12.5.exe')],env=env,timeout=120,check=True)
deadline=time.monotonic()+90
while not reopen.exists() and time.monotonic()<deadline:time.sleep(.25)
assert reopen.exists(),'Second packaged process did not report its result'
restarted=json.loads(reopen.read_text(encoding='utf-8'))
assert not restarted.get('error') and all(restarted['reopen'].values()),restarted
data['restart']=restarted['reopen']
(ROOT/'work/tests/packaged-smoke-1125.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print('PASS: real Windows EXE extraction/startup, secure renderer, packaged native worker, search, Unicode and lock cleanup in an isolated synthetic profile.')
