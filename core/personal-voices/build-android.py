"""Rebuild public ARM64 JNI library with16KB load segments; no models/voices bundled."""
from pathlib import Path
import os,subprocess,shutil,sys
r=Path(__file__).resolve().parents[2];src=Path(__file__).resolve().parent;tools=r.parent.parent/'2026-10-03/https-github-com-louis-cfm-coucou/work/android-tools';ndk=tools/'sdk/ndk/27.0.12077973';tool=ndk/'toolchains/llvm/prebuilt/windows-x86_64/bin';target=r/'work/android-voice-probe/target'
e=dict(os.environ,CARGO_HOME=str(r/'work/native-toolchain/cargo'),RUSTUP_HOME=str(r/'work/native-toolchain/rustup'),RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-gnu',CARGO_TARGET_DIR=str(target),RAYON_NUM_THREADS='4')
e['PATH']=str(r/'work/native-toolchain/cargo/bin')+os.pathsep+str(tool)+os.pathsep+e['PATH'];e['CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER']=str(tool/'aarch64-linux-android26-clang.cmd');e['CC_aarch64_linux_android']=str(tool/'aarch64-linux-android26-clang.cmd');e['CXX_aarch64_linux_android']=str(tool/'aarch64-linux-android26-clang++.cmd');e['AR_aarch64_linux_android']=str(tool/'llvm-ar.exe')
log=r/'work/tests/android-voices-build-1120.log'
with log.open('w',encoding='utf-8') as f:
 result=subprocess.run([str(r/'work/native-toolchain/cargo/bin/cargo.exe'),'rustc','--locked','--offline','--manifest-path',str(src/'Cargo.toml'),'--lib','--target','aarch64-linux-android','--release','--','-C','link-arg=-Wl,-z,max-page-size=16384'],env=e,stdout=f,stderr=subprocess.STDOUT)
if result.returncode:raise SystemExit('Native voice build failed; see '+str(log))
so=target/'aarch64-linux-android/release/libthingsbook_voices.so';dest=r/'outputs/ThingsBook/android/jniLibs/arm64-v8a/libthingsbook_voices.so';dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(so,dest);print('PASS: native Android personal voice library built (no private assets).')
