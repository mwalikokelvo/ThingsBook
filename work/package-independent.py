from pathlib import Path
import shutil,zipfile,hashlib,json
root=Path(__file__).resolve().parents[1];desktop=root/'work/thingsbook-desktop';dist=desktop/'node_modules/electron/dist'
assert (dist/'electron.exe').exists(),'Electron runtime is missing'
archive=root/'work/thingsbook-independent-runtime.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6,strict_timestamps=False) as bundle:
 for p in sorted(dist.rglob('*')):
  if not p.is_file():continue
  relative=p.relative_to(dist).as_posix()
  if relative=='electron.exe':relative='ThingsBook.exe'
  if relative=='resources/default_app.asar':continue
  if relative.startswith('locales/') and p.stem not in ('en-US','en-GB'):continue
  bundle.write(p,relative)
 for p in sorted((desktop/'web').rglob('*')):
  if p.is_file():bundle.write(p,'resources/app/web/'+p.relative_to(desktop/'web').as_posix())
 for name in ('main.cjs','catalog.cjs','zlibrary.cjs','native-core.cjs','voice-catalog.cjs','preload.cjs','custom-voice.py','narration_text.py','package.json','icon.ico'):bundle.write(desktop/name,'resources/app/'+name)
 bundle.write(desktop/'native/ProviderProtection.exe','resources/ProviderProtection.exe')
 bundle.write(desktop/'native/SpeechBridge.exe','resources/SpeechBridge.exe')
 bundle.write(desktop/'native/thingsbook-core.exe','resources/thingsbook-core.exe')
 for p in (desktop/'native-licenses').rglob('*'):
  if p.is_file():bundle.write(p,'resources/native-licenses/'+p.relative_to(desktop/'native-licenses').as_posix())
with zipfile.ZipFile(archive) as bundle:
 assert bundle.testzip() is None
 assert 'ThingsBook.exe' in bundle.namelist()
 assert 'resources/app/main.cjs' in bundle.namelist()
 assert all('..' not in name.split('/') and not name.startswith('/') for name in bundle.namelist())
 for p in (desktop/'web').rglob('*'):
  if p.is_file():assert bundle.read('resources/app/web/'+p.relative_to(desktop/'web').as_posix())==p.read_bytes()
print(f'Runtime ZIP verified: {archive.stat().st_size:,} bytes; official Electron plus final ThingsBook reader and native speech helper.')
