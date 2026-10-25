"""Verify the recovered Llama release; never substitute host tests for a phone."""
from pathlib import Path
import hashlib,json,subprocess,zipfile,re
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'outputs';APP=OUT/'ThingsBook';VERSION='1.12.5'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
baseline=read(OUT/'ThingsBook-1.12.4-Verification.json')
for name,item in baseline['artifacts'].items():assert sha(OUT/name)==item['sha256'],'Prior release changed: '+name
tests=read(ROOT/'work/tests/verification-1125.json');assert len(tests['tests'])==42 and all(t['exit_code']==0 for t in tests['tests'])
for name,digest in tests['source_sha256'].items():assert sha(ROOT/name)==digest,'Source changed since checks: '+name
integration=read(ROOT/'work/tests/llama-integration-1125.json')
assert all(integration['result'].values()) and integration['schema2Reopen'] and not integration['errors'] and not integration['network']
assert integration['test_sha256']==sha(ROOT/'work/tests/llama-integration-1125.cjs')
ui=read(ROOT/'work/tests/ui-efficiency-shared-1125.json')
for name,digest in ui['source_sha256'].items():assert sha(APP/name)==digest
smoke=read(ROOT/'work/tests/packaged-smoke-1125.json');assert smoke['version']==VERSION and all(smoke['native'].values()) and all(smoke['restart'].values())
scan=read(ROOT/'work/tests/scanned-runtime-1125.json');assert all(scan[k] for k in ['rendered','noEmbeddedText','scanStopsWithoutRecognition','offlineRecognition']) and scan['reader_sha256']==sha(APP/'reader.js')
stream=read(ROOT/'work/tests/streaming-runtime-1125.json')
for k in ['continuous','pauseResume','seekAndRanges','privacyStreamReleased','pdfContinuous']:assert stream[k]
assert len(stream['voices'])==15
for name,digest in stream['source_sha256'].items():assert sha(ROOT/'work/thingsbook-desktop'/name)==digest
apk=OUT/f'ThingsBook-Android-{VERSION}.apk';device=ROOT/'work/tests/device-1125'
phone=read(device/'reader-report.json') if (device/'reader-report.json').exists() else None
if phone:
 assert phone['version']==VERSION and phone['production_apk_sha256']==sha(apk)
 assert phone['test_js_sha256']==sha(device/'omnibus-checks.js') and phone['test_java_sha256']==sha(device/'ReaderChecks.java')
physical_passed=bool(phone and phone.get('all_passed'))
if physical_passed:
 cleanup=read(device/'cleanup.json');assert cleanup['test_package_removed'] and cleanup['reopen_exit_code']==0 and not cleanup['library_data_cleared']
asset_count=0
with zipfile.ZipFile(apk) as a,zipfile.ZipFile(OUT/'ThingsBook-Android-1.12.4.apk') as old:
 assert a.testzip() is None and b'setMediaPlaybackRequiresUserGesture' in a.read('classes.dex')
 assert all(n in a.namelist() for n in old.namelist() if n.startswith('assets/web/'))
 assert a.read('assets/native/arm64-v8a/libthingsbook_voices.so')==old.read('assets/native/arm64-v8a/libthingsbook_voices.so')
 assert a.read('assets/web/vendor/citation.js')==(APP/'vendor/citation.js').read_bytes()
 for p in APP.rglob('*'):
  if not p.is_file() or 'android' in p.relative_to(APP).parts:continue
  name='assets/web/'+p.relative_to(APP).as_posix()
  if name in a.namelist():assert a.read(name)==p.read_bytes();asset_count+=1
