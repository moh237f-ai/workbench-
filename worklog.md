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
