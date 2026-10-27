# Changelog

## Unreleased

### New
- **No more accidental duplicates.** A book that is already in your library (same content, whatever its
  file name) is not imported again; the import names the book it matches. Converted books (Kindle, Word,
  ...) are matched by their original file. Tick "Also import books already in my library" to keep a
  second copy. The check covers every byte but reads large PDFs 4 MiB at a time, never whole. Books
  saved earlier get their fingerprint in the background while the app is idle (except converted ones).
  Fingerprints are kept inside each book's encrypted details.
- **Open with ThingsBook (Android).** ThingsBook appears in "Open with" and the share sheet for the book
  formats it imports, so a book downloaded in the browser or received in a chat goes straight in. The
  import dialog opens with the files chosen (after you unlock, if the library is locked), and nothing is
  saved until you confirm. Each shared file is readable once, only by ThingsBook, for 30 minutes.

## 1.13.0 — 2026-10-26

Many more book formats (Kindle, Word, OpenDocument, FictionBook, comics, Markdown, web pages), PDFs up
to 500 MB opened by byte range, saved OCR text, library search inside PDFs, and much faster, lighter
storage and backups. Install over 1.12.5; your library is converted in the background.

### New
- **Kindle books (MOBI, AZW3, combined MOBI)** import by being converted to EPUB once, at import.
  Uses foliate-js's parser (MIT, vendored by `work/vendor-foliate.py`). DRM-protected books are
  refused with an explanation, never decrypted.
- **Word documents (.docx)** import as EPUB, split into chapters at headings, with images, tables,
  lists and links. Uses mammoth.js 1.13.0 (BSD-2-Clause), loaded only when a .docx is imported.
  Legacy .doc and password-protected files explain how to save a usable copy.
- **FictionBook (.fb2, .fb2.zip, .fbz)** import as EPUB, including footnotes, poems and
  non-UTF-8 encodings such as windows-1251.
- **OpenDocument text (.odt)** from LibreOffice, OpenOffice or Google Docs imports as EPUB: chapters at
  top-level headings, bold/italic/underline and super/subscript from the document's styles, numbered
  and bulleted lists, tables, links and embedded images. Footnotes are gathered into a linked Notes
  chapter; generated tables of contents, comments and tracked deletions are left out.
  Password-protected documents explain how to save a usable copy.
- **Markdown (.md) and saved web pages (.html, .htm)** import as EPUB, with chapters at top-level
  headings, tables, code, links and embedded images. Title and author come from Markdown front matter
  or the page's meta tags; a page's article is kept without its site menus. Nothing in the file runs
  or is fetched: scripts, styles, frames and forms are removed, and images that are not embedded in
  the file show their description instead. Markdown uses marked 18.0.14 (MIT), loaded only when a
  Markdown file is imported.
- **Precise highlights.** Highlighting a few words marks only those words instead of the whole
  passage; highlights from earlier versions still mark their whole passage.
- **Comic archives (.cbz)** import as EPUB, one page per image in natural order, with title and
  writer from ComicInfo.xml.
- **PDFs up to 500 MB.** Other formats keep the 100 MB limit.
- Converted books offer "Download EPUB" instead of "Download original".
- **Library-wide search covers PDF text.** PDFs with a text layer are indexed page by page (read by
  byte range); a match opens the book on its page. Scanned PDFs are still searched inside each book.
- **Compare PDFs side by side.** The comparison pane now accepts PDFs (including two different PDF
  books): pages are listed and each page's text is shown when chosen; the PDF is read by byte range.
- **Recognized text is kept.** Text recognized on a scanned PDF page is saved, encrypted, with the book
  (per page; the book and page are sealed inside and checked), so the page shows it again after
  closing or restarting and library search includes it. Removing a book removes it. It travels in
  version 2 backups; on restore, records that do not verify for their book and page are dropped.

- **Built-in private voices (Android, private builds).** `work/release.py --voice-pack <file>` bundles
  your private voice pack into the APK; on first launch with no personal voices installed, the app
  installs it through the usual checks. The pack never goes into the repository or GitHub builds.

### Faster and lighter
- New books are stored as 4 MiB encrypted pieces (IndexedDB "chunks" store; each piece is bound
  to its book, position and count). Saving reading progress or notes now rewrites a few hundred
  bytes instead of the whole book.
- Books from 1.12.5 and earlier are converted to pieces in the background while the app is idle.
- PDFs import and open by byte range: a 300 MiB PDF imported within about 100 MiB and opened within
  about 180 MiB of extra memory in Chromium (previously about four whole copies when opening).
- Downloads, search and backups read books one piece at a time.

### Backups and restore
- **Fixed:** libraries over about 384 MB could not be backed up (one JSON string hit the browser's
  string limit) and showed a misleading "more free memory" error.
- Backups use version 2, a streaming format, whenever a library holds chunked books or is too big
  for version 1. Version 1 is still written byte-for-byte for small whole-file libraries.
- Restore reads a backup one piece at a time into a staging store and replaces the library in one
  transaction. Nothing changes until every piece is verified; a damaged backup says so and leaves
  the library intact. Restoring 150 MiB peaked about 92 MiB above baseline in Chromium.
- Restore reports incomplete backups and backups from newer versions clearly.
- **Fixed (Android):** version 2 backups were refused by the export bridge; `application/octet-stream`
  is now allowed (needs the rebuilt APK).

### Reliability
- Opening a PDF with a damaged piece now shows "This book file is damaged or incomplete" instead of
  waiting forever.
- An open PDF stops decrypting as soon as the library locks.
- Stray pieces left by an interrupted import are removed at the next unlock.
- **Fixed:** turning PDF pages quickly (or jumping from a search result) could leave an uncaught
  "rendering cancelled" error; a cancelled page render now just stops.

### Compatibility
- Database version 4 only adds the "chunks", "staging" and "ocr" stores; libraries upgrade in place (tested
  in Chromium against a 1.12.5 profile).
- **Going back to 1.12.5 after updating:** the library still unlocks, but books stored as pieces
  (all new imports and, after background conversion, older books too) do not open there. Nothing is
  lost; the new version reads them.
- 1.12.5 cannot restore version 2 backups. Update every device before moving a library.

### Development
- `node work/run-tests.cjs` runs the portable tests on any OS (19 pass; Electron, Windows and
  live-network tests are listed as skipped). Chromium tests cover upgrade, Kindle/Word/FB2/comic
  import, PDF range loading and restore.
- `.github/workflows/tests.yml` runs those tests and the Rust core tests; the template workflows that
  could not pass in this repository were removed. GitHub Actions jobs are currently not starting
  because of an account billing/spending-limit issue.

### Before releasing
- Windows: run the Electron/runtime checks (`work/tests/check-1125.py`) and the release verifier.
- Android: rebuild the APK, install over 1.12.5 without uninstalling, then import a book, back up and
  restore. Android saves at most 1 GB per export (`MAX_TRANSFER`), which also caps backup size there.
