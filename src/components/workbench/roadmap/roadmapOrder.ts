/* ==================== Workbench Aurora — Roadmap order helpers ====================
   Pure module-scope functions shared by RoadmapView (list + canvas workspace +
   execution order panel) and RoadmapTimeline. No React, no store state reads —
   everything takes its data as arguments, so it is compiler-safe by construction. */

import { wbTimeboxedItems } from '@/lib/workbench/store';
import { plannedStartToMin } from '@/lib/workbench/helpers';
import type { FilePlanBlock, Item, Roadmap, RoadmapNode } from '@/lib/workbench/types';
import { topoOrder, type RmNodeLive } from './RoadmapCanvas';

/* ---------- progress ---------- */

export function roadmapProgress(rm: Roadmap, liveMap: Map<string, RmNodeLive>): number {
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

/* ---------- execution order (topological rows + cumulative time + critical path) ---------- */

export interface OrderRow {
  id: string;
  idx: number;
  node: RoadmapNode;
  live: RmNodeLive | undefined;
  est: number;
  cum: number;
  blocked: boolean;
}

export interface OrderInfo {
  rows: OrderRow[];
  totalEst: number;
  critical: Set<string>;
  /** total estimate of the longest chain (0 when there is no timed path) */
  criticalEst: number;
}

export function computeOrder(roadmap: Roadmap, liveMap: Map<string, RmNodeLive>): OrderInfo {
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

  return { rows, totalEst: cum, critical, criticalEst: critical.size ? max : 0 };
}

/* ---------- next up: first unfinished node in execution order ---------- */

export function nextUpRow(rows: OrderRow[]): OrderRow | null {
  for (const r of rows) {
    if (r.node.kind === 'note') continue;
    if (r.live && r.live.status !== 'done') return r;
  }
  return null;
}

/* ---------- planner bridge: first free 30m slot on a date ---------- */
/** Busyness = timeboxed items (plannedStart..plannedEnd) + file plan blocks. */
export function findFreeSlot(
  items: Item[],
  filePlans: FilePlanBlock[],
  date: string,
  minutes = 30
): number | null {
  const busy: Array<[number, number]> = [];
  wbTimeboxedItems(items, date).forEach((i) => {
    if (!i.plannedStart || !i.plannedEnd) return;
    busy.push([plannedStartToMin(i.plannedStart), plannedStartToMin(i.plannedEnd)]);
  });
  filePlans.forEach((p) => {
    if (p.date === date) busy.push([p.startMin, p.startMin + p.minutes]);
  });
  for (let t = 540; t + minutes <= 1260; t += 15) {
    // 09:00 stepping 15m, never past 21:00
    if (!busy.some(([s, e]) => t < e && t + minutes > s)) return t;
  }
  return null;
}
