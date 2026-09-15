/* ==================== Workbench Aurora — Roadmaps View ====================
   Screen 1: roadmap list (cards + progress rings, kind chips, inline rename,
             duplicate, delete, template picker)
   Screen 2: workspace — v6 deep redesign:
   - persistent quick-add bar ON the canvas (+ Goal/Task/File/Milestone/Note)
     and a combined quick-add popover at the double-clicked spot
   - three views: Canvas / Timeline / Swimlanes (kind-grouped canvas layout)
   - tidy layout button + automatic tidy on open for meaningless positions
   - live stats bar with icons, richer execution-order panel
     (Open / Schedule inline, progress per row, DateField for milestones) */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignJustify, ArrowLeft, CalendarPlus, CalendarRange, ChevronLeft, Clock, Copy, ExternalLink,
  FilePlus2, Gauge, GraduationCap, Layers, LayoutGrid, Link2, ListOrdered, LucideIcon,
  Network, Plus, Rocket, Route, Search, Sparkles, Trash2, X,
} from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import {
  addDaysStr, dateTimeFromMin, fmtDuration, minToHHMM, todayStr,
} from '@/lib/workbench/helpers';
import type { Roadmap, RoadmapNode, RoadmapNodeKind } from '@/lib/workbench/types';
import { Btn, IconBtn, toast } from '../ui/primitives';
import { DateField } from '../ui/DateField';
import RoadmapCanvas, {
  RM_KIND_ICON, RM_KIND_META, RM_NODE_H, RM_NODE_W, nodeLive, topoOrder,
  type RmNodeLive, type RmSelection, type RoadmapCanvasHandle,
} from './RoadmapCanvas';
import RoadmapTimeline, { type RoadmapTimelineHandle } from './RoadmapTimeline';
import {
  computeOrder, findFreeSlot, nextUpRow, roadmapProgress,
} from './roadmapOrder';
import './roadmap.css';

/* ---------- roadmap templates ---------- */

interface RmTemplate {
  id: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  title: string;
  milestones: { label: string; weeks: number }[];
  note: string | null;
}

const RM_TEMPLATES: RmTemplate[] = [
  {
    id: 'blank', label: 'Blank', Icon: FilePlus2,
    desc: 'An empty canvas — build it your way.',
    title: 'Untitled roadmap', milestones: [], note: null,
  },
  {
    id: 'exam', label: 'Exam prep', Icon: GraduationCap,
    desc: 'Syllabus, past papers, exam day — three milestones over six weeks.',
    title: 'Exam prep',
    milestones: [
      { label: 'Syllabus covered', weeks: 2 },
      { label: 'Past papers done', weeks: 4 },
      { label: 'Exam day', weeks: 6 },
    ],
    note: 'Add your course files and link them',
  },
  {
    id: 'skill', label: 'Learn a skill', Icon: Sparkles,
    desc: 'Fundamentals to first project to comfort, over three months.',
    title: 'Learn a skill',
    milestones: [
      { label: 'Fundamentals', weeks: 3 },
      { label: 'First project shipped', weeks: 7 },
      { label: 'Comfortable', weeks: 12 },
    ],
    note: 'Break each milestone into tasks',
  },
  {
    id: 'ship', label: 'Ship a project', Icon: Rocket,
    desc: 'Scope, MVP, launch — five weeks from idea to shipped.',
    title: 'Ship a project',
    milestones: [
      { label: 'Scope locked', weeks: 1 },
      { label: 'MVP done', weeks: 3 },
      { label: 'Launch', weeks: 5 },
    ],
    note: 'Cut scope, not quality',
  },
];

/* ---------- header actions (new roadmap + template picker) ---------- */

