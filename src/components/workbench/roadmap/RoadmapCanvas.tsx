/* ==================== Workbench Aurora — Roadmap Canvas ====================
   Internal pan/zoom SVG canvas used by RoadmapView:
   - ONE root <svg>; edges render first, then foreignObject node cards
   - pan by dragging the dotted background, cursor-anchored wheel zoom (0.35–2.2)
   - node drag with live override + 4px snap, link mode, bezier edges + labels
   - imperative handle: fitView / centerNode / zoomBy / dropSpot
   Also exports the shared graph helpers (nodeLive, topoOrder, kind metadata). */

'use client';

import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { BookOpen, Flag, SquareCheck, StickyNote, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 2.2;

export type RmSelection = { kind: 'node' | 'edge'; id: string };

export const RM_KIND_ICON: Record<RoadmapNodeKind, LucideIcon> = {
  goal: Target,
  task: SquareCheck,
  file: BookOpen,
  milestone: Flag,
  note: StickyNote,
};

export const RM_KIND_META: { kind: RoadmapNodeKind; label: string; hint: string; Icon: LucideIcon }[] = [
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
    const f = files.find((x) => x.id === node.refId);
    if (!f) return { ...base, missing: true, title: node.label || 'Deleted file' };
    const pct = wbFileProgress(f);
    const read = wbFileReadPages(f);
    const remaining = Math.max(0, f.pageCount - read);
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

export interface RoadmapCanvasProps {
  roadmap: Roadmap;
  items: Item[];
  files: ResourceFile[];
  selection: RmSelection | null;
  onSelect: (sel: RmSelection | null) => void;
  linkMode: boolean;
  linkSource: string | null;
  onLinkSource: (id: string | null) => void;
  onLink: (from: string, to: string) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onToggleMilestone: (node: RoadmapNode) => void;
  onZoomChange?: (zoom: number) => void;
  fitKey: number; // bump to trigger a fit (e.g. after auto-layout)
}

const snap = (v: number) => Math.round(v / 4) * 4;
const f = (n: number) => n.toFixed(1);

const RoadmapCanvas = forwardRef<RoadmapCanvasHandle, RoadmapCanvasProps>(function RoadmapCanvas(props, ref) {
  const {
    roadmap, items, files, selection, onSelect, linkMode, linkSource, onLinkSource, onLink,
    onMoveNode, onToggleMilestone, onZoomChange, fitKey,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  /* latest-value refs (read inside imperative handle + native listeners) */
  const viewportRef = useRef(viewport);
  const sizeRef = useRef(size);
  const roadmapRef = useRef(roadmap);
  const onZoomChangeRef = useRef(onZoomChange);

  /* keep refs in sync after render (compiler-safe) */
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    roadmapRef.current = roadmap;
  }, [roadmap]);
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  const dragInfoRef = useRef<{ id: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const panInfoRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const didFitRef = useRef(false);

  /* live data per node — recomputed when entities or nodes change */
  const liveById = useMemo(() => {
    const m = new Map<string, RmNodeLive>();
    roadmap.nodes.forEach((n) => m.set(n.id, nodeLive(n, items, files)));
    return m;
  }, [roadmap.nodes, items, files]);

  const nodeById = useMemo(() => new Map(roadmap.nodes.map((n) => [n.id, n])), [roadmap.nodes]);

  /* selected / dragging / link-source node renders last (on top) */
  const renderNodes = useMemo(() => {
    const topId = drag?.id ?? (selection?.kind === 'node' ? selection.id : null) ?? linkSource;
    const rest: RoadmapNode[] = [];
    const top: RoadmapNode[] = [];
    roadmap.nodes.forEach((n) => (n.id === topId ? top.push(n) : rest.push(n)));
    return [...rest, ...top];
  }, [roadmap.nodes, drag, selection, linkSource]);

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

  useEffect(() => {
    onZoomChangeRef.current?.(viewport.zoom);
  }, [viewport.zoom]);

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

  /* ---------- background pan ---------- */

  const onBgPointerDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const v = viewportRef.current;
    panInfoRef.current = { px: e.clientX, py: e.clientY, x: v.x, y: v.y };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    onLinkSource(null); // background cancels the link source
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

  /* ---------- node drag / select / link ---------- */

  const onNodePointerDown = (e: React.PointerEvent<HTMLDivElement>, node: RoadmapNode) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (linkMode) {
      // capture semantics — clicking never drags in link mode
      if (!linkSource) onLinkSource(node.id);
      else if (linkSource === node.id) onLinkSource(null);
      else onLink(linkSource, node.id);
      return;
    }
    dragInfoRef.current = { id: node.id, px: e.clientX, py: e.clientY, ox: node.x, oy: node.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onNodePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragInfoRef.current;
    if (!d) return;
    const zoom = viewportRef.current.zoom;
    const dx = (e.clientX - d.px) / zoom;
    const dy = (e.clientY - d.py) / zoom;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;
    setDrag({ id: d.id, x: snap(d.ox + dx), y: snap(d.oy + dy) });
  };

  const onNodePointerUp = (e: React.PointerEvent<HTMLDivElement>, node: RoadmapNode) => {
    const d = dragInfoRef.current;
    dragInfoRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      const cur = drag && drag.id === d.id ? drag : { x: snap(d.ox), y: snap(d.oy) };
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
    if (linkMode) {
      if (!linkSource) onLinkSource(node.id);
      else if (linkSource !== node.id) onLink(linkSource, node.id);
      return;
    }
    onSelect({ kind: 'node', id: node.id });
  };

  /* ---------- render ---------- */

  return (
    <div
      ref={wrapRef}
      className={`rm-canvas-wrap${panning ? ' is-panning' : ''}${linkMode ? ' linking' : ''}`}
    >
      <svg className="rm-canvas-svg" role="img" aria-label={`Roadmap canvas: ${roadmap.title}`}>
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
              <g key={edge.id}>
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
              </g>
            );
          })}

          {/* nodes on top */}
          {renderNodes.map((node) => {
            const p = posOf(node);
            const live = liveById.get(node.id);
            const st = live?.status ?? 'todo';
            const selected = selection?.kind === 'node' && selection.id === node.id;
            const isSource = linkSource === node.id;
            const cls = [
              'rm-node',
              selected ? 'selected' : '',
              isSource ? 'linking-source' : '',
              drag?.id === node.id ? 'dragging' : '',
              live?.missing ? 'deleted-ref' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const Icon = RM_KIND_ICON[node.kind];
            const isProgressKind = node.kind === 'goal' || node.kind === 'task' || node.kind === 'file';
            return (
              <foreignObject key={node.id} x={f(p.x)} y={f(p.y)} width={RM_NODE_W} height={RM_NODE_H}>
                <div
                  className={cls}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.kind} node: ${live?.title ?? node.label}`}
                  onPointerDown={(e) => onNodePointerDown(e, node)}
                  onPointerMove={onNodePointerMove}
                  onPointerUp={(e) => onNodePointerUp(e, node)}
                  onPointerCancel={onNodePointerCancel}
                  onKeyDown={(e) => onNodeKeyDown(e, node)}
                >
                  <span className={`rm-node-stripe st-${st}`} />
                  <div className="rm-node-head">
                    <span className={`rm-node-ico st-${st}`}>
                      <Icon />
                    </span>
                    <span className="rm-node-title">
                      {live?.title || 'Untitled'}
                      {live?.missing && <em className="rm-deleted-tag">deleted</em>}
                    </span>
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
                        <span className={`mono ${live?.deadlineTone === 'over' ? 'rm-dl-over' : ''}`}>
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
              </foreignObject>
            );
          })}
        </g>
      </svg>

      {roadmap.nodes.length === 0 && (
        <div className="rm-canvas-hint">
          <div>
            <div className="rm-hint-title">This canvas is empty</div>
            Use “Add node” to drop goals, tasks, files, milestones or notes —<br />
            then switch on “Link” and connect them to shape the path.
          </div>
        </div>
      )}

      <div className="rm-canvas-badge mono">
        {roadmap.nodes.length} nodes · {roadmap.edges.length} links · drag to pan · scroll to zoom
      </div>
    </div>
  );
});

export default RoadmapCanvas;
