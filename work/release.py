"""Builds a complete ThingsBook release on a Windows PC, in one command.

usage (from the repository root, on Windows):
  python work\\release.py 1.13.0                      # Windows EXE + Android APK
  python work\\release.py 1.13.0 --skip-android       # Windows EXE only
  python work\\release.py 1.13.0 --jdk "C:\\...\\jdk" --sdk "C:\\...\\Android\\Sdk" --signing "D:\\keys"
  python work\\release.py 1.13.0 --voice-pack "D:\\private\\voices.zip"   # bundle your private voices into the APK

Steps, stopping at the first failure:
  1. checks the checkout is `main`, clean, and not behind origin/main;
  2. sets the version everywhere (work/set-version.py) and dates the CHANGELOG section;
  3. runs the regression suite, including the Chromium tests (Playwright is installed once into
     work/test-tools) and the upgrade test against the previous release;
  4. installs the desktop runtime if missing (npm ci) and builds the Rust core (cargo build --release);
  5. builds the Windows EXE (then tests its device-protection helper) and the signed Android APK
     (work/build-apps.py), unless skipped;
  6. writes outputs/ThingsBook-<version>-SHA256SUMS.txt and -Release-notes.md;
  7. commits "Release <version>" and tags v<version> (push them yourself, or pass --push).
If a step fails before the commit, the version changes are undone, so you can fix it and rerun.

Android signing uses your original key (work/thingsbook-signing by default, or --signing); it is
read only by apksigner and never copied. Install the APK over the existing app: do not uninstall,
which would remove the private on-device library.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs'


def run(*args, cwd=ROOT):
    print('>', ' '.join(str(a) for a in args), flush=True)
    subprocess.run([str(a) for a in args], cwd=cwd, check=True)


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def tool(name):
    found = shutil.which(name) or shutil.which(name + '.cmd') or shutil.which(name + '.exe')
    if not found:
        raise SystemExit(f'{name} is not on PATH; install it and retry.')
    return found


PLAYWRIGHT = 'playwright@1.63.0'
# The last release before tags were used: ThingsBook 1.12.5. Later releases are found by their v* tags.
LEGACY_RELEASE = 'c740c89'


def test_tools():
    # The Chromium tests need Playwright; it is installed once into work/test-tools (ignored by git).
    tools = ROOT / 'work/test-tools'
    env = {**os.environ, 'NODE_PATH': os.pathsep.join(filter(None, [str(tools / 'node_modules'), os.environ.get('NODE_PATH')]))}
    if subprocess.run([tool('node'), '-e', "require('playwright')"], cwd=ROOT, env=env, capture_output=True).returncode != 0:
        print('Installing the browser test tools (once)…', flush=True)
        run(tool('npm'), 'install', '--prefix', tools, '--no-audit', '--no-fund', PLAYWRIGHT)
    probe = "const fs=require('fs');process.exit(fs.existsSync(require('playwright').chromium.executablePath())?0:1)"
    if subprocess.run([tool('node'), '-e', probe], cwd=ROOT, env=env, capture_output=True).returncode != 0:
        cli = subprocess.run([tool('node'), '-e', "console.log(require.resolve('playwright/cli.js'))"], cwd=ROOT, env=env, capture_output=True, text=True, check=True).stdout.strip()
        run(tool('node'), cli, 'install', 'chromium')


def previous_release(version):
    tags = [t for t in git('tag', '--list', 'v*', '--sort=-v:refname').splitlines() if t != f'v{version}']
    return tags[0] if tags else LEGACY_RELEASE


def notes(version):
    text = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
    match = re.search(rf'^## {re.escape(version)} — [^\n]*\n(.*?)(?=^## |\Z)', text, re.S | re.M)
    return match.group(1).strip() if match else ''


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('version')
    parser.add_argument('--skip-windows', action='store_true')
    parser.add_argument('--skip-android', action='store_true')
    parser.add_argument('--android-tools', help='Tools folder with jdk/ and sdk/ (build-apps.py default if omitted)')
    parser.add_argument('--jdk'); parser.add_argument('--sdk'); parser.add_argument('--signing')
    parser.add_argument('--voice-pack', help='Private Android voice pack to bundle into the APK (kept outside the repository)')
    parser.add_argument('--push', action='store_true', help='Push the release commit and tag to origin')
    parser.add_argument('--allow-dirty', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    version = args.version
    if sys.platform != 'win32' and not args.skip_windows:
        raise SystemExit('The Windows EXE needs Windows (.NET Framework csc). Use --skip-windows elsewhere.')

    # 1. A clean, current main.
    if git('rev-parse', '--abbrev-ref', 'HEAD') != 'main':
        raise SystemExit('Check out main first.')
    if git('status', '--porcelain') and not args.allow_dirty:
        raise SystemExit('Commit or stash your changes first; a release is built from a clean checkout.')
    run('git', 'fetch', '-q', 'origin', 'main')
    if git('rev-list', '--count', 'HEAD..origin/main') != '0':
        raise SystemExit('main is behind origin/main; run git pull first.')

    # 2-3. Version, then the tests against the versioned tree. If anything fails before the release
    # commit, the version changes are undone so the same checkout can simply be run again.
    run(sys.executable, ROOT / 'work/set-version.py', version, '--release-notes')
    try:
        built = build(args, version)
    except BaseException:
        if not args.allow_dirty:
            print('Release stopped; undoing the version changes.', flush=True)
            subprocess.run(['git', 'checkout', '--', '.'], cwd=ROOT)
        raise
    finish(args, version, built)


def build(args, version):
    test_tools()
    previous = previous_release(version)
    released = Path(tempfile.mkdtemp(prefix='thingsbook-previous-'))
    run('git', 'worktree', 'add', '--detach', '-f', released / 'tree', previous)
    try:
        env = {**os.environ, 'THINGSBOOK_RELEASED_DIR': str(released / 'tree/outputs/ThingsBook')}
        print(f'> node work/run-tests.cjs --require-browser   (upgrade from {previous})', flush=True)
        subprocess.run([tool('node'), ROOT / 'work/run-tests.cjs', '--require-browser'], cwd=ROOT, env=env, check=True)
    finally:
        subprocess.run(['git', 'worktree', 'remove', '--force', str(released / 'tree')], cwd=ROOT)
        shutil.rmtree(released, ignore_errors=True)

    # 4-5. Builds.
    built = []
    if not args.skip_windows:
        desktop = ROOT / 'work/thingsbook-desktop'
        if not (desktop / 'node_modules/electron/dist/electron.exe').exists():
            run(tool('npm'), 'ci', cwd=desktop)
        run(tool('cargo'), 'build', '--release', '--locked', '--bin', 'thingsbook-core', cwd=ROOT / 'core')
        run(sys.executable, ROOT / 'work/build-apps.py', 'windows')
        # Tests of helpers the Windows build compiles (Windows device protection).
        run(tool('node'), ROOT / 'work/run-tests.cjs', 'provider-1125', '--no-skip')
        built.append(OUT / f'ThingsBook-Independent-{version}.exe')
    if not args.skip_android:
        extra = [f'--{k}={v}' for k, v in (('android-tools', args.android_tools), ('jdk', args.jdk), ('sdk', args.sdk), ('signing', args.signing), ('voice-pack', args.voice_pack)) if v]
        run(sys.executable, ROOT / 'work/build-apps.py', 'android', *extra)
        built.append(OUT / f'ThingsBook-Android-{version}.apk')
    for file in built:
        if not file.is_file():
            raise SystemExit(f'Expected build output is missing: {file}')
    return built


def finish(args, version, built):
    # 6. Checksums and notes.
    sums = OUT / f'ThingsBook-{version}-SHA256SUMS.txt'
    sums.write_text(''.join(f'{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.name}\n' for f in built), encoding='utf-8')
    body = notes(version) or 'See CHANGELOG.md.'
    (OUT / f'ThingsBook-{version}-Release-notes.md').write_text(
        f'# ThingsBook {version}\n\n' + body + '\n\nInstall the Android APK over the existing app; do not uninstall, '
        'which removes the private on-device library. Update every device before moving a library with a new backup.\n', encoding='utf-8')

    # 7. Commit and tag (build outputs are release assets, not committed).
    run('git', 'add', '-u')
    run('git', 'commit', '-q', '-m', f'Release {version}')
    run('git', 'tag', '-a', f'v{version}', '-m', f'ThingsBook {version}')
    if args.push:
        run('git', 'push', 'origin', 'main', f'v{version}')
    print(f'\nThingsBook {version} is ready:')
    for f in [*built, sums]:
        print('  ', f)
    if not args.push:
        print(f'Push when you are happy with it:  git push origin main v{version}')


if __name__ == '__main__':
    main()
