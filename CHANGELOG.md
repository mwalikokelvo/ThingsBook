# Changelog

## Unreleased

## 1.14.3 — 2026-10-27

### Long listening with the screen off
- **A PDF page that was being drawn when the screen turned off now opens.** Drawing for the screen
  waits for the display, which never comes while it is off, so whole-book reading could stall at that
  page until the screen was turned on again. The page is now drawn again in one go.
- **Windows:** while reading aloud, the PC no longer suspends ThingsBook when the screen turns off or
  the computer is idle (the quiet moments while the next words are prepared do not count as playing
  audio), and a minimised window keeps full speed. Both end when reading stops or pauses.

### Development
- New `endurance-browser.cjs`: with the page hidden and no screen refreshes, whole-book reading goes
  through all 40 chapters of an EPUB and all 60 pages of a PDF to the end, with memory, page size and
  event listeners staying flat; and a page caught mid-drawing by the screen turning off still opens.

## 1.14.2 — 2026-10-27

### Reading aloud with the screen off (Android)
- **PDFs keep reading past the end of a page with the screen off.** Drawing a PDF page waited for the
  screen to refresh, which never happens while it is off, so whole-book reading of a PDF stopped at
  the first page turn. Pages are now drawn in one go when the app is not visible.
- **"Keep reading in background" is on by default** and remembered, so reading aloud continues when the
  screen turns off or you switch apps (the notification shows no book title). Turn it off in Voice to
  close the library whenever you leave the app. Paused in the background for 15 minutes, ThingsBook
  stops and closes the library as before.
- While reading in the background the page keeps a high priority, so Android is less likely to end it
  to free memory; if it still does, ThingsBook reopens locked instead of crashing.
- The sleep timer is also checked at every passage, so it ends on time even when Android delays timers.

### Reading
- **Details** in the reader heading edits the book's title, author and other details without leaving
  the book; the heading updates. Details you edit are never changed by the automatic tidy-up.
- Chapter names come from the book's table of contents (EPUB 3 or EPUB 2) where it names the chapter;
  reading order stays the book's own (its spine).
- Places saved by 1.14.0 and earlier reopen at the same paragraph (1.14.1 counted long paragraphs
  differently). Older whole-passage highlights inside a long paragraph mark only their own text.
- A scanned PDF page also offers **Always recognize scanned pages**.

## 1.14.1 — 2026-10-27

Fixes from reviewing a screen recording of 1.14.0 on Windows and two outside reports.

### Read aloud
- **Turning the page no longer stops reading.** The arrows, Next/Previous chapter, the page list, the
  keyboard and swipes carry on reading from the first words of the new screen or page.
- **Personal voices start in a second or two after the first time** (Windows): stopping, pausing or
  turning a page used to restart the voice engine and reload its model, which took 10-20 seconds and
  caused most of the long "Buffering" pauses. The engine now stops the passage it is reading and keeps
  the model loaded. It also uses up to four processor threads instead of two.
- **Read aloud starts at the screen you are looking at** when your saved place is somewhere else, and
  no longer jumps back to the start of a long paragraph that began on the previous screen.
- **Follow text moves only when the words being read leave the screen,** and only forward, instead of
  jumping back and forth while a long paragraph is read.
- **Status line is accurate:** it says "Narration stopped" when reading stops, instead of still saying
  "Reading in your personal voice. Preparing the next segment locally."
- **Personal voices say dates, years and numbers as words** ("August 22, 2022" is read "August
  twenty-second, twenty twenty-two"), titles ("Dr." as "Doctor") and initials ("R.A." as "R. A.").
  The page text is unchanged.
- Blank PDF pages are skipped when reading the whole book instead of counting as unreadable scans.

### Reading
- **Paragraphs are no longer cut in the middle of a sentence.** Long book paragraphs stay whole with
  their italics and links; long plain-text paragraphs are split only at the end of a sentence.
  Existing highlights and bookmarks are found again by their text.
- **Cleaner PDF page text:** no stray spaces inside words ("five thou sand", "fatig ue") or before
  punctuation, hyphenated line ends joined, and paragraphs found from indents and spacing.
- A blank PDF page says "This page appears to be blank" instead of asking for text recognition; a
  scanned page offers **Recognize this page** right beside the message.
- The PDF ready message matches the layout (no "text shown below" when no text is shown).
- The chapter, percent and "saved" line is no longer hidden behind the floating controls bar.

### Reader tools
- On wide screens Tools opens as a panel beside the page, and the page narrows to stay readable,
  instead of a sheet covering the bottom half.
- New **Study** tab for Reflections, Dictionary, Cite, Compare and Flashcard (they were mixed into
  Appearance). Typeface and spacing settings are hidden for PDF page images, where they do nothing.
- Every control has a visible name: passage buttons, the chapter position slider, ambient sound and
  its volume; sliders show their value; the font picker uses an app button.
- The selected tab is clearly marked; dropdown lists are readable in every theme; buttons follow the
  dark themes. The reader heading shows the author (and "PDF") instead of "ONE MORE CHAPTER".

### Library
- **Clean titles and authors:** names like "One Nation Under Blackmail, Volume 2 (Whitney Webb)Trine
  Day 2022" become the title "One Nation Under Blackmail, Volume 2" by Whitney Webb, and catalogue
  authors like "DeBona, Guerric, 1955-" become "Guerric DeBona". Applied to new imports and once to
  books already in the library; details you edit yourself are kept.
- Books with a real cover show the cover alone, without the generated title painted over it.
- Shelves no longer show their own scrollbars; "Connections" and "Daily recall" no longer look
  selected; the sort menu is no longer cut off; spines leave out "Unknown author".

### Development
- New tests: `narration-browser.cjs` (reading through page turns, starting on screen, forward-only
  follow, stop status, blank pages), `voice-worker-cancel.cjs` (cancelling inside the voice worker
  keeps the model loaded) and `speech-text.cjs` (spoken numbers, PDF text, sentence splitting).

## 1.14.0 — 2026-10-27

### New
- **No more accidental duplicates.** A book that is already in your library (same content, whatever its
  file name) is not imported again; the import names the book it matches. Converted books (Kindle, Word,
  ...) are matched by their original file. Tick "Also import books already in my library" to keep a
  second copy. The check covers every byte but reads large PDFs 4 MiB at a time, never whole. Books
  saved earlier get their fingerprint in the background while the app is idle (except converted ones).
  Fingerprints are kept inside each book's encrypted details.
- **RTF documents (.rtf)** from WordPad, TextEdit, Word or pandoc import as EPUB: chapters at headings,
  bold/italic/underline and super/subscript, lists, tables, links, pictures (PNG and JPEG) and
  footnotes (gathered into a linked Notes chapter), with the title and author the document records.
  Text in other alphabets is decoded with the document's or font's code page. Page headers and
  footers, comments and other hidden parts are left out.
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
