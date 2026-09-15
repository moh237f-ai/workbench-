# Task 6-d — Roadmaps v6 UX overhaul (agent record)

## Context
- Inherited state: the 4 roadmap files (RoadmapView.tsx / RoadmapCanvas.tsx / RoadmapTimeline.tsx / roadmap.css) already carried an unlogged v6 rewrite (interrupted prior run of this same task — no worklog entry existed for it, worklog ended at Task 20-a). I treated it as WIP: deep-reviewed it line by line against the brief, fixed the genuine bugs/gaps, and verified end-to-end.
- Store API untouched (createRoadmap / addRoadmapNode / addRoadmapEdge / updateRoadmapNode / removeRoadmapNode|Edge / duplicateRoadmap used as-is). types.ts not edited.

## UX problems found in review
1. Esc during a port-drag ALSO cleared the node selection (two competing window keydown listeners — canvas + workspace).
2. goal/task/file nodes with refId null (never linked) were shown with a false "deleted" tag (nodeLive conflated "no link" with "link gone").
3. Canvas svg had role="img" — swallows interactive descendants (node cards, ports) from the a11y tree.
4. Edge labels rendered permanently instead of on hover (brief A.6) and captured pointer events; edge midpoint delete was hover-only → unreachable on touch.
5. Template picker + Tidy layout popovers had no click-outside close (Esc/toggle only).
6. Stray "X" IconBtn appeared at the end of the toolbar whenever the Tidy pop was open (redundant, looked broken).
7. Quick-add strip couldn't scroll on touch (parent .rm-canvas-wrap has touch-action: none).
8. Coarse-pointer touch targets were 30–38px (brief E requires 44).
9. reduced-motion block missed rm-pop entrance animation, ring/progress-bar transitions, cards/pills.

## Changes (only the 4 roadmap files)
- RoadmapCanvas.tsx: Esc-for-connection moved to a capture-phase window listener + stopPropagation (one key, one outcome; safe — no other popover can coexist with a captured port drag); nodeLive early-returns a clean "Untitled" record for never-linked goal/task/file nodes; svg role img→group.
- RoadmapView.tsx: click-outside (document pointerdown + wrap refs) closes the template picker and the Tidy pop; removed the stray toolbar X (dead code path).
- roadmap.css: .rm-edge-label now opacity 0 + pointer-events none, revealed by .rm-edge-g:hover / .rm-edge-g.selected (same rule extended to .rm-edge-del → touch users tap-to-select to reveal label+delete); .rm-quickadd touch-action: pan-x; coarse-pointer bumps to 44px (qk-btn, view-btn, zoomctl, order-row icon-btns, tl-zoom, tpl-row; node-acts 34px — three must fit the 92px card); reduced-motion extended (pop animation, rings, pbar, cards, pills, stat-next).
- Pre-existing v6 implementation kept and verified (not rewritten): quick-add bar + combined canvas-dblclick picker (search / DateField / inline text), port-drag connections with live bezier preview + target highlight + Esc/empty-drop cancel, 20px snap dragging, inline rename, rich cards (kind rail, ring, chip, date, hover actions), corner zoom + minimap + onboarding hint, auto-tidy-once + manual Tidy, 3-way view seg, stats bar w/ Next up, order panel (Open/Schedule/pct/DateField rows), timeline (lanes, sim dates, critical path, edges), swimlanes, richer list cards.

## Verification
- `bunx tsc --noEmit` → 0 new errors (only the 8 pre-existing FocusMode.tsx ClockType errors, explicitly out of scope).
- `bun run lint` → 0 errors / 0 warnings.
- `tail -40 dev.log` → clean compiles, GET / 200, no runtime errors.
- Browser (agent-browser, real input pipeline + VLM on screenshots, /screenshots/rm-6d-*.png):
  - template create → workspace (fit 105%, all cards visible, VLM clean)
  - +File quick-add picker → searchable library list → node spawned with live 2% progress
  - real mouse port-drag file→milestone → edge created (2→3), curved, VLM-confirmed
  - canvas dblclick → "Add to the canvas" combined popover with "at click point" chip; Milestone → DateField (dual Shamsi, "Today · 27 Sha 1405") → node created dated today
  - inline rename dblclick→Enter → "Midterm review v2" committed
  - Order panel: 6 rows, pct (2%), 4 DateFields, Open + Schedule buttons; Schedule click → toast "Scheduled Algorithms — CLRS tomorrow at 09:00"
  - Esc mid-drag → live preview cancelled, pointerup created NO edge (drop-on-empty cancel too)
  - Timeline: 3 lanes / 6 pills / 3 edges / months / Today tag / zoom; Swimlanes: kind rows y=360/510/660
  - click-outside closes Tidy pop + template pop (fixed behavior verified live)
  - list card: kinds 1,4,1 · 6 nodes · 3 links · 0% ring · upd. date · dup/del actions
  - 390px mobile: no page/canvas horizontal overflow, quick-add strip scrolls
  - zero page errors / console warnings
