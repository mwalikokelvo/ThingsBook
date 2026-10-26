"""Sets the ThingsBook release version everywhere it appears, and checks every change was applied.

usage: python work/set-version.py 1.13.0 [--release-notes]

Updates work/thingsbook-desktop/package.json, the launcher's version constants
(work/thingsbook-desktop/native/IndependentLauncher.cs), the Android manifest's versionName and
versionCode (major*10000 + minor*100 + patch, as work/build-apps.py computes it), the default in
outputs/ThingsBook/android/Build-Android.ps1 and the app footer in outputs/ThingsBook/index.html.
With --release-notes, the CHANGELOG.md "Unreleased" heading becomes "<version> — <today>" and a new
empty "Unreleased" section is started above it.
Refuses versions that are not newer than the current one (Android only installs a higher versionCode).
"""
import datetime, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def code(version):
    major, minor, patch = map(int, version.split('.'))
    if not (0 <= minor < 100 and 0 <= patch < 100):
        raise SystemExit('Minor and patch must be below 100 so the Android versionCode stays ordered.')
    return major * 10000 + minor * 100 + patch


def replace(path, pattern, new, count=1):
    file = ROOT / path
    text = file.read_text(encoding='utf-8')
    updated, n = re.subn(pattern, new, text)
    if n != count:
        raise SystemExit(f'{path}: expected {count} match(es) for {pattern!r}, found {n}.')
    file.write_text(updated, encoding='utf-8')


def main(argv):
    if not argv or not re.fullmatch(r'\d+\.\d+\.\d+', argv[0]):
        raise SystemExit(__doc__)
    version = argv[0]
    current = json.loads((ROOT / 'work/thingsbook-desktop/package.json').read_text(encoding='utf-8'))['version']
    if code(version) <= code(current):
        raise SystemExit(f'{version} is not newer than the current version {current}.')
    replace('work/thingsbook-desktop/package.json', r'("version":\s*")[0-9.]+(")', rf'\g<1>{version}\g<2>')
    replace('work/thingsbook-desktop/native/IndependentLauncher.cs', r'AssemblyVersion\("[0-9.]+"\)', f'AssemblyVersion("{version}.0")')
    replace('work/thingsbook-desktop/native/IndependentLauncher.cs', r'AssemblyFileVersion\("[0-9.]+"\)', f'AssemblyFileVersion("{version}.0")')
    replace('work/thingsbook-desktop/native/IndependentLauncher.cs', r'const string Version="[0-9.]+"', f'const string Version="{version}"')
    replace('outputs/ThingsBook/android/AndroidManifest.xml', r'android:versionCode="\d+"', f'android:versionCode="{code(version)}"')
    replace('outputs/ThingsBook/android/AndroidManifest.xml', r'android:versionName="[0-9.]+"', f'android:versionName="{version}"')
    replace('outputs/ThingsBook/android/Build-Android.ps1', r"(\[string\]\$Version = ')[0-9.]+(')", rf'\g<1>{version}\g<2>')
    replace('outputs/ThingsBook/index.html', r'<span>ThingsBook [0-9.]+ ·', f'<span>ThingsBook {version} ·')
    if '--release-notes' in argv:
        replace('CHANGELOG.md', r'## Unreleased[^\n]*\n', f'## Unreleased\n\n## {version} — {datetime.date.today().isoformat()}\n')
    print(f'Version set to {version} (Android versionCode {code(version)}), up from {current}.')


if __name__ == '__main__':
    main(sys.argv[1:])
