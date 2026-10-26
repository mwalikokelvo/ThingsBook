# ThingsBook

ThingsBook is a private, local-first reading and listening app for Windows and Android. It imports PDF, EPUB, and TXT books, keeps the library on the device, supports encrypted backup and restore, and provides reading, annotation, research, OCR, and narration tools.

## Current release

The source in this repository matches **ThingsBook 1.12.5**. The corresponding Windows EXE and Android APK are distributed as release assets rather than committed to Git.

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
- `work/vendor-foliate-mobi.py` — re-vendors foliate-js's MIT-licensed MOBI/KF8 parser (`vendor/foliate-mobi.js`), used to convert DRM-free Kindle books to EPUB on import.
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

## Project status

Release 1.12.5 is a matched Windows/Android release, but the broader Unified v5 rebuild is still in progress. Native Android storage/search migration, sustained background/full-book endurance, semantic search, private sync, precise EPUB CFI annotations, and parts of the native-shell roadmap remain unfinished. See `Start-here.txt` for the current release boundary.

## Privacy and security

- Libraries and credentials stay local unless the user explicitly exports or downloads something.
- Provider sessions use platform protection and are excluded from backups and source archives.
- Personal voice recordings and prepared voice packs are private data and must never be committed.
- DRM or access-control bypass is not part of the project.

## License

No project-wide open-source license has been granted. Third-party components retain their own licenses in the included vendor and license files.
