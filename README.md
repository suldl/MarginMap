# MarginMap

A MarginNote-style study app for Windows. It covers the core MarginNote workflow:
**read a PDF → excerpt passages into cards → organize them as a mind map → review them as flashcards.**

> MarginMap is an independent, from-scratch implementation inspired by MarginNote's workflow.
> It does not use or contain any MarginNote code or assets, and it can't open MarginNote files.

## Features

| Area | What you get |
| --- | --- |
| **Library** | Import PDFs (button, drag & drop, or *Open with…* from Explorer), cover thumbnails, duplicate detection, notebooks that can hold several documents |
| **Reader** | Fast lazy-rendered pages (pdf.js), crisp at any zoom, fit-width mode, Ctrl+wheel zoom, table of contents, full-text search, bundled CJK character maps |
| **Excerpts** | Select text → choose a color → it becomes a highlighted card. **Area excerpts** capture figures, formulas and tables as images (and remember the text under them for search) |
| **Mind map** | Horizontal tree with pan/zoom, drag & drop to reparent or reorder, collapse/expand, find (Ctrl+F), right-click menu, keyboard editing. Click a card to see it **enlarged** (full text, big image, notes) |
| **Free placement** | Drag a card into empty space and it stays there, still connected to its parent (Alt = detach as an independent card). Double-click anywhere to put a new card on that spot. *Tidy up* returns everything to the automatic layout |
| **Selection & groups** | Drag a selection box over cards, Ctrl/Shift+click to add, Ctrl+A for all. Move, recolor, tag, review or delete them together. **Ctrl+G** groups them into a named, colored frame (also shown on the whiteboard) |
| **Classify & filter** | Filter the map by color, tag, group or status (in review, due, has notes, image, placed freely) and select every match; tag several cards at once |
| **Formulas** | LaTeX in titles, excerpts, notes and whiteboard text — `$…$` inline, `$$…$$` display — rendered with KaTeX. Typing `\` suggests commands with live previews; Tab jumps between the `{}` slots of `\frac{}{}` and friends |
| **Whiteboard** | A free canvas per notebook: drag cards anywhere, draw with pen and highlighter, add rectangles, ellipses, text and arrows that stay connected to cards as you move them. **E** toggles pen ⇄ eraser; works with pen tablets (the eraser end of a pen erases too) |
| **Two-way links** | Click a card → the document jumps to the excerpt and flashes it. Click a highlight in the PDF → its card is selected in the map |
| **Outline** | The same cards as an indented outline, with drag & drop and Tab / Shift+Tab indent/outdent |
| **Card panel** | Title, color, editable excerpt, notes, tags, source link, review toggle |
| **Review** | Spaced repetition (SM-2, Anki-like): Again / Hard / Good / Easy, per notebook or across all notebooks |
| **Export** | Markdown, OPML (importable by mind-map apps such as XMind and MindNode), JSON backup |
| **Settings** | Theme (system/light/dark), accent color, interface size, canvas background, connector style, drag behavior, formula options, data folder (**Ctrl+,**) |
| **Updates** | In-app updates from GitHub releases: download in the background, restart to install — see [In-app updates](#in-app-updates) |
| **Comfort** | Undo/redo for all card, group and whiteboard edits, middle-click to close document tabs, native window controls, auto-save |

## Getting started

Requirements: Windows 10/11 and Node.js 22.12+.

```bash
npm install
npm run dev        # Electron app with hot reload
```

Build the Windows installer and a portable `.exe` (written to `release/`):

```bash
npm run dist
```

`release/MarginMap-Setup-0.5.1.exe` is a normal installer (it can update itself). `release/MarginMap-0.5.1-portable.exe` runs without installing.
To publish a release on GitHub, see [Releasing on GitHub](#releasing-on-github).
The builds are unsigned, so Windows SmartScreen will ask for confirmation the first time.

Other scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev:web` | UI only, in a browser (stores data in IndexedDB) — handy for UI work |
| `npm run typecheck` | TypeScript check |
| `npm run test:e2e` | Builds, then drives the real Electron app through import → excerpt → map → review → whiteboard → settings, updates, formulas, selection, groups, data folder (screenshots in `tests/output/`) |
| `node scripts/check-latex.mjs` | Checks that every LaTeX autocomplete suggestion renders in KaTeX |
| `npm run dist:dir` | Unpacked build in `release/win-unpacked/` (faster than a full installer) |

## How to use it

1. **Import** a PDF and click it — a notebook is created for it.
2. **Select text** in the document; in the popup pick a color to excerpt it as a card.
   Use the **area tool** (dashed-square icon) and drag a box to capture a figure.
3. **Select a card first** and new excerpts are added as its children — a quick way to build a hierarchy while reading.
4. **Organize** in the mind map: drag cards onto each other (middle = child, top/bottom edge = sibling), into empty space to place them freely, or use the keyboard.
   Drag across empty space to select several cards, then **Ctrl+G** to group them; the funnel button filters by color, tag, group or status.
   Write formulas as `$E=mc^2$` anywhere in a card.
   Or switch to the **whiteboard** (third view button) to arrange cards freely, sketch and connect them with arrows.
   Open the **Cards** panel there to drag cards in, and new excerpts land on the board while it is open.
5. **Review**: switch on *Review as flashcard* in the card panel (or right-click → *Add with all children to review*), then press **Review**.

### Keyboard shortcuts

