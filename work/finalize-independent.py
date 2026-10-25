from pathlib import Path
import hashlib,zipfile,json
root=Path(__file__).resolve().parents[1];out=root/'outputs';desktop=root/'work/thingsbook-desktop'
version=json.loads((desktop/'package.json').read_text())['version']
exe=out/f'ThingsBook-Independent-{version}.exe';payload=root/'work/thingsbook-independent-runtime.zip'
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
needle=payload.open('rb').read(128);offset=None;carry=b'';position=0
with exe.open('rb') as stream:
 while True:
  block=stream.read(1024*1024)
  if not block:break
  combined=carry+block;found=combined.find(needle)
  if found>=0:offset=position-len(carry)+found;break
  carry=combined[-127:];position+=len(block)
assert offset is not None,'Embedded runtime was not found'
h=hashlib.sha256();remaining=payload.stat().st_size
with exe.open('rb') as stream:
 stream.seek(offset)
 while remaining:
  block=stream.read(min(1024*1024,remaining));assert block;h.update(block);remaining-=len(block)
assert h.hexdigest()==digest(payload),'Embedded runtime differs from the verified bundle'
source=out/f'ThingsBook-Independent-Source-{version}.zip'
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED,strict_timestamps=False) as archive:
 for name in ('main.cjs','catalog.cjs','zlibrary.cjs','native-core.cjs','voice-catalog.cjs','preload.cjs','custom-voice.py','narration_text.py','package.json','package-lock.json','icon.ico'):
  archive.write(desktop/name,'work/thingsbook-desktop/'+name)
 for p in (desktop/'native').glob('*.cs'):archive.write(p,'work/thingsbook-desktop/native/'+p.name)
 for p in (desktop/'native-licenses').rglob('*'):
  if p.is_file():archive.write(p,'work/thingsbook-desktop/native-licenses/'+p.relative_to(desktop/'native-licenses').as_posix())
 for name in ('build-apps.py','Build-Independent.ps1','prepare-independent.py','package-independent.py','finalize-independent.py'):archive.write(root/'work'/name,'work/'+name)
 for name in ('Cargo.toml','Cargo.lock','uniffi.toml','README.md'):archive.write(root/'core'/name,'core/'+name)
 for p in (root/'core/src').rglob('*.rs'):archive.write(p,'core/'+p.relative_to(root/'core').as_posix())
 for p in (out/'ThingsBook').rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.rsp':archive.write(p,'outputs/ThingsBook/'+p.relative_to(out/'ThingsBook').as_posix())
 archive.write(out/f'ThingsBook-Start-here-{version}.txt','Start-here.txt')
names=(exe.name,source.name,f'ThingsBook-Start-here-{version}.txt')
(out/'ThingsBook-Independent-SHA256.txt').write_text('\n'.join(digest(out/name)+'  '+name for name in names)+'\n')
print(f'PASS: independent EXE contains the exact verified runtime payload ({payload.stat().st_size:,} bytes).')
print('Independent EXE, editable source, migration guide and checksums are ready.')
