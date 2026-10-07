/* ==================== Reader v2 — annotation engine ====================
   Pure stroke math + undo/redo command algebra shared by the reader components.
   Strokes are normalized to page dimensions (0..1) so they survive zoom/resize. */

import { uid } from '@/lib/workbench/helpers';
import type { AnnoTool, PageAnnoMap, Stroke, StrokeShape } from '@/lib/workbench/types';

export const HL_OPACITY = 0.38;

/* ---------- undo/redo commands ---------- */

export type AnnoCommand =
  | { type: 'add'; page: number; strokes: Stroke[] }
  | { type: 'remove'; page: number; strokes: Stroke[] }
  | { type: 'clear'; page: number; strokes: Stroke[] }
  | { type: 'update'; page: number; before: Stroke; after: Stroke }
  | { type: 'replace'; page: number; remove: Stroke[]; add: Stroke[] }; /* precise eraser splits — one undo step */

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
    case 'update':
      return withPage(map, cmd.page, cur.map((s) => (s.id === cmd.after.id ? cmd.after : s)));
    case 'replace': {
      const ids = new Set(cmd.remove.map((st) => st.id));
      return withPage(map, cmd.page, [...cur.filter((st) => !ids.has(st.id)), ...cmd.add]);
    }
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
    case 'update':
      return withPage(map, cmd.page, cur.map((s) => (s.id === cmd.before.id ? cmd.before : s)));
    case 'replace':
      return withPage(map, cmd.page, [
        ...cur.filter((st) => !cmd.add.some((a) => a.id === st.id)),
        ...cmd.remove,
      ]);
    default:
      return map;
  }
}

/* ---------- stroke factory + painting ---------- */

export function createStroke(tool: Stroke['tool'], color: string, width: number, points: number[], shape?: Stroke['shape']): Stroke {
  return {
    id: uid(),
    tool,
    shape,
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
  if (stroke.shape === 'text') {
    drawTextBox(ctx, stroke, w, h);
    return;
  }
  const lw = Math.max(0.4, (stroke.width / 1000) * w);
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* whiteout: opaque paper-colored cover */
  if (stroke.tool === 'whiteout') {
    const x0 = Math.min(p[0], p[2]) * w;
    const y0 = Math.min(p[1], p[3]) * h;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, y0, Math.abs(p[2] - p[0]) * w, Math.abs(p[3] - p[1]) * h);
    ctx.restore();
    return;
  }

  /* geometric shapes: points[0..1] are opposite corners (normalized) */
  if (stroke.shape) {
    const x0 = p[0] * w;
    const y0 = p[1] * h;
    const x1 = p[2] * w;
    const y1 = p[3] * h;
    ctx.beginPath();
    if (stroke.shape === 'rect') {
      ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else if (stroke.shape === 'ellipse') {
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    } else if (stroke.shape === 'line') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    } else if (stroke.shape === 'arrow') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(8, lw * 4);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang - Math.PI / 7), y1 - head * Math.sin(ang - Math.PI / 7));
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang + Math.PI / 7), y1 - head * Math.sin(ang + Math.PI / 7));
    }
    if (stroke.tool === 'highlight') {
      ctx.fillStyle = stroke.color;
      ctx.fill();
    } else {
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
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

/** Whiteouts always paint beneath ink/highlight so covering text never erases marks. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number): void {
  for (const s of strokes) if (s.tool === 'whiteout') strokePath(ctx, s, w, h);
  for (const s of strokes) if (s.tool !== 'whiteout') strokePath(ctx, s, w, h);
}

const TEXT_LINE = 1.35;

/* Canvas font stacks matching the app's families (canvas can't use CSS vars).
   Vazirmatn is included in every stack so Persian words shape correctly. */
const CANVAS_FONTS: Record<string, string> = {
  sans: "'Inter Variable', 'Vazirmatn Variable', system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono Variable', 'Vazirmatn Variable', ui-monospace, monospace",
  persian: "'Vazirmatn Variable', 'Inter Variable', sans-serif",
};

export function textBoxFontCss(font?: Stroke['font']): string {
  return CANVAS_FONTS[font ?? 'sans'] ?? CANVAS_FONTS.sans;
}

/** A text-box stroke: points[0..1] top-left, points[2..3] bottom-right (normalized). */
export function drawTextBox(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number): void {
  const text = stroke.text ?? '';
  if (!text) return;
  const x = stroke.points[0] * w + 4;
  const yTop = stroke.points[1] * h;
  const boxW = Math.max(24, (stroke.points[2] - stroke.points[0]) * w - 8);
  const fontSize = ((stroke.fontSize ?? 14) / 1000) * w;
  const lineH = fontSize * TEXT_LINE;
  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.fillStyle = stroke.color;
  /* THE fix: without this every text box rendered at the canvas default ~10px
     and the size/font controls did nothing to the glyphs */
  ctx.font = `${fontSize}px ${textBoxFontCss(stroke.font)}`;
  ctx.textBaseline = 'alphabetic';
  const rtl = isRtlTextLocal(text);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  const anchorX = rtl ? x + boxW : x;
  /* word wrap within boxW (CJK & Persian get per-char fallback) */
  const paragraphs = text.split('\n');
  let y = yTop + fontSize;
  for (const para of paragraphs) {
    if (!para) {
      y += lineH;
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > boxW && line) {
        ctx.fillText(line, anchorX, y);
        y += lineH;
        line = word;
      } else line = test;
    }
    if (line) {
      ctx.fillText(line, anchorX, y);
      y += lineH;
    }
  }
  ctx.restore();
}