| Where | Keys |
| --- | --- |
| Mind map | `Tab` add child · `Enter` add sibling · `F2` / double-click rename · `Del` delete selected · arrows navigate · `Space` locate in document · `Ctrl+F` find · `Ctrl+A` select all · `Ctrl+G` / `Ctrl+Shift+G` group / ungroup · drag empty space to select · right- or middle-drag to pan · double-click empty space for a new card there · `Esc` deselect |
| Whiteboard | `V` select · `H` pan (or hold `Space`) · `P` pen · `M` highlighter · `E` eraser (press again: back to the pen) · `R` rectangle · `O` ellipse · `A` arrow · `T` text · `Ctrl+G` group cards · `Del` remove · arrows nudge · double-click empty space for a new card |
| Formulas | `\` + letters: command suggestions · `↑`/`↓` choose · `Enter`/`Tab` insert · `Tab` next `{}` slot |
| Anywhere | `Ctrl+,` settings |
| Outline | `Tab` / `Shift+Tab` indent / outdent · `Alt+↑/↓` move · `Enter` new sibling · arrows navigate |
| Reader | `Ctrl+F` search · `Ctrl+=` / `Ctrl+-` zoom · `Ctrl+0` fit width · `Esc` cancel |
| Anywhere in a notebook | `Ctrl+Z` undo · `Ctrl+Y` / `Ctrl+Shift+Z` redo |
| Review | `Space` show answer · `1`–`4` grade |

## Where your data lives

By default everything is stored locally in `%APPDATA%\MarginMap`:

```
library.json          documents + notebooks index
docs\<id>.pdf         imported PDFs (copies)
notebooks\<id>.json   cards, mind map, whiteboard and review state
assets\<id>.png       area-excerpt images and thumbnails
```

Set `MARGINMAP_DATA_DIR` to use a different folder (portable use, testing). Settings → About → *Open* shows the folder in Explorer.

## Releasing on GitHub

Releases are built and uploaded by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

**One-time setup**

1. Create a public GitHub repository and push this project to it:
   ```bash
   git remote add origin https://github.com/<you>/marginmap.git
   git push -u origin main
   ```
2. In `package.json`, replace `OWNER` (in `repository` and in `build.publish`) with your GitHub user or organization,
   and `marginmap` with the repository name if it differs. Commit and push.
   *(That setting is also what installed copies use to look for updates.)*

**Each release**

1. Set the new `version` in `package.json` (e.g. `0.5.1`), add the changes to `UpdateLog.md`, commit.
2. Tag and push — the tag must be `v` + the version:
   ```bash
   git tag v0.5.1
   git push origin main --tags
   ```
3. The workflow type-checks, runs the end-to-end tests on Windows, builds, and uploads to a **draft** release:
   `MarginMap-Setup-0.5.1.exe` (installer), its `.blockmap`, `latest.yml` (read by the updater) and
   `MarginMap-0.5.1-portable.exe`.
4. On GitHub → Releases, open the draft, write the notes (they are shown in the app), and **Publish**.
   Installed copies see the update from that moment on.

electron-builder only builds the files (`--publish never`); the workflow uploads all four in one step with
the GitHub CLI. Letting electron-builder upload can split the files across several drafts with the same tag.
If a run fails half-way, delete its draft on GitHub, then use *Re-run all jobs* on the Actions page.

The builds are not code-signed, so Windows SmartScreen asks for confirmation on the first install.
Updates install without that prompt.

## In-app updates

*Settings → Updates* checks the latest **published** GitHub release (also automatically once a day at startup,
which can be switched off).

- **Installed copy** (`MarginMap-Setup-….exe`): *Download update* fetches the new installer in the background
  (only the changed parts when possible, thanks to the `.blockmap`), then *Restart and install* closes MarginMap,
  installs silently and starts the new version. Quitting the app after downloading installs it as well.
  Your library is never touched — it lives in `%APPDATA%\MarginMap`.
- **Portable copy**: it can't replace itself, so it only reports the new version and opens the release page.

Implementation: [`electron/autoUpdate.ts`](electron/autoUpdate.ts) (electron-updater, installed copies) and
[`electron/updates.ts`](electron/updates.ts) (notify-only check). The updater writes a log to
`%APPDATA%\MarginMap\logs\updater.log`.

For testing, two environment variables override the source:
`MARGINMAP_UPDATE_GENERIC=http://host/folder/` makes an installed copy update from a folder containing
`latest.yml` and the installer, and `MARGINMAP_UPDATE_URL` (`owner/repo` or a JSON URL returning
`{ "version", "url", "notes" }`) forces the notify-only check.

## Architecture

```
electron/main.ts      window, app:// protocol, file storage over IPC, single-instance + "Open with"
electron/dataDir.ts   where the library lives: choosing, moving or switching the data folder
electron/autoUpdate.ts in-app updates for the installed build (electron-updater)
electron/updates.ts   notify-only update check (portable build, development)
electron/preload.ts   the narrow API exposed to the UI (contextIsolation + sandbox on)
src/backend/          storage interface: Electron IPC, or IndexedDB in the browser build
src/store/            zustand stores — library, open notebook (undo history, selection, groups),
                      study-view UI, settings, update checks
src/components/
  reader/             pdf.js pages, text/area excerpting, highlights, ToC + search sidebar
  mindmap/            tree + free-placement layout, pan/zoom canvas, selection box, drag & drop, groups, filter
  whiteboard/         free canvas: cards, ink, shapes, text, arrows, group frames
  Settings, LatexAssist, MathText, Outline, Inspector, Review, Library, Study
src/lib/              pdf helpers, tree utilities, SM-2 scheduler, Markdown/OPML export, LaTeX (KaTeX) helpers
```

The stack is Electron 44, React 19, TypeScript, Vite 7, pdf.js 5, KaTeX 0.16 and zustand.

## Not (yet) implemented

Compared with MarginNote 4, MarginMap doesn't have EPUB support, pen annotations directly on the PDF, cloud sync,
OCR for scanned PDFs, or card-to-card links inside the mind map (the whiteboard's arrows cover part of that).
The data model (`src/types.ts`) leaves room for these.