tools=ROOT.parent.parent/'2026-10-03/https-github-com-louis-cfm-coucou/work/android-tools'
jdk=next((tools/'jdk').iterdir())/'bin/java.exe';signer=tools/'sdk/build-tools/35.0.0/lib/apksigner.jar'
r=subprocess.run([str(jdk),'-jar',str(signer),'verify','--verbose','--print-certs',str(apk)],capture_output=True,text=True,check=True)
assert all('Verified using '+s+' scheme (APK Signature Scheme '+s+'): true' in r.stdout for s in ['v2','v3'])
certificate=re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)',r.stdout).group(1);assert certificate==baseline['original_android_certificate_sha256']
source=OUT/f'ThingsBook-Independent-Source-{VERSION}.zip'
with zipfile.ZipFile(source,'a',zipfile.ZIP_DEFLATED,strict_timestamps=False) as a,zipfile.ZipFile(OUT/'ThingsBook-Independent-Source-1.12.4.zip') as old:
 names=set(a.namelist())
 for name in old.namelist():
  if name not in names and name.startswith('core/personal-voices/'):a.writestr(name,old.read(name));names.add(name)
 paths=list((ROOT/'work/tests').glob('*1125.cjs'))+list((ROOT/'work/tests').glob('*1125.js'))+[ROOT/'work/tests/check-1125.py',ROOT/'work/tests/launch-packaged-1125.py',ROOT/'work/tests/research.cjs',Path(__file__)]+[p for p in device.iterdir() if p.suffix in ('.java','.js','.py')]
 for p in paths:
  name=p.relative_to(ROOT).as_posix()
  if name in names:assert a.read(name)==p.read_bytes(),'Regenerate archive after test source changes'
  else:a.write(p,name);names.add(name)
with zipfile.ZipFile(source) as a:
 assert a.testzip() is None and len(a.namelist())==len(set(a.namelist()))
 assert all(Path(n).suffix.lower() not in ('.jks','.m4a','.mp3','.wav','.safetensors','.tbvoices','.dpapi') for n in a.namelist())
 assert all('PRIVATE-device' not in n and 'private.tbvoices' not in n for n in a.namelist())
 for p in APP.rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.rsp':assert a.read(p.relative_to(ROOT).as_posix())==p.read_bytes()
status=read(OUT/'ThingsBook-1.12.4-Directive-status.json');status.update(release=VERSION,date='2026-10-23',completion='Partial Unified v5; recovered Llama reader/research/import changes with matching Windows and Android packages')
status['delivered']+=[
 'Recovered startup syntax and research tools overwritten by partial Llama edits; original partial source snapshot retained locally',
 'Staged PDF page image/transcript layout with desktop columns, mobile stacked panes and saved transcript scroll',
 'Bidirectional highlight links, target pickers, passage navigation/removal and graph edges inside encrypted book metadata; concurrent changes and encrypted backup tested',
 'Publisher metadata editor and APA/MLA/Chicago/BibTeX citation drafts; existing flashcards, footnotes and comparison retained',
 'Content-aware PDF/EPUB classification despite renamed extensions; manual metadata overrides, bounded imports and retry retained',
 'Existing prototype schema2 can reopen without a forced database downgrade; no new plaintext links store',
 'Fresh42 regression groups and Windows EXE/native narration/OCR verification; original-key matching Android APK']
status['partial']['annotations']='Encrypted bidirectional links between saved highlights delivered. Exact CFI/character-range anchors, inline marginalia and stylus overlays remain pending.'
status['partial']['citations']='Publisher-aware plain-text drafts and BibTeX integrated into existing Cite UI; names, editions and formal style correctness require review.'
status['partial']['comparison']='EPUB/TXT comparison retained; PDF page-image/transcript layout delivered. Comparing two different PDF books and FPS acceptance remain pending.'
status['partial']['metadata']='Content-aware PDF/EPUB import and publisher editor delivered;100MB bound retained. Large-file streaming and additional formats are pending.'
status['partial']['listening']='Fresh Windows15-voice EPUB/PDF continuation and authored-scan OCR passed. Earlier physical Omnibus checks are historical; see current device status. Full-book/background endurance pending.'
status['partial']['personal_voices']='Windows15 voices freshly generated; Android native runtime/private pack unchanged. Human likeness and current sustained/background Android acceptance remain pending.'
status['verification_limits']=[
 'Full Unified v5 remains partial: native Android UI/storage/FTS, semantic search/RAG, sync, precise annotation ranges and other not_implemented items are not completed.',
 'No full1,983-page, overnight/background, screen-off/Bluetooth/call/battery or human voice-quality acceptance.',
 '100MB import limit retained; the prototype500MB increase lacked streaming/memory support. PDF/EPUB/TXT only; no DRM bypass.',
 'Citation output is a draft from saved metadata, not a comprehensive formal-style engine.',
 'Windows/OCR timings are single-run observations; cold startup and scan-recognition pauses remain.',
 'Old-release removal remains pending after an earlier policy rejection; no old installers, books, voice models, recordings, backups or signing material were deleted in this recovery.']
