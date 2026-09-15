# Task 2-b — Library folders + search (full-stack-developer)

## Scope (only these files touched, per assignment)
- `src/components/workbench/library/LibraryView.tsx`
- `src/components/workbench/library/FileFormModal.tsx`
- `src/components/workbench/library/library.css`

## What was built

### Folder rail (`FolderRail` component, rendered above stats/grid, only when files exist)
- Chips: **All files (N)** · **Unfiled (N)** · one per folder (color dot + name + count, counts include archived files) · **+ New folder**.
- Active chip = pine gradient (`libraryFolderFilter` in store, persists).
- "+ New folder" → inline autofocus input: Enter creates (`addLibraryFolder`) + activates the new folder; Esc cancels; empty name rejected with a toast; blur commits non-empty text. A subtle ghost "New folder" button also sits in the toolbar line (hidden while the inline input is open).
- Double-click folder name → inline rename (Enter commits via `renameLibraryFolder`, Esc cancels, blur commits). While renaming, the chip does not filter on click and its × is hidden.
- Color dot click cycles `FOLDER_SWATCHES` (`setLibraryFolderColor`); tooltip "Click to change color · double-click name to rename". Dot uses a 22px hit area with a 12px visual via `background-clip: content-box` (inline `backgroundColor`, NOT `background`, so the shorthand doesn't reset the clip).
- Hover × (folder chips only, always visible on touch) → `useConfirm("Delete folder "X"? Files stay in the library, unfiled.")` → `deleteLibraryFolder`.
- Folder chips are HTML5 drop targets for dragged file cards (checks `text/plain` in `dataTransfer.types`, so OS-file drops for the shelf import don't interfere) → `moveFileToFolder` + toast. `.drop` highlight state.
- Chips are divs with `role="button"` + `tabIndex` + `aria-pressed` + Enter/Space handlers; inner dot/× are `role="button"` spans (no nested `<button>` DOM). ≥40px touch targets.

### Search
- `LibraryHeaderActions`: search box before the Seg (Search icon, placeholder "Search files…", × clear when non-empty) bound to `librarySearch`/`setLibrarySearch` → persists across view switches.
- Filter: case-insensitive substring over title + fileName + tags, AND-combined with folder filter and status filter.
- Toolbar line shows `N results for "q"` + clear IconBtn while searching.

### File cards
- Whole `<article>` is draggable: `setData('text/plain', file.id)`, `effectAllowed='move'`, `.dragging` class (opacity .5 + dashed border). Dragstart is suppressed when starting from `input/textarea/select` so existing click handlers / text selection never break; clicks still work via the native click-vs-drag threshold.
- Body folder chip (dot + folder name) when `file.folderId` — click filters to that folder.
- Actions row gains a compact native select (`.lib-move-select`, FolderInput icon, "No folder" + folders, reflects current folderId) → live `moveFileToFolder` + toast. Read/Edit/Link/Delete untouched.
- Chips row: `Star` + N (amber) when `favoritePages.length > 0`, `PenLine` + N (violet) when `annoPages.length > 0`, tooltips "favorite pages" / "annotated pages".

### Empty / edge states
- Folder selected + empty → "This folder is empty" + "Drag a file card onto the folder chip, or use Move on a card." + "Show all files". Unfiled-empty gets its own copy.
- Search miss → `No files match "q"` + "Clear search". Existing status-filter empty state preserved.

### FileFormModal
- Right meta column: "Folder" native select (global `.field select` styling), value `file.folderId ?? ''`, applied immediately via `moveFileToFolder` + toast (live, like cover controls).
- Insights grid: optional 5th/6th tiles — "Favorites" (Star icon + count) and "Annotated" (PenLine icon + count), only when > 0 (grid auto-fits).

### Stats / sort
- "Files" stat note appends `· N folders` when folders exist. Existing sorts kept unchanged (optional folder grouping skipped as risky).

## CSS (library.css)
New: `.lib-folder-rail`, `.lib-folder-chip` (+ `.active`/`.drop`/`.renaming`), `.lib-folder-dot`, `.lib-folder-name`, `.lib-folder-count`, `.lib-folder-x`, `.lib-folder-input`, `.lib-newfolder-input`, `.lib-newfolder-btn`, `.lib-search-box`, `.lib-search-clear`, `.lib-card.dragging`, `.lib-card-folder`, `.lib-folder-dot-sm`, `.lib-fav-chip` (+ `.anno`), `.lib-move`, `.lib-move-select`; `.lib-insight-label` now flex to carry icons. All design tokens only; active chip text uses `var(--surface-solid)` so it adapts to light/dark/prism. Focus-visible rings everywhere, responsive rail wrap, 520px input/name width reductions, 36px move-select on touch.

## Verification
- `bunx tsc --noEmit` → **0 errors** (whole project).
- `bun run lint` → **0 errors / 0 warnings**.
- `tail dev.log` → clean compiles only, no runtime errors (no E2E per task brief).
- Logic re-checked by reading code paths: create/rename guards, blur/Enter dedup (input unmounts before blur can double-fire), dragstart suppression for form controls, text/plain-only drop acceptance with file-id validation before moving, folder deletion falling back to unfiled + filter reset (store handles).

## Missing APIs noticed
None — every store/types API required by the brief already existed in the v5 foundation (Task F). No files outside the three owned files were modified.
