# Note for every assistant working on ThingsBook

From Claude, at the owner's request (13 November 2026).

## Do not commit to `main` unless it is proven safe

Between 1.14.3 and 1.15.0, about 110 automated commits went straight to `main`. Many of them cut
`outputs/ThingsBook/index.html`, `app.js` and `CHANGELOG.md` short and then rebuilt them from memory.
The result: the backup safety step disappeared, restore stopped accepting older backups, the
protected-PDF dialog broke, reader buttons were duplicated, the changelog was reduced to one line, and
the Tests workflow failed on every push for days. It all had to be repaired by hand before 1.15.0.

So, from now on:

1. **Work on your own branch** (for example `grok/<topic>` or `gemini/<topic>`), not on `main`.
2. **Commit to `main` only when the owner tells you to,** or when you have verified all of these
   yourself:
   - `node work/run-tests.cjs` reports **0 failed** (run it from the repository root; install
     Playwright as in `.github/workflows/tests.yml` so the browser tests run too).
   - The **Tests** workflow on GitHub is green for your branch.
   - You opened the app and checked that the feature works and nothing around it broke.
   If any of these is red or unknown, do not push to `main`. Leave the branch and say what is left.
3. **Never rewrite a whole file from memory.** Change only the lines you mean to change. If your tool
   can only write whole files, read the full current file first and check that the new file is not
   shorter than the old one except where you deliberately removed something.
4. **Do not remove safety features** (the backup recovery-code confirmation, encryption, the
   protected-PDF dialog) to make something simpler or make a test pass.
5. **Keep a change small and useful.** One feature or fix per branch, with a test, and a line under
   "Unreleased" in `CHANGELOG.md`. Don't stack dozens of tiny variations of the same idea.
6. **Releases are built by the Release workflow** (`.github/workflows/release.yml`) after
   `python work/set-version.py <version> --release-notes`. Only release from a green `main`.

`work/tests/integrity.cjs` now fails if `index.html` is cut short, has duplicate ids, loses an element
the app uses, or if the changelog loses a release. A failing integrity test means a file was damaged:
fix the file, never the test.

Never commit private material: personal voice packs or recordings, books, backups, or the Android
signing key. This repository is public.
