# Task 2-c — Planner v2 (full-stack-developer)

Task: Upgrade the Workbench Aurora Planner (Day timeline + Week board) for efficiency and friendliness: date navigation bar, click-to-add quick capture, drag-to-schedule from the backlog, overlap detection, Up Next card, day progress + copy/clear/scroll-to-now, week HTML5 drag & drop + day totals, capacity free-time polish.

Files owned / touched (ONLY these two):
- `src/components/workbench/planner/PlannerView.tsx`
- `src/components/workbench/planner/planner.css`

## What was built

1. **Date navigation bar (view root)** — `.plan-nav` restructured into `.plan-datebar` + `.plan-datebar-aux`: `‹`/`›` IconBtns (±1 day, ±7 in week mode), label ("Monday, January 5" via toLocaleDateString / week range) with pine "Today" badge when plannerDate===today, native `<input type="date">` (`.plan-date-input`, color-scheme aware for dark/prism), "Today" chip button.

2. **Click-to-add quick capture** — clicking empty space in `.plan-tl-lanes` (guarded by `closest('.plan-block, .plan-pop')`) opens `QuickAddPop`: fixed 264px card clamped to viewport, header "New block · at 14:30", title input (autofocus, Enter submits), duration Seg 15/30/45/60/90, type Seg Task|Reading; Reading swaps title input for a file picker (non-archived, unfinished files sorted by deadline; max-h 200px scroll; search input when >8 files; BookOpen + title + "Np left" chip; aria-pressed selection). Add: snapshot() → addItem({title, estimateMin, plannedStart/plannedEnd via dateTimeFromMin, startDate, status 'todo'}) or snapshot() → addFilePlan(fileId, date, startMin, dur); toasts. Esc (window keydown capture) + click-outside (window pointerdown capture + contains check) close. snappedStart = 15-min grid clamped 0–1425. Popover auto-hides on date change via `pop.date === date` render guard (no setState-in-effect).

3. **Drag-to-schedule from side pool** — every "Suggested work" / "Reading goals" row got a `.plan-sug-grip` (GripVertical, grab cursor, touch-action none). Pointerdown → setPointerCapture → track; ghost block `.plan-ghost` (pine/violet dashed, pointer-events none) renders inside lanes at snapQ position with live "10:30–11:00" label; lanes get `.droptarget` inner highlight while a pool drag is active. Pointerup over lanes (movedPx ≥ 4) commits updateItem(..., {snapshot:true}) / snapshot()+addFilePlan at drop time; outside or <4px → no-op (row click + Add button unaffected). Minute = clamp(snap15(DAY_START_MIN + (y − lanesRect.top)/PX_PER_MIN), 0, 1440−dur), rect from `lanesRef`.

4. **Overlap detection** — `liveBlocks` (drag-aware intervals incl. `dragFor` substitution) → O(n²) half-open intersection → `overlapKeys` Set; blocks render `.plan-overlap` (coral dashed outline) + corner AlertTriangle `.plan-overlap-ico` + aria-label suffix ", overlaps another block". Re-evaluates while dragging (block + pool commits re-render).

5. **Up Next card** — new isolated `UpNextCard` (first side card; own `useNow(isToday)` so the 1s ticker doesn't re-render the whole planner). Today: running block → pulsing dot + "Now" + range + "Nm left"; else next → "Next · at 10:30 · in 23m"; else "Nothing left today — nice." Other dates: "First block · at 09:00"; empty → "Nothing planned for this day." Done blocks excluded. Click → openItemDetail / 'wb-open-reader'.

6. **Timeline header actions** — `.plan-head-actions`: "3/7 done" chip (chip-ok when all done, chip-soon otherwise; only when blocks exist), Copy yesterday IconBtn (duplicates yesterday's timeboxes as NEW items via addItem — title/type/priority/color/estimateMin + same times — and file plans via addFilePlan; snapshot first; toast "Copied N blocks from yesterday" / "Nothing to copy"), Clear day IconBtn (Eraser, danger; useConfirm("Clear all blocks on <date>?"); snapshot → plannedStart/plannedEnd null on that date's timeboxes + deleteFilePlan each; toast), Now IconBtn (Crosshair, today only; smooth scrollRef.scrollTo centering the now-line).

7. **Week view upgrades** — rows `draggable` with `application/x-wb-plan` JSON payload ({kind, id, src}); columns gate dragover on that MIME, preventDefault + `.drop` highlight (dragLeave guarded by relatedTarget containment, cleared on drop/dragend); drop moves the block to the column's date keeping its time (updateItem {snapshot:true} / snapshot()+updateFilePlan({date})); toasts. Day headers gained `.plan-wk-daytotal` (mono, muted, hidden ≤640px). Chevrons + × + click-to-open all preserved.

8. **Capacity polish** — when not over capacity: free-time line with tiny `.plan-meter-sm` bar + "Xh Ym free" mono label; overCap message unchanged.

9. **A11y** — all new buttons have title/aria-label, focus-visible rings on every new interactive element, popover role=dialog + Esc trap, keyboard Enter/Space paths preserved.

## Bugs found & fixed in owned files
- v4 mouse-click on a file reading block dispatched 'wb-open-reader' with the FilePlanBlock id instead of fileId (keyboard path was correct) → openFileBlock now resolves planId → fileId.

## CSS (planner.css)
Added `.plan-datebar(-label/-badge/-aux)`, `.plan-date-input` (+ dark/prism color-scheme), `.plan-today-chip`, `.plan-head-actions`, `.plan-done-chip`, `.plan-pop*` (head/title/x/input/row/lab/files/search/filelist/file/ftitle/nofiles/foot), `.plan-ghost(-file)` + `.plan-tl-lanes.droptarget`, `.plan-sug-grip`, `.plan-overlap` + `.plan-overlap-ico`, `.plan-un-*` (row/main/kicker/title/meta/dot/go/empty) + planPulse keyframes, `.plan-free`/`.plan-meter-sm`/`.plan-free-lab`, `.plan-wk-daytotal`, `.plan-wk-col.drop`, `[draggable]` cursor styles, `.plan-wk-row:focus-visible`. Removed dead `.plan-nav-title`/`.plan-nav-actions`. Media: 980px tweaks kept (2-col week fallback intact), 640px hides daytotal, `pointer: coarse` bumps new controls to 44px, reduced-motion disables pulse. Lanes now `cursor: copy`.

## Verification
- `bunx tsc --noEmit` → 0 errors.
- `bunx eslint src/components/workbench/planner` + `bun run lint` → 0 errors/warnings (fixed one react-hooks/set-state-in-effect by deriving popover validity from `pop.date === date` instead of setState in the date effect).
- dev.log tail: clean compiles, 200s, no runtime errors.

## Notes for main agent
- Missing APIs noticed: none — everything needed existed. (Minor observation, no action: `deleteFilePlan` snapshots internally per call, so "Clear day" with N reading blocks pushes N+1 undo entries; spec accepted this since deleteFilePlan is the only removal API.)
- Copy yesterday intentionally creates NEW items (an item holds a single timebox; moving would destroy yesterday's history).
