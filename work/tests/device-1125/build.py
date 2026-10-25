"""Build a PRIVATE removable signed instrumentation harness; no production APK edits."""
from pathlib import Path
import subprocess,zipfile,sys
root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent
tools=root.parent.parent/'2026-10-03/https-github-com-louis-cfm-coucou/work/android-tools'
jdk=next((tools/'jdk').iterdir())/'bin'
sdk=tools/'sdk/build-tools/35.0.0'
platform=tools/'sdk/platforms/android-35/android.jar'
def run(*args):subprocess.run([str(x) for x in args],check=True,cwd=root)
for name in ['classes','dex']:(out/name).mkdir(exist_ok=True)
(out/'AndroidManifest.xml').write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.thingsbook.devicechecks"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/><application android:label="ThingsBook private device checks" android:allowBackup="false"/><instrumentation android:name=".DeviceChecks" android:targetPackage="com.thingsbook.library" android:label="Private ThingsBook numerical checks"/><instrumentation android:name=".ReaderChecks" android:targetPackage="com.thingsbook.library" android:label="Private ThingsBook reader checks"/></manifest>''',encoding='utf-8')
run(jdk/'javac.exe','-encoding','UTF-8','--release','8','-cp',platform,'-d',out/'classes',*sorted(out.glob('*.java')))
run(jdk/'jar.exe','cf',out/'classes.jar','-C',out/'classes','.')
run(jdk/'java.exe','-cp',sdk/'lib/d8.jar','com.android.tools.r8.D8','--release','--min-api','26','--lib',platform,'--output',out/'dex',out/'classes.jar')
run(sdk/'aapt2.exe','link','-o',out/'unsigned.apk','--manifest',out/'AndroidManifest.xml','-I',platform)
with zipfile.ZipFile(out/'unsigned.apk','a') as z:
 z.write(out/'dex/classes.dex','classes.dex')
 z.write(out/('omnibus-continuous.js' if '--boundary' in sys.argv else 'omnibus-checks.js' if '--omnibus' in sys.argv else 'playback-checks.js' if '--real-book' in sys.argv else 'reader-checks.js'),'assets/reader-checks.js')
 if '--include-private-pack' in sys.argv:
  z.write(root/'outputs/ThingsBook-PRIVATE-Android-Voices-1.12.0.tbvoices','assets/private.tbvoices',compress_type=zipfile.ZIP_STORED)
run(sdk/'zipalign.exe','-f','4',out/'unsigned.apk',out/'aligned.apk')
sign=root/'work/thingsbook-signing'
run(jdk/'java.exe','-jar',sdk/'lib/apksigner.jar','sign','--ks',sign/'thingsbook-release.jks','--ks-key-alias','thingsbook','--ks-pass','file:'+str(sign/'password.txt'),'--out',out/'PRIVATE-device-checks.apk',out/'aligned.apk')
print('PRIVATE instrumentation built. Never add this APK to source/public archives.')