function isRtlTextLocal(s: string): boolean {
  const RTL = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const LTR = /[A-Za-z\u00C0-\u024F]/;
  for (const ch of s) {
    if (RTL.test(ch)) return true;
    if (LTR.test(ch)) return false;
  }
  return false;
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


/* ---------- selection: bbox + transforms ---------- */

export interface StrokeBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalized bounding box of a stroke, padded to include its line width. */
export function strokeBBox(stroke: Stroke): StrokeBBox {
  const p = stroke.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
  }
  const pad = stroke.width / 1000 / 2;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Move a stroke by normalized deltas. */
export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const p = [...stroke.points];
  for (let i = 0; i < p.length; i += 2) {
    p[i] = Math.min(1, Math.max(0, p[i] + dx));
    p[i + 1] = Math.min(1, Math.max(0, p[i + 1] + dy));
  }
  return { ...stroke, points: p };
}

/** Scale a stroke from a normalized anchor point by the given factors. */
export function scaleStroke(stroke: Stroke, ax: number, ay: number, fx: number, fy: number): Stroke {
  const fxSafe = Math.abs(fx) < 0.05 ? 0.05 * Math.sign(fx || 1) : fx;
  const fySafe = Math.abs(fy) < 0.05 ? 0.05 * Math.sign(fy || 1) : fy;
  const p = [...stroke.points];
  for (let i = 0; i < p.length; i += 2) {
    p[i] = Math.min(1, Math.max(0, ax + (p[i] - ax) * fxSafe));
    p[i + 1] = Math.min(1, Math.max(0, ay + (p[i + 1] - ay) * fySafe));
  }
  return { ...stroke, points: p };
}

/**
 * Hit-test a stroke at normalized (x, y): points within radius, or — for
 * shapes — inside / near the outline of the bounding box.
 */
export function hitTestStrokeAt(stroke: Stroke, x: number, y: number, r: number): boolean {
  if (stroke.shape) {
    const b = strokeBBox(stroke);
    const pad = Math.max(r, stroke.width / 1000);
    const inside =
      x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
    if (!inside) return false;
    /* filled shapes hit anywhere inside; strokes only near the edge */
    if (stroke.tool === 'highlight') return true;
    const inner = x > b.x + pad && x < b.x + b.w - pad && y > b.y + pad && y < b.y + b.h - pad;
    return !inner || stroke.shape === 'line' || stroke.shape === 'arrow';
  }
  return hitTestStroke(stroke, x, y, r);
}
