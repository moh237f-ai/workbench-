/* ==================== Workbench Aurora — Roadmap Timeline ====================
   The time view of a roadmap — "the order, the time and the process":
   - every node becomes a pill on a horizontal date axis, in swimlanes by kind
   - dated pills (milestone dates, real deadlines) are solid; undated ones are
     SIMULATED: today + ceil(cumulative est along topo order / daily capacity)
     days — dashed border + "≈" before the date
   - curved dependency edges (critical path thicker + coral), today marker,
     lightly shaded weekends, month ruler + week ticks
   - S/M/L day-width zoom (44 / 64 / 96 px per day), sticky lane labels
   Native scrolling only — no pan/zoom matrix. Pills are keyboard focusable. */

'use client';

import React, {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { addDaysStr, clamp, parseDate, todayStr } from '@/lib/workbench/helpers';
import type {
  Item, ResourceFile, Roadmap, RoadmapNode, RoadmapNodeKind,
} from '@/lib/workbench/types';
import { RM_KIND_ICON, nodeLive, type RmNodeLive, type RmSelection } from './RoadmapCanvas';
import { computeOrder } from './roadmapOrder';

/* ---------- geometry constants ---------- */

const LANE_LABEL_W = 86;
const RULER_H = 46;
const PILL_W = 216;
const PILL_H = 46;
const ROW_GAP = 10;
const DAY_WIDTHS = { S: 44, M: 64, L: 96 } as const;
type ZoomId = keyof typeof DAY_WIDTHS;

const LANES: { kind: RoadmapNodeKind; label: string }[] = [
  { kind: 'goal', label: 'Goals' },
  { kind: 'task', label: 'Tasks' },
  { kind: 'file', label: 'Files' },
  { kind: 'milestone', label: 'Milestones' },
  { kind: 'note', label: 'Notes' },
];

/* ---------- model types ---------- */

export interface RoadmapTimelineHandle {
  scrollToNode: (nodeId: string) => void;
}

export interface RoadmapTimelineProps {
  roadmap: Roadmap;
  items: Item[];
  files: ResourceFile[];
  selection: RmSelection | null;
  onSelect: (sel: RmSelection | null) => void;
}

interface Placed {
  node: RoadmapNode;
  live: RmNodeLive | undefined;
  title: string;
  date: string;
  sim: boolean;
  tone: RmNodeLive['deadlineTone'];
  pct: number;
  blocked: boolean;
  critical: boolean;
  x: number; // pill left, chart coords (relative to lane body)
  y: number; // pill top within its lane
  cy: number; // pill center y in lanes-space (edge anchor)
}

interface LaneModel {
  kind: RoadmapNodeKind;
  label: string;
  count: number;
  height: number;
  top: number;
  pills: Placed[];
}

interface EdgePath {
  id: string;
  d: string;
  crit: boolean;
}

interface TimelineModel {
  days: string[];
  months: { key: string; label: string; startIdx: number; count: number }[];
  chartW: number;
  totalH: number;
  laneModels: LaneModel[];
  placeById: Map<string, Placed>;
  edgePaths: EdgePath[];
  todayIdx: number;
}

/* ---------- component ---------- */

const RoadmapTimeline = forwardRef<RoadmapTimelineHandle, RoadmapTimelineProps>(
  function RoadmapTimeline(props, ref) {
    const { roadmap, items, files, selection, onSelect } = props;
    const dailyCapacityMin = useWB((s) => s.dailyCapacityMin);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [dayW, setDayW] = useState<number>(DAY_WIDTHS.M);

    const today = useMemo(() => todayStr(), []);

    const liveMap = useMemo(() => {
      const m = new Map<string, RmNodeLive>();
      roadmap.nodes.forEach((n) => m.set(n.id, nodeLive(n, items, files)));
      return m;
    }, [roadmap.nodes, items, files]);

    const model = useMemo<TimelineModel>(() => {
      const order = computeOrder(roadmap, liveMap);
      const cap = Math.max(30, dailyCapacityMin);

      /* date per node: real (milestone date / linked deadline) or simulated */
      const dated = order.rows.map((row) => {
        let date: string;
        let sim = false;
        if (row.node.kind === 'milestone' && row.node.milestoneDate) {
          date = row.node.milestoneDate;
        } else if (row.live?.deadline) {
          date = row.live.deadline;
        } else {
          sim = true;
          date = addDaysStr(today, Math.ceil(row.cum / cap));
        }
        return { row, date, sim };
      });

      /* axis range: min(today, earliest real) − 2d … max(latest date, today+14d) + 2d */
      const realDates = dated.filter((d) => !d.sim).map((d) => d.date);
      const allDates = dated.map((d) => d.date);
      const horizon = addDaysStr(today, 14);
      const earliest = [today, ...realDates].reduce((m, x) => (x < m ? x : m));
      const latest = [horizon, ...allDates].reduce((m, x) => (x > m ? x : m));
      const first = addDaysStr(earliest, -2);
      const last = addDaysStr(latest, 2);

      const days: string[] = [];
      for (let d = first; d <= last && days.length < 800; d = addDaysStr(d, 1)) days.push(d);
      const dayIndex = new Map(days.map((d, i) => [d, i]));
      const chartW = days.length * dayW;

      /* ruler months */
      const months: TimelineModel['months'] = [];
      days.forEach((d, i) => {
        const key = d.slice(0, 7);
        const prev = months[months.length - 1];
        if (prev && prev.key === key) prev.count += 1;
        else {
          months.push({
            key,
            label: parseDate(d).toLocaleDateString(undefined, { month: 'long' }),
            startIdx: i,
            count: 1,
          });
        }
      });

      /* lanes with sub-row packing (same/adjacent-day pills stack) */
      const laneModels: LaneModel[] = [];
      let acc = 0;
      LANES.forEach((lane) => {
        const entries = dated
          .filter((d) => d.row.node.kind === lane.kind)
          .sort((a, b) => (a.date === b.date ? a.row.idx - b.row.idx : a.date < b.date ? -1 : 1));
        if (!entries.length) return;

        const occupied: Array<Array<[number, number]>> = [];
        const packed = entries.map((e) => {
          const di = dayIndex.get(e.date) ?? 0;
          const left = clamp(di * dayW + dayW / 2 - PILL_W / 2, 2, Math.max(2, chartW - PILL_W - 2));
          let sub = 0;
          let clash = true;
          while (clash) {
            if (!occupied[sub]) occupied[sub] = [];
            const row = occupied[sub];
            clash = row.some(([s, en]) => left < en + 8 && left + PILL_W > s - 8);
            if (clash) sub += 1;
            else row.push([left, left + PILL_W]);
          }
          const live = e.row.live;
          return {
            node: e.row.node,
            live,
            title: live?.title || e.row.node.label || 'Untitled',
            date: e.date,
            sim: e.sim,
            tone: live?.deadlineTone ?? null,
            pct: live && live.pct >= 0 ? live.pct : -1,
            blocked: e.row.blocked,
            critical: order.critical.has(e.row.id),
            x: left,
            sub,
          };
        });
        const subCount = occupied.length;
        const height = 10 + subCount * PILL_H + Math.max(0, subCount - 1) * ROW_GAP + 10;
        const top = acc;
        acc += height;
        const pills: Placed[] = packed.map((p) => {
          const y = 10 + p.sub * (PILL_H + ROW_GAP);
          return { ...p, y, cy: top + y + PILL_H / 2 };
        });
        laneModels.push({ kind: lane.kind, label: lane.label, count: entries.length, height, top, pills });
      });

      const totalH = RULER_H + acc + 8;
      const placeById = new Map<string, Placed>();
      laneModels.forEach((l) => l.pills.forEach((p) => placeById.set(p.node.id, p)));

      /* curved connectors between pill centers (pill-edge anchored) */
      const edgePaths: EdgePath[] = [];
      roadmap.edges.forEach((e) => {
        if (e.from === e.to) return;
        const a = placeById.get(e.from);
        const b = placeById.get(e.to);
        if (!a || !b) return;
        const forward = b.x >= a.x;
        const x1 = forward ? a.x + PILL_W : a.x;
        const x2 = forward ? b.x : b.x + PILL_W;
        const bend = clamp(Math.abs(x2 - x1) * 0.45, 28, 150);
        const c1x = forward ? x1 + bend : x1 - bend;
        const c2x = forward ? x2 - bend : x2 + bend;
        edgePaths.push({
          id: e.id,
          d:
            `M ${x1.toFixed(1)} ${a.cy.toFixed(1)} ` +
            `C ${c1x.toFixed(1)} ${a.cy.toFixed(1)}, ${c2x.toFixed(1)} ${b.cy.toFixed(1)}, ` +
            `${x2.toFixed(1)} ${b.cy.toFixed(1)}`,
          crit: order.critical.has(e.from) && order.critical.has(e.to),
        });
      });

      return {
        days, months, chartW, totalH, laneModels, placeById, edgePaths,
        todayIdx: dayIndex.get(today) ?? -1,
      };
    }, [roadmap, liveMap, dailyCapacityMin, dayW, today]);

    /* initial scroll: today − 3 days; keep the anchor when the day width changes */
    const didInitRef = useRef(false);
    const prevDayWRef = useRef(dayW);
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (!didInitRef.current) {
        didInitRef.current = true;
        el.scrollLeft = Math.max(0, (model.todayIdx - 3) * dayW);
        prevDayWRef.current = dayW;
        return;
      }
      const prev = prevDayWRef.current;
      prevDayWRef.current = dayW;
      if (prev !== dayW) el.scrollLeft = (el.scrollLeft / prev) * dayW;
    }, [dayW, model.todayIdx]);

    useImperativeHandle(ref, () => ({
      scrollToNode: (nodeId: string) => {
        const el = scrollRef.current;
        const p = model.placeById.get(nodeId);
        if (!el || !p) return;
        el.scrollTo({
          left: clamp(p.x + PILL_W / 2 - el.clientWidth / 2, 0, Math.max(0, el.scrollWidth - el.clientWidth)),
          top: clamp(p.cy + RULER_H - el.clientHeight / 2, 0, Math.max(0, el.scrollHeight - el.clientHeight)),
          behavior: 'smooth',
        });
      },
    }), [model]);

    return (
      <div className="rm-tl-wrap">
        <div
          className="rm-timeline rm-scroll"
          ref={scrollRef}
          aria-label={`Roadmap timeline: ${roadmap.title}`}
        >
          <div className="rm-tl-inner" style={{ width: LANE_LABEL_W + model.chartW }}>
            {/* background: weekends, week guides, today line */}
            <div
              className="rm-tl-grid"
              style={{ left: LANE_LABEL_W, width: model.chartW, height: model.totalH }}
            >
              {model.days.map((d, i) => {
                const dow = parseDate(d).getDay();
                return dow === 0 || dow === 6 ? (
                  <div key={`we-${d}`} className="rm-tl-weekend" style={{ left: i * dayW, width: dayW }} />
                ) : null;
              })}
              {model.days.map((d, i) =>
                parseDate(d).getDay() === 1 ? (
                  <div key={`wk-${d}`} className="rm-tl-weekline" style={{ left: i * dayW }} />
                ) : null
              )}
              {model.todayIdx >= 0 && (
                <div className="rm-tl-today" style={{ left: model.todayIdx * dayW + dayW / 2 }} />
              )}
            </div>

            {/* ruler: sticky top, corner sticky left */}
            <div className="rm-tl-ruler" style={{ height: RULER_H }}>
              <div className="rm-tl-corner" style={{ flexBasis: LANE_LABEL_W }}>
                <span>{model.days.length} days</span>
              </div>
              <div className="rm-tl-rulerbody" style={{ width: model.chartW }}>
                {model.months.map((m) => (
                  <div
                    key={`${m.key}-${m.startIdx}`}
                    className="rm-tl-month"
                    style={{ left: m.startIdx * dayW, width: m.count * dayW }}
                    title={m.label}
                  >
                    {m.label}
                  </div>
                ))}
                {model.todayIdx >= 0 && (
                  <span
                    className="rm-tl-today-tag mono"
                    style={{ left: model.todayIdx * dayW + dayW / 2 }}
                  >
                    Today
                  </span>
                )}
                <div className="rm-tl-ticks">
                  {model.days.map((d, i) => {
                    const dt = parseDate(d);
                    if (dt.getDay() === 1) {
                      return (
                        <div key={`t-${d}`} className="rm-tl-tick wk" style={{ left: i * dayW }}>
                          <span className="mono">{dt.getDate()}</span>
                        </div>
                      );
                    }
                    if (dayW >= 96) {
                      return <div key={`t-${d}`} className="rm-tl-tick" style={{ left: i * dayW }} />;
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>

            {/* lanes */}
            {model.laneModels.map((lane) => (
              <div key={lane.kind} className="rm-tl-lane" style={{ height: lane.height }}>
                <div className="rm-tl-lanelabel" style={{ flexBasis: LANE_LABEL_W }}>
                  <span>{lane.label}</span>
                  <span className="mono">{lane.count}</span>
                </div>
                <div className="rm-tl-lanebody" style={{ width: model.chartW }}>
                  {lane.pills.map((p) => (
                    <TimelinePill key={p.node.id} p={p} selection={selection} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            ))}

            {/* dependency edges overlay */}
            <svg
              className="rm-tl-edges"
              style={{
                left: LANE_LABEL_W,
                top: RULER_H,
                width: model.chartW,
                height: model.totalH - RULER_H,
              }}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="rm-tl-arrow"
                  viewBox="0 0 10 10"
                  refX={8}
                  refY={5}
                  markerWidth={8}
                  markerHeight={8}
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" className="rm-tl-arrow" />
                </marker>
                <marker
                  id="rm-tl-arrow-crit"
                  viewBox="0 0 10 10"
                  refX={8}
                  refY={5}
                  markerWidth={8}
                  markerHeight={8}
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 0 1 L 8 5 L 0 9 z" className="rm-tl-arrow-crit" />
                </marker>
              </defs>
              {model.edgePaths.map((e) => (
                <path
                  key={e.id}
                  d={e.d}
                  className={`rm-tl-edge${e.crit ? ' crit' : ''}`}
                  markerEnd={`url(#${e.crit ? 'rm-tl-arrow-crit' : 'rm-tl-arrow'})`}
                />
              ))}
            </svg>
          </div>
        </div>

        {/* day-width zoom */}
        <div className="rm-tl-zoom" role="group" aria-label="Timeline zoom, pixels per day">
          <span>day</span>
          {(Object.keys(DAY_WIDTHS) as ZoomId[]).map((z) => (
            <button
              key={z}
              type="button"
              className={dayW === DAY_WIDTHS[z] ? 'on' : ''}
              onClick={() => setDayW(DAY_WIDTHS[z])}
              title={`${DAY_WIDTHS[z]} px per day`}
            >
              {z}
            </button>
          ))}
        </div>

        {!roadmap.nodes.length && (
          <div className="rm-canvas-hint rm-tl-empty">
            <div>
              <div className="rm-hint-title">Nothing on the timeline yet</div>
              Add nodes on the canvas first — dated and estimated nodes land here
              on the day they are expected.
            </div>
          </div>
        )}
      </div>
    );
  }
);

/* ---------- node pill ---------- */

function TimelinePill({
  p,
  selection,
  onSelect,
}: {
  p: Placed;
  selection: RmSelection | null;
  onSelect: (sel: RmSelection | null) => void;
}) {
  const Icon = RM_KIND_ICON[p.node.kind];
  const done = !!p.live?.done;
  const selected = selection?.kind === 'node' && selection.id === p.node.id;
  const cls = [
    'rm-tl-pill',
    p.node.kind === 'milestone' ? 'ms' : '',
    p.sim ? 'sim' : '',
    done ? 'done' : '',
    p.critical && !done ? 'critical' : '',
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={{ left: p.x, top: p.y, width: PILL_W }}
      role="button"
      tabIndex={0}
      aria-label={`${p.node.kind}${p.sim ? ', estimated ' : ', '}${p.date}: ${p.title}`}
      title={`${p.title} — ${p.date}${p.sim ? ' (estimated from remaining estimates)' : ''}`}
      onClick={() => onSelect({ kind: 'node', id: p.node.id })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect({ kind: 'node', id: p.node.id });
        }
      }}
    >
      <span className={`rm-tl-pill-ico${done ? ' done' : ''}`}>
        <Icon />
      </span>
      <span className="rm-tl-pill-title">{p.title}</span>
      {p.blocked && !done && (
        <AlertTriangle size={11} className="rm-tl-pill-warn" aria-label="waiting on an unfinished node" />
      )}
      {done && <Check size={12} className="rm-tl-pill-check" />}
      <span className={`rm-tl-pill-date mono rm-dl-${p.tone ?? 'ok'}`}>
        {p.sim ? '≈' : ''}
        {p.date.slice(5)}
      </span>
      {p.node.refId && (
        <button
          type="button"
          className="rm-tl-pill-open"
          title="Open the linked goal, task or file"
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent(p.node.kind === 'file' ? 'wb-open-reader' : 'wb-open-item', {
                detail: p.node.refId,
              })
            );
          }}
        >
          Open
        </button>
      )}
      {p.pct >= 0 && (
        <span className="rm-tl-pill-bar">
          <span style={{ width: `${clamp(p.pct, 0, 100)}%` }} />
        </span>
      )}
    </div>
  );
}

export default RoadmapTimeline;
