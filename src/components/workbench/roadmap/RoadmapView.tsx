/* ==================== Workbench Aurora — Roadmaps View ====================
   Screen 1: roadmap list (cards + progress rings, inline rename, delete)
   Screen 2: canvas workspace (toolbar + RoadmapCanvas + execution order panel) */

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronLeft, ExternalLink, LayoutGrid, Link2, ListOrdered, Maximize2,
  Plus, Search, Trash2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { fmtDuration } from '@/lib/workbench/helpers';
import type { Roadmap, RoadmapNode, RoadmapNodeKind } from '@/lib/workbench/types';
import { Btn, IconBtn, toast } from '../ui/primitives';
import RoadmapCanvas, {
  RM_KIND_ICON, RM_KIND_META, nodeLive, topoOrder,
  type RmNodeLive, type RmSelection, type RoadmapCanvasHandle,
} from './RoadmapCanvas';
import './roadmap.css';

/* ---------- header actions ---------- */

export function RoadmapHeaderActions() {
  const createRoadmap = useWB((s) => s.createRoadmap);
  return (
    <Btn
      size="sm"
      variant="primary"
      onClick={() => {
        const rm = createRoadmap('Untitled roadmap');
        toast('Roadmap created', 'Add goals, tasks and files, then connect them.');
        void rm;
      }}
    >
      <Plus size={14} /> New roadmap
    </Btn>
  );
}

/* ---------- helpers ---------- */

