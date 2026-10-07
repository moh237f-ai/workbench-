/* ==================== Workbench Aurora — Roadmap Canvas ====================
   v6 deep redesign — connection without a "link mode":
   - quick-add bar slot at the top (rendered by RoadmapView)
   - connect by dragging the round port handles on a card's left/right edge —
     live bezier preview follows the cursor, valid targets highlight,
     drop on a node creates the edge, drop on empty space / Esc cancels
   - 20px snap-to-grid node dragging (pointer capture)
   - double-click empty canvas → combined quick-add at that point
   - double-click a card → inline rename
   - richer cards: kind rail + icon, progress ring, status chip, deadline,
     hover action row (open / schedule / remove), readable at 0.6 zoom
   - edges: hover label + midpoint delete button
   - corner zoom controls (−/%/+/fit), minimap bottom-left, onboarding hint
   - imperative handle: fitView / centerNode / zoomBy / dropSpot
   Also exports the shared graph helpers (nodeLive, topoOrder, kind metadata). */

'use client';

import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import {
  BookOpen, CalendarPlus, Check, ExternalLink, Flag, Grip, Maximize2, MousePointerClick,
  SquareCheck, StickyNote, Target, Trash2, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  wbChildren, wbFileAvgSecPerPage, wbFileDeadlineStatus, wbFileProgress, wbFileReadPages, wbIsBlocked,
} from '@/lib/workbench/store';
import { clamp, computeProgress, daysUntil, deadlineStatus } from '@/lib/workbench/helpers';
import type {
  Item, ResourceFile, Roadmap, RoadmapEdge, RoadmapNode, RoadmapNodeKind,
} from '@/lib/workbench/types';

/* ---------- constants & shared kind metadata ---------- */

export const RM_NODE_W = 230;
export const RM_NODE_H = 92;
/** extra foreignObject space on each side so port handles sit ON the card edge
    (keep in sync with .rm-node-wrap / .rm-node left offset in roadmap.css) */
const PORT_PAD = 14;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.2;
const GRID = 20; // snap-to-grid step while dragging
const MINI_W = 168;
const MINI_H = 104;
const MINI_PAD = 5;

export type RmSelection = { kind: 'node' | 'edge'; id: string };

export const RM_KIND_ICON: Record<RoadmapNodeKind, typeof Target> = {
  goal: Target,
  task: SquareCheck,
  file: BookOpen,
  milestone: Flag,
  note: StickyNote,
};

export const RM_KIND_META: { kind: RoadmapNodeKind; label: string; hint: string; Icon: typeof Target }[] = [
  { kind: 'goal', label: 'Goal', hint: 'live from Goals', Icon: Target },
  { kind: 'task', label: 'Task', hint: 'live from Work', Icon: SquareCheck },
  { kind: 'file', label: 'File', hint: 'live from Library', Icon: BookOpen },
  { kind: 'milestone', label: 'Milestone', hint: 'date + done', Icon: Flag },
  { kind: 'note', label: 'Note', hint: 'free text', Icon: StickyNote },
];

const STATUS_LABEL: Record<RmNodeStatus, string> = {
  done: 'done',
  progress: 'active',
  blocked: 'blocked',
  todo: 'todo',
  none: '',
};

/* ---------- live per-node data (mirrors linked entities) ---------- */

export type RmNodeStatus = 'done' | 'progress' | 'todo' | 'blocked' | 'none';

export interface RmNodeLive {
  title: string;
  missing: boolean; // linked entity was deleted
  status: RmNodeStatus;
  pct: number; // -1 = not applicable
  deadline: string | null;
  deadlineTone: 'done' | 'over' | 'soon' | 'ok' | null;
  estMin: number;
  done: boolean;
  pagesRead: number;
  pagesTotal: number;
}

