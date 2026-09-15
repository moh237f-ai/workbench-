# Workbench Aurora — Merge & Rebuild Worklog

## Project Goal
Merge two single-file HTML versions of the "Workbench Aurora" productivity app into ONE best version, rebuilt as a Next.js 16 app, fixing all bugs (UI/UX/logic/structure), redesigning buttons + fonts, and making Focus Mode + Sidebar + Theme fully synced.

## Analysis of the two uploaded versions

### File 1: `upload/workbench-aurora(20260915-080219).html` (3087 lines, "Aurora Suite")
Feature-rich: Inbox + quick-capture NLP, Library (IndexedDB resources), Roadmaps canvas, dependencies, timeboxing, day planner, smart schedule, XP, reminders, search, weekly review, 4 themes (light/dark/prism/atelier), focus mode with 4 clocks (true split-flap flip), 9 backgrounds, 4 presets, compact + fullscreen, undo+redo, ICS import/export, events audit log, schema migration.

Critical defects found:
- SIX stacked <style> blocks of layered redesigns (base → Aurora 2.0 → Focus 2.0 → Aurora 3.0 → Prism → Atelier) overriding each other with !important + brittle `[style*=...]` selectors.
- FATAL SYNTAX ERROR in `searchRows`: `const hay=.name,h.description]` → whole script fails to parse → blank app.
- `plannedMinutesForDate` defined TWICE (1762 + 2046) with different semantics (startDate vs plannedStart).
- `render`, `persist`, `openItemDetail`, `exportJSONSuite`, `bindCommonActions` monkey-patched multiple times.
- `piProcessReplay`/`piProjectStats` read non-existent fields (`x.start`, `x.minutes`, `isItemBlocked`).
- `atelier` theme in THEMES list but CSS mostly absent → broken theme.
- Two parallel planning systems (startDate capacity vs plannedStart timebox) never reconciled.

### File 2: `upload/workbench-aurora (1).html` (1220 lines, "Clean 3.0")
Coherent single design system, command palette (⌘K), cleaner code.

Defects found:
- Focus mode re-renders the ENTIRE overlay every second (`updateFocusClockTime→renderFocusMode`) → flicker, animations destroyed.
- Flip clock is fake (static top/bottom text, no animation).
- Redo button in topbar has NO handler (dead button); no redo stack.
- `view-journal` action rendered but never bound → journal history clicks do nothing.
- Label rename inputs (`data-label-id`) have no change handler → renaming impossible.
- Pomodoro pause does not freeze the visible countdown.
- Kanban says "Drop here" but has NO drag & drop.
- Calendar has NO month navigation.
- No import (export only), no quick capture, sidebar clock second-hand stale between renders.

## Merged "best version" scope (decisions)
- Rebuild as Next.js 16 client app: Zustand + persist (skipHydration) + undo/redo session stacks.
- Views: Today, Inbox, Dashboard, Goals & Work (tree/kanban+DnD via @dnd-kit/matrix), Activity Log, Habits, Journal, Calendar (Gregorian+Shamsi, month nav, timeboxes, day planner), Reports.
- Focus Mode: 4 clocks (analog/digital/minimal/true split-flap flip), presets (25/50/90/custom), 9 backgrounds, compact, fullscreen, context card, live updates WITHOUT full re-render, pomodoro auto-advance globally, pause freezes countdown.
- Command palette ⌘K merging commands + global search (items/journal/habits/labels). Quick capture with NLP parse (p1, 45m/1.5h, today/tomorrow/next week).
- 3 polished themes: Light (Aurora Cream), Dark (Aurora Night), Prism (Prismatic Signal) — sidebar + focus mode + all UI follow the active theme.
- Redesigned button system (Btn component + .btn classes: primary/secondary/ghost/soft-danger/icon, sizes) and new font pairing: Sora (display) + Inter (body) + JetBrains Mono (numerals).
- Sticky status footer (autosave, timer, counts) using min-h-screen flex + mt-auto.
- Mobile: sidebar becomes drawer; responsive grids.
- Fix-all list: redo, label rename, journal view, kanban DnD, calendar nav, pause freeze, no flicker, import+export JSON, checklist editing in item detail (was missing), dependencies (blocked-by) editing + badges, empty-title validation with toast.
- Trimmed (with rationale, were broken/half-baked in file 1): PDF Library/IndexedDB, Roadmap canvas, evidence graphs, XP/levels, reminders, weekly review — consolidated into cleaner core. Stats (focus sessions/minutes) kept.

## Task IDs
- 1: Foundation (types, shamsi, helpers, store, globals.css, layout, fonts) — main agent
- 2: App shell (primitives, Sidebar, Topbar, Footer, toasts, modals host) — main agent
- 3: Views (Today, Inbox, Dashboard, Goals, Log, Habits, Journal, Calendar, Reports) — main agent
- 4: Focus Mode + clocks + command palette + capture + shortcuts — main agent
- 5: Lint + dev server + error fixing — main agent
- 6: Browser + VLM verification (desktop & mobile), fix issues — main agent (agent-browser + VLM skill)

---
Task ID: 0
Agent: main
Task: Deep-read both HTML files line-by-line, produce merged architecture + defect list

Work Log:
- Read both uploaded files completely (3087 + 1220 lines) via chunked reads + targeted greps.
- Catalogued every function, defect, and feature in both versions (see above).

Stage Summary:
- Architecture decided: Next.js client app, custom coherent design system, 3 themes, zustand store. Foundation coding starts next.

---
Task ID: 1-6
Agent: main
Task: Build the complete merged Workbench Aurora app in Next.js (foundation → shell → views → focus mode → palette), fixing every defect found in analysis

