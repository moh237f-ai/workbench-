/* ==================== Reader v2 — annotation engine ====================
   Pure stroke math + undo/redo command algebra shared by the reader components.
   Strokes are normalized to page dimensions (0..1) so they survive zoom/resize. */

import { uid } from '@/lib/workbench/helpers';
import type { AnnoTool, PageAnnoMap, Stroke } from '@/lib/workbench/types';

export const HL_OPACITY = 0.38;

/* ---------- undo/redo commands ---------- */

export type AnnoCommand =
  | { type: 'add'; page: number; strokes: Stroke[] }
  | { type: 'remove'; page: number; strokes: Stroke[] }
  | { type: 'clear'; page: number; strokes: Stroke[] };

export const UNDO_CAP = 100;

/** Immutable page-map update; empty pages drop their key to keep the map tidy. */
function withPage(map: PageAnnoMap, page: number, strokes: Stroke[]): PageAnnoMap {
  const key = String(page);
  if (strokes.length === 0) {
    if (!(key in map)) return map;
    const next = { ...map };
    delete next[key];
    return next;
  }
  return { ...map, [key]: strokes };
}

export function applyAnnoCommand(map: PageAnnoMap, cmd: AnnoCommand): PageAnnoMap {
  const cur = map[String(cmd.page)] ?? [];
  switch (cmd.type) {
    case 'add':
      return withPage(map, cmd.page, [...cur, ...cmd.strokes]);
    case 'remove': {
      const ids = new Set(cmd.strokes.map((s) => s.id));
      return withPage(map, cmd.page, cur.filter((s) => !ids.has(s.id)));
    }
    case 'clear':
      return withPage(map, cmd.page, []);
    default:
      return map;
  }
}

export function revertAnnoCommand(map: PageAnnoMap, cmd: AnnoCommand): PageAnnoMap {
  const cur = map[String(cmd.page)] ?? [];
  switch (cmd.type) {
    case 'add': {
      const ids = new Set(cmd.strokes.map((s) => s.id));
      return withPage(map, cmd.page, cur.filter((s) => !ids.has(s.id)));
    }
    case 'remove':
      return withPage(map, cmd.page, [...cur, ...cmd.strokes]);
    case 'clear':
      return withPage(map, cmd.page, cmd.strokes);
    default:
      return map;
  }
}

/* ---------- stroke factory + painting ---------- */

export function createStroke(tool: AnnoTool, color: string, width: number, points: number[]): Stroke {
  return {
    id: uid(),
    tool,
    color,
    width,
    opacity: tool === 'highlight' ? HL_OPACITY : 1,
    points,
    createdAt: Date.now(),
  };
}

/**
 * Paint one stroke into a 2D context. `w`/`h` describe the coordinate space the
 * normalized points should map onto (CSS px for the overlay, device px on export).
 * Width is stored as px at a 1000px reference page width. Lines are smoothed with
 * quadratic curves through segment midpoints; caps/joins are round.
 */
export function strokePath(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number): void {
  const p = stroke.points;
  const n = Math.floor(p.length / 2);
  if (n < 1 || w <= 0 || h <= 0) return;
  const lw = Math.max(0.4, (stroke.width / 1000) * w);
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, Math.max(0.6, lw / 2), 0, Math.PI * 2);
    ctx.fill();
  } else if (n === 2) {
    ctx.beginPath();
    ctx.moveTo(p[0] * w, p[1] * h);
    ctx.lineTo(p[2] * w, p[3] * h);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(p[0] * w, p[1] * h);
    for (let i = 1; i < n - 1; i++) {
      const mx = ((p[i * 2] + p[(i + 1) * 2]) / 2) * w;
      const my = ((p[i * 2 + 1] + p[(i + 1) * 2 + 1]) / 2) * h;
      ctx.quadraticCurveTo(p[i * 2] * w, p[i * 2 + 1] * h, mx, my);
    }
    ctx.lineTo(p[(n - 1) * 2] * w, p[(n - 1) * 2 + 1] * h);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number): void {
  for (const s of strokes) strokePath(ctx, s, w, h);
}

/** True when any point of the stroke lies within `r` (normalized units) of (x, y). */
export function hitTestStroke(stroke: Stroke, x: number, y: number, r: number): boolean {
  const p = stroke.points;
  const r2 = r * r;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const dx = p[i] - x;
    const dy = p[i + 1] - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/* ---------- tiny concurrency limiter (thumbnail queue) ---------- */

export function createLimiter(cap: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            const next = queue.shift();
            if (next) next();
          });
      };
      if (active < cap) start();
      else queue.push(start);
    });
  };
}