export function nodeLive(node: RoadmapNode, items: Item[], files: ResourceFile[]): RmNodeLive {
  const base: RmNodeLive = {
    title: node.label,
    missing: false,
    status: 'todo',
    pct: -1,
    deadline: null,
    deadlineTone: null,
    estMin: 0,
    done: false,
    pagesRead: 0,
    pagesTotal: 0,
  };

  if (node.kind === 'goal' || node.kind === 'task') {
    if (!node.refId) return { ...base, title: node.label || 'Untitled' }; // never linked — not "deleted"
    const item = items.find((i) => i.id === node.refId);
    if (!item) return { ...base, missing: true, title: node.label || 'Deleted item' };
    const pct = computeProgress(item, (id) => wbChildren(items, id));
    const blocked = wbIsBlocked(items, item);
    const done = item.status === 'done' || (pct >= 100 && item.status !== 'inbox');
    const status: RmNodeStatus = done
      ? 'done'
      : blocked || item.status === 'waiting'
        ? 'blocked'
        : item.status === 'in_progress'
          ? 'progress'
          : 'todo';
    return {
      ...base,
      title: item.title,
      status,
      pct,
      deadline: item.deadline,
      deadlineTone: deadlineStatus(item, pct),
      estMin: item.estimateMin || 30,
      done,
    };
  }

  if (node.kind === 'file') {
    if (!node.refId) return { ...base, title: node.label || 'Untitled' }; // never linked — not "deleted"
    const f = files.find((x) => x.id === node.refId);
    if (!f) return { ...base, missing: true, title: node.label || 'Deleted file' };
    const pct = wbFileProgress(f);
    const read = wbFileReadPages(f);
    const remaining = f.kind === 'md' ? 0 : Math.max(0, f.pageCount - read);
    const avgSec = wbFileAvgSecPerPage(f);
    const perPageMin = avgSec > 0 ? Math.max(1, Math.round(avgSec / 60)) : 1; // fallback: 1 min/page
    const tone = wbFileDeadlineStatus(f);
    const status: RmNodeStatus = pct >= 100 ? 'done' : tone === 'over' ? 'blocked' : tone === 'soon' ? 'progress' : 'todo';
    return {
      ...base,
      title: f.title,
      status,
      pct,
      deadline: f.deadline,
      deadlineTone: tone,
      estMin: remaining * perPageMin,
      done: pct >= 100,
      pagesRead: read,
      pagesTotal: f.pageCount,
    };
  }

  if (node.kind === 'milestone') {
    const done = node.done;
    let tone: RmNodeLive['deadlineTone'] = null;
    if (node.milestoneDate) {
      if (done) tone = 'done';
      else {
        const du = daysUntil(node.milestoneDate);
        tone = du < 0 ? 'over' : du <= 3 ? 'soon' : 'ok';
      }
    }
    return {
      ...base,
      title: node.label || 'Milestone',
      status: done ? 'done' : 'todo',
      pct: done ? 100 : -1,
      deadline: node.milestoneDate,
      deadlineTone: tone,
      estMin: 0,
      done,
    };
  }

  // note
  return { ...base, title: node.label || 'Note', status: 'none' };
}

/* ---------- topological order (Kahn, cycle-safe) ---------- */

export function topoOrder(nodes: RoadmapNode[], edges: RoadmapEdge[]): string[] {
  const ids = nodes.map((n) => n.id);
  if (!ids.length) return [];
  const idSet = new Set(ids);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  ids.forEach((id) => {
    indeg.set(id, 0);
    adj.set(id, []);
  });
  edges.forEach((e) => {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) return;
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    adj.get(e.from)!.push(e.to);
  });

  const orderIndex = new Map(ids.map((id, i) => [id, i]));
  const ready: string[] = [];
  const pushReady = (id: string) => {
    ready.push(id);
    ready.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  };
  ids.forEach((id) => {
    if ((indeg.get(id) ?? 0) === 0) pushReady(id);
  });

  const out: string[] = [];
  const emitted = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    out.push(id);
    emitted.add(id);
    for (const t of adj.get(id) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0) pushReady(t);
    }
  }

  // cycle remains → append leftover nodes by x-position (never crash)
  if (out.length < ids.length) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const rest = ids.filter((id) => !emitted.has(id));
    rest.sort((a, b) => (byId.get(a)?.x ?? 0) - (byId.get(b)?.x ?? 0));
    out.push(...rest);
  }
  return out;
}

/* ---------- canvas component ---------- */

interface Viewport { x: number; y: number; zoom: number }

export interface RoadmapCanvasHandle {
  fitView: () => void;
  centerNode: (nodeId: string) => void;
  zoomBy: (factor: number) => void;
  /** free world-coord spot for a new node — staggered around the view center */
  dropSpot: () => { x: number; y: number };
}

/** live connection gesture (pointerId −1 = keyboard-initiated) */
interface PortDrag {
  pointerId: number;
  fixedId: string; // node whose port was grabbed
  side: 'out' | 'in'; // out: fixed→target · in: target→fixed
  x: number; y: number; // cursor in world coords
  hoverId: string | null; // valid node under the cursor
}