Work Log:
- lib/workbench/types.ts — full type system (items with checklist/dependencies/timeboxes, entries, habits, journal, pomodoro, focus presets/backgrounds).
- lib/workbench/shamsi.ts — REWROTE with faithful jalaali-js port; validated 5,487 checks (daily × 6 years both directions + month lengths 1390-1420) against Intl persian calendar with 0 failures. Fixes wrong leap-year handling (1403) and one-day J→G drift present in BOTH original files.
- lib/workbench/helpers.ts — dates, formatting, progress, pause-aware focus timing, capture NLP parser, ICS build/parse, streaks.
- lib/workbench/store.ts — Zustand + persist (skipHydration), undo+redo session stacks, all CRUD/timer/pomodoro/theme/focus actions, selectors.
- globals.css — ONE coherent design system (replaces file 1's six stacked <style> layers): 3 themes (Light Cream / Dark Night / Prism Signal), redesigned button system (.btn primary/ghost/danger + icon buttons with shine sweep, focus rings, active states), cards/KPIs/hero, tree/board/matrix, calendar, focus mode with 9 backgrounds, TRUE split-flap flip clock, responsive + reduced-motion.
- layout.tsx — new font pairing (Sora display / Inter body / JetBrains Mono numerals) + inline theme-init script (no flash, no hydration mismatch).
- Components: primitives (Btn/IconBtn/Seg/Modal/Toasts/shared 1s ticker useNow), Sidebar (theme-synced, live clock, timer pill, autosave), Topbar (undo/redo both wired), StatusFooter (sticky via min-h-screen flex + mt-auto), TodayClock, 4 focus clocks, FocusMode overlay (presets/backgrounds/compact/fullscreen, live updates WITHOUT full re-render, global pomodoro auto-advance, pause freezes countdown), 9 views, 10 modals incl. Command Palette (commands + global search with keyboard nav).
- Kanban drag & drop via @dnd-kit (file 2 promised "Drop here" but had no DnD — now real).
- Keyboard: ⌘K palette, C capture, F focus, T timer, N new, G+letter navigation, Ctrl+Z/Shift+Z undo/redo, Ctrl+J theme, Ctrl+/ shortcuts, Esc exits.

Bugs found & fixed during build/verification:
- deleteCascade reassigned local param → deletions silently no-op'd (fixed: returns filtered array).
- openHabitForm(null) collided with closed-sentinel → New habit modal never opened (fixed: object state).
- My initial shamsi port used unreduced year in leap calc (fixed via full jalaali-js port + validation suite).
- FlipDigit setState-in-effect lint violation → derived flipping state.
- Modal form resets → conditional-mount pattern (no effects).

Stage Summary:
- App fully functional in browser: goals tree/board(DnD)/matrix, capture NLP, inbox clarify/plan/archive, habits heatmap + streaks, journal history editing, dual calendar with month nav + timeboxes + day planner, reports with charts, undo/redo, import/export + ICS, 3 synced themes.
- ESLint clean; dev server compiles and serves 200 with no runtime errors.

---
Task ID: 7-10 (interleaved)
Agent: main
Task: Browser + VLM verification loop

Work Log:
- 33 screenshots taken across views × themes × breakpoints with agent-browser.
- VLM review rounds: (1) Today light → fixed clock sync (shared ticker), time format spacing, invisible capacity track, 0% hero empty state, sidebar label ellipsis. (2) Goals tree/board/matrix → fixed toast overlap with footer (raised stack), progress bar contrast (inset hairline), added "goal" chip on board cards. (3) Focus clocks → added visible ring tracks (analog+digital), stronger minimal progress bar, standard flip labels. (4) Dark/Prism themes → toned prism aurora to 0.17 opacity. (5) Habits/Journal/Log/Dashboard dark → heatmap cell borders, timer banner accent. (6) Mobile 390px → single-column KPI grid below 560px, hidden keyboard-shortcut hints on touch sizes. (7) Final 3-theme pass: all production-ready, sidebar follows theme everywhere.
- Interaction tests passed: goal+sub-item creation, kanban drag & drop (todo→in_progress), capture NLP ("Review PR comments tomorrow 45m p1" → P1/45m/due tomorrow), pomodoro start/pause(FREEZES countdown)/advance-to-break, theme cycling, calendar month nav + Gregorian/Shamsi (Shahrivar 1405 correct), heatmap toggle + streak, journal save + history switch, label create + rename-on-blur, checklist add/check → parent progress 50%, palette search → item detail, delete → undo → redo.
- Sticky footer verified: bottom=900 on short pages, pushed down on long pages.
- dev.log clean; final ESLint clean.

Stage Summary:
- Every golden-path flow verified working in-browser; all VLM-flagged issues resolved; three themes, desktop + mobile layouts confirmed production-ready.

---
Task ID: 11 (Phase 2 planning)
Agent: main
Task: Design "Workbench Aurora v4 — Connected Knowledge & Flow System": PDF Library, Roadmaps, Planner, Goals v2, Reports v2, Dashboard v2, cross-feature connections

## FULL DESIGN PLAN (v4)

### A. Library (PDF hub) — new view `library`
- PDFs stored client-side: blob in IndexedDB (`wb-files` DB: `blobs` + `covers` stores); light metadata in Zustand persist (localStorage).
- ResourceFile: title, fileName, size, pageCount, deadline ("dead time"), coverMode 'page'|'custom', coverPage (default 1), tags, notes, color, currentPage, pageSeconds (per-page seconds), readPages (manual marks), archived.
- Cover = rendered thumbnail (pdf.js, default page 1, user can pick any page or upload custom image). Covers cached in IDB, loaded async via `useFileCover` hook (module cache + skeleton).
- Library grid: cover, title, progress ring (read pages/total), time spent, deadline countdown chip (over/soon/ok), page position, actions (Read/Edit/Link/Delete). Stats header (files, pages read, reading min this week, avg sec/page). Filters: All/Reading/Unread/Deadline soon/Archived + sort.
- Reader overlay (`ReaderOverlay`): pdf.js canvas, page nav (arrows/keys), zoom, per-page time tracking (seconds accumulate on visible page; page ≥15s auto-counts read), live session timer, deadline countdown, linked goals/tasks chips, focus-read integration (starts pomodoro via store.startFileFocus, shows phase/remaining), immersive mode. Sessions flush to store every 10s + on close; `currentPage` persists for resume.
- ReadingSession log: id, fileId, date, startedAt, endedAt, minutes, pagesVisited, pagesRead, startPage, endPage.

### B. Files ↔ Goals/Tasks (many-to-many)
- Item.fileIds: string[] (one file in many goals/tasks; one task with many files).
- ItemDetailModal: Files section — link/unlink via picker, per-file progress bars, "Read" launches reader. Goals tree/board show file chips + file-count badges. Palette searches files.

### C. Roadmaps — new view `roadmap`
- Roadmap: {id, title, description, nodes, edges}. Node kinds: goal|task|file (refId → live status/progress/deadline mirror), milestone (date, done), note.
- Canvas: SVG pan (drag bg) + zoom (wheel/btns/fit), foreignObject node cards, node drag, link mode (click A→B creates edge), delete selection, edge labels, auto-layout (layered by topological depth).
- "Order" panel: topological order, per-node est time, CUMULATIVE time, blocked markers, critical path highlight → "see the order, the time, the process".
- Roadmap list with progress rings (entities done/total).

### D. Planner — new view `planner` (Day | Week)
- Day: hour timeline 6–24 with now-line; item timeboxes (drag move + resize, 5-min snap, writes plannedStart/plannedEnd via updateItem — same primitives as Calendar, NO duplicate planning system); file reading blocks (new `filePlans`: {id, fileId, date, startMin, minutes, done}) in violet; click block → detail/reader.
- Backlog sidebar: suggested items (due ≤3d/overdue/p0-p1, not yet timeboxed), reading goals (files with near deadlines / in-progress) → one-click schedule at next free slot; capacity meter vs dailyCapacityMin; "Auto-plan" greedy scheduler.
- Week: 7 columns with compact blocks + all-day due chips (items AND file deadlines), move ±1 day buttons, click day → Day view.

### E. Goals & Work v2 (more friendly)
- Tree: indent rails, dblclick inline rename, status-dot click cycles todo→in_progress→done, quick "+ sub" inline input per node, file chip with mini progress, filter bar (status/overdue/has-files), expand/collapse all. Board: file-count badge. Detail: files tab (B).

### F. Reports v2
- Existing KPIs + Reading section (minutes by day, top files: time/pages/avg-sec-per-page/deadline risk), Goals section (per-goal progress incl. linked files), Planner adherence (blocks planned vs completed in range), Roadmap progress.

### G. Dashboard v2
- New "Reading this week" KPI, "Continue reading" strip (resume last files), unified Upcoming deadlines (items + files), roadmap progress widget, today plan snapshot.

### H. Connections (all features wired)
- Reader ↔ Focus (startFileFocus pomodoro inside reader; reading time feeds stats/reports)
- Files ↔ Items (fileIds both directions, progress chips)
- Roadmap ↔ Files/Items (live mirrored nodes)
- Planner ↔ Items timeboxes + filePlans; Calendar unchanged (same primitives)
- Palette searches: items, journal, habits, labels, entries + FILES + ROADMAPS; events `wb-open-reader` / `wb-open-file-form`
- Today: continue-reading strip + file deadline chips. Dashboard unified deadlines. Footer: reading session live pill.
- Sidebar/keyboard: new nav Library (G B), Roadmaps (G M), Planner (G P).

### I. Foundation (main agent, BEFORE subagents)
- types.ts v4: ResourceFile, ReadingSession, FilePlanBlock, Roadmap(+Node/Edge), Item.fileIds, ActiveTimer.fileId, ViewId + 'library'|'roadmap'|'planner'.
- store.ts v4: persist version 4 + migrate (defaults for old data); CRUD actions for files/filePlans/roadmaps; addFilePageSeconds (batched), setFilePosition, toggleItemFile, startFileFocus; snapshots extended.
- lib: idb.ts (blobs/covers), pdf.ts (pdfjs lazy client-only, worker at /pdf.worker.min.mjs), fileStats.ts (progress/deadline selectors), helpers additions (minToHHMM/hhmmToMin).
- sample PDF generator (public/samples/aurora-sample-book.pdf) for E2E testing.

### J. Task split
- 12-a Library view + FileFormModal (+library.css) — subagent
- 12-b Reader overlay (+reader.css) — subagent
- 12-c Roadmap view + canvas (+roadmap.css) — subagent
- 12-d Planner view (+planner.css) — subagent
- 12-e Reports v2 + Dashboard v2 (no new css, reuse system) — subagent
- 13 Integration (WorkbenchApp/shell/palette/ItemModals/Goals v2/Today/FocusMode) — main
- 14 Lint/tsc/devlog fixes — main
- 15 Browser + VLM verification + fixes — main

Stage Summary:
- Plan approved and committed; foundation coding starts immediately. Architecture stays local-first (IndexedDB for blobs/covers, Zustand persist for metadata) consistent with existing app.

---
Task ID: 12-e
Agent: full-stack-developer (Reports + Dashboard v2)
Task: Reports v2 + Dashboard v2 — reading/goals/planner-adherence/roadmap reporting + continue-reading strip, unified deadlines, roadmap widget on dashboard
Work Log:
- Read worklog Task 11 v4 plan + all mandated files (both views, types, store selectors, helpers, covers, primitives, viewCtx, globals.css class inventory).
- ReportsView.tsx REWRITE (kept ReportsView + ReportsHeaderActions exports, pills/header + By day/By label/By item logic untouched):
  - KPI row 4 → 6 cards: added "Reading time" (Σ wbReadingMinutesInRange, sub pages in range) and "Files on track" (at-risk+overdue count of deadline-bearing unfinished files, coral when >0, sub "X of Y with deadlines").
  - NEW "Reading by day" daychart (readingSessions minutes/day, violet gradient bars, only days>1) after "By day".
  - NEW "Top reading files": top 8 by minutes-in-range as bar-rows (violet fill) + meta line "X/Y pages · Z% · avg Ns/page" + deadline chip (over/soon/ok); up to 3 at-risk 0-minute files appended marked "not started" chip.
  - NEW "Goals & linked files": top 10 active goals by deadline — progress bar (goal.color||pine, width=progress%), % value, meta "N linked files · files Z%" (fileIds ∪ direct children fileIds, avg wbFileProgress).
  - NEW "Planner adherence" (skipped when 0 blocks in range): 4 stat-cards — timeboxes planned/done, reading blocks planned/done, adherence % (pine ≥60 / amber 30-59 / coral <30), total planned minutes (timebox plannedEnd−plannedStart + block minutes).
  - NEW "Roadmaps" section: per-roadmap title + pbar (avg node progress: item→computeProgress, file→wbFileProgress, milestone→done, note excluded, empty→0) + % + "N nodes · M links".
- DashboardView.tsx EXTEND (all existing widgets kept):
  - KPI grid 4 → 5: added "Reading this week"; removed inline repeat(4,…) so grid-cards auto-fit wraps responsively.
  - NEW "Continue reading" strip after KPIs (0<progress<100, ≤5 by lastReadAt desc): horizontal scroll (overflow-x auto, thin scrollbar), ContinueCard sub-component w/ useFileCover (84px 3/4 cover, skeleton + FileText fallback, 2-line clamp title, "p.X of Y" mono, slim pbar + %, Resume Btn + clickable cover → 'wb-open-reader' event).
  - REPLACED "Upcoming deadlines" with unified items+files merge (deadline && <100%, archived excluded), sorted, top 6, goal-card rows w/ Target/BookOpen icons (pine/violet), Item/File meta, chip labels ("in 3d"/"2d overdue"/"due today"); item→openItemDetail, file→wb-open-reader; keyboard accessible.
  - NEW "Roadmaps" mini widget (right col, after Signals): top-2 by updatedAt as clickable goal-cards (pbar + % + "N nodes" mono) → useWB.setState({view:'roadmap', activeRoadmapId}); "+ New" ghost Btn → createRoadmap + navigate.
  - Quick jumps: added Library (BookOpen), Roadmaps (Waypoints), Planner (CalendarClock).
- Verified: bunx tsc --noEmit clean (whole project), bunx eslint on both files clean (fixed React Compiler preserve-manual-memoization by inlining progress helper inside useMemo closures); dev.log clean.
Stage Summary:
- Reports now covers reading, linked-file goals, planner adherence and roadmap progress; Dashboard surfaces reading KPI + resume strip, unified item/file deadlines and roadmap widget — all using existing design tokens/classes only (no new CSS), fully typed + memoized.

---
Task ID: 12-d
Agent: full-stack-developer (Planner)
Task: Build Planner view (Day timeline + Week board) with draggable item timeboxes, violet file reading blocks, backlog panel (capacity/suggested/reading goals/auto-plan), all in plan-* CSS on design tokens.

Work Log:
- Read worklog v4 plan (§D Planner), types.ts (Item.plannedStart/plannedEnd/startDate, FilePlanBlock), store.ts (planner state/actions/filePlans CRUD/selectors), helpers.ts (v4 time helpers), primitives (Btn/IconBtn/Seg/toast/useNow), viewCtx (openItemDetail), CalendarView (timebox conventions), globals.css (tokens: --pine/--violet/--coral/--amber, .card/.chip/.seg/capacity-track patterns, scrollbar styling).
- Created src/components/workbench/planner/PlannerView.tsx exporting PlannerView + PlannerHeaderActions (Seg Day|Week + Today ghost btn).
- Day mode: 06:00–23:00 timeline, 56px/hour, hour hairlines + half-hour dashed, sticky-ish mono gutter labels, auto-scroll to 08:00 on mount/date change, now-line (isolated NowLine component using shared useNow ticker so only it re-renders per second) with pine line + time bubble.
- Item timebox blocks: pine-tinted, 3px stripe = item.color (via --stripe CSS var, falls back to pine), title clamp 650, mono time range, done → strike + 60% opacity, clamped-before-6:00 "↑" indicator, min 24px height.
- Pointer drag (move + bottom resize handle): setPointerCapture + pointercancel discard + window-level safety listeners, 5-min snap, move clamps 0..1440-dur, resize min 15min, click-vs-drag threshold 4px (click → openItemDetail / 'wb-open-reader'), commits via updateItem({plannedStart, plannedEnd, startDate}, {snapshot:true}); resize also syncs estimateMin = durMin; file blocks commit via snapshot()+updateFilePlan({startMin, minutes}).
- File reading blocks: violet, BookOpen icon, done-circle toggle top-right (updateFilePlan({done})), hover ✕ delete (deleteFilePlan), click → 'wb-open-reader' event with fileId.
- Backlog panel: Capacity card (Σ timebox durations + Σ file minutes vs dailyCapacityMin, plan-meter pine/coral fill, "over by Xm"); Suggested work (not done/archived/inbox, not timeboxed today, not dependency-blocked, due ≤3d/overdue/p0-p1; sorted priority→deadline; "+ Add" schedules at nextFreeSlot from max(8:00, now-if-today) in 5-min steps with toast); Reading goals (deadline ≤7d or in-progress or unread-with-deadline, sorted by deadline; pages-left + deadline chips via wbFileDeadlineStatus; "30m" adds file plan at next free slot); Auto-plan card (single lazy snapshot, greedy fill until capacity, ≤2 reading blocks, toast "Planned N blocks · Xm", disabled when nothing to plan or capacity committed).
- Week mode: Monday-based 7-column header (weekday + date, today pine, click → Day view), per-day columns (min 320px, max-h 60vh scroll) with all-day due chips (items amber/coral-when-past → openItemDetail; file deadlines violet → reader), merged sorted compact rows (timeboxes pine dot + mono time + strike-when-done; file blocks violet dot), hover-revealed ‹ › day-shift buttons (timebox: recompute plannedStart/plannedEnd on addDaysStr; file: updateFilePlan({date})), ✕ on file rows, footer card with 7 mini bars (pine=item min, violet=reading min, today outlined) + "Planned Xh Ym · Reading Zh" totals.
- planner.css: all plan-* prefixed, tokens only (works across light/dark/prism), custom .plan-scroll scrollbars, touch-action:none on blocks for touch dragging, @media(hover:none) keeps controls visible, ≤980px single-column day grid (backlog below) + 2-col week, prefers-reduced-motion support.
- Verified: bunx tsc --noEmit → 0 errors; bunx eslint src/components/workbench/planner → clean; dev.log healthy.

Stage Summary:
- Files created: src/components/workbench/planner/PlannerView.tsx (exports PlannerView, PlannerHeaderActions), src/components/workbench/planner/planner.css. No other files touched.
- Key decisions: single planning system — planner writes the same plannedStart/plannedEnd timeboxes as Calendar/Timebox modal (no duplicate); resize syncs estimateMin for consistency; suggested work additionally excludes dependency-blocked items (wbIsBlocked) since they can't be acted on; file-plan drag/delete take an explicit store.snapshot() because updateFilePlan/addFilePlan don't snapshot internally; NowLine isolated as its own component to avoid per-second re-render of the whole planner; week rows merge timeboxes + file blocks into one start-sorted list.
- Integration notes for Task 13: import { PlannerView, PlannerHeaderActions } from './planner/PlannerView'; wire 'planner' into ViewBody/ViewHeaderActions switch + sidebar (G P) + palette.

---
Task ID: 12-a
Agent: full-stack-developer (Library module)
Task: Library view (PDF shelf: covers, filters, stats, hover actions, DnD import) + FileFormModal (cover controls, meta, reading insights, page time map, recent sessions) + library.css

Work Log:
- Read worklog (Task 11 v4 plan), types.ts, store.ts (v4 file actions + wb* selectors), idb.ts, pdf.ts, covers.ts, helpers.ts, primitives.tsx, GoalsView/ReportsView (style refs), globals.css (tokens + existing classes).
- library.css — NEW lib-* classes only (toolbar/sort select, grid + drop-zone highlight, card, cover w/ shimmer skeleton + fallback tile, page badge, 2-line-clamp title, chips, progress, meta, hover-reveal actions (always visible on touch, ≥36px targets ≤640px), inline link picker w/ max-h + slim webkit scrollbar, importing chip + spinner, modal form grid, cover preview, insights grid, page time map + legend, session rows, responsive single-col ≤520px). Design tokens only; #fff solely as PDF cover backdrop.
- LibraryView.tsx — module-level import pipeline shared by header button / drop zone / empty state: uid → putBlob → loadDocFromBlob → pageToDataUrl(1,420,0.72) → saveCover → addFile → toast; purgeFileArtifacts + error toast on failure; useSyncExternalStore-based "Importing n…" busy chip. usePdfPicker hook (hidden multi-file input, re-selectable). useCoverWithFallback (epoch-keyed timeout distinguishes shimmer vs failed tile — lint-clean, no setState-in-effect). Header actions: filter Seg (All/Reading/Unread/Deadline/Archived bound to store.libraryFilter) + Add PDF. View: 4 stat-cards (Files+total pages, Reading this week via wbReadingMinutesInRange + pages sub, Pages read this week via wbReadingPagesInRange, weighted avg sec/visited page), sort select (Recent/Deadline/Progress/Title, local), lib-grid cards: cover (click→'wb-open-reader', p.X/Y badge), title (click→'wb-open-file-form'), deadline chip (wbFileDeadlineStatus + daysUntil: "3d left"/"2d overdue"/"due today"/done), pbar + "42% · 5/12p", fmtDuration time, tag chips, linked-count chip; hover actions Read/Edit/Link/Delete; Link = inline picker (search + active items, toggleItemFile + toast, linked-first sort); Delete = confirm → purge + deleteFile + toast. Filters per spec (deadline = set && (status!=='ok' || pct<100); archived isolated, others exclude archived). Drag & drop of PDFs onto grid/empty-state with dashed pine highlight + non-PDF toast. Empty states (no files at all / filter mismatch with Show-all shortcut). Archived cards get grayscale cover + chip.
- FileFormModal.tsx — signature ({ fileId, onClose }); hooks-before-guard pattern (file may vanish mid-edit). Two-col wide modal: live cover preview (useFileCover) + cover Seg page|custom — page mode: number input 1..pageCount applies live (updateFile + refreshCover, blur-safe text state); custom mode: image upload → FileReader → applyCustomCover + updateFile. Right: Title/Deadline/Tags(comma→string[] deduped)/Notes/SWATCHES color. Insights grid (total time, avg sec/page, sessions count, current page). Page time map (10px cells, pine-scaled 0→15s+, manual readPages ring, "Page N · Xm Ys" tooltips, max-h 120 scroll + legend). Recent sessions (latest 5, "Mar 3 · 24m · 6 pages · p.2→8"). Footer: Delete (left, danger, confirm→purge+delete+close) / spacer / Cancel / Save (patches updateFile, validates title).
- Cross-feature events only: 'wb-open-reader', 'wb-open-file-form' (dispatched, never imported other components). No other files touched.
- Fixed react-hooks/set-state-in-effect in useCoverWithFallback by epoch-keying the timeout state; removed an unused type import. `bunx tsc --noEmit` clean; `bunx eslint src/components/workbench/library` clean; dev.log shows healthy compiles.

Stage Summary:
- Files created: src/components/workbench/library/LibraryView.tsx (exports LibraryView, LibraryHeaderActions), src/components/workbench/library/FileFormModal.tsx (exports FileFormModal({ fileId, onClose })), src/components/workbench/library/library.css (lib-* only, imported by both tsx).
- Key decisions: module-level import queue + useSyncExternalStore count so the busy chip tracks drops as well as the header button; per-instance hidden inputs (header + view + empty state) sharing one pipeline; cover fallback via 2.4s epoch-keyed grace timer since useFileCover can't signal failure; link picker is inline in-card (violet accent) with toggle semantics; all live cover edits (mode/page/custom upload) apply immediately, meta fields apply on Save.
- Ready for wiring: add LibraryView/LibraryHeaderActions to WorkbenchApp view registries, mount FileFormModal on 'wb-open-file-form', ReaderOverlay (12-b) consumes 'wb-open-reader'.

---
Task ID: 12-b
Agent: full-stack-developer (Reader overlay)
Task: Build the full-screen PDF ReaderOverlay (pdf.js canvas, per-page time tracking, focus-read, immersive mode) + reader.css
Work Log:
- Read worklog v4 plan, types/store/pdf/helpers/covers, primitives, FocusMode + ItemModals for conventions and exact store API signatures.
- reader/ReaderOverlay.tsx: createPortal→body, z-900, `ReaderOverlay({ fileId, onClose })`. loadFileDoc with loading/error/file-missing states; fit-width default (ResizeObserver + computed padding, debounced), zoom ±10% clamp 50–300% + Fit reset + % display; serialized canvas paints (promise chain + seq guard) so rapid page/zoom changes never race pdf.js renders.
- Reading-time core: 1s tick gated on document.visibilityState; pending Map<page,secs> flushed every 10s + on page change + on unmount via addFilePageSeconds; visited/newly-read Sets with immutable mount snapshot of pageSeconds/readPages to detect 15s (PAGE_READ_THRESHOLD_SEC) threshold crossings; logReadingSession on close when elapsed ≥ 60s (startPage/endPage/pagesVisited/pagesRead, minutes=max(1,round)).
- Nav: prev/next (disabled at bounds), page input (Enter applies, clamped, Esc blurs+resets), ←/→/PageUp/PageDown/Home/End (ignored in inputs or while a modal is open above), setFilePosition on every change, stage scrolls to top.
- Header chrome: title + p.X of Y + slim read-pages progress + meta, deadline chip (wbFileDeadlineStatus + daysUntil → "3d left"/"2d overdue"/"Due today"/"Complete"), linked item chips (wbItemsForFile, icon by type, → 'wb-open-item' event), live session clock (fmtClock mono via shared useNow), time-on-page counter, close. Focus-read: start Btn / phase badge + mm:ss + pause/resume/skip/end (stopTimer + toast('Session logged')) / "Timer running elsewhere" chip; pomodoro auto-advances at 0 while focus-reading (mirrors FocusMode).
- Footer toolbar: zoom out/%/in/Fit | prev/input/next | Mark read/Unread toggle (markFilePage, reflects file.readPages) | immersive toggle (PanelTopClose/Open) | session clock.
- Immersive: reader-immersive collapses header+footer (animated max-height/padding/translate), chrome returns on mousemove or tap (touch support) and auto-hides after 2.6s; Esc exits immersive first, else closes.
- reader.css: rd-* only, tokens throughout (surface-solid panels, hairline borders, shadow-lg canvas, pine/amber/coral/violet accents), themed thin scrollbars, mobile wrap + 44px coarse-pointer targets, reduced-motion support. Canvas paper white is the sole non-token color (PDF content paints over it).
- Verified: `bunx tsc --noEmit` 0 errors; `bunx eslint src/components/workbench/reader` clean. No other files modified.
Stage Summary:
- Files: src/components/workbench/reader/ReaderOverlay.tsx (+ reader.css). Export: `ReaderOverlay({ fileId, onClose }: { fileId: string; onClose: () => void })`.
- Key decisions: render serialization via promise chain (no cancel API in renderPageToCanvas), exact fit-width from computed stage padding, threshold-crossing math against mount snapshot, nav keys yield to any open modal overlay, z-index 900 per spec (integrator must keep modals/toasts above — modal-overlay currently z-120 in globals.css).

---
Task ID: 12-c (completed by main after subagent context-exhaustion)
Agent: main
Task: Complete the Roadmaps module (canvas was finished by subagent; view written by main)

Work Log:
- Subagent delivered RoadmapCanvas.tsx (704 lines: pan/zoom SVG, foreignObject node cards, link mode, bezier edges + labels, topo helpers, nodeLive mirroring) + roadmap.css (676 lines incl. all view classes) but ran out of context before RoadmapView.tsx.
- Fixed React Compiler violations in canvas: latest-value refs now synced via useEffect (was assigned during render); auto-fit/fit-on-demand deferred via requestAnimationFrame.
- Wrote RoadmapView.tsx: list screen (progress rings, inline rename, delete, empty state) + workspace (toolbar with add-node popover: goal/task/file pickers + milestone/note mini-forms, link toggle, auto-layout, fit, zoom pill, order panel toggle, selection actions incl. edge label editor) + Execution Order panel (topological order, running cumulative Σ time, blocked markers, critical-path DP highlight, total estimate).
- Moved order computation to module-scope pure function (compiler-safe).

Stage Summary:
- Roadmaps fully functional: create/rename/delete, 5 node kinds with live entity mirroring, connect edges with labels, auto-layout, fit/zoom, execution order with critical path. Verified E2E in browser.

---
Task ID: 13
Agent: main
Task: Integration — wire all v4 modules into the app shell and upgrade existing views

Work Log:
- globals.css: modal-overlay z 120→940, toast-stack 300→960 (above reader overlay 900).
- WorkbenchApp: registered library/roadmap/planner views + header actions; mounted ReaderOverlay + FileFormModal; wb-open-reader / wb-open-file-form event hosts; G+B/G+M/G+P key map; excluded new views from default Capture/New buttons.
- shell.tsx: NAV + Library (G B) / Roadmaps (G M) / Planner (G P); footer: file count, reading minutes/pages, Reading-phase timer pill color.
- CommandPalette: Go-to commands for 3 new views; global search over files (→ reader) and roadmaps (→ canvas); hint text updated.
- ItemModals ItemDetailModal: Linked-files section — per-file progress bars, Read (opens reader), unlink, searchable picker, guidance copy. (one file ↔ many goals/tasks)
- GoalsView v2: filter bar (All/Active/Done + Overdue + With files toggles, filterTree keeps matching ancestors), dblclick inline rename, status-dot click cycles todo→in_progress→done, inline quick-add sub-item per node, violet file chips with avg reading %, sub-item count on caret, expand/collapse all, board file-count badges.
- TodayView: Continue-reading strip (cover thumbnails, p.X/Y, resume); unified Deadlines (items + files with reading meta, click → reader).
- FocusMode: file context card (title, p.X/Y, pages read, %) + BookOpen icon when activeTimer.fileId.
- CalendarView: Planner shortcut button. MiscModals: new shortcuts documented.

Stage Summary:
- Every feature now cross-wired: files↔items, roadmap↔entities, reader↔focus, planner↔timeboxes+filePlans, palette↔everything, sidebar/keyboard complete.

---
Task ID: 14
Agent: main
Task: Quality gates

Work Log:
- Fixed pre-existing latent tsc errors (undo/redo return types, getFocusTiming param, stats spread), excluded examples/skills/upload/tests/tool-results from tsconfig + eslint; public/** excluded (minified pdf worker).
- covers.ts useFileCover restructured to keyed-map state (no setState-in-effect).
- tsc --noEmit: 0 errors. ESLint: 0 errors 0 warnings. dev.log: clean compiles, 200s, no runtime errors.

Stage Summary:
- Whole project type-clean and lint-clean.

---
Task ID: 15
Agent: main
Task: Browser E2E + VLM verification of the full v4 system

Work Log:
- E2E verified with agent-browser (30 screenshots): sample PDF (tests/make-sample-pdf.mjs → public/samples) injected via DataTransfer → upload pipeline (blob→IDB, pdf.js pageCount=8, cover render, card with stats/filters/sort); READER: page render + nav (buttons + ←/→ + input), zoom, per-page seconds tracking (pageSeconds persisted), currentPage=4 resume, session logged (readingMinutes=1), deadline chip, FOCUS-READ pomodoro inside reader (pause freezes, skip, end logs), immersive mode.
- FileForm: deadline set (+5d → "5d left" chip), cover page 1→3 (regenerated + persisted), tags/notes/color, page-time heatmap, recent sessions.
- LINKING: goal "Master ODE for the exam" + 2 sub-tasks created via quick-add; file linked to goal AND task from library Link picker (many-to-many); file chip with 13% reading progress on goal tree; ItemDetail Files section verified.
- ROADMAP: created "ODE Exam Prep Plan", added goal/task/file/milestone nodes, linked chain (3 edges), auto-layout, Order panel: 1.Goal CRITICAL 30m Σ30m → 2.Task CRITICAL 30m Σ1h → 3.File CRITICAL 09-20 7m Σ1h7m → 4.Milestone 10-01 — exactly "order + time + process".
- PLANNER: day timeline with now-line, reading block scheduled at next free slot (11:10–11:40), capacity "1 block · 30m planned", week view 7 columns + 2-col mobile fallback.
- REPORTS: Reading by day, Top reading files, Goals & linked files, Planner adherence, Roadmaps sections + 6 KPIs. DASHBOARD: Continue reading, Reading this week KPI, unified deadlines, Roadmaps widget, quick jumps.
- Palette search finds files/roadmaps; G+B/M/P shortcuts work.
- VLM review rounds: (1) core 4 views OK; (2) goals/reports/dashboard OK, dark library flagged bottom cut-off → verified false alarm (page scrolls, footer clear); (3) mobile round: stat-note clip = false alarm, week label = intended ellipsis, dev-tools badge misread; REAL fix applied: mobile roadmap fit-zoom floor 0.62 (nodes were 35% → unreadable) — re-verified readable, nothing clipped; (4) reader + file form OK; final Today OK.
- Fixed during verification: roadmap canvas ref-during-render, setState-in-effect (×2), stray typo, unused imports.

Stage Summary:
- Full v4 system verified end-to-end in the browser across light/dark/prism and desktop/mobile; all VLM-flagged issues resolved or confirmed false alarms. Production-ready.

---
Task ID: F (v5 foundation)
Agent: main
Task: v5 foundation — focus photo backgrounds + shared data layer for reader/library/planner/roadmap upgrades

Work Log:
- Generated 7 atmospheric photos via z-ai CLI (1344x768, multiples of 32 required): public/focus-bg/{forest,sea,village,desert,sky,stars,night}.png
- types.ts: +LibraryFolder; ResourceFile += folderId/favoritePages/annoPages; +Stroke/PageAnnoMap/AnnoTool; +ReaderPrefs (viewMode single|scroll, tool select|pen|highlight|eraser, themeMode light|dark|warm|custom + custom brightness/contrast/sepia, pen/hl color+width); +HL_SWATCHES/PEN_SWATCHES/FOLDER_SWATCHES; FOCUS_BACKGROUNDS now aurora+7 photos; +FOCUS_BG_META with photo paths.
- idb.ts: DB_VERSION 2 + STORE_ANNOS; getAnnos/putAnnos/delAnnos + fetchAnnosCached/cacheAnnos/dropAnnoCache; purgeFileArtifacts also purges annotations.
- store.ts: makeFile += favoritePages/annoPages/folderId; DEFAULT_READER_PREFS; state += libraryFolders/libraryFolderFilter/librarySearch/readerPrefs; actions += addLibraryFolder/renameLibraryFolder/setLibraryFolderColor/deleteLibraryFolder/moveFileToFolder/setLibraryFolderFilter/setLibrarySearch/toggleFileFavoritePage/setFileAnnoPages/updateReaderPrefs/duplicateRoadmap; migrate + partialize extended (v4 persisted data auto-normalized).
- globals.css: focus backgrounds replaced with photo scenes (::before image + scrim + 70-110s focusDrift ken-burns, per-id base colors); REMOVED .focus-stage::before/::after (the circles behind clocks); bg panel cards now photo thumbnails (.focus-bg-thumb); vignette added via .focus-overlay::after.
- FocusMode.tsx: legacy bg id guard (flow/nebula/... -> aurora), photo panel via FOCUS_BG_META, B key cycles atmosphere + toast, hint text updated.
- tsc --noEmit: 0 errors; dev server compiles clean.

Stage Summary:
- Shared layer ready for 4 parallel feature agents (reader v2, library folders, planner v2, roadmap deep dev). No shared-file edits allowed for subagents — all store/idb/types APIs they need already exist.

---
Task ID: 2-b
Agent: full-stack-developer (library folders)
Task: Library folders (rail + create/rename/recolor/delete + DnD moves) + shelf search + card/modal folder affordances

Work Log:
- Read worklog (Task F v5 foundation), LibraryView/FileFormModal/library.css/types/primitives + store API surface — all needed APIs existed (addLibraryFolder, renameLibraryFolder, setLibraryFolderColor, deleteLibraryFolder, moveFileToFolder, setLibraryFolderFilter, setLibrarySearch, librarySearch/libraryFolderFilter/libraryFolders state, FOLDER_SWATCHES).
- LibraryView: new FolderRail component above stats/grid (All files (N) · Unfiled (N) · per-folder chip with color dot + name + count · "+ New folder" inline input). Chip click filters (pine active state), dblclick name → inline rename (Enter commit / Esc cancel / blur commit), color-dot click cycles FOLDER_SWATCHES, hover × deletes via useConfirm (files fall back to unfiled), folder chips are HTML5 drop targets for dragged file cards (.drop highlight → moveFileToFolder + toast). Rail only renders when files exist; toolbar also gets a subtle ghost "New folder" button.
- Search: header-actions search box (Search icon, × clear) bound to store librarySearch (persists across view switches); filtering ANDs title/fileName/tags substring match with folder filter + status filter; toolbar shows "N results for 'q'" + clear action.
- FileCard: whole card draggable (text/plain = file id, effectAllowed move, .dragging opacity .5, dragstart suppressed from input/textarea/select so clicks/text-selection never break); folder chip on card body (dot + name, click → filter); Star favorites + PenLine annotations count chips (amber/violet); compact .lib-move-select ("No folder" + folders) appended to actions row with live move + toast.
- Empty states: folder selected → "This folder is empty" + drag/Move hint + Show-all button (Unfiled variant copy); search miss → "No files match 'q'" + Clear search; existing status-filter empty state kept.
- Stats "Files" card note now appends "· N folders" when folders exist. Sorts unchanged (folder grouping skipped as risky).
- FileFormModal: "Folder" native select in right meta column (live moveFileToFolder + toast, mirrors cover controls); insights grid gains optional "Favorites" (Star) and "Annotated" (PenLine) tiles when counts > 0.
- library.css: added .lib-folder-rail/.lib-folder-chip(+.active/.drop/.renaming)/.lib-folder-dot/.lib-folder-count/.lib-folder-x/.lib-folder-input/.lib-newfolder-btn/.lib-search-box/.lib-search-clear/.lib-card-folder/.lib-folder-dot-sm/.lib-fav-chip(.anno)/.lib-move/.lib-move-select/.lib-card.dragging + insight-label icon support; 40px touch targets on rail chips, focus-visible rings, hover states, responsive tweaks (520px search/folder-name widths, 36px move select on touch).
- Detail fixes: dot uses inline backgroundColor (background shorthand would reset background-clip hit-area trick); rename/create inputs stopPropagation so chip clicks don't filter; dot/× dblclick isolated from chip rename.

Stage Summary:
- Library now organizes by folders end-to-end: create/rename/recolor/delete in the rail, move via card drag&drop, card Move select, or the FileFormModal Folder field; search composes with all filters; empty/edge states covered. Files touched: src/components/workbench/library/{LibraryView.tsx, FileFormModal.tsx, library.css} only.
- Verification: bunx tsc --noEmit → 0 errors; bun run lint → 0 errors/warnings; dev.log clean compiles. No missing store APIs — everything needed was already in the v5 foundation.

---
Task ID: 2-c
Agent: full-stack-developer (planner v2)
Task: Planner v2 — date navigation bar, click-to-add quick capture, drag-to-schedule from backlog, overlap detection, Up Next card, copy/clear/now day actions, week DnD + day totals, capacity free-time polish.

Work Log:
- Read worklog (v4/v5 history, Task F foundation), current PlannerView v4 + planner.css, helpers, primitives (Btn/IconBtn/Seg/toast/useConfirm/useNow), viewCtx, store APIs (addItem/makeItem/filePlans CRUD/planner nav/selectors), globals.css tokens + .dark/.prism theme classes, eslint config.
- PlannerView.tsx upgrades (only file + planner.css touched):
  - Date bar: ‹/› (day ±1, week ±7), "Monday, January 5" label + pine Today badge, native date input (.plan-date-input, color-scheme per theme), Today chip.
  - Click-to-add on empty .plan-tl-lanes (guard closest('.plan-block,.plan-pop')): QuickAddPop fixed 264px viewport-clamped popover — title input (autofocus, Enter), duration Seg 15/30/45/60/90, Task|Reading Seg; reading → file picker (deadline-sorted unfinished files, max-h 200 scroll, search when >8, pages-left chips, aria-pressed select); snapshot → addItem / addFilePlan; toasts; Esc + click-outside close; 15-min snapped start clamped 0–1425; "at 14:30" in header; auto-hide on date change via pop.date===date render guard (compiler-safe).
  - Drag-to-schedule: .plan-sug-grip on every suggested/reading row, pointer capture pattern; .plan-ghost block (pine/violet dashed) + .droptarget lanes highlight while over timeline; drop commits updateItem(snapshot)/snapshot+addFilePlan at snapQ minute; <4px or off-timeline → no-op; row dimmed while dragging.
  - Overlap detection: drag-aware O(n²) half-open interval scan → .plan-overlap coral dashed outline + AlertTriangle corner icon + aria-label suffix; re-evals during drags.
  - Up Next card (side col, first): isolated component with own useNow(isToday); running → pulsing dot "Now" + remaining; next → "Next · at 10:30 · in 23m"; empty today → "Nothing left today — nice."; other date → "First block · at 09:00"; click opens detail/reader; done blocks skipped.
  - Timeline header: "3/7 done" chip (blocks exist only), Copy yesterday (new items + file plans at same times, snapshot, spec toasts), Clear day (useConfirm → snapshot → null plannedStart/plannedEnd on that date's timeboxes + deleteFilePlan each), Now IconBtn (Crosshair, today only, smooth scroll to now-line).
  - Week view: rows draggable with application/x-wb-plan payload; columns dragover-gated + .drop highlight (relatedTarget-safe dragleave); drop moves block to that date keeping time (snapshot'd); day totals .plan-wk-daytotal under day heads (hidden ≤640px); chevrons/×/clicks/today-highlight/2-col fallback all kept.
  - Capacity card: free-time line + tiny .plan-meter-sm bar when not overCap; overCap message unchanged.
  - Fixed latent v4 bug: mouse-click on file reading block sent FilePlanBlock id to 'wb-open-reader' instead of fileId.
  - A11y: aria-labels/titles everywhere new, focus-visible rings, popover role=dialog + Esc trap, Enter/Space kept.
- planner.css: +datebar/input/chip, +plan-pop* set, +plan-ghost/-droptarget, +plan-sug-grip, +plan-overlap(+ico), +plan-un-* + planPulse, +plan-free/meter-sm, +plan-wk-daytotal/col.drop/[draggable] cursors, coarse-pointer 44px targets, 640/980 responsive, reduced-motion; removed dead .plan-nav-title/-actions; lanes cursor copy.
- Verified: bunx tsc --noEmit 0 errors; bun run lint 0 errors/warnings (fixed 1 set-state-in-effect via derived popover validity); dev.log clean.

Stage Summary:
- Files touched: src/components/workbench/planner/PlannerView.tsx, src/components/workbench/planner/planner.css (nothing else). All v4 behavior preserved (block drag/resize, now-line, capacity, suggested/reading, auto-plan, week chevrons/bars, keyboard a11y) plus 9 new feature groups. Store APIs were sufficient — none missing (note only: deleteFilePlan snapshots per call, so Clear day adds N+1 undo entries; unavoidable with the given API).

---
Task ID: 16 (v5 features — main-coordinated)
Agent: main + subagents (2-a reader partial → main finished; 2-b library; 2-c planner; 2-d roadmap TSX → main added CSS)
Task: v5 — focus mode redesign (photo atmospheres, circle removal), reader v2 (continuous + annotations + themes + favorites/review + pages panel), library folders + search, planner v2, roadmap deep development

Work Log:
- Subagent 2-b (library) + 2-c (planner) completed fully with worklog entries; 2-a left annotations.ts/PdfPageCard.tsx/PagesPanel.tsx complete but ReaderOverlay unwritten; 2-d left all TSX complete but roadmap.css v5 section unwritten.
- MAIN finished Reader v2: rewrote ReaderOverlay.tsx (~1100 lines) wiring PdfPageCard/PagesPanel/annotations: single+scroll modes (virtualized strip, IO dominant-page tracking → pageRef/setFilePosition), pen/highlight/eraser with command-based undo/redo (Ctrl+Z/Y), autosave (700ms debounce → putAnnos+setFileAnnoPages, flush on unmount/hidden/beforeunload), page themes light/dark/warm/custom(sliders) applied to PDF canvas only, favorites (f), review mode (favorites-only strip + banner + x of N), pages panel (lazy thumbs, 5 filters with counts, Review these), export page as flattened PNG, full keyboard map, reader.css v5 section (strip, pills of ink UI, panel, theme pop).
- MAIN fixed reader flex-compression bug (.rd-page-card flex-shrink:0 + align-self:flex-start — stage was squashing pages to viewport height).
- MAIN wrote roadmap.css v5 (missing entirely): stats bar, view seg, template picker rows, layout pop, kind chips, schedule btn, FULL timeline styling (ruler/months/ticks/today line/weekends/sticky lane labels/pills with ms/sim/done/critical/selected states/curved edges + arrowheads/zoom control) + fixed .rm-tl-wrap min-width:0 (timeline was stretching the page instead of scrolling).
- Shortcuts modal: added B (atmosphere) + reader keys (S/P/F/T/±).
- E2E verified with agent-browser (37 screenshots) + VLM rounds: reader (upload→open, single render, scroll mode 8 cards + dominant tracking p.3, pen draw→undo 0px→redo, highlighter 2641px, eraser→0px, dark/warm themes VLM-confirmed, star p.3+p.5, review "2 favorites · 1 of 2", pages panel 8 thumbs + filters All 8/Read 0/Unread 8/Favorites 2/Annotated 1 + star badges + current ring, autosave persisted across reload (817 ink px), export toast, Esc chain); library (folder create/rename-ready rail, move via select, search hit/miss/clear, folder empty states, favorites+anno chips); planner (datebar, Up Next, quick-add popover at 10:45 → task created 12:30–13:00, week DnD Tue→Fri keeping 12:30, copy/now/clear gated correctly); roadmap (template Exam prep → +2w/+4w/+6w milestones + note, stats bar, timeline 47 days/lanes/today/scroll, By-kind swimlanes, order-panel Schedule milestone-rejected + task→tomorrow 09:00, duplicate roadmap); focus (photo bg via panel + B cycling forest→sea→village, VLM: clock readable, NO circles behind clock); dark theme + mobile 390px (surface 378px fit, scrollable toolbar, no overflow).
- Gates: tsc --noEmit 0 errors; eslint 0/0; dev.log clean (200s, no runtime errors; only pre-existing benign hydration-mismatch warnings from localStorage rehydrate).

Stage Summary:
- v5 shipped: Focus mode now has 7 AI-generated photo atmospheres (forest/sea/village/desert/sky/stars/night) + aurora, B-key cycling, and the clock back-circles removed. Reader v2 is a full study-grade PDF surface: continuous reading, pen/highlighter/eraser with undo/redo + autosaved ink, dark/warm/custom page themes, favorite pages with end-of-day review mode, filterable pages panel, PNG export. Library has folders (rail + DnD moves + card selects) and search. Planner gained click-to-add, drag-to-schedule, Up Next, overlap warnings, copy/clear day, week DnD. Roadmaps gained templates, stats bar, a full timeline view (dated + simulated pills, critical path, dependency arrows), By-kind layout, per-node scheduling into the planner, and duplication. All cross-connected and browser-verified.

---
Task ID: 20-a (v6 foundation)
Agent: main
Task: v6 foundation — store/types for folder trees, report ranges, focus clock cfg + custom bgs, sidebar collapse; DateField dual-calendar picker; SettingsModal; shell cleanup; DailyPlan capacity rewrite

Work Log:
- types.ts: LibraryFolder += icon/parentId (+FOLDER_ICONS set); ReportRange extended (last3/last7/last30/year/lastyear/custom + ReportCustomRange); ClockType replaced with 'aura'|'orbit'|'cards'|'typo' (legacy ids migrated to 'aura'); +FocusClockCfg (size/xPct/yPct/accent) +FocusCustomBg; FOCUS_BG_META += accent color per atmosphere.
- store.ts (version 5, migrate handles old data): addLibraryFolder(name, parentId), setLibraryFolderIcon, moveLibraryFolder (cycle-safe), deleteLibraryFolder (cascade: descendants+files flatten to deleted folder's parent); focusCustomBgs (max 3) + addFocusCustomBg/removeFocusCustomBg (bg id format `custom:<id>`); focusClockCfg + setFocusClockCfg/resetFocusClockCfg; focusAutoColor + setFocusAutoColor; sidebarCollapsed + toggle; reportCustom + setReportCustom; all in partialize. Defaults: clock 'aura', cfg size100/x50/y46/accent'auto'.
- helpers.ts: rangeToDates(range, custom?) + lastNDays + rangeLabel.
- NEW ui/DateField.tsx: dual Shamsi+Gregorian popover picker (portal, fixed, viewport-clamped, Esc/click-out, today button, min/max, clear). Grid follows store.calendarSystem; every cell shows the alternate calendar day; month header shows both ranges; button shows both formatted dates. CSS in globals.css (.df-*).
- NEW modals/SettingsModal.tsx: 4 tabs — Appearance (theme picker, calendar system, focus auto-color toggle, compact sidebar toggle, bg info), Shortcuts (moved list), Data (backup/export/import/ics moved), Commands (opens palette). Wired: ⌘/ or "," shortcut, sidebar Settings button, topbar gear.
- shell.tsx: REMOVED SidebarClock; footer buttons replaced with Settings + Commands; brand row has PanelLeftClose collapse toggle (persisted, icons-only mode via .wb-sidebar.collapsed CSS); NAV loses 'log' entry (activity log merged into Reports — WorkbenchApp routes 'log'→ReportsView); G L now goes to reports; TimerPill collapses gracefully.
- CommandPalette: onOpenSettings replaces onOpenData/onOpenShortcuts; 'Backup & data'/'Keyboard shortcuts' rows → Settings row; Activity Log go-to → Reports.
- MiscModals DailyPlanModal REWRITTEN: capacity = H+M steppers + ± buttons + quick chips (any value like 5h 30m, persisted live); auto-fill sorts by deadline urgency→priority→updatedAt, reports added count; suggestions show fits/over capacity chips + overdue chips; planned list shows timebox times; reading-deadlines section with Read buttons; Shamsi date chip. TimeboxModal day input → DateField.
- globals.css: += df-*, settings-*, switch, sidebar-collapsed, wb-collapsible, dp-*/cap-* sections.
- Gates: tsc clean except 8 expected focus-mode errors (Phase 2 rewrite pending); eslint 0/0.

Stage Summary:
- Foundation ready for 5 parallel feature agents. Shared APIs available: nested folders (parentId/icon), focus clock cfg + custom bgs + autoColor, report custom range, sidebarCollapsed, DateField component (import from '../ui/DateField'), SettingsModal. Clock types are 'aura'|'orbit'|'cards'|'typo' — focus files still reference legacy ids until main's Phase-2 focus rewrite.

---
Task ID: 6-d
Agent: main (roadmaps v6 UX overhaul)
Task: Roadmaps deep redesign — "make it much more better": quick-add bar + anchored pickers, connection-by-drag replacing link mode, snap-to-grid, inline rename, richer cards/edges, zoom controls, onboarding + auto-tidy, segmented views, order panel actions with DateField, richer list cards (store API untouched; only the 4 roadmap files)

Work Log:
- Read worklog (Task 16 v5 + Task 20-a foundation), roadmap files, store roadmap actions, DateField, primitives, roadmapOrder helpers. Found the 4 roadmap files already carrying an UNLOGGED v6 rewrite from an interrupted run of this same task (worklog ended at 20-a) — treated it as WIP: line-by-line review against the brief, bug fixes, full verification, no store/types edits.
- Inherited v6 architecture (reviewed + verified, kept): RoadmapView = list screen (richer cards: kind-count chips, node/link stats, ring %, upd. date, whole-card click, rename/duplicate/delete, templates) + workspace (sticky toolbar w/ title+desc inputs, Canvas/Timeline/Swimlanes segmented tabs, Tidy pop, Order panel toggle, selection actions incl. edge label editor; live stats strip w/ Next-up button; QuickAddPop portalled to body with backdrop: kind menu → searchable item/file pickers, milestone mini-form with DateField, note inline text; spawn snaps to 20px grid at click point or view-center stagger; auto-tidy once when nodes sit at origin/pile + manual By-layers/By-kind; Esc chain quick→pop→selection; Del removes selection).
- RoadmapCanvas: connection-by-drag (circular port handles on both card edges, pointer capture, live dashed bezier preview w/ arrow, valid-target highlighting, drop-on-node → addRoadmapEdge, empty-drop/Esc cancel, keyboard port activation + Enter-on-target), 20px snap node drag (pointer capture), dblclick-card inline rename (Enter/Esc/blur, linked nodes rename their entity), rich cards (kind rail + icon, status chip, ring + progress bar, date chip, hover mini-actions open/schedule/remove, selected ring, deleted-ref style, zoom-sm legibility boost <0.8), edge hit-path select + hover stroke + label + midpoint delete, corner zoom −/%/+/fit, minimap w/ viewport rect, onboarding hint (≤2 nodes, no edges), imperative handle fitView/centerNode/zoomBy/dropSpot.
- RoadmapTimeline (v6 state kept): dated/simulated pills in kind swimlanes, critical-path edges, today line, month ruler + week ticks, S/M/L day-width zoom, pill Open button, scrollToNode handle.
- FIXES applied on review: (1) Esc during port-drag now cancels ONLY the connection — canvas listener moved to capture phase + stopPropagation (previously it also cleared the workspace selection via a second window listener); (2) nodeLive no longer stamps a false "deleted" tag on goal/task/file nodes that were never linked (refId null → clean "Untitled"); (3) canvas svg role img→group so foreignObject cards/ports stay in the a11y tree; (4) edge label now appears on hover/selected (brief A.6) instead of always, pointer-events none, and the midpoint delete button also shows when selected → touch users tap-select to reveal both; (5) template picker + Tidy pop close on outside click (document pointerdown + wrap refs); (6) removed the stray toolbar X that appeared while the Tidy pop was open; (7) .rm-quickadd touch-action: pan-x so the strip scrolls under the wrap's touch-action:none; (8) coarse-pointer targets raised to 44px (qk/view/zoomctl/order-row/tl-zoom/tpl-row; card mini-actions 34px — three must fit the 92px card, ports have a ~54px invisible hit circle); (9) reduced-motion extended (rm-pop entrance, rings, progress bars, cards, pills, stat-next).
- Gates: bunx tsc --noEmit → 0 new errors (only the 8 pre-existing FocusMode ClockType errors, out of scope); bun run lint → 0/0; dev.log clean.
- Browser E2E (agent-browser + VLM, screenshots rm-6d-*.png): template create → workspace auto-fit 105% all cards visible; +File picker → live 2% progress node; REAL-mouse port drag file→milestone created the edge (2→3, VLM-confirmed curved); canvas dblclick → combined popover "at click point" + Milestone via dual-Shamsi DateField ("Today · 27 Sha 1405") created dated node; inline rename committed "Midterm review v2"; Order panel 6 rows with pct/DateFields/Open/Schedule — Schedule toast "Scheduled Algorithms — CLRS tomorrow at 09:00"; Esc mid-drag cancelled preview and empty-drop created no edge; Timeline 3 lanes/6 pills/3 edges/Today; Swimlanes kind rows; click-outside closures verified live; list card stats (kinds 1,4,1 · 6 · 3 · 0% · upd date); 390px mobile no horizontal overflow, quick-add strip scrolls; zero page/console errors.

Stage Summary:
- Roadmaps are now user-friendly end-to-end: add anything from the persistent quick-add bar or a double-click on empty canvas, connect by dragging port handles with a live preview, drag cards on a snap grid, rename inline, read live progress straight on the cards, edit edges by hover, zoom with visible buttons + minimap, and the order panel schedules/opens/dates every row with the dual-calendar DateField. Files touched: src/components/workbench/roadmap/{RoadmapView.tsx, RoadmapCanvas.tsx, RoadmapTimeline.tsx, roadmap.css} only — store.ts/types.ts untouched.

---
Task ID: 6-a
Agent: main (reader link layer + theme popover fixes — inherited WIP review)
Task: Fix two reader bugs — (1) PDF internal/external links not working (no link layer over the canvas pages), (2) custom page theme popover clipped away by the toolbar's overflow-x; plus polish: dark-mode page-surface tint. Only reader files.

Work Log:
- Read worklog (Task 20-a foundation + 6-d) and found the 3 reader files already carrying an UNLOGGED implementation of this same task from an interrupted prior run (worklog had no 6-a entry) — treated as WIP, line-by-line review against the brief, kept the sound architecture, fixed the genuine bugs, verified. Store/types/globals/pdf.ts/PagesPanel untouched.
- KEPT + verified link layer (PdfPageCard.tsx): fetchLinkAnnos re-types pdf.js's any[] annotations into a strict RawLinkAnno slice (subtype==='Link', validated rect, dest string|array, url/unsafeUrl), WeakMap cache per doc+page of scale-independent raw PDF rects; per-card effect (deps doc/pageNum/live/cssWidth/baseW, seq + cancelled guards, setState only after awaits) converts rects at the paint zoom via page.getViewport({scale: cssWidth/baseW}) + convertToViewportPoint corners → min/max (rotation-safe equivalent of convertToViewportRectangle) into PdfLinkZone state; zones render in .rd-link-layer (absolute inset-0, z-index 5 above pdf + ink canvases) as <a> for external (target _blank, rel noopener noreferrer, window.open(...,'noopener,noreferrer'), modifier-click passthrough) and <button> for internal (onGoToPage?.(targetPage)); inline pointerEvents auto ONLY when tool==='select' (drawing tools never blocked — see fix 1); resolveDestPage handles named + explicit dests (getDestination → isRefLike {num,gen} or integer d[0] → getPageIndex+1), per-doc cache, numPages bounds check; onGoToPage wired in ReaderOverlay cardCommon → existing goToPage (single mode swaps the card, scroll mode scrollIntoView) — works in both view modes; .rd-page-loading pointer-events none; zone hover = rgba(45,212,191,0.08) fill + dashed teal outline, :focus-visible ring, a11y labels/titles; select-tool tooltip advertises clickable links; keyboard v/d/h/e for tool shortcuts.
- KEPT + verified theme popover fix (ReaderOverlay.tsx + reader.css): popover is now a createPortal(document.body) with inline position:fixed, left/bottom computed once on open from the custom-button anchor rect (center-clamped to viewport with 8px margins, stored in themePopPos state) — root cause was .rd-toolbar overflow-x:auto clipping/scrolling the old absolutely-positioned child; z-index 920 above reader overlay; Esc closes (incl. Esc while a slider inside the pop is focused) + capture-phase document pointerdown closes on outside click (pop + anchor excluded so the button self-toggles); custom button split out with its own .rd-theme-anchor, aria-haspopup/aria-expanded; live summary chip .rd-theme-live "b N · c N · w N" beside it while themeMode==='custom'; 3 preset buttons — Night reading 85/110/25, Paper 100/100/35, High contrast 95/140/0 — set prefs.custom live; stale clipping-prone CSS (absolute/translateX + 980px media override) replaced by fixed + max-height:100vh-20px with scroll.
- KEPT + verified polish: pageSurfaceBg() passes pageBg to PdfPageCard — dark mode .rd-page-surface gets #15181a (no white glare gaps), warm #f3ecdc, custom a mixed sepia/dim tint, light #fff; reduced-motion covers .rd-link-zone + .rd-theme-pop; custom-active toolbar button gets violet gradient. All prior behavior preserved (viewMode, tools, favorites/review, pages panel, annotations/undo/autosave, keyboard map).
- FIX 1 (critical): .rd-link-layer was missing pointer-events:none — the full-page layer (z-index 5, above the ink canvas z-index 2) intercepted EVERY pointerdown on any page with link annotations, killing pen/highlighter/eraser on exactly the pages that have TOC/cross-ref links (and swallowing clicks page-wide, not just zones). Added pointer-events:none to the container; zones keep their inline per-tool auto/none (children re-enable interaction inside a pointer-events:none parent) — links clickable in select mode only, drawing never blocked.
- FIX 2 (hardening): ann.url was trusted as-is and only unsafeUrl was scheme-validated; now BOTH go through sanitizeExternalUrl (absolute http/https/mailto only, URL-parsed) before any window.open — a "safe"-flagged javascript:-style value from a malicious PDF can no longer reach open().
- Gates: bunx tsc --noEmit → 0 new errors (only the 8 pre-existing FocusMode.tsx ClockType errors, another agent's scope); bun run lint → 0 errors/0 warnings; tail dev.log → clean (200s, no runtime errors). No build/servers/tests (per brief).

Stage Summary:
- Reader pages are now truly navigable: every Link annotation becomes a clickable zone (internal dests resolve to pages and jump in both single/scroll modes; external http(s)/mailto open safely with noopener), hover-highlighted in teal, active only with the select tool so ink tools stay unblocked — plus the one real bug in the inherited implementation (full-page layer blocking drawing) is fixed. The custom theme popover now escapes the scrollable toolbar via a body portal with viewport-clamped fixed positioning, shows a live "b/c/w" chip beside the custom button, and offers Night reading / Paper / High contrast presets; dark pages sit on a #15181a surface. Files touched: src/components/workbench/reader/{ReaderOverlay.tsx, PdfPageCard.tsx, reader.css} only.

---
Task ID: 6-b
Agent: main (library file-manager overhaul — inherited WIP review)
Task: Make the Library a real file manager — nested folder TREE with full row management, multi-file bulk selection, system-folder PDF import (webkitdirectory + webkitRelativePath hierarchy), polish (DateField, stats, a11y/responsive). Only LibraryView.tsx, FileFormModal.tsx, library.css.

Work Log:
- Read worklog (Task 20-a foundation + 2-b/16 library history) and found the 3 library files already carrying an UNLOGGED implementation of this same task from an interrupted prior run (worklog ended at 6-a; dev.log still showed the run's old mid-edit parse error at a since-rewritten line). Treated as WIP: line-by-line review against the brief + full browser E2E. Store/types/globals/other views untouched.
- KEPT + verified folder TREE (replaces v5 chip rail): buildFolderTree (orphan→root) with --lib-d indentation, caret expand/collapse (user collapsedIds override auto-expand of the filtered path's ancestors), 12-icon FOLDER_ICON_MAP, color dot cycling FOLDER_SWATCHES, per-folder count via selfAndDescendants memo (tooltip states "incl. subfolders"), hover actions +subfolder/Palette icon popover (body portal, viewport-clamped, 12-cell grid, outside+Esc close)/×delete-with-confirm, dblclick rename, row click filters (existing libraryFolderFilter semantics), root "+ New folder" button, virtual "All files"/"Unfiled" roots, tree head collapses the rail; DnD: file cards and folder rows both carry text/plain ids (folders also a custom x-wb-folder type), row drops → moveFileToFolder / moveLibraryFolder with silent guards (own descendant, same parent, folders-can't-be-unfiled); breadcrumb under the toolbar (Library / path / + Unfiled pill) once folders exist; search ∩ status ∩ folder filters compose in one memo.
- KEPT + verified multi-file selection: module-level selection store (useSyncExternalStore shared by header toggle, cards, bulk bar); header Select button (CheckSquare, aria-pressed); selection-mode card click toggles + checkbox overlay on the cover corner; floating bulk toolbar fixed bottom-center above the footer: "N selected", All/None over the visible list, Move-to dropdown (tree-ordered "— " depth labels + "No folder", one snapshot for the whole move), Archive/Unarchive (one snapshot), Delete (confirm → purgeFileArtifacts per id via allSettled → deleteFile, exactly the existing single-delete pattern), Clear, Exit; shift-click range selection on the visible list (anchor + replace); liveIds keeps the count honest when files are deleted elsewhere; normal mode fully intact.
- KEPT + verified system-folder import: "Add folder" (FolderPlus) → useFolderPicker hidden multiple input with webkitdirectory/directory set via ref callback; importPdfFolder filters PDFs (type + /\.pdf$/i) with skip toast, caps 60 with warning toast, splits webkitRelativePath per file into segments (selected root folder becomes a real root folder), ensureFolderPath creates/reuses by name+parent with a per-path cache, file gets deepest folderId, title from filename; ingest reuses the shared ingestPdf pipeline (putBlob → pdf.js pageCount+cover → saveCover → addFile) and the module importing counter; toast "Imported N files into M folders" (+ created/failed detail); empty webkitRelativePath degrades to root import.
- KEPT + verified polish: stats note "N pages · M folders" (M includes subfolders), empty states mention drag-drop + Import folder, FileFormModal deadline swapped to DateField (dual calendar, value=''|iso, label), responsive ≤700px indent 9px + ≤640px/hover:none 42-44px rows and lifted bulk bar, focus-visible rings on every control, prefers-reduced-motion, tree-ordered depth labels in card/bulk/form folder selects.
- Bugs found and fixed: NONE — every initially-suspected failure was proven a headless-harness artifact, not an app bug: HTML5 DnD never completes across elements in headless Chromium (verified all guards/moves via synthetic DragEvents on the real rows), CLI shift-click doesn't propagate shiftKey (verified range via synthetic shiftKey MouseEvent), file-path upload sets nothing on a webkitdirectory input (directory-path upload works and Playwright sets webkitRelativePath incl. the root folder name — which the import then builds the tree from).
- Gates: bunx tsc --noEmit → 0 new errors (only the 8 pre-existing FocusMode.tsx ClockType errors, another agent's scope); bun run lint → 0 errors/0 warnings; tail dev.log → clean (200s, no runtime errors).
- Browser E2E (agent-browser, 3 real generated PDFs + a nested directory): tree create/rename/icon/color/expand-to-depth-2/delete-cascade (Physics × → EM+Mechanics flattened under wbfolder, files moved up), descendant-inclusive counts, breadcrumb, all five DnD paths incl. rejected drops, selection toggle/card/range/bulk-move/bulk-archive/unarchive/bulk-delete (store empty AND IDB blobs/covers/annos all 0), All/None/Exit, folder import (wbfolder→Physics→{EM,Mechanics}, Waves→EM, Classical→Mechanics, notes.txt skipped), search∩deadline composing, DateField pick→Save→deadline persisted, 390px no-overflow with 44px rows, 1440px two columns, zero console/page errors. Screenshots tool-results/lib-6b-{tree,final,mobile}.png. Agent record: agent-ctx/6-b-main.md.

Stage Summary:
- The Library is now a real file manager: a nested folder tree with per-row create/rename/icon/color/delete, descendant-aware counts, drag-and-drop for files AND folders (cycle-safe), breadcrumb navigation, a bulk-selection mode with a floating action bar (move/archive/unarchive/delete with IDB purge, shift-range), and one-click import of a whole system folder of PDFs whose directory structure becomes the folder tree — all composing with search and status filters, fully responsive, keyboard/screen-reader friendly, and browser-verified end-to-end. Files touched: src/components/workbench/library/{LibraryView.tsx, FileFormModal.tsx, library.css} only.

---
Task ID: 6-c
Agent: main (planner add-block panel v3 + goals/roadmaps/habits — inherited WIP review)
Task: Replace the cramped 264px QuickAddPop with a WIDE anchored "Add block" panel (Task/Reading/Goal-work/Habits sections, DateField, duration presets + custom stepper), connect the planner to goals + roadmaps (side-column sections with Schedule at next free slot), add a habit check-in strip under the day timeline, and polish (DateField datebar, responsive bottom sheet, a11y). Only PlannerView.tsx + planner.css.

Work Log:
- Read worklog (20-a foundation + 2-c/16 planner history + 6-a/6-b) and found the 2 planner files already carrying an UNLOGGED implementation of this same task from an interrupted prior run (worklog ended at 6-b) — treated as WIP: line-by-line review against the brief, kept the sound architecture, fixed the genuine defects, verified end-to-end. Store/types/globals/other views untouched.
- KEPT + verified wide panel: AddBlockPanel portaled to body (z 250) over a dimmed backdrop (z 240), width min(420px, 92vw), max-height min(88vh, 720px), anchored right of the click point (cx+14) with viewport clamping, body scroll lock, Esc chain (open DateField calendar closes first — checks .df-pop, whose z 300 sits above the panel), auto-hide when the viewed planner date changes (panel.date !== date), generous 18/20px padding with labeled sections: title input (autofocus, Enter creates) OR the picked-task card (priority chip + estimate + goal context via parentId); When section = DateField (dual Shamsi+Gregorian) + Start/End native time inputs (End edits duration) + QUICK_DURS Seg 15/30/45/60/90/120 + ±5/custom minutes stepper + live "date · HH:MM–HH:MM · dur" summary chip; Type 2×2 chooser (Task/Reading/Goal-work/Habits with per-kind accent). Task kind = searchable ready-task picker (priority→deadline sorted, blocked/already-planned filtered) → updateItem plannedStart/plannedEnd + startDate, or creates a task from the typed title; Reading = enlarged searchable file picker (pages-left + due chips) → addFilePlan; Goal-work = goal picker → the goal's ready sub-tasks → schedules the picked one; Habits = amber info box explaining the strip + wb-switch to toggle it live + "Open Habits view" jump, no junk items (foot hides Submit for habits). Click-to-add on empty lanes keeps snapQ-snapped start + block-click guard.
- KEPT + verified goals & roadmaps bridges in the day side column (alongside Up Next): collapsible "From goals" (wb-collapsible) with up to 4 ready tasks under active goals, each row has goal-context chips, a Clock3 IconBtn that opens the panel pre-filled with that task at the next free slot, and a Schedule button → updateItem timebox via the shared nextFreeSlot/occupied calculation; "From roadmaps" resolves each roadmap's first unfinished node (task refId → live item done/archived check; file refId → archived/progress check; already-planned-today skipped; milestones/notes passed over) with Open (roadmap view + activeRoadmapId) and Schedule (task → timebox, file → 30m addFilePlan) buttons; both have empty states.
- KEPT + verified habit strip: "Habits" toggle chip (Repeat icon, aria-pressed, amber when on) in the timeline header; HabitsStrip under the day timeline = header row (M–S weekday letters, current day amber) + per habit: color dot, name, streak chip (computeStreak), 7 day-toggles wired to store toggleHabitDay(id, date) with done state colored by the habit's own color (--hab), today micro-dot, current-day ring; empty state links to Habits view. Styled as .plan-hab* in planner.css.
- KEPT + verified polish: datebar aux row uses compact DateField (Shamsi/Gregorian dual label, same picker as the panel); all v4/v5 behaviors intact (block drag/resize, overlap outlines, now-line, capacity meters, suggested/reading pools with pointer-capture pool drag, auto-plan, week DnD + bars, keyboard a11y).
- FIXES applied on review: (1) anchorY estimated the panel at 560px tall while CSS caps it at min(88vh, 720px) — clicks in the lower half of the viewport clipped the panel's foot below the fold; the estimate now mirrors the CSS box exactly (verified live: panel bottom == innerHeight−8); (2) anchorX clamped with a hardcoded 420px while the panel is min(420px, 92vw) — now clamps with the effective width so it can never overflow the right edge; (3) mobile bottom-sheet breakpoint 640px → 700px per the brief (full-width, rounded top, max-height 80vh, scrollable, safe-area-inset padding); (4) .plan-add-foot is now position:sticky bottom:0 with a surface-color fade so Cancel/Submit stay reachable while the 236px picker lists scroll; (5) aria-modal="true" on the dialog; (6) .plan-hab-chip raised to a 40px target on coarse pointers.
- Gates: bunx tsc --noEmit → 0 new errors (only the 8 pre-existing FocusMode.tsx ClockType errors, another agent's scope); bun run lint → 0 errors/0 warnings; tail dev.log → clean 200s.
- Browser E2E (agent-browser + VLM, screenshots tool-results/pl-6c-*.png; seeded 2 goals + tasks, 1 deadline PDF, 2 habits, 2 roadmaps, Shamsi system): click empty lane → 420px panel at cx+14, bottom clamped in view, snapped 17:30, title autofocused; typed "Review flashcards" + Enter → created 17:30–18:00; task picker search → picked task card (P1/~45m/goal chip, Seg "45m" active) → scheduled 18:15–19:00; Reading → Persian Grammar.pdf (120p left/due 5d) → filePlan 08:30–09:00 + violet block; Goal-work → Learn Persian → Memorize 40 verbs → 08:15–09:05; Habits type → info box + live strip toggle + jump, foot without submit; habit chip → strip with M–S header, per-habit colors, streak chips 2d/1d, today toggle → log updated + streak 2d→3d (VLM confirmed colored squares + today dot); panel DateField → Shahrivar 1405 grid above the panel, picked 29 Shahrivar → summary "Sun, Sep 20", Esc chain calendar→panel, backdrop click closes; From-goals Schedule → next free slot 09:05–09:35, prefilled clock-button panel at 10:35–11:15, empty state once all scheduled; From-roadmaps row → Open (view 'roadmap', activeRoadmapId set) + Schedule (t3 09:35–10:35) + empty state when all nodes planned; date change auto-hides the panel; datebar DateField moves plannerDate; week mode unchanged (7 cols, all rows); mobile 390×844 bottom sheet exact geometry + scrollable + sticky foot + no overflow; dark theme panel + strip readable; REAL-mouse pool drag still schedules (v5 intact); zero page/console errors.

Stage Summary:
- The planner's "add block" experience is now a proper wide panel: click any empty lane spot and get a spacious 420px dialog with title/when/type sections, a searchable ready-task picker (or create from title), the library file picker, a goal → sub-task drill-down, and a habits explainer that toggles the new check-in strip — all time inputs live (dual-calendar date, native times, presets + custom minutes, auto-derived end) with Enter-to-create, Esc chain, backdrop, and a mobile bottom sheet. The planner is also wired into the rest of the app: "From goals" and "From roadmaps" side sections pull ready work in at the next free slot, and the habit strip makes the day view a place to check habits off for the whole week. Files touched: src/components/workbench/planner/{PlannerView.tsx, planner.css} only. Agent record: agent-ctx/6-c-planner.md.

---
Task ID: 6-e
Agent: main (reports deep upgrade — inherited WIP review)
Task: Reports "heart of the project" upgrade — full range system (last-N presets + yearly + custom), yearly by-month report, GitHub-style contribution graph, print/save-as-PDF with custom period, more useful graphs (focus vs reading, weekday distribution, habits, insight cards), and the activity log merged in as an expandable collapsible. Own: ReportsView.tsx, LogView.tsx, NEW reports.css only.

Work Log:
- Read worklog (20-a foundation + 6-a..6-d) and found the 3 files already carrying an UNLOGGED implementation of this same task from an interrupted prior run (ReportsView.tsx 478→1307 lines, LogView.tsx with an `embedded` prop, reports.css present) — treated as WIP: line-by-line review against the brief, kept the sound architecture, fixed the genuine bugs, verified end-to-end. Store/types/helpers/globals/other views untouched.
- KEPT + verified range system: 10 pills (Today·Last 3·Last 7·This week·This month·Last 30·This year·Last year·All·Custom) in ReportsHeaderActions wrapping on mobile; Custom reveals two compact DateFields + Apply wired to store reportCustom/setReportCustom (draft refreshes from live store on pill click); [from,to]=rangeToDates(range,reportCustom); readable meta line with dual calendars (primary follows calendarSystem, alt in the other, "Since first activity" for All; effectiveFrom = earliest activity); range-scoped KPI/stat computations (activeDays, zeroDays, bestRun guard-bounded loops, statDays clamped to today).
- KEPT + verified yearly report: By-month section appears for year/lastyear or span ≥183d; month walk in Shamsi (SHAMSI_MONTHS_SHORT labels, year label on Farvardin) or Gregorian; 12-month-style bar chart (logged + reading bars) + full month detail list + legend; capped at last 24 months.
- KEPT + verified contribution graph: weeks = min(26, max(8, ceil(span/7))) window ending at the range end; columns = weeks (Sat-start when calendarSystem shamsi, Mon-start otherwise); 5-level color scale via color-mix of var(--pine) over var(--surface-solid) (0 / 1-30m / 30-60m / 1-2h / 2h+); per-cell title tooltip = weekday + dual date + minutes; month labels marked on the column containing the 1st of a month; Less/More legend; summary line = current streak + best day (dual date + minutes) + active days; grid is role=img with aria-label, .cg-scroll for mobile.
- KEPT + verified print / save-as-PDF: Printer button → window.print(); @media print in reports.css uses the visibility technique (body * hidden; .report-print-root + descendants visible; absolute top-left full-width — verified body is the only positioned ancestor in the chain), @page margin 14mm, forced light palette by overriding the CSS vars on the print root, print-color-adjust exact, break-inside avoid on cards/sections, .no-print on all interactive bits, print-only header block (app name, range label + dual dates, generated date + Shamsi), contribution/log scroll containers unclipped, activity log forced display:block in print (prints fully expanded even when collapsed on screen).
- KEPT + verified more graphs: Focus vs reading bars with reading % note; weekday distribution (7 bars Sat..Fri / Mon..Sun per system, avg minutes, weakest day flagged coral + insight); habits in range (daily → % days, weekly → % weeks over system weeks); INSIGHT cards (2-4 dynamic chips: zero days, avg vs dailyCapacityMin, reading share ≥50%, weakest weekday <50% of strongest, best streak ≥3, habits <50%) with good/warn/bad tones.
- KEPT + verified activity-log merge: bottom .wb-collapsible (starts collapsed) with Clock head + entry-count chip + rotating chev; body embeds LogView with the new optional `embedded` prop (compact "Newest first · N entries" toolbar, timer card + manual entry kept working, day list in a 560px custom-scrollbar container); LogView's default export surface unchanged (TimerWidget + LogView still exported, non-embedded mode intact).
- KEPT + verified v4 sections adapted: By day (≤62d) / By week (buckets by system week) with Shamsi jd sub-labels, Reading by day/week, Top reading files (+at-risk not-started), By label, By item, Goals & linked files, Planner adherence, Roadmaps — all range-scoped; 9 KPI cards; daily chart capped at 800 days.
- FIX 1 (critical): .cg-months grid-auto-columns was calc(var(--cg-cell)*7 + var(--cg-gap)*6) = 102px while the contribution grid's week-column pitch is 15px (12px cell + 3px gap) — month labels drifted ~8.5 columns off their weeks. Fixed to calc(var(--cg-cell) + var(--cg-gap)) with .cg-month-lbl overflow:visible (label spills into the following empty cells GitHub-style; container clips at the grid edge). Geometrically verified in-browser: label.x == its week column's first cell.x (dx = 0).
- FIX 2: added the missing @media (prefers-reduced-motion: reduce) block (transitions/animations neutralized; shared globals classes scoped under .report-print-root so other views are untouched).
- FIX 3: .report-rangebar .radio-pill:focus-visible ring (globals has none for pills) + 44px coarse-pointer targets for the range pills.
- Gates: bunx tsc --noEmit → 0 new errors (only the 8 pre-existing FocusMode.tsx ClockType errors, another agent's scope); bun run lint → 0 errors/0 warnings; tail dev.log → clean 200s.
- Browser E2E (agent-browser + VLM + DOM geometry; Shamsi system; seeded 15 entries / 5 reading sessions / 2 habits / 1 deadline file / goal+task / roadmap): Last 7 meta "22–28 Sha 1405 · 13–19 Sept 2026 · 7 days · 14h 55m" (math verified); This year → 9 Shamsi months Dey→Sha with dual bars + detail; Custom DateField pick 3 Sept → Apply → "12–28 Sha 1405 · 3–19 Sept 2026 · 17 days · 19h 20m" (1005 logged + 155 reading ✓); heatmap 8 weeks with level mix {46,1,1,2,6}, weekdays Sha..Jom, legend, summary "3 day streak · Best day 4h 55m · 24 Sha 1405 · 15 Sept 2026 · 10 active days", dual-date tooltips; Print stub invoked + real agent-browser pdf → 6 clean pages: print-only header (WORKBENCH AURORA / Productivity report / Custom: 12 Sha 1405 – 28 Sha 1405 · 3–19 Sept 2026 / Generated 19 Sept 2026 · 28 Shahrivar 1405), KPI grid + insights + focus-vs-reading p1, heatmap + day charts p2, activity log fully expanded p5-6 with zero interactive controls; mobile 390px no horizontal overflow, pills wrap, custom row full-width; dark mode pine levels theme-aware; Gregorian switch → Mon..Sun weekdays; All-time → 301 days · 35h 20m (1905+215 ✓) with By month + By week (44 buckets) and all 14 sections present; log collapsible collapsed-by-default → expands to 15 entries in 14 day groups. Screenshots tool-results/rp-6e-*.png, print PDF rp-6e-print.pdf. Agent record: agent-ctx/6-e-reports.md.

Stage Summary:
- Reports is now the deep analytics heart asked for: pick any period (incl. "last custom day" and yearly) from the header, read it in both calendars, see the GitHub-style contribution heatmap with streak/best-day/active-days, yearly by-month bars, focus-vs-reading and weekday/habit breakdowns with dynamic weakness insights, then print or save that exact period as a clean PDF with its own report header — and the full activity log lives right below it in an expandable section. Files touched: src/components/workbench/views/{ReportsView.tsx, LogView.tsx, reports.css} only — store/types/helpers/globals untouched; LogView exports intact.

---
Task ID: 20-b (v6 focus mode redesign — main)
Agent: main
Task: Focus mode full redesign — fullscreen background fix, all-new timer-aware clocks (movable/sizable/colorable), auto-coloring, user-uploaded local backgrounds

Work Log:
- clocks.tsx FULL REWRITE: 4 all-new faces — Aura (huge digits in progress arc ring + minute ticks + phase pill + dual-calendar date), Orbit (60-dot progress ring + orbiting second marker), Cards (split-flap v2 with accent seam, full flip animation, timer-aware H/M/S vs M/S auto), Typo (pure typography, thin giant numerals, progress hairline). ALL faces render countdown/elapsed + phase + cycle + paused while a session runs (fixes "focus not applied to all clocks") and wall clock otherwise; accent color prop throughout; CLOCK_FACES map + ClockFace dispatcher.
- FocusMode.tsx FULL REWRITE: fullscreen now targets the OVERLAY element itself (id=focus-overlay-root — background ::before stays visible in fullscreen, fixes "background disappears"); clock is a draggable fc-wrap (pointer capture, live position while dragging, commits xPct/yPct to store on release, clamped 8-92%/12-86%); size via clock settings popover slider 60-170% + [ / ] keys + reset; color via Auto + 7 accent swatches (auto = background accent); custom background support (class fb-custom + --focus-bg-img CSS var from dataUrl, drift animation kept); "Your photos" section in bg panel: file input → downscale to 1600w JPEG q0.82 → dominant-accent extraction (saturated mid-tone weighted sampling) → addFocusCustomBg (max 3, remove buttons); auto-coloring: overlay sets --focus-accent from bg accent when focusAutoColor (else pine fallback) and focus chrome CSS (selector active, presets, primary button, bg cards, context icon/kicker) now uses var(--focus-accent); B cycles atmospheres, legacy clock/bg ids guarded.
- globals.css: replaced ALL old clock CSS (analog/digital/minimal/flip/meta) with .fc-* v6 set (aura/orbit/cards/typo + pill + date + cfg-pop + swatches); accent-ized 9 focus chrome rules; +.fb-custom bg rules, :fullscreen rules, .focus-stage-v6 (pointer-events none, wrap auto), focus-bg-add/-x/-main rules; responsive rules updated flip-* → fc-cards-*.
- ItemModals: both deadline fields (create + detail) → DateField (dual-calendar picker).
- Gates: tsc --noEmit 0 errors across the whole repo; eslint 0/0; dev.log clean compiles.

Stage Summary:
- Focus mode v6 complete: photo atmospheres + user photos, flexible clocks (drag/resize/recolor), timer-aware faces, auto-colored chrome, fullscreen-safe background. All 7 user issue groups now implemented; full browser E2E verification is next.