function roadmapProgress(rm: Roadmap, liveMap: Map<string, RmNodeLive>): number {
  const vals: number[] = [];
  rm.nodes.forEach((n) => {
    const live = liveMap.get(n.id);
    if (!live) return;
    if (n.kind === 'note') return; // notes carry no progress
    vals.push(live.pct >= 0 ? live.pct : live.done ? 100 : 0);
  });
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/* ---------- execution order computation (module-scope pure) ---------- */

interface OrderRow {
  id: string;
  idx: number;
  node: RoadmapNode;
  live: RmNodeLive | undefined;
  est: number;
  cum: number;
  blocked: boolean;
}

function computeOrder(
  roadmap: Roadmap,
  liveMap: Map<string, RmNodeLive>
): { rows: OrderRow[]; totalEst: number; critical: Set<string> } {
  const order = topoOrder(roadmap.nodes, roadmap.edges);
  const estOf = (id: string): number => liveMap.get(id)?.estMin ?? 0;

  /* running cumulative down the list */
  const rows: OrderRow[] = [];
  let cum = 0;
  order.forEach((id, idx) => {
    const node = roadmap.nodes.find((n) => n.id === id);
    if (!node) return;
    const est = estOf(id);
    cum += est;
    const blocked = roadmap.edges.some((e) => {
      if (e.to !== id) return false;
      const st = liveMap.get(e.from)?.status;
      return !!st && st !== 'done' && st !== 'none';
    });
    rows.push({ id, idx, node, live: liveMap.get(id), est, cum, blocked });
  });

  /* critical path: longest est chain (DP over topo order) */
  const best = new Map<string, { total: number; prev: string | null }>();
  order.forEach((id) => {
    let prev: string | null = null;
    let prevTotal = -1;
    roadmap.edges.forEach((e) => {
      if (e.to !== id) return;
      const t = best.get(e.from)?.total ?? 0;
      if (t > prevTotal) {
        prevTotal = t;
        prev = e.from;
      }
    });
    best.set(id, { total: estOf(id) + Math.max(0, prevTotal), prev });
  });
  let end: string | null = null;
  let max = 0;
  best.forEach((v, id) => {
    if (v.total > max) {
      max = v.total;
      end = id;
    }
  });
  const critical = new Set<string>();
  let cur: string | null = end && max > 0 ? end : null;
  while (cur) {
    critical.add(cur);
    cur = best.get(cur)?.prev ?? null;
  }

  return { rows, totalEst: cum, critical };
}

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
              <div className="rm-card-del">
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
              <div className="rm-card-meta">
                <Ring pct={pct} />
                <span className="rm-card-stats">
                  {rm.nodes.length} node{rm.nodes.length === 1 ? '' : 's'} · {rm.edges.length} link{rm.edges.length === 1 ? '' : 's'}
                </span>
                <span className="rm-card-date mono">{updated}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- screen 2: workspace ---------- */

type PopState =
  | { mode: 'menu' }
  | { mode: 'pick'; kind: 'goal' | 'task' | 'file' }
  | { mode: 'milestone' }
  | { mode: 'note' }
  | null;

function RoadmapWorkspace({ roadmap }: { roadmap: Roadmap }) {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const updateRoadmap = useWB((s) => s.updateRoadmap);
  const updateRoadmapNode = useWB((s) => s.updateRoadmapNode);
  const removeRoadmapNode = useWB((s) => s.removeRoadmapNode);
  const addRoadmapNode = useWB((s) => s.addRoadmapNode);
  const addRoadmapEdge = useWB((s) => s.addRoadmapEdge);
  const removeRoadmapEdge = useWB((s) => s.removeRoadmapEdge);
  const updateRoadmapEdge = useWB((s) => s.updateRoadmapEdge);
  const setActiveRoadmap = useWB((s) => s.setActiveRoadmap);

  const canvasRef = useRef<RoadmapCanvasHandle>(null);
  const [selection, setSelection] = useState<RmSelection | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [pop, setPop] = useState<PopState>(null);
  const [popSearch, setPopSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [fitKey, setFitKey] = useState(0);

  const liveMap = useMemo(() => {
    const m = new Map<string, RmNodeLive>();
    roadmap.nodes.forEach((n) => m.set(n.id, nodeLive(n, items, files)));
    return m;
  }, [roadmap.nodes, items, files]);

  const selectedNode =
    selection?.kind === 'node' ? roadmap.nodes.find((n) => n.id === selection.id) || null : null;
  const selectedEdge =
    selection?.kind === 'edge' ? roadmap.edges.find((e) => e.id === selection.id) || null : null;

  /* keyboard: Esc closes pop / cancels link / clears selection; Delete removes */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable) return;
      if (e.key === 'Escape') {
        if (pop) setPop(null);
        else if (linkSource) setLinkSource(null);
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
  }, [pop, linkSource, selection, roadmap.id, removeRoadmapNode, removeRoadmapEdge]);

  /* ---------- node creation ---------- */

  const spawn = (partial: Omit<RoadmapNode, 'id'>) => {
    const spot = canvasRef.current?.dropSpot() ?? { x: 80, y: 80 };
    const node = addRoadmapNode(roadmap.id, { ...partial, x: spot.x, y: spot.y });
    setPop(null);
    setPopSearch('');
    setSelection({ kind: 'node', id: node.id });
    return node;
  };

  const pickList = useMemo(() => {
    if (!pop || pop.mode !== 'pick') return [] as { id: string; title: string; meta: string[] }[];
    const q = popSearch.trim().toLowerCase();
    if (pop.kind === 'file') {
      return files
        .filter((f) => !f.archived)
        .filter((f) => !q || f.title.toLowerCase().includes(q) || f.fileName.toLowerCase().includes(q))
        .slice(0, 40)
        .map((f) => {
          const live = { pct: 0, pagesRead: 0, pagesTotal: f.pageCount } as const;
          void live;
          return {
            id: f.id,
            title: f.title,
            meta: [`${f.pageCount} pages`, f.deadline ? `due ${f.deadline.slice(5)}` : 'no deadline'],
          };
        });
    }
    return items
      .filter((i) => i.type === pop.kind)
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
  }, [pop, popSearch, items, files]);

  /* ---------- auto layout ---------- */

  const autoLayout = () => {
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
    setFitKey((k) => k + 1);
    toast('Auto-layout applied', 'Layers follow your connections.');
  };

  /* ---------- order panel data ---------- */

  const orderRows = useMemo(
    () => computeOrder(roadmap, liveMap),
    [roadmap, liveMap]
  );

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

        {/* add node */}
        <div className="rm-pop-wrap">
          <Btn
            size="sm"
            variant="primary"
            onClick={() => setPop(pop ? null : { mode: 'menu' })}
            title="Add a node"
          >
            <Plus size={14} /> Add node
          </Btn>
          {pop && (
            <div className="rm-pop" role="dialog" aria-label="Add node">
              {pop.mode === 'menu' && (
                <>
                  <div className="rm-pop-head">
                    <span className="rm-pop-head-title">Add to the canvas</span>
                  </div>
                  {RM_KIND_META.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      className="rm-pop-item"
                      onClick={() => {
                        if (k.kind === 'milestone') setPop({ mode: 'milestone' });
                        else if (k.kind === 'note') setPop({ mode: 'note' });
                        else setPop({ mode: 'pick', kind: k.kind as 'goal' | 'task' | 'file' });
                      }}
                    >
                      <k.Icon />
                      {k.label}
                      <span className="rm-pop-hint">{k.hint}</span>
                    </button>
                  ))}
                </>
              )}

              {(pop.mode === 'pick' || pop.mode === 'milestone' || pop.mode === 'note') && (
                <>
                  <div className="rm-pop-head">
                    <IconBtn small title="Back" onClick={() => { setPop({ mode: 'menu' }); setPopSearch(''); }}>
                      <ArrowLeft size={14} />
                    </IconBtn>
                    <span className="rm-pop-head-title">
                      {pop.mode === 'pick'
                        ? `Pick a ${pop.kind}`
                        : pop.mode === 'milestone'
                          ? 'New milestone'
                          : 'New note'}
                    </span>
                  </div>

                  {pop.mode === 'pick' && (
                    <>
                      <div className="rm-pop-search">
                        <Search size={13} />
                        <input
                          autoFocus
                          value={popSearch}
                          placeholder={`Search ${pop.kind}s…`}
                          onChange={(e) => setPopSearch(e.target.value)}
                        />
                      </div>
                      <div className="rm-pick-list rm-scroll">
                        {pickList.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            className="rm-pick-row"
                            onClick={() => {
                              const kind: RoadmapNodeKind = pop.mode === 'pick' ? pop.kind : 'note';
                              spawn({
                                kind,
                                refId: row.id,
                                label: row.title,
                                x: 0, y: 0,
                                milestoneDate: null,
                                note: '',
                                done: false,
                              });
                              toast(`${kind === 'goal' ? 'Goal' : kind === 'task' ? 'Task' : 'File'} added`, row.title);
                            }}
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
                            Nothing to pick yet — create some in Goals &amp; Work or the Library first.
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {pop.mode === 'milestone' && (
                    <MiniForm
                      fields={[
                        { key: 'title', placeholder: 'Milestone title…', autoFocus: true },
                        { key: 'date', placeholder: 'Date (yyyy-mm-dd)', type: 'text' },
                      ]}
                      submitLabel="Add milestone"
                      onSubmit={(v) => {
                        const title = (v.title || '').trim() || 'Milestone';
                        const date = (v.date || '').trim();
                        spawn({
                          kind: 'milestone',
                          refId: null,
                          label: title,
                          x: 0, y: 0,
                          milestoneDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
                          note: '',
                          done: false,
                        });
                        toast('Milestone added', title);
                      }}
                      onCancel={() => setPop(null)}
                    />
                  )}

                  {pop.mode === 'note' && (
                    <MiniForm
                      fields={[{ key: 'text', placeholder: 'Note text…', autoFocus: true }]}
                      submitLabel="Add note"
                      onSubmit={(v) => {
                        const text = (v.text || '').trim();
                        if (!text) return;
                        spawn({
                          kind: 'note',
                          refId: null,
                          label: text,
                          x: 0, y: 0,
                          milestoneDate: null,
                          note: text,
                          done: false,
                        });
                        toast('Note added');
                      }}
                      onCancel={() => setPop(null)}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <Btn
          size="sm"
          className={linkMode ? 'rm-on' : ''}
          onClick={() => {
            setLinkMode((v) => !v);
            setLinkSource(null);
          }}
          title="Link mode — click one node, then another"
        >
          <Link2 size={14} /> Link
        </Btn>
        <Btn size="sm" onClick={autoLayout} title="Layer nodes by their connections">
          <LayoutGrid size={14} /> Auto-layout
        </Btn>
        <Btn size="sm" onClick={() => setFitKey((k) => k + 1)} title="Fit everything in view">
          <Maximize2 size={14} /> Fit
        </Btn>

        <div className="rm-zoom-pill">
          <IconBtn small title="Zoom out" onClick={() => canvasRef.current?.zoomBy(1 / 1.2)}>
            <ZoomOut size={14} />
          </IconBtn>
          <span className="rm-zoom-val mono">{Math.round(zoom * 100)}%</span>
          <IconBtn small title="Zoom in" onClick={() => canvasRef.current?.zoomBy(1.2)}>
            <ZoomIn size={14} />
          </IconBtn>
        </div>

        <Btn
          size="sm"
          className={orderOpen ? 'rm-on' : ''}
          onClick={() => setOrderOpen((v) => !v)}
          title="Show execution order"
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
                onClick={() => {
                  if (selectedNode.kind === 'file') {
                    window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: selectedNode.refId }));
                  } else {
                    window.dispatchEvent(new CustomEvent('wb-open-item', { detail: selectedNode.refId }));
                  }
                }}
                title="Open the linked goal, task or file"
              >
                <ExternalLink size={14} /> Open
              </Btn>
            )}
            <IconBtn
              danger
              title="Remove node (Del)"
              onClick={() => {
                removeRoadmapNode(roadmap.id, selectedNode.id);
                setSelection(null);
                toast('Node removed');
              }}
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

        {pop && (
          <IconBtn small title="Close menu" onClick={() => setPop(null)}>
            <X size={14} />
          </IconBtn>
        )}
      </div>

      <div className="rm-body">
        <RoadmapCanvas
          ref={canvasRef}
          roadmap={roadmap}
          items={items}
          files={files}
          selection={selection}
          onSelect={setSelection}
          linkMode={linkMode}
          linkSource={linkSource}
          onLinkSource={setLinkSource}
          onLink={(from, to) => {
            addRoadmapEdge(roadmap.id, from, to);
            setLinkSource(null);
            toast('Connected');
          }}
          onMoveNode={(nodeId, x, y) => updateRoadmapNode(roadmap.id, nodeId, { x, y })}
          onToggleMilestone={(node) => updateRoadmapNode(roadmap.id, node.id, { done: !node.done })}
          onZoomChange={setZoom}
          fitKey={fitKey}
        />

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
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={[
                      'rm-order-row',
                      selection?.kind === 'node' && selection.id === r.id ? 'selected' : '',
                      crit ? 'rm-critical' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => {
                      setSelection({ kind: 'node', id: r.id });
                      canvasRef.current?.centerNode(r.id);
                    }}
                  >
                    <span className="rm-idx mono">{r.idx + 1}</span>
                    <span className="rm-row-ico"><Icon /></span>
                    <span className="rm-row-main">
                      <span className="rm-row-title">{r.live?.title || r.node.label || 'Untitled'}</span>
                      <span className="rm-row-sub">
                        {crit && <span className="rm-crit-chip">critical</span>}
                        {r.blocked && (
                          <span className="rm-blocked-ico" title="Waiting on an unfinished node">
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                              <path d="M12 9v4" />
                              <path d="M12 17h.01" />
                            </svg>
                          </span>
                        )}
                        {r.live?.deadline && (
                          <span className={`mono rm-dl-${r.live.deadlineTone ?? 'ok'}`}>
                            {r.live.deadline.slice(5)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="rm-row-times">
                      <span className="rm-est mono">{r.est ? fmtDuration(r.est) : '—'}</span>
                      <span className="rm-cum mono">Σ {fmtDuration(r.cum)}</span>
                    </span>
                  </button>
                );
              })}
              {!orderRows.rows.length && (
                <div className="rm-empty-hint">Add nodes to see their execution order here.</div>
              )}
            </div>
            <div className="rm-order-foot">
              Estimates use item estimates and your reading pace. Critical path is highlighted —
              protect those blocks first.
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ---------- mini inline form (milestone / note) ---------- */

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

function MiniForm({
  fields,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  fields: { key: string; placeholder: string; type?: string; autoFocus?: boolean }[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="rm-mini-form">
      {fields.map((f) => (
        <input
          key={f.key}
          className="rm-mini-input"
          type={f.type || 'text'}
          autoFocus={f.autoFocus}
          placeholder={f.placeholder}
          value={values[f.key] || ''}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(values);
            if (e.key === 'Escape') onCancel();
          }}
        />
      ))}
      <div className="rm-mini-actions">
        <Btn size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn size="sm" variant="primary" onClick={() => onSubmit(values)}>{submitLabel}</Btn>
      </div>
    </div>
  );
}
