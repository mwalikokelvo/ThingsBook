THINGSBOOK 1.6.0 - READER AND RESEARCH UPDATE
Windows: ThingsBook-Independent-1.6.0.exe (independent of Edge).
Android: ThingsBook-Android-1.6.0.apk (original app ID and signing key).
Export an encrypted backup before updating. Close the older Windows app first.
Install the APK over your existing app; do not uninstall and erase its library.
Encrypted library and backup formats remain compatible.

TRY THE NEW FEATURES
Open Reading display for Compare, Cite, Flashcard, Reflections and typography.
Compare opens an EPUB/TXT in a second independent chapter pane. On small screens
it takes the reading area; close comparison to return to the primary book.
Sync scrolling follows relative positions when the primary layout is Scrolling.
Footnote links show a non-modal note without jumping away. Close note dismisses it.
Daily recall reviews encrypted FSRS flashcards. Show answer, then choose a rating.
Write [[Book Title]] in reflections to create a local book link. Connections shows
shared tags and explicit links in an interactive graph (first 120 books).
Cite generates metadata-based APA/Chicago/MLA/BibTeX starter citations; verify and
complete publisher/edition details for formal use. Missing years display n.d.

NEW DISPLAY AND SHELF OPTIONS
Merriweather, Inter, JetBrains Mono and OpenDyslexic are bundled for offline use.
Choose a licensed personal TTF/OTF under 2 MB to save in encrypted book preferences.
Bookerly is not bundled. Brightness, paragraph indents and drop caps save per book.
Line spacing spans 1.2-2.2; column measure spans 65-75 characters. Light, Paper,
Dark Slate and OLED palettes are included. New wide-screen text books start in
spread mode at 1280px; existing per-book layout preferences remain authoritative.
Narration speed advances in 0.05 steps from 0.75x to 2.5x; sleep includes 45 minutes.
Brown noise and a quiet-library noise bed join the procedural ambient sounds.
Shelf materials are Matte, Cloth and Leather. Spine type uses measured fitting.
Ctrl/Command/Shift click enters batch selection; existing batch tools remain.
Table rows include format, storage size, date added and annotation counts.

PRIVACY AND SHORTCUTS
Controls fade after 2.5s; tap, Tab, or approach an edge to reveal them.
F toggles focus; Ctrl+/ (Command+/) toggles chapter reflections.
Esc in a reader or double Shift triggers panic locking and stops audio.
Windows minimizes; Android sends the app to the background. A tray is not included.
Decrypted typed EPUB buffers and visible canvas frames are cleared on close.
JavaScript strings and third-party engine/OS memory cannot be guaranteed zeroed.
No cloud connection or telemetry is enabled. Android has no Internet permission.
User-selected original-book and note exports are plaintext at the chosen destination;
use encrypted .thingsbook snapshots to transfer your private library.

WHAT IS NOT FINISHED
This release delivers part of the attached Unified v5.0 directive, not the full
Rust/Compose rewrite. core/ contains a Rust/UniFFI vault and OPDS parsing foundation.
Formatting passed; native dependency retrieval failed in the Windows TLS client,
and the temporary package-cache helper was rejected by automatic approval policy.
Cargo test/clippy and Gradle lint/unit/Compose builds have not passed or run.
SQLite/SQLx encrypted indexing, complete OPDS browsing/acquisition and hardware
credential storage, self-hosted KOReader sync, native ONNX/Piper voice imports,
semantic vector search, watch folders, multi-vault/decoy PIN, full zero-trace
native memory handling, stylus drawings and full document virtualization remain.
The existing optional personal Pocket-TTS voice pack still requires prepared
models and voices; your recordings are not uploaded or included in this release.
Physical Windows/Android acceptance and FPS/latency/RAM targets remain unverified.
See ThingsBook-1.6.0-Directive-status.json for the explicit feature matrix.
