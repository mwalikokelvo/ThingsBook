# ThingsBook

ThingsBook is a private, local-first reading and listening app for Windows and Android. It imports PDF, EPUB, TXT, Kindle (MOBI/AZW3), Word, OpenDocument, RTF, FictionBook, comic, Markdown and web-page books, keeps the library on the device, supports encrypted backup and restore, and provides reading, annotation, research, OCR, and narration tools.

## Current release

The latest release is **ThingsBook 1.14.2**: the Windows EXE and the Android APK (signed with the original key, so it installs over earlier versions) are on the [GitHub Releases page](https://github.com/mwalikokelvo/ThingsBook/releases), with checksums; they are not committed to Git. `CHANGELOG.md` lists what changed in each version.

Highlights include:

- independent Windows desktop app and matching Android app;
- encrypted local library and backward-compatible encrypted backups;
- continuous narration, system voices, and optional locally installed personal voices;
- PDF page-and-transcript view with offline OCR for scanned pages;
- EPUB/TXT reading layouts, scrolling, paging, bookmarks, highlights, notes, and search;
- cross-book links, comparison tools, flashcards, citations, and reading reflections;
- Project Gutenberg discovery and an optional user-authenticated provider integration.

No private books, backups, recordings, personal voice packs, model weights, account sessions, or Android signing material are included in this repository.

## Repository layout

- `outputs/ThingsBook/` — authoritative shared web application and platform assets.
- `work/thingsbook-desktop/` — independent Windows desktop shell and native helpers.
- `work/build-apps.py` — maintained Windows and Android packaging entry point.
- `work/tests/` — release regression and integration checks.
- `core/` — Rust/UniFFI native-core foundation and personal-voice runtime source.
- `work/vendor-foliate.py` — re-vendors foliate-js's MIT-licensed MOBI/KF8 and FB2 parsers (`vendor/foliate-mobi.js`, `vendor/foliate-fb2.js`), used to convert DRM-free Kindle and FictionBook books to EPUB on import.
- `outputs/ThingsBook/vendor/mammoth.browser.min.js` — mammoth.js 1.13.0 (BSD-2-Clause, npm `mammoth`, sha256 `92914a3708cfdf1e62cb553d1856a7fedab21da83d8ee82845de2f897b368cab`), loaded only when a Word (.docx) book is imported and converted to EPUB.
- `outputs/ThingsBook/vendor/marked.umd.js` — marked 18.0.14 (MIT, npm `marked`, sha256 `21568877a938d2c4e7d74e27f18e60da96bb73a68809610ca39216e1efebae62`), loaded only when a Markdown file is imported; license in `vendor/MARKED-LICENSE.txt`.
- `Start-here.txt` — 1.12.5 release notes, limitations, and update guidance.

## Build

Use a consistent new version in `work/thingsbook-desktop/package.json`, preserve the existing Android application identity and signing key outside this repository, and run from the repository root:

```powershell
C:\Python314\python.exe work\build-apps.py windows
C:\Python314\python.exe work\build-apps.py android
```

Then run the relevant checks and release verifier before distributing either artifact. Do not uninstall the Android app during an upgrade because uninstalling removes its private on-device library.

For a quick check on any platform (Linux, macOS or Windows), run the portable regression suite from the repository root. It runs every test that needs only Node and lists the Electron, browser and Windows-only tests as skipped, with the reason:

```
node work/run-tests.cjs            # run everything portable
node work/run-tests.cjs research   # run tests whose name contains "research"
node work/run-tests.cjs --list     # show what would run or be skipped
```

This does not replace the Windows runtime checks or the release verifier.

### Making a release

On a Windows PC with Node, Rust, the .NET Framework compiler and the Android tools in place, one command sets the version everywhere, dates the changelog, runs the tests, builds the EXE and the signed APK, writes checksums and notes to `outputs/`, and commits and tags the release:

```powershell
python work\release.py 1.13.0            # add --push to push main and the tag
python work\release.py 1.13.0 --skip-android
```

To build your private Android voices into the APK, add `--voice-pack "D:\path\to\pack.zip"`. On first launch, when no personal voices are installed, the app installs the bundled pack through the same checks as a pack chosen by hand. Keep the pack outside the repository, or in the ignored `private-voices/` folder; the build refuses a pack that git could commit. Never bundle it in a GitHub build: the repository and its releases are public. Anyone given that APK also gets the voices.

`python work/set-version.py <version>` changes only the version numbers. Pushing a `v<version>` tag also runs `.github/workflows/release.yml`, which builds on GitHub's Windows runner and publishes a GitHub release. It always builds the EXE. It builds the APK only when the `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD` repository secrets hold the original signing key.

## Project status

Release 1.12.5 is a matched Windows/Android release, but the broader Unified v5 rebuild is still in progress. Native Android storage/search migration, sustained background/full-book endurance, semantic search, private sync, precise EPUB CFI annotations, and parts of the native-shell roadmap remain unfinished. See `Start-here.txt` for the current release boundary.

## Privacy and security

- Libraries and credentials stay local unless the user explicitly exports or downloads something.
- Provider sessions use platform protection and are excluded from backups and source archives.
- Personal voice recordings and prepared voice packs are private data and must never be committed.
- DRM or access-control bypass is not part of the project.

## License

No project-wide open-source license has been granted. Third-party components retain their own licenses in the included vendor and license files.