export function RoadmapHeaderActions() {
  const createRoadmap = useWB((s) => s.createRoadmap);
  const addRoadmapNode = useWB((s) => s.addRoadmapNode);
  const addRoadmapEdge = useWB((s) => s.addRoadmapEdge);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    /* click-outside closes (the wrap contains the toggle, so re-clicking it
       just toggles — same as before) */
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && wrapRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const createFrom = (t: RmTemplate) => {
    const rm = createRoadmap(t.title);
    const ms = t.milestones.map((m, i) =>
      addRoadmapNode(rm.id, {
        kind: 'milestone',
        refId: null,
        label: m.label,
        x: 60 + i * 300,
        y: 60,
        milestoneDate: addDaysStr(todayStr(), m.weeks * 7),
        note: '',
        done: false,
      })
    );
    for (let i = 1; i < ms.length; i++) addRoadmapEdge(rm.id, ms[i - 1].id, ms[i].id);
    if (t.note) {
      addRoadmapNode(rm.id, {
        kind: 'note',
        refId: null,
        label: t.note,
        x: 60,
        y: 250,
        milestoneDate: null,
        note: t.note,
        done: false,
      });
    }
    setOpen(false);
    toast(
      'Roadmap created',
      t.milestones.length
        ? `${t.milestones.length} milestones dated and chained — add your goals and tasks.`
        : 'Double-click the canvas to add your first node.'
    );
  };

  return (
    <div className="rm-pop-wrap" ref={wrapRef}>
      <Btn
        size="sm"
        variant="primary"
        onClick={() => setOpen((v) => !v)}
        title="Create a roadmap — blank or from a template"
        aria-expanded={open}
      >
        <Plus size={14} /> New roadmap
      </Btn>
      {open && (
        <div className="rm-pop rm-template-pop" role="dialog" aria-label="Start a new roadmap">
          <div className="rm-pop-head">
            <span className="rm-pop-head-title">Start a roadmap</span>
          </div>
          {RM_TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="rm-tpl-row" onClick={() => createFrom(t)}>
              <span className="rm-tpl-row-head">
                <t.Icon /> {t.label}
              </span>
              <span className="rm-tpl-row-desc">{t.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- list screen helpers ---------- */

const KIND_ORDER: RoadmapNodeKind[] = ['goal', 'task', 'file', 'milestone', 'note'];
const KIND_PLURAL: Record<RoadmapNodeKind, string> = {
  goal: 'goals', task: 'tasks', file: 'files', milestone: 'milestones', note: 'notes',
};

function Ring({ pct }: { pct: number }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <div className="rm-ring" aria-hidden="true">
      <svg viewBox="0 0 38 38" width={38} height={38}>
        <circle className="rm-ring-track" cx={19} cy={19} r={r} />
        <circle
          className="rm-ring-val"
          cx={19} cy={19} r={r}
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          transform="rotate(-90 19 19)"
        />
      </svg>
      <span className="rm-ring-pct mono">{pct}%</span>
    </div>
  );
}

/* ---------- workspace constants ---------- */

type ViewMode = 'canvas' | 'timeline' | 'swimlanes';

type QuickMode = 'menu' | RoadmapNodeKind;

interface QuickState {
  mode: QuickMode;
  /** node spawn position in world coords (canvas double-click) — null = dropSpot */
  world: { x: number; y: number } | null;
  /** popover position in viewport coords (clamped) */
  screen: { x: number; y: number };
  src: 'bar' | 'canvas';
}

interface PickRow {
  id: string;
  title: string;
  meta: string[];
}

const PICK_KINDS = ['goal', 'task', 'file'] as const;
type PickKind = (typeof PICK_KINDS)[number];

const isPickKind = (m: QuickMode): m is PickKind =>
  m === 'goal' || m === 'task' || m === 'file';
const GRID = 20;

const VIEW_OPTS: { id: ViewMode; label: string; desc: string; Icon: LucideIcon }[] = [
  { id: 'canvas', label: 'Canvas', desc: 'free-form graph', Icon: Network },
  { id: 'timeline', label: 'Timeline', desc: 'dates & deadlines', Icon: CalendarRange },
  { id: 'swimlanes', label: 'Swimlanes', desc: 'grouped by kind', Icon: AlignJustify },
];

/** positions lack meaning when everything sits at the origin or in one card-sized pile */
function needsAutoLayout(nodes: RoadmapNode[]): boolean {
  if (nodes.length < 2) return false;
  if (nodes.every((n) => Math.abs(n.x) < 1 && Math.abs(n.y) < 1)) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  });
  return maxX - minX < RM_NODE_W * 0.75 && maxY - minY < RM_NODE_H * 0.75;
}

/** clamp a popover to the viewport (300px wide, up to ~420px tall) */
function clampPop(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - 316)),
    y: Math.max(8, Math.min(y, window.innerHeight - 440)),
  };
}

const snapToGrid = (v: number) => Math.round(v / GRID) * GRID;

/* ---------- main view ---------- */

export function RoadmapView() {
  const roadmaps = useWB((s) => s.roadmaps);
  const activeId = useWB((s) => s.activeRoadmapId);
  const active = roadmaps.find((r) => r.id === activeId) || null;

  if (!active) return <RoadmapList />;
  return <RoadmapWorkspace roadmap={active} />;
}

/* ---------- screen 1: list ---------- */

