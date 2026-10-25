from pathlib import Path
import subprocess,json,hashlib,sys,datetime
root=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent
adb=root.parent.parent/'2026-10-03/https-github-com-louis-cfm-coucou/work/android-tools/sdk/platform-tools/adb.exe'
reader='--reader' in sys.argv
stem='reader-instrumentation' if reader else 'instrumentation'
report_name='boundary-report.json' if '--boundary' in sys.argv else 'reader-report.json' if reader else 'report.json'
for name in [stem+'.log',report_name]:
 previous=out/name
 if previous.exists():previous.rename(out/(previous.stem+'-prior-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+previous.suffix))
cmd=[str(adb),'-s','R5CR61381RX','shell','am','instrument','-w','-e','installPack','true','com.thingsbook.devicechecks/.'+('ReaderChecks' if reader else 'DeviceChecks')]
with (out/(stem+'.log')).open('w',encoding='utf-8') as log:
 p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace')
 for line in p.stdout:
  log.write(line);log.flush();print(line.rstrip(),flush=True)
 code=p.wait()
lines=(out/(stem+'.log')).read_text(encoding='utf-8').splitlines()
raw=next((s.split('report=',1)[1] for s in lines if s.startswith('INSTRUMENTATION_RESULT: report=')),None)
if raw is None:raise SystemExit('No final device report; inspect retained instrumentation log.')
report=json.loads(raw);report['adb_exit_code']=code
version=json.loads((root/'work/thingsbook-desktop/package.json').read_text())['version']
apk=root/('outputs/ThingsBook-Android-'+version+'.apk')
installed=subprocess.run([str(adb),'-s','R5CR61381RX','shell','dumpsys','package','com.thingsbook.library'],capture_output=True,text=True,check=True).stdout
if 'versionName='+version not in installed:raise SystemExit('Installed Android version does not match selected APK version.')
report['version']=version
report['production_apk_sha256']=hashlib.sha256(apk.read_bytes()).hexdigest()
report['test_java_sha256']=hashlib.sha256((out/('ReaderChecks.java' if reader else 'DeviceChecks.java')).read_bytes()).hexdigest()
if reader:report['test_js_sha256']=hashlib.sha256((out/('omnibus-continuous.js' if '--boundary' in sys.argv else 'omnibus-checks.js' if '--omnibus' in sys.argv else 'playback-checks.js' if '--real-book' in sys.argv else 'reader-checks.js')).read_bytes()).hexdigest()
report['not_tested']=['human listening and likeness','screen-off and Bluetooth/call controls','pre/post private library equivalence','full Unified v5 requirements']
if not reader:report['not_tested'].append('actual reader page transitions; see separate reader report')
(out/report_name).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
sys.exit(0 if code==0 and report.get('all_passed') else 1)