if physical_passed:status['delivered'].append('Fresh physical Android recovered-reader panes, research/citation APIs and local scan recognition passed; temporary harness removed')
else:status['verification_limits'].append('No fresh physical Android1.12.5 acceptance: ADB did not expose a usable phone during this run. APK signing, exact assets and Android bridge host regressions passed; these are not physical acceptance.')
if not stream['streamedBeforeComplete']:status['verification_limits'].append('Windows playback-before-complete-generation target not established in this run.')
(OUT/f'ThingsBook-{VERSION}-Directive-status.json').write_text(json.dumps(status,indent=2)+'\n',encoding='utf-8')
performance={'scope':'Fresh Windows production model, authored scanned-page OCR and responsive host UI; Android exact-device status separate','windows_cold_load_ms':stream['warmMilliseconds'],'windows_first_audio_ms':stream['firstPlayMilliseconds'],'windows_epub_chapter_gap_ms':stream['chapterGapMilliseconds'],'windows_pdf_max_transition_ms':stream['pdfMaxTransitionMilliseconds'],'streamed_before_complete_observed':stream['streamedBeforeComplete'],'windows_authored_scan_ocr_ms':scan['recognitionMilliseconds'],'physical_android_current_passed':physical_passed,'remaining':'Cold startup, scan OCR pauses, human likeness and full/background endurance remain.'}
(OUT/f'ThingsBook-{VERSION}-Performance.json').write_text(json.dumps(performance,indent=2)+'\n',encoding='utf-8')
artifacts=[OUT/f'ThingsBook-Independent-{VERSION}.exe',apk,source,OUT/f'ThingsBook-Start-here-{VERSION}.txt',OUT/f'ThingsBook-{VERSION}-Android-parity.md',OUT/f'ThingsBook-{VERSION}-Directive-status.json',OUT/f'ThingsBook-{VERSION}-Performance.json']
report={'version':VERSION,'completion':status['completion'],'regression_groups':42,'original_android_certificate_sha256':certificate,'matching_packaged_assets':asset_count,'physical_android_retest':physical_passed,'current_android_device_report':'work/tests/device-1125/reader-report.json' if phone else None,'historical_android_report':'outputs/ThingsBook-1.12.4-Verification.json','integration_report':'work/tests/llama-integration-1125.json','windows_runtime_report':'work/tests/streaming-runtime-1125.json','windows_scanned_page_report':'work/tests/scanned-runtime-1125.json','windows_packaged_smoke':'work/tests/packaged-smoke-1125.json','prior_1.12.4_artifacts_unchanged':True,'source_private_exclusions':True,'recovery_snapshot':'work/llama-recovery-20261023/snapshot.json','limitations':status['verification_limits'],'artifacts':{p.name:{'bytes':p.stat().st_size,'sha256':sha(p)} for p in artifacts}}
(OUT/f'ThingsBook-{VERSION}-Verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
artifacts.append(OUT/f'ThingsBook-{VERSION}-Verification.json')
(OUT/f'ThingsBook-{VERSION}-SHA256.txt').write_text(''.join(sha(p)+'  '+p.name+'\n' for p in artifacts),encoding='utf-8')
progress=read(ROOT/'work/v5/Progress.json');progress.update(date='2026-10-23',completion=status['completion'],latest_installer_release=VERSION,successor_checklist=f'outputs/ThingsBook-{VERSION}-Directive-status.json',verification=f'outputs/ThingsBook-{VERSION}-Verification.json',android_parity=f'outputs/ThingsBook-{VERSION}-Android-parity.md')
progress['physical_android_checkpoint']={'current_release':VERSION,'current_device_checks_passed':physical_passed,'previous_verified_device_release':'1.12.4','full_acceptance':'partial; full-book/background/human listening pending'}
(ROOT/'work/v5/Progress.json').write_text(json.dumps(progress,indent=2)+'\n',encoding='utf-8')
print('PASS: matching1.12.5 EXE/APK,42 regressions, encrypted research/import/PDF recovery, Windows runtime/OCR, original Android key, source privacy and preserved1.12.4. Physical Android current passed:',physical_passed)