export interface RoadmapCanvasProps {
  roadmap: Roadmap;
  items: Item[];
  files: ResourceFile[];
  selection: RmSelection | null;
  onSelect: (sel: RmSelection | null) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onToggleMilestone: (node: RoadmapNode) => void;
  /** port drag completed on a valid target */
  onConnect: (from: string, to: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNode: (node: RoadmapNode) => void;
  onOpenNode: (node: RoadmapNode) => void;
  onScheduleNode: (node: RoadmapNode) => void;
  onRenameNode: (node: RoadmapNode, title: string) => void;
  /** double-click empty canvas → combined quick-add at that world point */
  onRequestQuickAdd: (worldX: number, worldY: number, clientX: number, clientY: number) => void;
  /** persistent quick-add bar rendered at the top of the canvas */
  topBar?: React.ReactNode;
  fitKey: number; // bump to trigger a fit (e.g. after auto-layout)
}

const snapGrid = (v: number) => Math.round(v / GRID) * GRID;
const f = (n: number) => n.toFixed(1);
/** interactive descendants that own their own gestures (never drag the card) */
const INTERACTIVE_SEL = '.rm-port, .rm-node-acts, .rm-node-rename, .rm-ms-toggle, button, input';

const RoadmapCanvas = forwardRef<RoadmapCanvasHandle, RoadmapCanvasProps>(function RoadmapCanvas(props, ref) {
  const {
    roadmap, items, files, selection, onSelect, onMoveNode, onToggleMilestone,
    onConnect, onRemoveEdge, onRemoveNode, onOpenNode, onScheduleNode, onRenameNode,
    onRequestQuickAdd, topBar, fitKey,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [portDrag, setPortDrag] = useState<PortDrag | null>(null);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);

  /* latest-value refs (read inside imperative handle + native listeners) */
  const viewportRef = useRef(viewport);
  const sizeRef = useRef(size);
  const roadmapRef = useRef(roadmap);

  /* keep refs in sync after render (compiler-safe) */
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { roadmapRef.current = roadmap; }, [roadmap]);

  const dragInfoRef = useRef<{ id: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const panInfoRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const miniDragRef = useRef<number | null>(null);
  const didFitRef = useRef(false);

  /* live data per node — recomputed when entities or nodes change */
  const liveById = useMemo(() => {
    const m = new Map<string, RmNodeLive>();
    roadmap.nodes.forEach((n) => m.set(n.id, nodeLive(n, items, files)));
    return m;
  }, [roadmap.nodes, items, files]);

  const nodeById = useMemo(() => new Map(roadmap.nodes.map((n) => [n.id, n])), [roadmap.nodes]);

  /* selected / dragging / connecting node renders last (on top) */
  const renderNodes = useMemo(() => {
    const topId = drag?.id
      ?? (selection?.kind === 'node' ? selection.id : null)
      ?? portDrag?.hoverId
      ?? portDrag?.fixedId;
    const rest: RoadmapNode[] = [];
    const top: RoadmapNode[] = [];
    roadmap.nodes.forEach((n) => (n.id === topId ? top.push(n) : rest.push(n)));
    return [...rest, ...top];
  }, [roadmap.nodes, drag, selection, portDrag]);

  const posOf = (n: RoadmapNode): { x: number; y: number } =>
    drag && drag.id === n.id ? { x: drag.x, y: drag.y } : { x: n.x, y: n.y };

  /* ---------- measure ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- zoom (wheel, cursor-anchored) ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setViewport((v) => {
        const nz = clamp(v.zoom * Math.exp(-e.deltaY * 0.0016), ZOOM_MIN, ZOOM_MAX);
        if (nz === v.zoom) return v;
        const wx = (mx - v.x) / v.zoom;
        const wy = (my - v.y) / v.zoom;
        return { x: mx - wx * nz, y: my - wy * nz, zoom: nz };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- imperative handle ---------- */

  const fitView = useCallback(() => {
    const { w, h } = sizeRef.current;
    const nodes = roadmapRef.current.nodes;
    if (!nodes.length || !w || !h) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + RM_NODE_W);
      maxY = Math.max(maxY, n.y + RM_NODE_H);
    });
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    // On narrow screens don't shrink below a readable zoom — users pan instead.
    const minFit = w < 640 ? 0.62 : ZOOM_MIN;
    const zoom = clamp(Math.min((w - 90) / bw, (h - 90) / bh), minFit, 1.5);
    setViewport({
      x: (w - bw * zoom) / 2 - minX * zoom,
      y: (h - bh * zoom) / 2 - minY * zoom,
      zoom,
    });
  }, []);

  const centerNode = useCallback((nodeId: string) => {
    const { w, h } = sizeRef.current;
    const n = roadmapRef.current.nodes.find((x) => x.id === nodeId);
    if (!n || !w || !h) return;
    setViewport((v) => ({
      x: w / 2 - (n.x + RM_NODE_W / 2) * v.zoom,
      y: h / 2 - (n.y + RM_NODE_H / 2) * v.zoom,
      zoom: v.zoom,
    }));
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const { w, h } = sizeRef.current;
    setViewport((v) => {
      const nz = clamp(v.zoom * factor, ZOOM_MIN, ZOOM_MAX);
      if (nz === v.zoom) return v;
      const wx = (w / 2 - v.x) / v.zoom;
      const wy = (h / 2 - v.y) / v.zoom;
      return { x: w / 2 - wx * nz, y: h / 2 - wy * nz, zoom: nz };
    });
  }, []);

  const dropSpot = useCallback(() => {
    const { w, h } = sizeRef.current;
    const v = viewportRef.current;
    const n = roadmapRef.current.nodes.length;
    if (!w || !h) return { x: 80 + (n % 4) * 260, y: 80 + Math.floor(n / 4) * 140 };
    // stagger grid around the world coords of the current view center
    const cx = (w / 2 - v.x) / v.zoom;
    const cy = (h / 2 - v.y) / v.zoom;
    return {
      x: Math.round(cx + (n % 4) * 260 - RM_NODE_W / 2),
      y: Math.round(cy + Math.floor(n / 4) * 140 - RM_NODE_H / 2),
    };
  }, []);

  useImperativeHandle(ref, () => ({ fitView, centerNode, zoomBy, dropSpot }), [fitView, centerNode, zoomBy, dropSpot]);

  /* auto-fit once the canvas gets its first real size */
  useEffect(() => {
    if (didFitRef.current || !size.w || !size.h) return;
    didFitRef.current = true;
    if (roadmapRef.current.nodes.length > 0) {
      const raf = requestAnimationFrame(() => fitView());
      return () => cancelAnimationFrame(raf);
    }
  }, [size.w, size.h, fitView]);

  /* fit on demand (after auto-layout etc.) */
  useEffect(() => {
    if (fitKey > 0) {
      const raf = requestAnimationFrame(() => fitView());
      return () => cancelAnimationFrame(raf);
    }
  }, [fitKey, fitView]);

  /* ---------- world helpers ---------- */

  const toWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const v = viewportRef.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  }, []);

  /** topmost node under a world point that passes the validity test */
  const nodeAtWorld = useCallback((wx: number, wy: number, valid: (n: RoadmapNode) => boolean): string | null => {
    const nodes = roadmapRef.current.nodes;
    const PAD = 8;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!valid(n)) continue;
      if (wx >= n.x - PAD && wx <= n.x + RM_NODE_W + PAD && wy >= n.y - PAD && wy <= n.y + RM_NODE_H + PAD) {
        return n.id;
      }
    }
    return null;
  }, []);

  /* ---------- background pan + double-click quick-add ---------- */

  const onBgPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const v = viewportRef.current;
    panInfoRef.current = { px: e.clientX, py: e.clientY, x: v.x, y: v.y };
    setPanning(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
    onSelect(null); // background click clears the selection
  };
  const onBgPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const p = panInfoRef.current;
    if (!p) return;
    setViewport((v) => ({ ...v, x: p.x + (e.clientX - p.px), y: p.y + (e.clientY - p.py) }));
  };
  const endPan = (e: React.PointerEvent<SVGRectElement>) => {
    panInfoRef.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onBgDoubleClick = (e: React.MouseEvent<SVGRectElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    onRequestQuickAdd(w.x, w.y, e.clientX, e.clientY);
  };

  /* ---------- node drag / select ---------- */

  const onNodePointerDown = (e: React.PointerEvent<HTMLDivElement>, node: RoadmapNode) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(INTERACTIVE_SEL)) return; // ports / actions / rename own their gestures
    e.preventDefault();
    dragInfoRef.current = { id: node.id, px: e.clientX, py: e.clientY, ox: node.x, oy: node.y, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const onNodePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragInfoRef.current;
    if (!d) return;
    const zoom = viewportRef.current.zoom;
    const dx = (e.clientX - d.px) / zoom;
    const dy = (e.clientY - d.py) / zoom;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;
    setDrag({ id: d.id, x: snapGrid(d.ox + dx), y: snapGrid(d.oy + dy) });
  };

  const onNodePointerUp = (e: React.PointerEvent<HTMLDivElement>, node: RoadmapNode) => {
    const d = dragInfoRef.current;
    dragInfoRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      const cur = drag && drag.id === d.id ? drag : { x: snapGrid(d.ox), y: snapGrid(d.oy) };
      onMoveNode(d.id, cur.x, cur.y);
      setDrag(null);
    } else {
      onSelect({ kind: 'node', id: node.id });
    }
  };

  const onNodePointerCancel = () => {
    dragInfoRef.current = null;
    setDrag(null);
  };

  const onNodeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, node: RoadmapNode) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (portDrag && portDrag.pointerId === -1) {
      // keyboard connection: focused node becomes the target
      if (validTargetFor(node, portDrag)) {
        const from = portDrag.side === 'out' ? portDrag.fixedId : node.id;
        const to = portDrag.side === 'out' ? node.id : portDrag.fixedId;
        setPortDrag(null);
        onConnect(from, to);
      }
      return;
    }
    onSelect({ kind: 'node', id: node.id });
  };

  /* ---------- inline rename (double-click a card) ---------- */

  const commitRename = (node: RoadmapNode) => {
    const r = rename;
    if (!r || r.id !== node.id) return;
    const v = r.value.trim();
    setRename(null);
    if (v) onRenameNode(node, v);
  };

  const onCardDoubleClick = (e: React.MouseEvent<HTMLDivElement>, node: RoadmapNode) => {
    e.stopPropagation();
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(INTERACTIVE_SEL)) return;
    const live = liveById.get(node.id);
    setRename({ id: node.id, value: live?.title || node.label });
  };

  /* ---------- port drag → connect (replaces link mode) ---------- */

  const validTargetFor = useCallback((n: RoadmapNode, pd: PortDrag): boolean => {
    if (n.id === pd.fixedId) return false;
    const a = pd.side === 'out' ? pd.fixedId : n.id;
    const b = pd.side === 'out' ? n.id : pd.fixedId;
    return !roadmap.edges.some((e) => e.from === a && e.to === b);
  }, [roadmap]);

  /** render helper: is this node a valid connection target right now? */
  const isConnectTarget = (node: RoadmapNode): boolean => {
    if (!portDrag) return false;
    return validTargetFor(node, portDrag);
  };

  const onPortPointerDown = (e: React.PointerEvent<HTMLSpanElement>, node: RoadmapNode, side: 'out' | 'in') => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
    const w = toWorld(e.clientX, e.clientY);
    setPortDrag({ pointerId: e.pointerId, fixedId: node.id, side, x: w.x, y: w.y, hoverId: null });
    onSelect({ kind: 'node', id: node.id });
  };

  const onPortPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!portDrag || portDrag.pointerId !== e.pointerId) return;
    const w = toWorld(e.clientX, e.clientY);
    const hoverId = nodeAtWorld(w.x, w.y, (n) => validTargetFor(n, portDrag));
    if (hoverId === portDrag.hoverId && Math.abs(w.x - portDrag.x) < 0.5 && Math.abs(w.y - portDrag.y) < 0.5) return;
    setPortDrag({ ...portDrag, x: w.x, y: w.y, hoverId });
  };

  const onPortPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!portDrag || portDrag.pointerId !== e.pointerId) return;
    const pd = portDrag;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setPortDrag(null);
    if (pd.hoverId) {
      const from = pd.side === 'out' ? pd.fixedId : pd.hoverId;
      const to = pd.side === 'out' ? pd.hoverId : pd.fixedId;
      onConnect(from, to);
    }
    // dropping on empty space simply cancels
  };

  const onPortPointerCancel = () => setPortDrag(null);

  const onPortKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, node: RoadmapNode, side: 'out' | 'in') => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (portDrag && portDrag.pointerId === -1) {
      setPortDrag(null); // toggle off
      return;
    }
    setPortDrag({
      pointerId: -1,
      fixedId: node.id,
      side,
      x: node.x + (side === 'out' ? RM_NODE_W : 0),
      y: node.y + RM_NODE_H / 2,
      hoverId: null,
    });
  };

  /* Esc cancels the live connection. Capture phase + stopPropagation so the
     workspace's Esc (clear selection / close pops) doesn't ALSO fire — one key,
     one outcome. Safe: no other popover can be open while a port is dragged. */
  const connecting = !!portDrag;
  useEffect(() => {
    if (!connecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPortDrag(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [connecting]);

  /* ---------- minimap (bottom-left overview) ---------- */

  const mini = useMemo(() => {
    const nodes = roadmap.nodes;
    if (nodes.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + RM_NODE_W);
      maxY = Math.max(maxY, n.y + RM_NODE_H);
    });
    minX -= 50; minY -= 50; maxX += 50; maxY += 50;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const iw = MINI_W - MINI_PAD * 2;
    const ih = MINI_H - MINI_PAD * 2;
    const s = Math.min(iw / bw, ih / bh);
    return {
      s,
      ox: MINI_PAD + (iw - bw * s) / 2 - minX * s,
      oy: MINI_PAD + (ih - bh * s) / 2 - minY * s,
      bw,
      bh,
    };
  }, [roadmap.nodes]);

  const showMini =
    !!mini && size.w > 0 &&
    (mini.bw * viewport.zoom > size.w * 1.1 || mini.bh * viewport.zoom > size.h * 1.1);

  const miniJump = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!mini) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - rect.left - mini.ox) / mini.s;
    const wy = (e.clientY - rect.top - mini.oy) / mini.s;
    const { w, h } = sizeRef.current;
    setViewport((v) => ({ ...v, x: w / 2 - wx * v.zoom, y: h / 2 - wy * v.zoom }));
  }, [mini]);

  const onMiniPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    miniDragRef.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
    miniJump(e);
  };
  const onMiniPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (miniDragRef.current !== e.pointerId) return;
    miniJump(e);
  };
  const onMiniPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (miniDragRef.current !== e.pointerId) return;
    miniDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  /* ---------- connection preview path ---------- */

  const previewPath = useMemo(() => {
    if (!portDrag) return null;
    const fixed = nodeById.get(portDrag.fixedId);
    if (!fixed) return null;
    const pos = (n: RoadmapNode) =>
      drag && drag.id === n.id ? { x: drag.x, y: drag.y } : { x: n.x, y: n.y };
    const fp = pos(fixed);
    const hover = portDrag.hoverId ? nodeById.get(portDrag.hoverId) : null;
    const hp = hover ? pos(hover) : null;
    const a = portDrag.side === 'out'
      ? { x: fp.x + RM_NODE_W, y: fp.y + RM_NODE_H / 2 }
      : hp
        ? { x: hp.x + RM_NODE_W, y: hp.y + RM_NODE_H / 2 }
        : { x: portDrag.x, y: portDrag.y };
    const b = portDrag.side === 'out'
      ? hp
        ? { x: hp.x, y: hp.y + RM_NODE_H / 2 }
        : { x: portDrag.x, y: portDrag.y }
      : { x: fp.x, y: fp.y + RM_NODE_H / 2 };
    const mx = (a.x + b.x) / 2;
    return `M ${f(a.x)} ${f(a.y)} C ${f(mx)} ${f(a.y)}, ${f(mx)} ${f(b.y)}, ${f(b.x)} ${f(b.y)}`;
  }, [portDrag, nodeById, drag]);

  /* ---------- render ---------- */

  const wrapCls = ['rm-canvas-wrap', panning ? 'is-panning' : '', connecting ? 'connecting' : '']
    .filter(Boolean).join(' ');
  const emptyish = roadmap.nodes.length <= 2 && roadmap.edges.length === 0;

  return (
    <div ref={wrapRef} className={wrapCls}>
      {topBar && <div className="rm-quickadd">{topBar}</div>}

      <svg className="rm-canvas-svg" role="group" aria-label={`Roadmap canvas: ${roadmap.title}`}>
        <defs>
          <pattern
            id="rm-dots"
            width={24}
            height={24}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${f(viewport.x)} ${f(viewport.y)}) scale(${viewport.zoom.toFixed(3)})`}
          >
            <circle cx={1.4} cy={1.4} r={1.4} className="rm-dot" />
          </pattern>
          <marker
            id="rm-arrow"
            viewBox="0 0 10 10"
            refX={8.5}
            refY={5}
            markerWidth={9}
            markerHeight={9}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" className="rm-arrow" />
          </marker>
          <marker
            id="rm-arrow-sel"
            viewBox="0 0 10 10"
            refX={8.5}
            refY={5}
            markerWidth={9}
            markerHeight={9}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" className="rm-arrow-sel" />
          </marker>
        </defs>

        {/* pan surface (screen space, pattern follows pan/zoom) */}
        <rect
          className="rm-bg"
          width="100%"
          height="100%"
          fill="url(#rm-dots)"
          onPointerDown={onBgPointerDown}
          onPointerMove={onBgPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onDoubleClick={onBgDoubleClick}
        />

        <g transform={`translate(${f(viewport.x)} ${f(viewport.y)}) scale(${viewport.zoom.toFixed(3)})`}>
          {/* edges first */}
          {roadmap.edges.map((edge) => {
            const a = nodeById.get(edge.from);
            const b = nodeById.get(edge.to);
            if (!a || !b) return null;
            const pa = posOf(a);
            const pb = posOf(b);
            const x1 = pa.x + RM_NODE_W;
            const y1 = pa.y + RM_NODE_H / 2;
            const x2 = pb.x;
            const y2 = pb.y + RM_NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const d = `M ${f(x1)} ${f(y1)} C ${f(mx)} ${f(y1)}, ${f(mx)} ${f(y2)}, ${f(x2)} ${f(y2)}`;
            const midX = (x1 + 6 * mx + x2) / 8;
            const midY = (y1 + y2) / 2;
            const selected = selection?.kind === 'edge' && selection.id === edge.id;
            return (
              <g key={edge.id} className={`rm-edge-g${selected ? ' selected' : ''}`}>
                <path
                  d={d}
                  className={`rm-edge${selected ? ' selected' : ''}`}
                  markerEnd={`url(#${selected ? 'rm-arrow-sel' : 'rm-arrow'})`}
                />
                {edge.label ? (
                  <text x={f(midX)} y={f(midY - 6)} className="rm-edge-label">
                    {edge.label}
                  </text>
                ) : null}
                {/* wide invisible hit target for easy clicking */}
                <path
                  d={d}
                  className="rm-edge-hit"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'edge', id: edge.id });
                  }}
                />
                {/* midpoint delete button — appears on hover */}
                <g
                  className="rm-edge-del"
                  transform={`translate(${f(midX)} ${f(midY)})`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveEdge(edge.id);
                  }}
                >
                  <circle r={9.5} />
                  <path d="M-3.4 -3.4 L3.4 3.4 M3.4 -3.4 L-3.4 3.4" />
                </g>
              </g>
            );
          })}

          {/* live connection preview */}
          {portDrag && previewPath && (
            <path d={previewPath} className="rm-edge-preview" markerEnd="url(#rm-arrow-sel)" />
          )}

          {/* nodes on top */}
          {renderNodes.map((node) => {
            const p = posOf(node);
            const live = liveById.get(node.id);
            const st = live?.status ?? 'todo';
            const selected = selection?.kind === 'node' && selection.id === node.id;
            const isSource = portDrag?.fixedId === node.id;
            const isHoverT = portDrag?.hoverId === node.id;
            const isTarget = isConnectTarget(node);
            const renaming = rename?.id === node.id;
            const schedulable =
              (node.kind === 'goal' || node.kind === 'task' || node.kind === 'file') && !!node.refId;
            const cls = [
              'rm-node',
              `k-${node.kind}`,
              selected ? 'selected' : '',
              live?.done ? 'done' : '',
              isSource ? 'linking-source' : '',
              isHoverT ? 'connect-hover' : isTarget ? 'connect-target' : '',
              drag?.id === node.id ? 'dragging' : '',
              live?.missing ? 'deleted-ref' : '',
              viewport.zoom < 0.8 ? 'zoom-sm' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const Icon = RM_KIND_ICON[node.kind];
            const isProgressKind = node.kind === 'goal' || node.kind === 'task' || node.kind === 'file';
            const ringPct = live?.pct ?? -1;
            const ringVal = clamp(ringPct, 0, 100);
            const ringR = 10.5;
            const ringC = 2 * Math.PI * ringR;
            return (
              <foreignObject
                key={node.id}
                x={f(p.x - PORT_PAD)}
                y={f(p.y)}
                width={RM_NODE_W + PORT_PAD * 2}
                height={RM_NODE_H}
              >
                <div className="rm-node-wrap">
                  {/* in-port: drag from here → the dropped node becomes the source */}
                  <span
                    className="rm-port in"
                    role="button"
                    tabIndex={0}
                    aria-label={`Connect something to ${live?.title ?? node.label}`}
                    title="Drag to a node — it becomes the source of the link"
                    onPointerDown={(e) => onPortPointerDown(e, node, 'in')}
                    onPointerMove={onPortPointerMove}
                    onPointerUp={onPortPointerUp}
                    onPointerCancel={onPortPointerCancel}
                    onKeyDown={(e) => onPortKeyDown(e, node, 'in')}
                  >
                    <Grip size={11} />
                  </span>

                  <div
                    className={cls}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.kind} node: ${live?.title ?? node.label}${ringPct >= 0 ? `, ${Math.round(ringPct)}% complete` : ''}`}
                    onPointerDown={(e) => onNodePointerDown(e, node)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={(e) => onNodePointerUp(e, node)}
                    onPointerCancel={onNodePointerCancel}
                    onKeyDown={(e) => onNodeKeyDown(e, node)}
                    onDoubleClick={(e) => onCardDoubleClick(e, node)}
                  >
                    <span className={`rm-node-stripe k-${node.kind}`} />

                    {/* hover mini action row */}
                    <span className="rm-node-acts">
                      {node.refId && (
                        <button
                          type="button"
                          title="Open the linked goal, task or file"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenNode(node);
                          }}
                        >
                          <ExternalLink size={12} />
                        </button>
                      )}
                      {schedulable && (
                        <button
                          type="button"
                          title="Schedule into tomorrow's planner"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onScheduleNode(node);
                          }}
                        >
                          <CalendarPlus size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Remove this node"
                        className="danger"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveNode(node);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>

                    <div className="rm-node-head">
                      <span className={`rm-node-ico st-${st}`}>
                        <Icon />
                      </span>
                      {renaming ? (
                        <input
                          className="rm-node-rename"
                          autoFocus
                          value={rename?.value ?? ''}
                          aria-label="Rename node"
                          onChange={(e) => setRename((r) => (r ? { ...r, value: e.target.value } : r))}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onBlur={() => commitRename(node)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename(node);
                            }
                            if (e.key === 'Escape') setRename(null);
                          }}
                        />
                      ) : (
                        <span className="rm-node-title">
                          {live?.title || 'Untitled'}
                          {live?.missing && <em className="rm-deleted-tag">deleted</em>}
                        </span>
                      )}
                      {node.kind === 'milestone' && live?.done && (
                        <span className="rm-node-msdone" title="Milestone reached">
                          <Check size={12} />
                        </span>
                      )}
                      {isProgressKind && live && ringPct >= 0 && (
                        <span className="rm-node-ring" aria-hidden="true">
                          <svg viewBox="0 0 26 26" width={26} height={26}>
                            <circle className="rm-ring-track" cx={13} cy={13} r={ringR} />
                            <circle
                              className="rm-node-ring-val"
                              style={{ stroke: st === 'blocked' ? 'var(--coral)' : undefined }}
                              cx={13}
                              cy={13}
                              r={ringR}
                              strokeDasharray={`${(ringC * ringVal) / 100} ${ringC}`}
                              transform="rotate(-90 13 13)"
                            />
                          </svg>
                          <span className="rm-node-ring-pct mono">{Math.round(ringVal)}</span>
                        </span>
                      )}
                    </div>

                    {isProgressKind && live && (
                      <div className="rm-node-pbar">
                        <span
                          style={{
                            width: `${clamp(live.pct, 0, 100)}%`,
                            background: live.status === 'blocked' ? 'var(--coral)' : undefined,
                          }}
                        />
                      </div>
                    )}

                    <div className="rm-node-meta">
                      {(node.kind === 'goal' || node.kind === 'task') && live && (
                        <>
                          <span className={`rm-mini-chip tone-${st}`}>{STATUS_LABEL[st]}</span>
                          <span className="mono">{live.pct}%</span>
                          {live.deadline && (
                            <span className={`mono rm-dl-${live.deadlineTone ?? 'ok'}`}>{live.deadline.slice(5)}</span>
                          )}
                        </>
                      )}
                      {node.kind === 'file' && live && (
                        <>
                          <span className="mono">{live.pct}%</span>
                          <span>
                            {live.pagesRead}/{live.pagesTotal}p
                          </span>
                          {live.deadline && (
                            <span className={`mono rm-dl-${live.deadlineTone ?? 'ok'}`}>{live.deadline.slice(5)}</span>
                          )}
                        </>
                      )}
                      {node.kind === 'milestone' && (
                        <>
                          <span className={`mono rm-dl-${live?.deadlineTone ?? 'none'}`}>
                            {node.milestoneDate ? node.milestoneDate.slice(5) : 'no date'}
                          </span>
                          <button
                            type="button"
                            className={`rm-ms-toggle${node.done ? ' on' : ''}`}
                            aria-pressed={node.done}
                            aria-label={node.done ? 'Mark milestone as not done' : 'Mark milestone as done'}
                            title={node.done ? 'Mark as not done' : 'Mark as done'}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleMilestone(node);
                            }}
                          />
                        </>
                      )}
                      {node.kind === 'note' && <span className="rm-note-txt">{node.note || '—'}</span>}
                    </div>
                  </div>

                  {/* out-port: drag from here → this node becomes the source */}
                  <span
                    className="rm-port out"
                    role="button"
                    tabIndex={0}
                    aria-label={`Connect ${live?.title ?? node.label} to another node`}
                    title="Drag to another node to link them"
                    onPointerDown={(e) => onPortPointerDown(e, node, 'out')}
                    onPointerMove={onPortPointerMove}
                    onPointerUp={onPortPointerUp}
                    onPointerCancel={onPortPointerCancel}
                    onKeyDown={(e) => onPortKeyDown(e, node, 'out')}
                  >
                    <Grip size={11} />
                  </span>
                </div>
              </foreignObject>
            );
          })}
        </g>
      </svg>

      {/* friendly onboarding for near-empty roadmaps */}
      {emptyish && (
        <div className="rm-onboard" aria-hidden="true">
          <div className="rm-onboard-inner">
            <MousePointerClick size={20} />
            <div className="rm-onboard-title">
              {roadmap.nodes.length === 0 ? 'Add your first node' : 'Keep building'}
            </div>
            <div className="rm-onboard-text">
              Double-click anywhere to add a node — or use the + buttons above.
              <br />
              Drag the small handle on a node&apos;s edge onto another node to connect them.
            </div>
          </div>
        </div>
      )}

      {/* minimap — click or drag to jump around */}
      {showMini && mini && (
        <div
          className="rm-minimap"
          title="Overview — drag to move around"
          onPointerDown={onMiniPointerDown}
          onPointerMove={onMiniPointerMove}
          onPointerUp={onMiniPointerUp}
          onPointerCancel={onMiniPointerUp}
        >
          {roadmap.nodes.map((n) => {
            const live = liveById.get(n.id);
            return (
              <span
                key={n.id}
                className={`rm-mini-node k-${n.kind}${live?.done ? ' done' : ''}`}
                style={{
                  left: n.x * mini.s + mini.ox,
                  top: n.y * mini.s + mini.oy,
                  width: Math.max(3, RM_NODE_W * mini.s),
                  height: Math.max(2, RM_NODE_H * mini.s),
                }}
              />
            );
          })}
          {size.w > 0 && (
            <span
              className="rm-mini-vp"
              style={{
                left: (-viewport.x / viewport.zoom) * mini.s + mini.ox,
                top: (-viewport.y / viewport.zoom) * mini.s + mini.oy,
                width: (size.w / viewport.zoom) * mini.s,
                height: (size.h / viewport.zoom) * mini.s,
              }}
            />
          )}
        </div>
      )}

      <div className="rm-canvas-badge mono">
        drag to pan · scroll to zoom · drag node handles to connect
      </div>

      {/* zoom controls (corner) */}
      <div className="rm-zoomctl" role="group" aria-label="Canvas zoom">
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          <ZoomOut size={14} />
        </button>
        <span className="rm-zoomctl-val mono">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <ZoomIn size={14} />
        </button>
        <button type="button" title="Fit everything in view" aria-label="Fit view" onClick={() => fitView()}>
          <Maximize2 size={13} />
        </button>
      </div>
    </div>
  );
});

export default RoadmapCanvas;