function RoadmapList() {
  const roadmaps = useWB((s) => s.roadmaps);
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const setActiveRoadmap = useWB((s) => s.setActiveRoadmap);
  const deleteRoadmap = useWB((s) => s.deleteRoadmap);
  const duplicateRoadmap = useWB((s) => s.duplicateRoadmap);
  const updateRoadmap = useWB((s) => s.updateRoadmap);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const liveMaps = useMemo(() => {
    return roadmaps.map((rm) => {
      const m = new Map<string, RmNodeLive>();
      rm.nodes.forEach((n) => m.set(n.id, nodeLive(n, items, files)));
      return m;
    });
  }, [roadmaps, items, files]);

  if (!roadmaps.length) {
    return (
      <div className="empty-state fade-in">
        <div className="es-title">Design your first roadmap</div>
        A roadmap is a living canvas: drop your goals, tasks and PDF files onto it, draw the
        connections between them, and watch the order, the time and the progress come alive.
        <p className="rm-empty-templates">Start from a template — exam prep, learning a skill or shipping a project.</p>
        <div style={{ marginTop: 12 }}>
          <RoadmapHeaderActions />
        </div>
      </div>
    );
  }

  return (
    <div className="rm-screen fade-in">
      <div className="rm-list-head">
        <span className="rm-list-count">
          {roadmaps.length} roadmap{roadmaps.length === 1 ? '' : 's'}
        </span>
        <RoadmapHeaderActions />
      </div>
      <div className="rm-list-grid">
        {roadmaps.map((rm, i) => {
          const pct = roadmapProgress(rm, liveMaps[i]);
          const updated = rm.updatedAt.slice(0, 10);
          return (
            <div
              key={rm.id}
              className="rm-card"
              role="button"
              tabIndex={0}
              onClick={() => renaming === rm.id ? undefined : setActiveRoadmap(rm.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renaming !== rm.id) setActiveRoadmap(rm.id);
              }}
              aria-label={`Open roadmap ${rm.title}`}
            >
              <div className="rm-card-del rm-card-actions">
                <IconBtn
                  small
                  title="Duplicate roadmap"
                  onClick={(e) => {
                    e.stopPropagation();
                    const copy = duplicateRoadmap(rm.id);
                    if (copy) toast('Roadmap duplicated', copy.title);
                  }}
                >
                  <Copy size={14} />
                </IconBtn>
                <IconBtn
                  danger
                  small
                  title="Delete roadmap"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete roadmap "${rm.title}"?`)) {
                      deleteRoadmap(rm.id);
                      toast('Roadmap deleted', rm.title);
                    }
                  }}
                >
                  <Trash2 size={14} />
                </IconBtn>
              </div>
              {renaming === rm.id ? (
                <input
                  className="rm-rename"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => {
                    const t = draft.trim();
                    if (t && t !== rm.title) updateRoadmap(rm.id, { title: t });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <h3
                  className="rm-card-title"
                  title={`${rm.title} — double-click to rename`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setDraft(rm.title);
                    setRenaming(rm.id);
                  }}
                >
                  {rm.title}
                </h3>
              )}
              <p className="rm-card-desc">{rm.description || 'No description yet.'}</p>
              <div className="rm-card-kinds">
                {KIND_ORDER.map((k) => {
                  const n = rm.nodes.filter((nd) => nd.kind === k).length;
                  if (!n) return null;
                  const Icon = RM_KIND_ICON[k];
                  return (
                    <span key={k} className="rm-kind-chip" title={`${n} ${KIND_PLURAL[k]}`}>
                      <Icon /> <span className="mono">{n}</span>
                    </span>
                  );
                })}
              </div>
              <div className="rm-card-meta">
                <Ring pct={pct} />
                <span className="rm-card-stats">
                  <span className="rm-cstat" title={`${rm.nodes.length} nodes`}>
                    <Network size={11} /> <b className="mono">{rm.nodes.length}</b>
                  </span>
                  <span className="rm-cstat" title={`${rm.edges.length} links`}>
                    <Link2 size={11} /> <b className="mono">{rm.edges.length}</b>
                  </span>
                  <span className="rm-cstat" title="Overall progress">
                    <b className="mono">{pct}%</b>
                  </span>
                </span>
                <span className="rm-card-date mono" title={`Last updated ${updated}`}>
                  upd. {updated}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- screen 2: workspace ---------- */

function RoadmapWorkspace({ roadmap }: { roadmap: Roadmap }) {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const filePlans = useWB((s) => s.filePlans);
  const updateRoadmap = useWB((s) => s.updateRoadmap);
  const updateRoadmapNode = useWB((s) => s.updateRoadmapNode);
  const removeRoadmapNode = useWB((s) => s.removeRoadmapNode);
  const addRoadmapNode = useWB((s) => s.addRoadmapNode);
  const addRoadmapEdge = useWB((s) => s.addRoadmapEdge);
  const removeRoadmapEdge = useWB((s) => s.removeRoadmapEdge);
  const updateRoadmapEdge = useWB((s) => s.updateRoadmapEdge);
  const setActiveRoadmap = useWB((s) => s.setActiveRoadmap);
  const updateItem = useWB((s) => s.updateItem);
  const updateFile = useWB((s) => s.updateFile);
  const addFilePlan = useWB((s) => s.addFilePlan);

  const canvasRef = useRef<RoadmapCanvasHandle>(null);
  const timelineRef = useRef<RoadmapTimelineHandle>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  const [selection, setSelection] = useState<RmSelection | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [quick, setQuick] = useState<QuickState | null>(null);
  const [qaSearch, setQaSearch] = useState('');
  const [layoutPop, setLayoutPop] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const layoutWrapRef = useRef<HTMLDivElement>(null);

  /* tidy pop closes on outside click — no dead ends */
  useEffect(() => {
    if (!layoutPop) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && layoutWrapRef.current?.contains(t)) return;
      setLayoutPop(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [layoutPop]);

  const liveMap = useMemo(() => {
    const m = new Map<string, RmNodeLive>();
    roadmap.nodes.forEach((n) => m.set(n.id, nodeLive(n, items, files)));
    return m;
  }, [roadmap.nodes, items, files]);

  const selectedNode =
    selection?.kind === 'node' ? roadmap.nodes.find((n) => n.id === selection.id) || null : null;
  const selectedEdge =
    selection?.kind === 'edge' ? roadmap.edges.find((e) => e.id === selection.id) || null : null;

  /* ---------- derived stats (shared by stats bar + order panel) ---------- */

  const orderRows = useMemo(() => computeOrder(roadmap, liveMap), [roadmap, liveMap]);
  const progress = useMemo(() => roadmapProgress(roadmap, liveMap), [roadmap, liveMap]);
  const nextUp = useMemo(() => nextUpRow(orderRows.rows), [orderRows]);

  /* ---------- quick-add candidate list ---------- */

  const pickList = useMemo<PickRow[]>(() => {
    if (!quick || !isPickKind(quick.mode)) return [];
    const kind = quick.mode;
    const q = qaSearch.trim().toLowerCase();
    if (kind === 'file') {
      return files
        .filter((f) => !f.archived)
        .filter((f) => !q || f.title.toLowerCase().includes(q) || f.fileName.toLowerCase().includes(q))
        .slice(0, 40)
        .map((f) => ({
          id: f.id,
          title: f.title,
          meta: [`${f.pageCount} pages`, f.deadline ? `due ${f.deadline.slice(5)}` : 'no deadline'],
        }));
    }
    return items
      .filter((i) => i.type === kind)
      .filter((i) => !['archived'].includes(i.status))
      .filter((i) => !q || i.title.toLowerCase().includes(q))
      .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0))
      .slice(0, 40)
      .map((i) => ({
        id: i.id,
        title: i.title,
        meta: [
          i.status.replace('_', ' '),
          i.deadline ? `due ${i.deadline.slice(5)}` : 'no deadline',
          i.estimateMin ? `${i.estimateMin}m` : '',
        ].filter(Boolean),
      }));
  }, [quick, qaSearch, items, files]);

  /* ---------- keyboard: Esc closes pops / clears selection; Delete removes ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable) return;
      if (e.key === 'Escape') {
        if (quick) setQuick(null);
        else if (layoutPop) setLayoutPop(false);
        else if (selection) setSelection(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault();
        if (selection.kind === 'node') {
          removeRoadmapNode(roadmap.id, selection.id);
          toast('Node removed');
        } else {
          removeRoadmapEdge(roadmap.id, selection.id);
          toast('Link removed');
        }
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quick, layoutPop, selection, roadmap.id, removeRoadmapNode, removeRoadmapEdge]);

  /* ---------- layout: two tidy strategies (store-only, safe to call anywhere) ---------- */

  const applyLayout = useCallback((mode: 'layers' | 'kind') => {
    if (mode === 'layers') {
      const order = topoOrder(roadmap.nodes, roadmap.edges);
      const depth = new Map<string, number>();
      roadmap.nodes.forEach((n) => depth.set(n.id, 0));
      order.forEach((id) => {
        roadmap.edges.forEach((e) => {
          if (e.from !== id) return;
          depth.set(e.to, Math.max(depth.get(e.to) ?? 0, (depth.get(id) ?? 0) + 1));
        });
      });
      const layers = new Map<number, RoadmapNode[]>();
      roadmap.nodes.forEach((n) => {
        const d = depth.get(n.id) ?? 0;
        const arr = layers.get(d) || [];
        arr.push(n);
        layers.set(d, arr);
      });
      layers.forEach((arr, d) => {
        arr.sort((a, b) => a.y - b.y);
        arr.forEach((n, i) => updateRoadmapNode(roadmap.id, n.id, { x: 60 + d * 290, y: 60 + i * 150 }));
      });
    } else {
      KIND_ORDER.forEach((k, row) => {
        const arr = roadmap.nodes.filter((n) => n.kind === k).sort((a, b) => a.y - b.y);
        arr.forEach((n, i) => updateRoadmapNode(roadmap.id, n.id, { x: 60 + i * 290, y: 60 + row * 150 }));
      });
    }
  }, [roadmap, updateRoadmapNode]);

  const tidyLayout = (mode: 'layers' | 'kind') => {
    setLayoutPop(false);
    applyLayout(mode);
    setFitKey((k) => k + 1);
    toast('Layout tidied', mode === 'layers' ? 'Layers follow your connections.' : 'Swimlanes group nodes by kind.');
  };

  /* auto-tidy ONCE when a roadmap is opened with meaningless positions */
  const autoTidiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (autoTidiedRef.current === roadmap.id) return;
    autoTidiedRef.current = roadmap.id;
    if (needsAutoLayout(roadmap.nodes)) applyLayout('layers');
  }, [roadmap.id, roadmap.nodes, applyLayout]);

  /* ---------- view switching (swimlanes = canvas + kind layout) ---------- */

  const onViewChange = (v: ViewMode) => {
    setViewMode(v);
    if (v === 'swimlanes') {
      applyLayout('kind');
      setFitKey((k) => k + 1);
    }
  };

  /* ---------- focus a node in whichever view is active ---------- */

  const focusNode = (id: string) => {
    setSelection({ kind: 'node', id });
    if (viewMode === 'timeline') timelineRef.current?.scrollToNode(id);
    else canvasRef.current?.centerNode(id);
  };

  /* ---------- node creation (quick-add) ---------- */

  const closeQuick = useCallback(() => {
    setQuick(null);
    setQaSearch('');
  }, []);

  const spawnNode = (partial: Omit<RoadmapNode, 'id' | 'x' | 'y'>): RoadmapNode => {
    const spot = quick?.world
      ? { x: quick.world.x - RM_NODE_W / 2, y: quick.world.y - RM_NODE_H / 2 }
      : canvasRef.current?.dropSpot() ?? { x: 80, y: 80 };
    const node = addRoadmapNode(roadmap.id, {
      ...partial,
      x: snapToGrid(spot.x),
      y: snapToGrid(spot.y),
    });
    setSelection({ kind: 'node', id: node.id });
    closeQuick();
    return node;
  };

  const toggleQuickBar = useCallback((e: React.MouseEvent<HTMLButtonElement>, kind: RoadmapNodeKind) => {
    if (quick && quick.src === 'bar' && quick.mode === kind) {
      closeQuick();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setQuick({
      mode: kind,
      world: null,
      screen: clampPop(rect.left - 130, rect.bottom + 8),
      src: 'bar',
    });
    setQaSearch('');
  }, [quick, closeQuick]);

  const quickAddAtCanvas = useCallback((wx: number, wy: number, cx: number, cy: number) => {
    setQuick({ mode: 'menu', world: { x: wx, y: wy }, screen: clampPop(cx - 150, cy + 10), src: 'canvas' });
    setQaSearch('');
  }, []);

  const quickBar = (
    <div className="rm-qk-row">
      {RM_KIND_META.map((k) => (
        <button
          key={k.kind}
          type="button"
          className={`rm-qk-btn k-${k.kind}${quick?.src === 'bar' && quick.mode === k.kind ? ' on' : ''}`}
          onClick={(e) => toggleQuickBar(e, k.kind)}
          aria-haspopup="dialog"
          aria-expanded={quick?.src === 'bar' && quick.mode === k.kind}
          title={`Add a ${k.label.toLowerCase()} — ${k.hint}`}
        >
          <k.Icon size={13} />
          <span>{k.label}</span>
        </button>
      ))}
    </div>
  );

  const pickKindLabel: Record<string, string> = { goal: 'Goal', task: 'Task', file: 'File' };

  const onSpawnLinked = (row: PickRow) => {
    if (!quick) return;
    const kind = quick.mode;
    if (!isPickKind(kind)) return;
    spawnNode({
      kind,
      refId: row.id,
      label: row.title,
      milestoneDate: null,
      note: '',
      done: false,
    });
    toast(`${pickKindLabel[kind]} added`, row.title);
  };

  const onSpawnMilestone = (title: string, date: string) => {
    const t = title.trim() || 'Milestone';
    spawnNode({
      kind: 'milestone',
      refId: null,
      label: t,
      milestoneDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      note: '',
      done: false,
    });
    toast('Milestone added', t);
  };

  const onSpawnNote = (text: string) => {
    const t = text.trim();
    if (!t) return;
    spawnNode({
      kind: 'note',
      refId: null,
      label: t,
      milestoneDate: null,
      note: t,
      done: false,
    });
    toast('Note added', t);
  };

  /* ---------- canvas callbacks ---------- */

  const titleOf = (id: string): string =>
    liveMap.get(id)?.title || roadmap.nodes.find((n) => n.id === id)?.label || 'node';

  const connectNodes = (from: string, to: string) => {
    if (roadmap.edges.some((e) => e.from === from && e.to === to)) {
      toast('Already connected');
      return;
    }
    addRoadmapEdge(roadmap.id, from, to);
    toast('Connected', `${titleOf(from)} → ${titleOf(to)}`);
  };

  const removeNode = (node: RoadmapNode) => {
    removeRoadmapNode(roadmap.id, node.id);
    setSelection((s) => (s?.kind === 'node' && s.id === node.id ? null : s));
    toast('Node removed', liveMap.get(node.id)?.title || node.label);
  };

  const openNode = (node: RoadmapNode) => {
    if (!node.refId) return;
    window.dispatchEvent(
      new CustomEvent(node.kind === 'file' ? 'wb-open-reader' : 'wb-open-item', { detail: node.refId })
    );
  };

  /** double-click a node title → rename (linked nodes rename their entity) */
  const renameNode = (node: RoadmapNode, title: string) => {
    const t = title.trim();
    if (!t) return;
    if (node.kind === 'milestone') {
      updateRoadmapNode(roadmap.id, node.id, { label: t });
      return;
    }
    if (node.kind === 'note') {
      updateRoadmapNode(roadmap.id, node.id, { label: t, note: t });
      return;
    }
    if (node.refId) {
      if (node.kind === 'file') updateFile(node.refId, { title: t });
      else updateItem(node.refId, { title: t }, { snapshot: true });
      return;
    }
    updateRoadmapNode(roadmap.id, node.id, { label: t });
  };

  /* ---------- schedule a node onto tomorrow's planner ---------- */

  const scheduleNode = (node: RoadmapNode) => {
    if (node.kind === 'milestone' || node.kind === 'note' || !node.refId) {
      toast("Milestones aren't schedulable", 'Link a task or file first.');
      return;
    }
    const live = liveMap.get(node.id);
    const title = live?.title || node.label || 'Untitled';
    const tomorrow = addDaysStr(todayStr(), 1);
    if (node.kind === 'file') {
      const f = files.find((x) => x.id === node.refId);
      if (!f) {
        toast('Linked file is missing');
        return;
      }
      const slot = findFreeSlot(items, filePlans, tomorrow);
      if (slot === null) {
        toast('No free slot tomorrow', 'The 09:00–21:00 window is fully booked.');
        return;
      }
      addFilePlan(f.id, tomorrow, slot, 30);
      toast(`Scheduled ${title} tomorrow at ${minToHHMM(slot)}`);
      return;
    }
    const item = items.find((i) => i.id === node.refId);
    if (!item) {
      toast('Linked item is missing');
      return;
    }
    const slot = findFreeSlot(items, filePlans, tomorrow);
    if (slot === null) {
      toast('No free slot tomorrow', 'The 09:00–21:00 window is fully booked.');
      return;
    }
    updateItem(
      item.id,
      {
        plannedStart: dateTimeFromMin(tomorrow, slot),
        plannedEnd: dateTimeFromMin(tomorrow, slot + 30),
        startDate: tomorrow,
      },
      { snapshot: true }
    );
    toast(`Scheduled ${title} tomorrow at ${minToHHMM(slot)}`);
  };

  /* ---------- render ---------- */

  return (
    <div className="rm-screen fade-in">
      <div className="rm-toolbar">
        <Btn size="sm" onClick={() => setActiveRoadmap(null)} title="Back to all roadmaps">
          <ChevronLeft size={14} /> Roadmaps
        </Btn>
        <div className="rm-toolbar-sep" />
        <div className="rm-toolbar-titles">
          <input
            className="rm-title-input"
            value={roadmap.title}
            aria-label="Roadmap title"
            onChange={(e) => updateRoadmap(roadmap.id, { title: e.target.value })}
          />
          <input
            className="rm-desc-input"
            value={roadmap.description}
            placeholder="Add a short description…"
            aria-label="Roadmap description"
            onChange={(e) => updateRoadmap(roadmap.id, { description: e.target.value })}
          />
        </div>

        {/* view switcher: canvas / timeline / swimlanes */}
        <div className="rm-views" role="tablist" aria-label="Roadmap view">
          {VIEW_OPTS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={viewMode === o.id}
              className={`rm-view-btn${viewMode === o.id ? ' on' : ''}`}
              title={`${o.label} — ${o.desc}`}
              onClick={() => onViewChange(o.id)}
            >
              <span className="rm-view-lbl">
                <o.Icon size={13} /> {o.label}
              </span>
              <span className="rm-view-desc">{o.desc}</span>
            </button>
          ))}
        </div>

        {/* tidy layout */}
        {viewMode !== 'timeline' && (
          <div className="rm-pop-wrap" ref={layoutWrapRef}>
            <Btn
              size="sm"
              className={layoutPop ? 'rm-on' : ''}
              onClick={() => setLayoutPop((v) => !v)}
              title="Arrange node positions"
              aria-expanded={layoutPop}
            >
              <LayoutGrid size={14} /> Tidy
            </Btn>
            {layoutPop && (
              <div className="rm-pop rm-layout-pop" role="dialog" aria-label="Tidy layout options">
                <div className="rm-pop-head">
                  <span className="rm-pop-head-title">Tidy the canvas</span>
                </div>
                <button type="button" className="rm-pop-item" onClick={() => tidyLayout('layers')}>
                  <Layers /> By layers
                  <span className="rm-pop-hint">follow the links</span>
                </button>
                <button type="button" className="rm-pop-item" onClick={() => tidyLayout('kind')}>
                  <AlignJustify /> By kind
                  <span className="rm-pop-hint">swimlanes</span>
                </button>
              </div>
            )}
          </div>
        )}

        <Btn
          size="sm"
          className={orderOpen ? 'rm-on' : ''}
          onClick={() => setOrderOpen((v) => !v)}
          title="Show execution order & scheduling"
          aria-expanded={orderOpen}
        >
          <ListOrdered size={14} /> Order
        </Btn>

        {/* selection-driven actions */}
        {selectedNode && (
          <>
            <div className="rm-toolbar-sep" />
            {selectedNode.refId && (
              <Btn
                size="sm"
                onClick={() => openNode(selectedNode)}
                title="Open the linked goal, task or file"
              >
                <ExternalLink size={14} /> Open
              </Btn>
            )}
            <IconBtn
              danger
              title="Remove node (Del)"
              onClick={() => removeNode(selectedNode)}
            >
              <Trash2 size={15} />
            </IconBtn>
          </>
        )}
        {selectedEdge && (
          <>
            <div className="rm-toolbar-sep" />
            <EdgeLabelInput
              key={selectedEdge.id}
              initial={selectedEdge.label}
              onCommit={(label) => updateRoadmapEdge(roadmap.id, selectedEdge.id, { label })}
            />
            <IconBtn
              danger
              title="Remove link (Del)"
              onClick={() => {
                removeRoadmapEdge(roadmap.id, selectedEdge.id);
                setSelection(null);
                toast('Link removed');
              }}
            >
              <Trash2 size={15} />
            </IconBtn>
          </>
        )}

      </div>

      {/* live stats strip */}
      <div className="rm-stats" aria-label="Roadmap statistics">
        <span className="rm-stat" title="Nodes on this roadmap">
          <Network size={13} /> <b className="mono">{roadmap.nodes.length}</b> nodes
        </span>
        <span className="rm-stats-sep" aria-hidden="true">·</span>
        <span className="rm-stat" title="Connections between nodes">
          <Link2 size={13} /> <b className="mono">{roadmap.edges.length}</b> links
        </span>
        <span className="rm-stats-sep" aria-hidden="true">·</span>
        <span className="rm-stat" title="Average progress across nodes">
          <Gauge size={13} /> <b className="mono">{progress}%</b> complete
        </span>
        <span className="rm-stats-sep" aria-hidden="true">·</span>
        <span className="rm-stat" title="Total remaining estimate">
          <Clock size={13} /> ~<b className="mono">{fmtDuration(orderRows.totalEst)}</b> left
        </span>
        <span className="rm-stats-sep" aria-hidden="true">·</span>
        <span className="rm-stat" title="Longest chain of estimates, end to end">
          <Route size={13} /> <b className="mono">{orderRows.criticalEst ? fmtDuration(orderRows.criticalEst) : '—'}</b> critical
        </span>
        {nextUp && (
          <>
            <span className="rm-stats-sep" aria-hidden="true">·</span>
            <button
              type="button"
              className="rm-stat-next"
              onClick={() => focusNode(nextUp.id)}
              title="Select this node in the current view"
            >
              Next up: <span className="rm-stat-next-title">{nextUp.live?.title || nextUp.node.label || 'Untitled'}</span>
              <span className="mono">· {nextUp.est ? fmtDuration(nextUp.est) : '—'}</span>
            </button>
          </>
        )}
      </div>

      <div className="rm-body">
        {viewMode === 'timeline' ? (
          <RoadmapTimeline
            ref={timelineRef}
            roadmap={roadmap}
            items={items}
            files={files}
            selection={selection}
            onSelect={setSelection}
          />
        ) : (
          <RoadmapCanvas
            ref={canvasRef}
            roadmap={roadmap}
            items={items}
            files={files}
            selection={selection}
            onSelect={setSelection}
            topBar={quickBar}
            onMoveNode={(nodeId, x, y) => updateRoadmapNode(roadmap.id, nodeId, { x, y })}
            onToggleMilestone={(node) => updateRoadmapNode(roadmap.id, node.id, { done: !node.done })}
            onConnect={connectNodes}
            onRemoveEdge={(edgeId) => {
              removeRoadmapEdge(roadmap.id, edgeId);
              setSelection((s) => (s?.kind === 'edge' && s.id === edgeId ? null : s));
              toast('Link removed');
            }}
            onRemoveNode={removeNode}
            onOpenNode={openNode}
            onScheduleNode={scheduleNode}
            onRenameNode={renameNode}
            onRequestQuickAdd={quickAddAtCanvas}
            fitKey={fitKey}
          />
        )}

        {orderOpen && (
          <aside className="rm-order-panel" aria-label="Execution order">
            <div className="rm-order-head">
              <span className="rm-order-title">
                <ListOrdered /> Execution order
              </span>
              <span className="rm-order-total">
                estimated <b className="mono">{fmtDuration(orderRows.totalEst)}</b> end to end
              </span>
            </div>
            <div className="rm-order-rows rm-scroll">
              {orderRows.rows.map((r) => {
                const Icon = RM_KIND_ICON[r.node.kind];
                const crit = orderRows.critical.has(r.id);
                const pct = r.live?.pct ?? -1;
                const schedulable =
                  (r.node.kind === 'goal' || r.node.kind === 'task' || r.node.kind === 'file') &&
                  !!r.node.refId;
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    className={[
                      'rm-order-row',
                      selection?.kind === 'node' && selection.id === r.id ? 'selected' : '',
                      crit ? 'rm-critical' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => focusNode(r.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        focusNode(r.id);
                      }
                    }}
                  >
                    <span className="rm-idx mono">{r.idx + 1}</span>
                    <span className="rm-row-ico"><Icon /></span>
                    <span className="rm-row-main">
                      <span className="rm-row-title">{r.live?.title || r.node.label || 'Untitled'}</span>
                      <span className="rm-row-sub">
                        {crit && <span className="rm-crit-chip">critical</span>}
                        {r.live?.status === 'blocked' && (
                          <span className="rm-row-blocked" title="Waiting on an unfinished node">blocked</span>
                        )}
                        {pct >= 0 && <span className="rm-row-pct mono">{pct}%</span>}
                        {r.node.kind === 'milestone' ? (
                          <span
                            className="rm-row-date"
                            title="Milestone date"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <DateField
                              value={r.node.milestoneDate || ''}
                              onChange={(iso) =>
                                updateRoadmapNode(roadmap.id, r.node.id, { milestoneDate: iso || null })
                              }
                              compact
                              placeholder="set date"
                              allowClear
                            />
                          </span>
                        ) : (
                          r.live?.deadline && (
                            <span className={`mono rm-dl-${r.live.deadlineTone ?? 'ok'}`}>
                              {r.live.deadline.slice(5)}
                            </span>
                          )
                        )}
                      </span>
                      {pct >= 0 && (
                        <span className="rm-row-pbar" aria-hidden="true">
                          <span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                        </span>
                      )}
                    </span>
                    <span className="rm-row-times">
                      <span className="rm-est mono">{r.est ? fmtDuration(r.est) : '—'}</span>
                      <span className="rm-cum mono">Σ {fmtDuration(r.cum)}</span>
                    </span>
                    <span className="rm-row-acts">
                      {r.node.refId && (
                        <IconBtn
                          small
                          className="rm-open-btn"
                          title="Open the linked goal, task or file"
                          onClick={(e) => {
                            e.stopPropagation();
                            openNode(r.node);
                          }}
                        >
                          <ExternalLink size={13} />
                        </IconBtn>
                      )}
                      {schedulable && (
                        <IconBtn
                          small
                          className="rm-sched-btn"
                          title="Schedule tomorrow"
                          onClick={(e) => {
                            e.stopPropagation();
                            scheduleNode(r.node);
                          }}
                        >
                          <CalendarPlus size={13} />
                        </IconBtn>
                      )}
                    </span>
                  </div>
                );
              })}
              {!orderRows.rows.length && (
                <div className="rm-empty-hint">Add nodes to see their execution order here.</div>
              )}
            </div>
            <div className="rm-order-foot">
              Progress comes live from goals, tasks and reading. Critical path is highlighted —
              protect those blocks first. Use the calendar button to drop a row into tomorrow&apos;s plan.
            </div>
          </aside>
        )}
      </div>

      {/* floating quick-add popover + click-away backdrop (portalled to body) */}
      {quick && createPortal(
        <>
          <div className="rm-qa-backdrop" onPointerDown={closeQuick} aria-hidden="true" />
          <QuickAddPop
            key={`${quick.src}-${quick.world ? 'w' : 'b'}`}
            quick={quick}
            pickList={pickList}
            search={qaSearch}
            onSearch={setQaSearch}
            onPickKind={(kind) => {
              setQuick((q) => (q ? { ...q, mode: kind } : q));
              setQaSearch('');
            }}
            onBack={() => {
              setQuick((q) => (q ? { ...q, mode: 'menu' } : q));
              setQaSearch('');
            }}
            onSpawnLinked={onSpawnLinked}
            onSpawnMilestone={onSpawnMilestone}
            onSpawnNote={onSpawnNote}
            onClose={closeQuick}
          />
        </>,
        document.body
      )}
    </div>
  );
}

/* ---------- floating quick-add popover ---------- */

function QuickAddPop({
  quick,
  pickList,
  search,
  onSearch,
  onPickKind,
  onBack,
  onSpawnLinked,
  onSpawnMilestone,
  onSpawnNote,
  onClose,
}: {
  quick: QuickState;
  pickList: PickRow[];
  search: string;
  onSearch: (v: string) => void;
  onPickKind: (kind: RoadmapNodeKind) => void;
  onBack: () => void;
  onSpawnLinked: (row: PickRow) => void;
  onSpawnMilestone: (title: string, date: string) => void;
  onSpawnNote: (text: string) => void;
  onClose: () => void;
}) {
  const isPick = quick.mode === 'goal' || quick.mode === 'task' || quick.mode === 'file';
  const isMilestone = quick.mode === 'milestone';
  const isNote = quick.mode === 'note';
  const [msTitle, setMsTitle] = useState('');
  const [msDate, setMsDate] = useState('');
  const [noteText, setNoteText] = useState('');

  const pickLabel = quick.mode === 'goal' ? 'Goal' : quick.mode === 'task' ? 'Task' : 'File';
  const pickHint =
    quick.mode === 'file'
      ? 'Pick a library file — progress and deadline come live.'
      : 'Pick an existing goal or task — progress comes live.';

  return (
    <div
      className="rm-pop rm-qa-pop"
      role="dialog"
      aria-label="Add a node"
      style={{ left: quick.screen.x, top: quick.screen.y }}
    >
      <div className="rm-pop-head">
        {quick.mode !== 'menu' && (
          <IconBtn small title="Back to all kinds" onClick={onBack}>
            <ArrowLeft size={14} />
          </IconBtn>
        )}
        <span className="rm-pop-head-title">
          {quick.mode === 'menu'
            ? 'Add to the canvas'
            : isPick
              ? `Pick a ${pickLabel.toLowerCase()}`
              : isMilestone
                ? 'New milestone'
                : 'New note'}
        </span>
        {quick.world && (
          <span className="rm-qa-at mono" title="The node will appear where you clicked">
            at click point
          </span>
        )}
        <IconBtn small title="Close" onClick={onClose}>
          <X size={13} />
        </IconBtn>
      </div>

      {quick.mode === 'menu' && (
        <>
          {RM_KIND_META.map((k) => (
            <button
              key={k.kind}
              type="button"
              className="rm-pop-item"
              onClick={() => onPickKind(k.kind)}
            >
              <k.Icon />
              {k.label}
              <span className="rm-pop-hint">{k.hint}</span>
            </button>
          ))}
          <div className="rm-qa-tip">Tip: double-click the canvas to open this menu right there.</div>
        </>
      )}

      {isPick && (
        <>
          <div className="rm-pop-search">
            <Search size={13} />
            <input
              autoFocus
              value={search}
              placeholder={`Search ${quick.mode === 'file' ? 'files' : `${quick.mode}s`}…`}
              aria-label={`Search ${pickLabel}s`}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pickList.length) {
                  e.preventDefault();
                  onSpawnLinked(pickList[0]);
                }
              }}
            />
          </div>
          <div className="rm-pick-list rm-scroll">
            {pickList.map((row) => (
              <button
                key={row.id}
                type="button"
                className="rm-pick-row"
                onClick={() => onSpawnLinked(row)}
              >
                <span className="rm-pick-title">{row.title}</span>
                <span className="rm-pick-meta">
                  {row.meta.map((m, i) => (
                    <span key={i} className="mono">{m}</span>
                  ))}
                </span>
              </button>
            ))}
            {!pickList.length && (
              <div className="rm-empty-hint">
                {search
                  ? 'No matches — try another search.'
                  : `Nothing to pick yet — create some in ${quick.mode === 'file' ? 'the Library' : 'Goals & Work'} first.`}
              </div>
            )}
          </div>
          <div className="rm-qa-tip">{pickHint}</div>
        </>
      )}

      {isMilestone && (
        <div className="rm-mini-form">
          <input
            className="rm-mini-input"
            autoFocus
            placeholder="Milestone title…"
            aria-label="Milestone title"
            value={msTitle}
            onChange={(e) => setMsTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSpawnMilestone(msTitle, msDate);
              }
            }}
          />
          <DateField
            value={msDate}
            onChange={setMsDate}
            compact
            placeholder="Pick a date (optional)"
          />
          <div className="rm-mini-actions">
            <Btn size="sm" onClick={onClose}>Cancel</Btn>
            <Btn size="sm" variant="primary" onClick={() => onSpawnMilestone(msTitle, msDate)}>
              <Plus size={13} /> Add milestone
            </Btn>
          </div>
        </div>
      )}

      {isNote && (
        <div className="rm-mini-form">
          <input
            className="rm-mini-input"
            autoFocus
            placeholder="Note text…"
            aria-label="Note text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSpawnNote(noteText);
              }
            }}
          />
          <div className="rm-mini-actions">
            <Btn size="sm" onClick={onClose}>Cancel</Btn>
            <Btn size="sm" variant="primary" onClick={() => onSpawnNote(noteText)}>
              <Plus size={13} /> Add note
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- mini inline form pieces ---------- */

function EdgeLabelInput({ initial, onCommit }: { initial: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="rm-edge-edit"
      value={value}
      placeholder="Link label…"
      aria-label="Link label"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
