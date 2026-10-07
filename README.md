# Workbench Aurora — Offline Linux App

A local-first productivity workbench: goals, planner, PDF library, roadmaps,
focus sessions, habits, journal and reports. **Everything runs on your
machine** — no account, no server, no network. Your data lives in the app's
local profile (localStorage + IndexedDB) and survives restarts.

## Install (Linux)

Two artifacts come out of the build in `dist-app/`:

| File | Use |
|---|---|
| `Workbench Aurora-<version>-x86_64.AppImage` | Portable — chmod +x and run anywhere |
| `Workbench Aurora-<version>-amd64.deb` | System install — `sudo dpkg -i *.deb` |

After the deb install, launch "Workbench Aurora" from your app menu, or
`workbench-aurora` from a terminal.

**Full installation, data, update and troubleshooting guide: [INSTALL.md](INSTALL.md).**
Your data lives in `~/.config/workbench-aurora/` — installing, updating or
removing the app never touches it. The app shows its version in
**Settings → About** (bottom of any section).

## Build from source (fully offline-capable)

```bash
npm install            # once (needs network only for npm itself)
npm run app:build      # static export + AppImage + deb into dist-app/
```

- Fonts (Inter, Sora, JetBrains Mono) are bundled from `@fontsource-variable` —
  no Google Fonts, no CDN, no telemetry.
- The UI is a fully static export (`out/`) served inside Electron through a
  private `app://` protocol. The app never opens a network socket.

## Develop

```bash
npm run dev            # web preview at http://localhost:3000
npm run app:start      # Electron shell against the last export (out/)
SMOKE=1 npx electron . --ozone-platform=headless --no-sandbox --disable-gpu   # headless self-test
```

## Where is my data?

| Web (npm run dev) | Desktop app |
|---|---|
| Browser localStorage + IndexedDB | Electron profile: `~/.config/workbench-aurora/` |

Back up via **Settings → Backup & data → Export** (JSON) — the backup contains
goals, tasks, entries, habits, journal, library metadata and folders. PDF files
themselves live in IndexedDB; keep your own copy of imported PDFs outside the
profile if you re-install.

## Reading & study toolkit

- **Markdown notes** — the library holds PDFs *and* markdown. "New note"
  creates one; `E` toggles edit mode with live preview; autosaves as you type.
- **Text mode** — press `S` to cycle Single → Scroll → **Text**: the PDF's real
  text reflows like an e-book with font / size / line-height / column-width
  controls. Reading position and time still track pages.
- **Dictionary** — select any word (text layer or text mode) for offline
  definitions, synonyms, antonyms, examples and **English→Persian**
  translations. Pronounce with a click (OS speech). "Highlight" boxes the
  selection.
- **Vocabulary** (`G V`) — saved words become flashcards with Leitner review
  (Again / Good / Easy), streaks, and Anki-friendly CSV export.
- **Find in document** — `Ctrl+F` in the reader searches every page's text.
- **PDF editor** — select / move / resize / recolor strokes; rectangle,
  ellipse, line and arrow tools (`R` `O` `L` `A`); adjustable eraser size.
- **Insert pages** — blank / lined / grid / dots / Oxford (Cornell) templates
  with controllable page color, line color, width and spacing, written into
  the PDF as vectors.
- **Export with ink** — flatten every annotation into a new PDF file in the
  library; or capture a page's text as a markdown note.
- **Blink care** — Settings → Eye care: gentle look-away reminders while
  reading or focusing (interval, style and context configurable).

## Keyboard

`⌘K` palette · `C` capture · `F` focus · `T` timer · `N` new ·
`G+T/I/D/G/B/M/P/H/J/C/R/V` navigation · `Ctrl+Z / Ctrl+Shift+Z` undo/redo ·
`Ctrl+J` theme (Light · Night · Prism) · `Ctrl+F` find in PDF ·
`S` view mode · `E` edit note · `V/D/H/E` reader tools · `R/O/L/A` shapes
