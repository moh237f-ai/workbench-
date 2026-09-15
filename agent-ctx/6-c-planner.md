# 6-c — Planner add-block panel v3 + goals/roadmaps/habits integration

## Scope
Files touched (only): `src/components/workbench/planner/PlannerView.tsx`, `src/components/workbench/planner/planner.css`. Store/types/globals/other views untouched.

## Situation on arrival
The two planner files already carried an UNLOGGED implementation of this exact task from an interrupted prior run (worklog ended at 6-b). Treated as inherited WIP — line-by-line review against the brief, kept the sound architecture, fixed the genuine defects found, full browser E2E, then logged.

## Kept + verified (inherited architecture)
- Wide anchored `AddBlockPanel` (420px / min(92vw), portaled to body, backdrop, Esc chain, click-outside, auto-hide on planner date change, body scroll lock, sticky foot).
- Title input (autofocus, Enter creates) / picked-task card with P-chips + estimate + goal context.
- When section: DateField (dual Shamsi+Gregorian), Start/End native time inputs, QUICK_DURS Seg (15/30/45/60/90/120), ±5 stepper + custom minutes, live summary chip "date · HH:MM–HH:MM · dur".
- Type chooser 2×2: Task (searchable ready-task picker → updateItem plannedStart/plannedEnd+startDate, or create from title) / Reading (file picker → addFilePlan) / Goal-work (goal picker → sub-task list → schedules that task) / Habits (info box + strip toggle + jump to Habits view, no junk items).
- Side column: collapsible "From goals" (≤4 ready tasks under active goals, Schedule via nextFreeSlot + Clock3 iconbtn opens the panel prefilled at the next free slot) and "From roadmaps" (per-roadmap first unfinished node resolving task/file refs, Open → roadmap view / Schedule → timebox or reading block; empty states).
- "Habits" toggle chip (Repeat) in the timeline header → `HabitsStrip` under the day timeline: color dot + name + streak chip + 7 week day-toggles wired to `toggleHabitDay(id, date)`; `.today` dot marker; `.cur` highlight; per-habit `--hab` color.
- Datebar aux row uses compact DateField (Shamsi available when picking the planner date).
- All v5 behaviors intact: block drag/resize, overlap coral outlines, now-line, capacity, suggested/reading pools + real-mouse pool drag, week DnD/bars, keyboard a11y.

## Fixes applied during review
1. `anchorY` height estimate was 560px while the panel's CSS max-height is min(88vh, 720px) — clicks in the lower half of the viewport clipped the panel's foot buttons below the fold. Now mirrors the CSS box exactly (`min(720, innerHeight*0.88)`); verified live (panel bottom == innerHeight−8, foot visible).
2. `anchorX` clamped with hardcoded 420px while the panel is `min(420px, 92vw)` — now clamps with the effective width so it can never overflow the right edge at any viewport.
3. Mobile bottom-sheet breakpoint 640px → 700px per the brief (full-width, rounded top, 80vh, scrollable, safe-area padding). Verified at 390×844: left 0, width 390, height 675 = 80vh, radius 18px 18px 0 0.
4. `.plan-add-foot` made `position: sticky; bottom: 0` with a surface fade — Submit/Cancel stay reachable while the 236px picker lists scroll (panel body is the scroll container).
5. `aria-modal="true"` on the panel dialog (backdrop makes it modal for AT).
6. `@media (pointer: coarse)`: `.plan-hab-chip` raised to a 40px touch target alongside the existing 44px controls.

## Gates
- `bunx tsc --noEmit` → 0 new errors (only the 8 pre-existing FocusMode.tsx ClockType errors, another agent's scope).
- `bun run lint` → 0 errors / 0 warnings.
- `tail dev.log` → 200s, clean compile, no runtime errors.

## Browser E2E (agent-browser + VLM, screenshots tool-results/pl-6c-*.png)
Seeded: 2 goals + 5 sub/standalone tasks, 1 PDF (deadline +5d), 2 habits with logs, 2 roadmaps (task/milestone/file nodes), Shamsi calendar system.
- Click empty lane → panel at click point (cx+14), 420px, viewport-clamped bottom, snapQ time (17:30), title autofocused, backdrop; VLM-confirmed spacious sections.
- Title "Review flashcards" + Enter → item created 17:30–18:00 (persisted plannedStart/plannedEnd/startDate/estimateMin).
- Task picker: search "polish" → row with P1/~45m/goal chip → pick → sel-card + seg "45m" active → "Schedule task" → t1 timeboxed 18:15–19:00, panel closed, block rendered.
- Reading type → file row (120p left, due 5d) → "Add reading block" → filePlan {startMin 510, 30m} + violet block 08:30–09:00.
- Goal-work → goal list → "Learn Persian" → sub-task "Memorize 40 verbs" → scheduled 08:15–09:05.
- Habits type: info box + wb-switch + "Open Habits view" + foot shows only Cancel (no junk submit).
- Habit chip toggle → strip under timeline: M–S header, "Morning stretch" 2d, "Read 10 pages"; toggling today → log["2026-09-19"]=true, cell done, streak 2d→3d; VLM confirmed colored squares + today dot.
- DateField inside panel: df-pop z300 above panel z250, Shahrivar 1405 + Gregorian alt range; picked 29 Shahrivar → summary "Sun, Sep 20"; Esc chain: first Esc closes calendar only, second closes panel; backdrop click closes.
- "From goals" Schedule → next free slot 09:05–09:35 (reuses nextFreeSlot with the occupied blocks); Clock3 → prefilled panel at next free slot 10:35–11:15; empty state after all goal tasks scheduled.
- "From roadmaps": rm row (task node + Open/Schedule); Open → view 'roadmap' + activeRoadmapId; Schedule → t3 at 09:35–10:35; when all nodes planned → "No roadmap next-steps waiting." empty state.
- Date change while panel open → auto-hid; datebar DateField pick → plannerDate 2026-09-21.
- Week mode: 7 cols, 6 rows incl. reading block — unchanged.
- Mobile 390×844: bottom sheet geometry exact, scrollable, sticky foot visible, no horizontal overflow; dark theme panel+strip readable (VLM).
- Real-mouse pool drag grip→timeline still schedules (Email professor Azar 08:00–08:25) — v5 drag-to-schedule intact.
- Zero page/console errors across the whole run.

## Screenshots
pl-6c-day-seeded / side-roadmaps / panel-open / panel-reading / panel-habit / df-in-panel / mobile-day / mobile-panel / week / final-day / final-with-strip / dark-panel (.png in tool-results/).
