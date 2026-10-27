"""Build the existing Windows/Android applications using their native tools.

Does not execute PowerShell scripts or alter execution/approval/security policy.
Signing passwords are passed by file reference, never read or printed here.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'outputs/ThingsBook'
DESKTOP = ROOT / 'work/thingsbook-desktop'
VERSION = json.loads((DESKTOP / 'package.json').read_text())['version']

def run(*args):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)

def windows():
    launcher = (DESKTOP / 'native/IndependentLauncher.cs').read_text()
    if ('const string Version="' + VERSION + '"') not in launcher or ('AssemblyFileVersion("' + VERSION + '.0")') not in launcher:
        raise RuntimeError('Launcher version must match package version; otherwise the old runtime could be launched.')
    native = ROOT / 'core/target/release/thingsbook-core.exe'
    if not native.is_file():
        raise RuntimeError('Build the verified native core before packaging Windows.')
    shutil.copy2(native, DESKTOP / 'native/thingsbook-core.exe')
    # Electron 44+ no longer downloads its runtime during `npm ci`; its install.js does, checked against the
    # package's pinned checksums. It exits at once when dist/ already holds this version for Windows x64.
    electron = DESKTOP / 'node_modules/electron'
    if not (electron / 'install.js').is_file():
        raise RuntimeError('Run `npm ci` in work/thingsbook-desktop first (Electron is not installed).')
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is needed to fetch the Electron runtime.')
    subprocess.run([node, str(electron / 'install.js')], cwd=DESKTOP, check=True,
                   env={**os.environ, 'ELECTRON_INSTALL_PLATFORM':'win32', 'ELECTRON_INSTALL_ARCH':'x64'})
    if not (electron / 'dist/electron.exe').is_file():
        raise RuntimeError('The Electron runtime did not install (node_modules/electron/dist/electron.exe is missing).')
    run(sys.executable, ROOT / 'work/prepare-independent.py')
    framework = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    speech = next((Path(os.environ['WINDIR']) / 'Microsoft.NET/assembly/GAC_MSIL/System.Speech').rglob('System.Speech.dll'))
    run(framework, '/nologo', '/target:exe', '/optimize+', '/reference:System.Web.Extensions.dll',
        '/reference:' + str(speech), '/out:' + str(DESKTOP / 'native/SpeechBridge.exe'), DESKTOP / 'native/SpeechBridge.cs')
    run(framework, '/nologo', '/target:exe', '/optimize+', '/reference:System.Security.dll', '/reference:System.Web.Extensions.dll', '/out:' + str(DESKTOP / 'native/ProviderProtection.exe'), DESKTOP / 'native/ProviderProtection.cs')
    run(sys.executable, ROOT / 'work/package-independent.py')
    run(framework, '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
        '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
        '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
        '/out:' + str(ROOT / f'outputs/ThingsBook-Independent-{VERSION}.exe'),
        '/win32icon:' + str(DESKTOP / 'icon.ico'),
        '/resource:' + str(ROOT / 'work/thingsbook-independent-runtime.zip') + ',thingsbook.runtime.zip',
        DESKTOP / 'native/IndependentLauncher.cs')
    print('Windows build complete.', flush=True)

TEST_PACKAGE = 'com.thingsbook.library.test'

def test_manifest(build):
    # A separate app ("ThingsBook Test", com.thingsbook.library.test) that installs next to the real one
    # and keeps its own library. Components keep their Java package, so their names are written in full.
    text = (APP / 'android/AndroidManifest.xml').read_text(encoding='utf-8')
    for old, new in (('package="com.thingsbook.library"', f'package="{TEST_PACKAGE}"'), ('android:label="ThingsBook"', 'android:label="ThingsBook Test"'),
                     ('android:name=".ListeningService"', 'android:name="com.thingsbook.library.ListeningService"'),
                     ('android:name=".MainActivity"', 'android:name="com.thingsbook.library.MainActivity"')):
        if text.count(old) != 1:
            raise RuntimeError(f'Test manifest: expected one {old}')
        text = text.replace(old, new)
    path = build / 'AndroidManifest-test.xml'
    path.write_text(text, encoding='utf-8')
    return path

def check_voice_pack(pack):
    """The private voice pack to bundle: the app's installer format (manifest.json, then catalog.json) for the
    model this app pins. Refused when it sits in the repository without being ignored, so it cannot be committed."""
    import zipfile, re
    if not pack.is_file():
        raise RuntimeError(f'Voice pack not found: {pack}')
    if pack.stat().st_size > 420 * 1024 * 1024:
        raise RuntimeError('Voice pack is larger than the app accepts (400 MB).')
    try:
        inside = pack.relative_to(ROOT)
    except ValueError:
        inside = None
    if inside is not None and subprocess.run(['git', 'check-ignore', '-q', str(inside)], cwd=ROOT).returncode != 0:
        raise RuntimeError('Keep the private voice pack outside the repository (or in an ignored folder) so it is never committed.')
    with zipfile.ZipFile(pack) as archive:
        names = archive.namelist()
        if names[:2] != ['manifest.json', 'catalog.json']:
            raise RuntimeError('This is not a ThingsBook private Android voice pack (manifest.json and catalog.json must come first).')
        manifest = json.loads(archive.read('manifest.json'))
    pinned = re.search(r'MODEL_HASH="([0-9a-f]{64})"', (APP / 'android/java/com/thingsbook/library/PersonalVoicePack.java').read_text(encoding='utf-8')).group(1)
    if manifest.get('version') != 1 or manifest.get('model_sha256') != pinned:
        raise RuntimeError('This voice pack is for a different voice model than this app supports.')

def android(tools, jdk_home=None, sdk_root=None, signing=None, test=False, voice_pack=None):
    # jdk_home/sdk_root override the bundled tools folder (e.g. JAVA_HOME and ANDROID_HOME on a build machine).
    # test=True builds the side-by-side test app; `signing` then holds a throwaway key, never the original.
    build = ROOT / ('work/android-build-' + VERSION.replace('.', '') + ('-test' if test else ''))
    jdk = (Path(jdk_home) if jdk_home else next((tools / 'jdk').iterdir())) / 'bin'
    sdk_base = Path(sdk_root) if sdk_root else tools / 'sdk'
    sdk = sdk_base / 'build-tools/35.0.0'
    platform = sdk_base / 'platforms/android-35/android.jar'
    for required in (jdk, sdk, platform):
        if not required.exists():
            raise RuntimeError(f'Android build tools not found: {required}')
    signing = Path(signing) if signing else ROOT / 'work/thingsbook-signing'
    keystore, password = signing / 'thingsbook-release.jks', signing / 'password.txt'
    if not keystore.is_file() or not password.is_file():
        raise RuntimeError('A test signing key is required.' if test else 'Original signing material is required for an upgrade.')
    if voice_pack:
        voice_pack = Path(voice_pack).resolve()
        check_voice_pack(voice_pack)
    for folder in ('assets/web', 'classes', 'dex'):
        (build / folder).mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'style.css', 'app.js', 'reader.js', 'reader.css', 'pdf.worker.mjs', 'vendor', 'cmaps', 'standard_fonts', 'wasm'):
        source, destination = APP / name, build / 'assets/web' / name
        if source.is_dir():
            shutil.copytree(source, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(source, destination)
    major, minor, patch = map(int, VERSION.split('.'))
    code = major * 10000 + minor * 100 + patch
    name = VERSION + ('-test' if test else '')
    manifest = test_manifest(build) if test else APP / 'android/AndroidManifest.xml'
    run(sdk / 'aapt2.exe', 'compile', '--dir', APP / 'android/res', '-o', build / 'resources.zip')
    run(sdk / 'aapt2.exe', 'link', '-o', build / 'unsigned.apk', '--manifest', manifest,
        '-I', platform, '--min-sdk-version', '26', '--target-sdk-version', '35', '--version-code', code,
        '--version-name', name, '--replace-version', build / 'resources.zip')
    run(jdk / 'jar.exe', 'uf', build / 'unsigned.apk', '-C', build, 'assets')
    native=APP/'android/jniLibs/arm64-v8a/libthingsbook_voices.so'
    if not native.is_file():raise RuntimeError('Build the16KB-aligned Android voice library before packaging.')
    import zipfile
    with zipfile.ZipFile(build/'unsigned.apk','a') as bundle:
        bundle.write(native,'assets/native/arm64-v8a/libthingsbook_voices.so',compress_type=zipfile.ZIP_STORED)
        if voice_pack:
            # Installed by the app on first launch when no personal voices are installed (MainActivity.installBundledVoices).
            bundle.write(voice_pack,'assets/voices/personal-pack.zip',compress_type=zipfile.ZIP_STORED)
            print(f'Bundled private voice pack: {voice_pack.name} ({voice_pack.stat().st_size // (1024 * 1024)} MB)', flush=True)
    sources = sorted((APP / 'android/java/com/thingsbook/library').glob('*.java'))
    run(jdk / 'javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', platform, '-d', build / 'classes', *sources)
    run(jdk / 'jar.exe', 'cf', build / 'classes.jar', '-C', build / 'classes', '.')
    run(jdk / 'java.exe', '-cp', sdk / 'lib/d8.jar', 'com.android.tools.r8.D8', '--release', '--min-api', '26',
        '--lib', platform, '--output', build / 'dex', build / 'classes.jar')
    run(jdk / 'jar.exe', 'uf', build / 'unsigned.apk', '-C', build / 'dex', 'classes.dex')
    run(sdk / 'zipalign.exe', '-f', '-P', '16', '4', build / 'unsigned.apk', build / 'aligned.apk')
    apk = ROOT / f"outputs/ThingsBook-Android-{'Test-' if test else ''}{VERSION}.apk"
    run(jdk / 'java.exe', '-jar', sdk / 'lib/apksigner.jar', 'sign',
        '--ks', keystore, '--ks-key-alias', 'thingsbook', '--ks-pass', 'file:' + str(password),
        '--out', apk, build / 'aligned.apk')
    run(jdk / 'java.exe', '-jar', sdk / 'lib/apksigner.jar', 'verify', '--verbose', apk)
    print(f'Android {"test " if test else ""}build complete: {apk.name}', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('platform', choices=['windows', 'android'])
    parser.add_argument('--android-tools', type=Path, default=ROOT.parent.parent / '2026-10-03/https-github-com-louis-cfm-coucou/work/android-tools')
    parser.add_argument('--jdk', help='JDK home to use instead of the tools folder (for example JAVA_HOME)')
    parser.add_argument('--sdk', help='Android SDK root to use instead of the tools folder (for example ANDROID_HOME)')
    parser.add_argument('--signing', help='Folder holding thingsbook-release.jks and password.txt (default work/thingsbook-signing)')
    parser.add_argument('--test', action='store_true', help='Build the side-by-side "ThingsBook Test" app (com.thingsbook.library.test) with a throwaway key')
    parser.add_argument('--voice-pack', help='Private Android voice pack (.zip) to bundle; kept outside the repository, never committed')
    args = parser.parse_args()
    if args.platform == 'windows':
        windows()
    else:
        android(args.android_tools.resolve(), args.jdk, args.sdk, args.signing, args.test, args.voice_pack)
