"""Retry the unstable USB connection, then run the no-save Omnibus probe."""
from pathlib import Path
import subprocess,sys,time,json
root=Path(__file__).resolve().parents[3];folder=Path(__file__).resolve().parent
adb=root.parent.parent/'2026-10-03/https-github-com-louis-cfm-coucou/work/android-tools/sdk/platform-tools/adb.exe'
def run(*args,timeout=25):
 return subprocess.run([str(adb),'-s','R5CR61381RX',*map(str,args)],capture_output=True,text=True,timeout=timeout)
deadline=time.monotonic()+90
while '--cleanup' not in sys.argv and time.monotonic()<deadline:
 try:
  if run('get-state',timeout=8).stdout.strip()=='device':
   upgraded=run('install','--no-streaming','--no-incremental','-r',root/'outputs/ThingsBook-Android-1.12.5.apk',timeout=45)
   if upgraded.returncode!=0:continue
   installed=run('install','--no-streaming','--no-incremental','-r',folder/'PRIVATE-device-checks.apk',timeout=40)
   if installed.returncode==0:
    subprocess.run([sys.executable,str(folder/'run.py'),'--reader','--boundary' if '--boundary' in sys.argv else '--omnibus'],cwd=root,timeout=210)
    break
 except subprocess.TimeoutExpired:pass
 time.sleep(5)
cleanup={'test_package_removed':False,'reason':'USB unavailable','library_data_cleared':False}
for attempt in range(12):
 try:
  state=run('shell','pm','list','packages','com.thingsbook.devicechecks')
  if state.returncode==0:
   if 'com.thingsbook.devicechecks' in state.stdout:run('uninstall','com.thingsbook.devicechecks')
   state=run('shell','pm','list','packages','com.thingsbook.devicechecks')
   cleanup['test_package_removed']=state.returncode==0 and 'com.thingsbook.devicechecks' not in state.stdout
   if cleanup['test_package_removed']:
    cleanup['reopen_exit_code']=run('shell','am','start','-n','com.thingsbook.library/.MainActivity').returncode
    if cleanup['reopen_exit_code']==0:cleanup.pop('reason',None);break
 except subprocess.TimeoutExpired:pass
 time.sleep(5)
(folder/'cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n')
print(json.dumps(cleanup))
