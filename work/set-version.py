"""Sets the ThingsBook release version everywhere it appears, and checks every change was applied.

usage: python work/set-version.py 1.13.0 [--release-notes]   set a new, higher version
       python work/set-version.py --check                    fail if any place disagrees with package.json
       python work/set-version.py --sync                     copy package.json's version to every place

Places (SPOTS below): work/thingsbook-desktop/package.json and package-lock.json, the desktop preload's
version (what the Windows app reports), the launcher's version constants
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
PACKAGE = 'work/thingsbook-desktop/package.json'


def code(version):
    major, minor, patch = map(int, version.split('.'))
    if not (0 <= minor < 100 and 0 <= patch < 100):
        raise SystemExit('Minor and patch must be below 100 so the Android versionCode stays ordered.')
    return major * 10000 + minor * 100 + patch


# (file, pattern with the version in group "v", what that group must hold for a version, matches expected)
SPOTS = [
    (PACKAGE, r'("version":\s*")(?P<v>[0-9.]+)(")', lambda v: v, 1),
    # The lockfile's root project entry and its packages[""] entry.
    ('work/thingsbook-desktop/package-lock.json', r'(\A\{\s*"name":\s*"thingsbook-desktop",\s*"version":\s*")(?P<v>[0-9.]+)(")', lambda v: v, 1),
    ('work/thingsbook-desktop/package-lock.json', r'("":\s*\{\s*"name":\s*"thingsbook-desktop",\s*"version":\s*")(?P<v>[0-9.]+)(")', lambda v: v, 1),
    ('work/thingsbook-desktop/preload.cjs', r"(\bversion:')(?P<v>[0-9.]+)(')", lambda v: v, 1),
    ('work/thingsbook-desktop/native/IndependentLauncher.cs', r'(AssemblyVersion\(")(?P<v>[0-9.]+)("\))', lambda v: f'{v}.0', 1),
    ('work/thingsbook-desktop/native/IndependentLauncher.cs', r'(AssemblyFileVersion\(")(?P<v>[0-9.]+)("\))', lambda v: f'{v}.0', 1),
    ('work/thingsbook-desktop/native/IndependentLauncher.cs', r'(const string Version=")(?P<v>[0-9.]+)(")', lambda v: v, 1),
    ('outputs/ThingsBook/android/AndroidManifest.xml', r'(android:versionCode=")(?P<v>\d+)(")', lambda v: str(code(v)), 1),
    ('outputs/ThingsBook/android/AndroidManifest.xml', r'(android:versionName=")(?P<v>[0-9.]+)(")', lambda v: v, 1),
    ('outputs/ThingsBook/android/Build-Android.ps1', r"(\[string\]\$Version = ')(?P<v>[0-9.]+)(')", lambda v: v, 1),
    ('outputs/ThingsBook/index.html', r'(<span>ThingsBook )(?P<v>[0-9.]+)( ·)', lambda v: v, 1),
]


def current():
    return json.loads((ROOT / PACKAGE).read_text(encoding='utf-8'))['version']


def mismatches(version):
    found = []
    for path, pattern, value, count in SPOTS:
        matches = list(re.finditer(pattern, (ROOT / path).read_text(encoding='utf-8')))
        if len(matches) != count:
            found.append(f'{path}: expected {count} match(es) for {pattern!r}, found {len(matches)}')
        found += [f'{path}: {m.group("v")} (expected {value(version)})' for m in matches if m.group('v') != value(version)]
    return found


def apply(version):
    for path, pattern, value, count in SPOTS:
        file = ROOT / path
        updated, n = re.subn(pattern, lambda m: m.group(1) + value(version) + m.group(3), file.read_text(encoding='utf-8'))
        if n != count:
            raise SystemExit(f'{path}: expected {count} match(es) for {pattern!r}, found {n}.')
        file.write_text(updated, encoding='utf-8')
    left = mismatches(version)
    if left:
        raise SystemExit('Version not applied everywhere:\n  ' + '\n  '.join(left))


def main(argv):
    if argv[:1] == ['--check']:
        left = mismatches(current())
        if left:
            raise SystemExit(f'Version numbers disagree with {PACKAGE} ({current()}):\n  ' + '\n  '.join(left) + '\nRun: python work/set-version.py --sync')
        print(f'All {len(SPOTS)} version numbers say {current()}.')
        return
    if argv[:1] == ['--sync']:
        apply(current())
        print(f'Every version number now says {current()}.')
        return
    if not argv or not re.fullmatch(r'\d+\.\d+\.\d+', argv[0]):
        raise SystemExit(__doc__)
    version, old = argv[0], current()
    if code(version) <= code(old):
        raise SystemExit(f'{version} is not newer than the current version {old}.')
    apply(version)
    if '--release-notes' in argv:
        changelog = ROOT / 'CHANGELOG.md'
        text, n = re.subn(r'## Unreleased[^\n]*\n', f'## Unreleased\n\n## {version} — {datetime.date.today().isoformat()}\n', changelog.read_text(encoding='utf-8'), count=1)
        if n != 1:
            raise SystemExit('CHANGELOG.md has no "## Unreleased" heading.')
        changelog.write_text(text, encoding='utf-8')
    print(f'Version set to {version} (Android versionCode {code(version)}), up from {old}.')


if __name__ == '__main__':
    main(sys.argv[1:])
