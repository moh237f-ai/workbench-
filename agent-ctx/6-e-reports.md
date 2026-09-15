# Task 6-e — Reports deep upgrade (inherited WIP review)

Task: Reports deep upgrade — full range system (incl. custom + yearly), contribution heatmap, print/save-as-PDF, more graphs (focus vs reading, weekday distribution, habits, insights), activity-log merge into an expandable collapsible. Own: ReportsView.tsx, LogView.tsx, NEW reports.css.

## Situation
Found all three files already carrying an UNLOGGED implementation of this exact task from an interrupted prior run (worklog ended at 6-c; ReportsView.tsx 478→1307 lines, LogView.tsx had the `embedded` prop, reports.css existed). Treated as WIP: line-by-line review against the brief, fixed the genuine bugs, full browser E2E, gates.

## Review outcome (kept architecture)
- Range system: RANGE_OPTIONS 10 pills in ReportsHeaderActions (wraps via flex-wrap), Custom opens two compact DateFields + Apply wired to store reportCustom/setReportCustom; [from,to] = rangeToDates(range, reportCustom); readable meta line with dual calendars (shamsiShort/gregShort swap by calendarSystem); "All" resolves to earliest-activity → today (effectiveFrom).
- Yearly: MonthRow building walks Shamsi months (jy/jm, yearLabel on Farvardin) or Gregorian months; shown when range year/lastyear or span ≥ 183d; capped at last 24; logged+reading bars + detail rows + legend.
- Contribution: weeks = min(26, max(8, ceil(span/7))), window ENDS at effectiveTo (weekStart-aligned, Sat-start shamsi / Mon-start greg); 5 levels cgLevel 0/1-30/30-60/1-2h/2h+; color-mix of var(--pine) over var(--surface-solid); per-cell title = weekday + dualDate + duration; month labels marked on the column containing the 1st; Less/More legend; summary = current streak + best day (dual date + minutes) + active days.
- Print: .report-print-root + .no-print + @page 14mm + body* visibility technique (position:absolute root; body is the positioned ancestor — verified no transformed/overflow-clipping ancestors in the chain) + forced light palette via CSS vars + break-inside avoid on cards + print-only header (app name / range label + dual dates / generated date + Shamsi) + activity log forced display:block in print.
- Graphs: Focus vs reading bars + % note, weekday distribution (avg, weakest/strongest, coral weak bar), habits % (daily % days, weekly % weeks with system-week buckets), 2-4 insight chips (zero days, avg vs capacity, reading share, weakest weekday, best streak, habits %).
- Log merge: .wb-collapsible (collapsed default) with Clock head + entry-count chip + chev, LogView embedded (trimmed head "Newest first · N entries" + Manage labels, timer card kept, .report-log-scroll 560px custom scrollbar). LogView default-export surface unchanged (TimerWidget + LogView, embedded optional).
- All v4 sections preserved and range-scoped (By day/week with Shamsi jd sub-labels, Reading by day/week, Top reading files + at-risk, By label, By item, Goals & linked files, Planner adherence, Roadmaps).

## Fixes applied on review
1. CRITICAL .cg-months alignment: grid-auto-columns was calc(var(--cg-cell)*7 + var(--cg-gap)*6) = 102px but the contribution grid's week-column pitch is 15px (12px cell + 3px gap) — month labels drifted ~8.5 columns off their weeks (26 cols → 2.6k px strip vs 390px grid). Fixed to calc(var(--cg-cell) + var(--cg-gap)) + .cg-month-lbl overflow:visible so a label spills right into the following empty cells (GitHub-style; container clips at the grid edge). Geometrically verified in-browser: label.x == its week column's first cell.x (dx=0).
2. Added missing @media (prefers-reduced-motion: reduce) — scoped (.report-print-root .bar-fill/.daychart-bar/.pbar>span/etc. so shared globals.css classes are only neutralized inside Reports).
3. Added .report-rangebar .radio-pill:focus-visible ring (globals has none for pills).
4. Coarse-pointer 44px targets for range pills.
5. (Seed artifact, not an app bug: LabelsModal crashes only with hand-crafted labels missing itemIds — Label type requires it and addLabel always sets it; fixed my localStorage seed.)

## Verification
- bunx tsc --noEmit → 8 errors, ALL pre-existing FocusMode.tsx ClockType (another agent's scope); 0 new. bun run lint → 0/0. dev.log tail clean (200s, no runtime errors).
- Browser E2E (agent-browser + VLM + geometry, Shamsi system, seeded 15 entries/5 reading sessions/2 habits/1 file/goal/roadmap):
  - Range bar: 10 pills + Print/PDF; Last 7 active; meta "Last 7 days · 22–28 Sha 1405 · 13–19 Sept 2026 · 7 days · 14h 55m" (math verified 780+115=895).
  - This year → By month: 9 Shamsi months Dey→Sha, 18 bars, legend, meta "11 Dey 1404 – 28 Sha 1405 · 1 Jan – 19 Sept 2026 · 262 days".
  - Custom: DateFields show seeded range, picker (Shahrivar 1405 grid, aria-label ISO cells) pick 2026-09-03 → Apply → "Custom · 12–28 Sha 1405 · 3–19 Sept 2026 · 17 days · 19h 20m" (1005 logged + 155 reading = 1160 ✓).
  - Contribution: 8 weeks (min-8 for last7) with levels {0:46,1:1,2:1,3:2,4:6}, weekdays Sha..Jom, legend 5 cells, summary "3 day streak · Best day 4h 55m · 24 Sha 1405 · 15 Sept 2026 · 10 active days", tooltip "Sha 10 Mor 1405 · 1 Aug 2026 · no activity".
  - Print: window.print stub → invoked; agent-browser pdf → 6 pages: p1 header block (WORKBENCH AURORA / Productivity report / Custom: 12 Sha 1405 – 28 Sha 1405 · 3–19 Sept 2026 / Generated 19 Sept 2026 · 28 Shahrivar 1405) + KPI grid + insights + focus-vs-reading, p2 heatmap + by-day charts, p5-6 activity log FULLY EXPANDED (collapsed on screen!) with day headings + totals, zero interactive controls.
  - Mobile 390×844: no horizontal overflow, pills wrap (bar 252px), custom row full-width.
  - Dark: l4 cell rgb(55,217,188), l0 rgba(233,244,238,.05) theme-aware, all readable (VLM pass).
  - Gregorian switch: weekdays Mon..Sun, no Shamsi subs.
  - All-time: 301 days · 35h 20m (1905+215 ✓), sections list = Insights / Focus vs reading / Contribution / By month / By week (44 cols) / Reading by week / Weekday distribution / Habits / Top reading files / By label / By item / Goals & linked files / Planner adherence / Roadmaps.
  - Log collapsible: collapsed default (display:none), click → block, 15 entries in 14 day groups, scroll max-height 560px.

## Files touched
- src/components/workbench/views/reports.css (fixes + additions; file created by the prior run, completed now)
- src/components/workbench/views/ReportsView.tsx, LogView.tsx — reviewed, no further edits needed this run (prior-run WIP verified + kept)
