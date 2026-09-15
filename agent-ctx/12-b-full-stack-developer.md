# Task 12-b — Reader overlay (full-stack-developer)

## Scope
Created ONLY (per assignment):
- `src/components/workbench/reader/ReaderOverlay.tsx` — exports `ReaderOverlay({ fileId, onClose }: { fileId: string; onClose: () => void })`
- `src/components/workbench/reader/reader.css` — all reader styling (rd-* / reader-* classes), imported by the tsx

No other files touched. `bunx tsc --noEmit` (whole project) and `bunx eslint src/components/workbench/reader` both pass clean.

## Mount contract for integrator (Task 13)
```tsx
{readerFileId && (
  <ReaderOverlay fileId={readerFileId} onClose={() => setReaderFileId(null)} />
)}
```
- Renders via createPortal to document.body, `.reader-overlay` z-index **900**. NOTE: existing `.modal-overlay` is z-120 — the integrator must raise modal/toast stacking above 900 (task brief says "modals are higher").
- Opens item detail with `window.dispatchEvent(new CustomEvent('wb-open-item', { detail: itemId }))`.
- Reuses store v4 API only: setFilePosition / addFilePageSeconds / markFilePage / logReadingSession / startFileFocus / pausePomodoro / resumePomodoro / advancePomodoro / stopTimer + selectors wbFileProgress / wbFileReadPages / wbFileDeadlineStatus / wbItemsForFile / PAGE_READ_THRESHOLD_SEC.

## Behavior notes (decisions)
- **Time tracking**: 1s tick only while `document.visibilityState === 'visible'`; per-page pending map flushed every 10s + on page change + unmount. Newly-read = page crossed 15s threshold during session, computed against an immutable mount snapshot of `pageSeconds`/`readPages` + session totals. Session logged on unmount only if elapsed ≥ 60s (`minutes = max(1, round(elapsed/60000))`, endPage = current).
- **Rendering**: doc via `loadFileDoc` (cached); base page width from `getPage(page).getViewport({scale:1})`; fit-width = stage clientWidth − computed padding − 12px slack (debounced ResizeObserver 140ms); zoom ±10% clamp 50–300%, Fit resets. Paints serialized through a promise chain + seq guard — no concurrent canvas renders.
- **Immersive**: `reader-immersive` collapses header/footer (max-height + padding + translate transition); mousemove/tap reveals, auto-hide after 2.6s; Esc exits immersive first, then closes. Nav keys ignored while typing or while a `.modal-overlay` is open above (palette/item modal owns keys then).
- **Focus-read**: no timer → "Focus read" primary Btn (startFileFocus + toast); timer on this file → phase badge + mm:ss (getFocusTiming + shared useNow ticker) + pause/resume/skip/end mini IconBtns (end = stopTimer + toast('Session logged')); timer elsewhere → subtle "Timer running elsewhere" chip. Bonus: auto-advance pomodoro at 0 remaining while focus-reading here (mirrors FocusMode).
- **Chrome**: header = title/p.X of Y/slim progress+meta/deadline chip (over/soon/ok from wbFileDeadlineStatus + daysUntil)/linked item chips (max 3 + more, click opens item)/session clock (fmtClock mono)/time-on-page counter/close. Footer = zoom group / page nav with Enter-applies input / mark read-unread (reflects file.readPages) / immersive toggle (PanelTopClose/PanelTopOpen) / session clock.
- All colors via tokens (--surface-solid, --hairline, --shadow-lg, --pine/--amber/--coral/--violet, --bg-tint-*); themes light/dark/prism safe. Custom thin scrollbars on the stage; ≥44px touch targets via `pointer: coarse` query; mobile wraps toolbar and drops separators; `prefers-reduced-motion` respected.
- Canvas `background: #fff` is the paper (PDF paints over it) — the only non-token color, intentional.

## Verification
- `bunx tsc --noEmit` → 0 errors.
- `bunx eslint src/components/workbench/reader` → clean.
