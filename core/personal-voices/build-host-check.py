from pathlib import Path
import os,subprocess,json,hashlib,time
r=Path(__file__).resolve().parents[2];src=Path(__file__).resolve().parent;target=r/'work/android-voice-probe/target';tool=r/'work/native-toolchain/rustup/toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin';e=dict(os.environ,CARGO_HOME=str(r/'work/native-toolchain/cargo'),RUSTUP_HOME=str(r/'work/native-toolchain/rustup'),RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-gnu',CARGO_TARGET_DIR=str(target),RAYON_NUM_THREADS='4');e['CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER']=str(tool/'rust-lld.exe');e['CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS']='-C linker-flavor=ld.lld -C link-self-contained=yes';e['PATH']=str(r/'work/native-toolchain/llvm-mingw/full/bin')+os.pathsep+e['PATH']
with (r/'work/tests/voices-host-build-1120.log').open('w',encoding='utf-8') as log:
 result=subprocess.run([str(r/'work/native-toolchain/cargo/bin/cargo.exe'),'build','--locked','--offline','--manifest-path',str(src/'Cargo.toml'),'--target','x86_64-pc-windows-gnu','--release','--bin','compatibility'],env=e,stdout=log,stderr=subprocess.STDOUT)
if result.returncode:raise SystemExit('Host voice build failed; inspect retained log.')
pack=Path(os.environ['LOCALAPPDATA'])/'ThingsBookDesktop/VoicePack';exe=target/'x86_64-pc-windows-gnu/release/compatibility.exe';voices=sorted((pack/'voices').glob('*.safetensors'));report={'scope':'Production memory-state importer; host CPU numerical inference, not Android/device/likeness acceptance','private_audio_written':False,'voices':[],'source_sha256':{str(p.relative_to(src)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (src/'src').rglob('*.rs')}}
for index,voice in enumerate(voices,1):
 result=subprocess.run([str(exe),str(pack/'models'),str(voice)],env=e,capture_output=True,text=True,timeout=180)
 item=json.loads(result.stdout) if result.returncode==0 else {'passed':False,'error':'Host inference failed; private paths omitted'}
 item.update(voice_index=index);item['passed']=result.returncode==0 and item.get('all_finite') and item.get('non_silent') and item.get('sample_rate')==24000 and item.get('samples',0)>0;report['voices'].append(item);print('Voice '+str(index)+': '+('PASS' if item['passed'] else 'FAIL'),flush=True)
 report['all_passed']=len(report['voices'])==15 and all(i['passed'] for i in report['voices']);(r/'work/tests/voices-host-1120.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
assert report['all_passed']
