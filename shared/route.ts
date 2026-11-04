// Automatic route planning around land the player has discovered.
//
// This module is deliberately pure: it receives a `knownLand` predicate and
// never reads the real land lookup itself. Undiscovered ground is therefore
// optimistic sea, as the fog-of-war rules require.

import { MAP_HEIGHT_KM, MAP_WIDTH_KM, isInsideMapFrame, type MapPoint } from "./map.js";
import { settings } from "./settings.js";

export const ROUTE_NO_KNOWN = "No known route. Explore further.";
export const ROUTE_LAND = "That is land.";
export const ROUTE_NEAREST_SEA = "That is land. Sailing to the nearest sea point.";
export const ROUTE_OUTSIDE = "That is outside the chart.";

export type RouteStatus = "ok" | "partial" | "land" | "none";

export interface RoutePlan {
  status: RouteStatus;
  /** Points after the start, ending at the destination when it is reachable. */
  waypoints: MapPoint[];
  message: string | null;
  gridKm: number;
  /** Expanded search nodes, for the performance report. */
  nodes: number;
}

export interface RouteOptions {
  start: MapPoint;
  goal: MapPoint;
  knownLand: (x: number, y: number) => boolean;
  isInside?: (x: number, y: number) => boolean;
  gridKm?: number;
  clearanceKm?: number;
  minimumClearanceKm?: number;
  /** Upper edge of the soft clearance band. */
  softClearanceKm?: number;
  /** Multiplier on the soft-band cost. */
  softClearanceWeight?: number;
  marginKm?: number;
  maxNodes?: number;
  maxWaypoints?: number;
  /** Start and destination are allowed this close to known land. */
  terminalClearanceKm?: number;
}

interface SearchOptions extends RouteOptions {
  gridKm: number;
  marginKm: number;
  maxNodes: number;
  clearanceKm: number;
  minimumClearanceKm: number;
  softClearanceKm: number;
  softClearanceWeight: number;
  terminalClearanceKm: number;
  maxWaypoints: number;
  isInside: (x: number, y: number) => boolean;
}

interface GridNode {
  key: string;
  column: number;
  row: number;
  x: number;
  y: number;
  g: number;
  f: number;
  h: number;
  parent: GridNode | null;
  closed: boolean;
}

class MinHeap {
  private items: GridNode[] = [];

  push(node: GridNode): void {
    this.items.push(node);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[parent]!, this.items[index]!) <= 0) break;
      [this.items[parent], this.items[index]] = [this.items[index]!, this.items[parent]!];
      index = parent;
    }
  }

  pop(): GridNode | undefined {
    if (this.items.length === 0) return undefined;
    const first = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.compare(this.items[left]!, this.items[smallest]!) < 0) {
          smallest = left;
        }
        if (right < this.items.length && this.compare(this.items[right]!, this.items[smallest]!) < 0) {
          smallest = right;
        }
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest]!, this.items[index]!];
        index = smallest;
      }
    }
    return first;
  }

  get size(): number {
    return this.items.length;
  }

  private compare(a: GridNode, b: GridNode): number {
    return a.f - b.f || a.h - b.h || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nodeKey(column: number, row: number): string {
  return `${column}_${row}`;
}

/** A point on the global planner grid. */
function gridPoint(column: number, row: number, gridKm: number): MapPoint {
  return { x: column * gridKm, y: row * gridKm };
}

/** True when the straight segment crosses known land. */
export function routeSegmentClear(
  from: MapPoint,
  to: MapPoint,
  knownLand: (x: number, y: number) => boolean,
): boolean {
  if (knownLand(from.x, from.y) || knownLand(to.x, to.y)) return false;
  const length = distance(from, to);
  const steps = Math.max(1, Math.ceil(length / 1));
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    if (knownLand(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) {
      return false;
    }
  }
  return true;
}

/** True when a segment keeps the preferred clearance, except at its ends. */
export function routeSegmentHasClearance(
  from: MapPoint,
  to: MapPoint,
  knownLand: (x: number, y: number) => boolean,
  clearanceKm: number,
  terminalKm = 0,
): boolean {
  const length = distance(from, to);
  const steps = Math.max(1, Math.ceil(length / 1));
  for (let index = 0; index <= steps; index += 1) {
    const along = (index / steps) * length;
    if (along <= terminalKm || length - along <= terminalKm) continue;
    const t = index / steps;
    if (!hasRouteClearance(
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      knownLand,
      clearanceKm,
    )) return false;
  }
  return true;
}

/** A turn that is sharper than 120 degrees inside a ten-kilometre window. */
export function routeHasReversal(
  start: MapPoint,
  points: readonly MapPoint[],
  windowKm = 10,
  maxTurnDeg = 120,
): boolean {
  let previous = start;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = previous;
    const b = points[index]!;
    const c = points[index + 1]!;
    const first = { x: b.x - a.x, y: b.y - a.y };
    const second = { x: c.x - b.x, y: c.y - b.y };
    const firstLength = Math.hypot(first.x, first.y);
    const secondLength = Math.hypot(second.x, second.y);
    if (firstLength + secondLength <= windowKm && firstLength > 1e-6 && secondLength > 1e-6) {
      const dot = (first.x * second.x + first.y * second.y) / (firstLength * secondLength);
      const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      if (angle > maxTurnDeg) return true;
    }
    previous = b;
  }
  return false;
}

/** Remove sharp little dog-legs when a direct replacement keeps clearance. */
function removeReversals(
  start: MapPoint,
  points: readonly MapPoint[],
  knownLand: (x: number, y: number) => boolean,
  clearanceKm: number,
): MapPoint[] {
  const out = [...points];
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let index = 0; index + 1 < out.length; index += 1) {
      const a = index === 0 ? start : out[index - 1]!;
      const b = out[index]!;
      const c = out[index + 1]!;
      const first = { x: b.x - a.x, y: b.y - a.y };
      const second = { x: c.x - b.x, y: c.y - b.y };
      const firstLength = Math.hypot(first.x, first.y);
      const secondLength = Math.hypot(second.x, second.y);
      if (firstLength + secondLength > 10 || firstLength < 1e-6 || secondLength < 1e-6) continue;
      const dot = (first.x * second.x + first.y * second.y) / (firstLength * secondLength);
      const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      if (angle <= 120) continue;
      if (!routeSegmentClear(a, c, knownLand)) continue;
      if (!routeSegmentHasClearance(a, c, knownLand, clearanceKm, 0)) continue;
      out.splice(index, 1);
      changed = true;
      break;
    }
  }
  return out;
}

/**
 * Round every waypoint with a circular fillet of at least the requested
 * radius. A blocked fillet falls back to the original corner, so the caller
 * can still see and re-plan it rather than cutting across land.
 */
export function smoothRoute(
  start: MapPoint,
  waypoints: readonly MapPoint[],
  blocked: (x: number, y: number) => boolean = () => false,
  minRadiusKm = 1,
): MapPoint[] {
  const points = [start, ...waypoints];
  if (points.length < 3) return points;
  const out: MapPoint[] = [points[0]!];

  for (let index = 1; index + 1 < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const c = points[index + 1]!;
    const u = { x: b.x - a.x, y: b.y - a.y };
    const v = { x: c.x - b.x, y: c.y - b.y };
    const firstLength = Math.hypot(u.x, u.y);
    const secondLength = Math.hypot(v.x, v.y);
    if (firstLength < 1e-6 || secondLength < 1e-6) continue;
    u.x /= firstLength;
    u.y /= firstLength;
    v.x /= secondLength;
    v.y /= secondLength;
    const cross = u.x * v.y - u.y * v.x;
    const dot = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y));
    const turn = Math.atan2(cross, dot);
    if (Math.abs(turn) < 1e-3) {
      out.push(b);
      continue;
    }

    const radius = Math.max(0.25, minRadiusKm);
    const tangent = Math.min(radius * Math.tan(Math.abs(turn) / 2), firstLength * 0.45, secondLength * 0.45);
    const actualRadius = tangent / Math.tan(Math.abs(turn) / 2);
    const p1 = { x: b.x - u.x * tangent, y: b.y - u.y * tangent };
    const p2 = { x: b.x + v.x * tangent, y: b.y + v.y * tangent };
    const left = { x: -u.y, y: u.x };
    const direction = Math.sign(turn);
    const centre = {
      x: p1.x + left.x * actualRadius * direction,
      y: p1.y + left.y * actualRadius * direction,
    };
    const startAngle = Math.atan2(p1.y - centre.y, p1.x - centre.x);
    const samples = Math.max(2, Math.ceil((actualRadius * Math.abs(turn)) / 0.75));
    const arc: MapPoint[] = [];
    for (let sample = 0; sample <= samples; sample += 1) {
      const angle = startAngle + turn * (sample / samples);
      arc.push({
        x: centre.x + Math.cos(angle) * actualRadius,
        y: centre.y + Math.sin(angle) * actualRadius,
      });
    }
    if (arc.some((point) => blocked(point.x, point.y))) {
      out.push(b);
      continue;
    }
    out.push(...arc);
  }

  const last = points[points.length - 1]!;
  const previous = out[out.length - 1]!;
  if (distance(previous, last) > 1e-6) out.push(last);
  return out;
}

/** Resample a smooth route at a fixed spacing, with a hard point ceiling. */
export function sampleRouteCurve(
  points: readonly MapPoint[],
  spacingKm: number,
  maxPoints: number,
): MapPoint[] {
  if (points.length <= 1 || maxPoints < 2) return points.map((point) => ({ ...point }));
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1]!, points[index]!);
  }
  if (total <= 1e-9) return [{ ...points[0]! }];

  const step = Math.max(spacingKm, total / (maxPoints - 1));
  const out: MapPoint[] = [{ ...points[0]! }];
  let segment = 0;
  let segmentStart = 0;
  for (let at = step; at < total; at += step) {
    while (
      segment + 1 < points.length - 1 &&
      segmentStart + distance(points[segment]!, points[segment + 1]!) < at
    ) {
      segmentStart += distance(points[segment]!, points[segment + 1]!);
      segment += 1;
    }
    const from = points[segment]!;
    const to = points[segment + 1] ?? from;
    const segmentLength = distance(from, to);
    const share = segmentLength > 1e-9 ? (at - segmentStart) / segmentLength : 0;
    out.push({
      x: from.x + (to.x - from.x) * share,
      y: from.y + (to.y - from.y) * share,
    });
  }
  const last = points[points.length - 1]!;
  if (distance(out[out.length - 1]!, last) > 1e-6) out.push({ ...last });
  return out;
}

/** Drop the part of a route the ship has already passed. */
export function remainingRouteCurve(
  points: readonly MapPoint[],
  ship: MapPoint,
): MapPoint[] {
  if (points.length === 0) return [];
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const distanceToShip = (point.x - ship.x) ** 2 + (point.y - ship.y) ** 2;
    if (distanceToShip < bestDistance) {
      bestDistance = distanceToShip;
      bestIndex = index;
    }
  }
  return points.slice(bestIndex).map((point) => ({ ...point }));
}

// Clearance probes are computed once; these run for every A* node. Sixteen
// directions catch narrow points between the old eight compass rays; the
// exact segment check below still rejects every land crossing on the route.
const CLEARANCE_PROBES = Array.from({ length: 16 }, (_, index) => {
  const angle = (index / 16) * Math.PI * 2;
  return { dx: Math.sin(angle), dy: -Math.cos(angle) };
});

/** True when no known land lies within the preferred clearance radius. */
export function hasRouteClearance(
  point: MapPoint,
  knownLand: (x: number, y: number) => boolean,
  clearanceKm: number,
): boolean {
  if (knownLand(point.x, point.y)) return false;
  for (const probe of CLEARANCE_PROBES) {
    if (knownLand(point.x + probe.dx * clearanceKm, point.y + probe.dy * clearanceKm)) {
      return false;
    }
  }
  return true;
}

function routeClearancePenalty(
  point: MapPoint,
  knownLand: (x: number, y: number) => boolean,
  clearanceKm: number,
  softClearanceKm: number,
  weight: number,
): number {
  if (softClearanceKm <= clearanceKm) return 0;
  let penalty = 0;
  const rings = 4;
  for (let ring = 0; ring < rings; ring += 1) {
    const radius = clearanceKm + ((softClearanceKm - clearanceKm) * (ring + 1)) / rings;
    for (const probe of CLEARANCE_PROBES) {
      if (!knownLand(point.x + probe.dx * radius, point.y + probe.dy * radius)) continue;
      const closeness = 1 - (radius - clearanceKm) / (softClearanceKm - clearanceKm);
      penalty = Math.max(penalty, weight * closeness);
    }
  }
  return penalty;
}

function safePoint(
  point: MapPoint,
  search: SearchOptions,
  terminalRadius: number,
): boolean {
  if (!search.isInside(point.x, point.y)) return false;
  if (search.knownLand(point.x, point.y)) return false;
  if (distance(point, search.start) <= terminalRadius || distance(point, search.goal) <= terminalRadius) {
    return true;
  }
  return hasRouteClearance(
    point,
    search.knownLand,
    Math.min(search.clearanceKm, search.minimumClearanceKm),
  );
}

/** The nearest safe grid intersection, with a small terminal exemption. */
function nearestGridNode(
  point: MapPoint,
  search: SearchOptions,
  terminalRadius: number,
  endpoint: "start" | "goal",
): GridNode | null {
  const baseColumn = Math.round(point.x / search.gridKm);
  const baseRow = Math.round(point.y / search.gridKm);
  let best: GridNode | null = null;
  let bestDistance = Infinity;

  for (let rowOffset = -3; rowOffset <= 3; rowOffset += 1) {
    for (let columnOffset = -3; columnOffset <= 3; columnOffset += 1) {
      const column = baseColumn + columnOffset;
      const row = baseRow + rowOffset;
      const candidate = gridPoint(column, row, search.gridKm);
      const d = distance(point, candidate);
      if (d >= bestDistance || d > search.gridKm * 3.5) continue;
      if (!safePoint(candidate, search, terminalRadius)) continue;
      const clear = endpoint === "start"
        ? routeSegmentClear(point, candidate, search.knownLand)
        : routeSegmentClear(candidate, point, search.knownLand);
      if (!clear) continue;
      bestDistance = d;
      best = {
        key: nodeKey(column, row),
        column,
        row,
        x: candidate.x,
        y: candidate.y,
        g: 0,
        f: 0,
        h: 0,
        parent: null,
        closed: false,
      };
    }
  }
  return best;
}

interface SearchResult {
  path: MapPoint[];
  reachedGoal: boolean;
  bestPath: MapPoint[];
  nodes: number;
  limitHit: boolean;
  boundsHit: boolean;
}

function searchGrid(search: SearchOptions): SearchResult {
  const terminalRadius = Math.max(search.terminalClearanceKm, search.gridKm * 2);
  const startNode = nearestGridNode(search.start, search, terminalRadius, "start");
  const goalNode = nearestGridNode(search.goal, search, terminalRadius, "goal");
  if (!startNode || !goalNode) {
    return {
      path: [],
      reachedGoal: false,
      bestPath: [],
      nodes: 0,
      limitHit: false,
      boundsHit: false,
    };
  }

  const margin = search.marginKm;
  const minX = Math.max(0, Math.min(search.start.x, search.goal.x) - margin);
  const maxX = Math.min(MAP_WIDTH_KM, Math.max(search.start.x, search.goal.x) + margin);
  const minY = Math.max(0, Math.min(search.start.y, search.goal.y) - margin);
  const maxY = Math.min(MAP_HEIGHT_KM, Math.max(search.start.y, search.goal.y) + margin);
  const minColumn = Math.floor(minX / search.gridKm) - 1;
  const maxColumn = Math.ceil(maxX / search.gridKm) + 1;
  const minRow = Math.floor(minY / search.gridKm) - 1;
  const maxRow = Math.ceil(maxY / search.gridKm) + 1;

  const open = new MinHeap();
  const nodes = new Map<string, GridNode>();
  startNode.h = distance(startNode, search.goal);
  startNode.f = startNode.h;
  open.push(startNode);
  nodes.set(startNode.key, startNode);

  let best: GridNode = startNode;
  let bestH = startNode.h;
  let expanded = 0;
  let limitHit = false;
  let boundsHit = false;
  const safety = new Map<string, boolean>();
  const isSafe = (point: MapPoint): boolean => {
    const key = nodeKey(Math.round(point.x / search.gridKm), Math.round(point.y / search.gridKm));
    const cached = safety.get(key);
    if (cached !== undefined) return cached;
    const safe = safePoint(point, search, terminalRadius);
    safety.set(key, safe);
    return safe;
  };
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ] as const;

  while (open.size > 0) {
    const current = open.pop()!;
    if (current.closed) continue;
    current.closed = true;
    expanded += 1;

    if (current.h < bestH || (current.h === bestH && current.g > best.g)) {
      best = current;
      bestH = current.h;
    }

    if (
      current.key === goalNode.key ||
      (current.h <= search.gridKm * 1.5 &&
        routeSegmentClear(current, search.goal, search.knownLand))
    ) {
      const path = reconstruct(current, search.start);
      return {
        path,
        reachedGoal: true,
        bestPath: path,
        nodes: expanded,
        limitHit: false,
        boundsHit,
      };
    }

    if (expanded >= search.maxNodes) {
      limitHit = true;
      break;
    }

    for (const [dc, dr] of directions) {
      const column = current.column + dc;
      const row = current.row + dr;
      if (column < minColumn || column > maxColumn || row < minRow || row > maxRow) {
        const x = column * search.gridKm;
        const y = row * search.gridKm;
        if (search.isInside(x, y)) boundsHit = true;
        continue;
      }
      const point = gridPoint(column, row, search.gridKm);
      if (!isSafe(point)) continue;
      if (!routeSegmentClear(current, point, search.knownLand)) continue;

      const key = nodeKey(column, row);
      const existing = nodes.get(key);
      const step = distance(current, point);
      const g = current.g +
        step *
          (1 + routeClearancePenalty(
            point,
            search.knownLand,
            search.clearanceKm,
            search.softClearanceKm,
            search.softClearanceWeight,
          ));
      if (existing && existing.g <= g) continue;

      const next: GridNode = existing ?? {
        key,
        column,
        row,
        x: point.x,
        y: point.y,
        g: 0,
        f: 0,
        h: 0,
        parent: null,
        closed: false,
      };
      next.g = g;
      next.h = distance(point, search.goal);
      // Slightly weighted A*: routes stay sensible but the search visits far
      // fewer nodes around long coastlines. The saved path is still checked
      // segment by segment against known land before it is returned.
      next.f = g + next.h * 1.3;
      next.parent = current;
      next.closed = false;
      nodes.set(key, next);
      open.push(next);
    }
  }

  const bestPath = best === startNode ? [] : reconstruct(best, search.start);
  return {
    path: [],
    reachedGoal: false,
    bestPath,
    nodes: expanded,
    limitHit,
    boundsHit,
  };
}

function reconstruct(node: GridNode, start: MapPoint): MapPoint[] {
  const points: MapPoint[] = [];
  let current: GridNode | null = node;
  while (current) {
    points.push({ x: current.x, y: current.y });
    current = current.parent;
  }
  points.reverse();
  const first = points[0];
  if (!first || distance(first, start) > 1e-6) points.unshift({ x: start.x, y: start.y });
  return points;
}

/** Remove redundant points using line of sight over known land only. */
function simplifyPath(
  points: readonly MapPoint[],
  knownLand: (x: number, y: number) => boolean,
  maxWaypoints: number,
  clearanceKm: number,
  terminalClearanceKm: number,
): MapPoint[] {
  if (points.length <= 2) return points.slice(1);
  const result: MapPoint[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (
      next > anchor + 1 &&
      (!routeSegmentClear(points[anchor]!, points[next]!, knownLand) ||
        !routeSegmentHasClearance(
          points[anchor]!,
          points[next]!,
          knownLand,
          clearanceKm,
          terminalClearanceKm,
        ))
    ) {
      next -= 1;
    }
    if (next === anchor) next += 1;
    result.push(points[next]!);
    anchor = next;
  }
  return result.slice(0, maxWaypoints);
}

function withGoal(
  path: readonly MapPoint[],
  goal: MapPoint,
  knownLand: (x: number, y: number) => boolean,
): MapPoint[] {
  if (path.length === 0) return [];
  const last = path[path.length - 1]!;
  if (distance(last, goal) < 1e-6) return [...path];
  if (!routeSegmentClear(last, goal, knownLand)) return [...path];
  return [...path, { x: goal.x, y: goal.y }];
}

/** Plan one route, growing the search box and falling back to a coarser grid. */
export function planRoute(options: RouteOptions): RoutePlan {
  const baseGrid = options.gridKm ?? settings.route.gridKm;
  const clearanceKm = options.clearanceKm ?? settings.route.clearanceKm;
  const minimumClearanceKm =
    options.minimumClearanceKm ?? settings.route.minimumClearanceKm;
  const softClearanceKm =
    options.softClearanceKm ?? settings.route.softClearanceKm;
  const softClearanceWeight =
    options.softClearanceWeight ?? settings.route.softClearanceWeight;
  const terminalClearanceKm =
    options.terminalClearanceKm ?? settings.route.terminalClearanceKm;
  const maxWaypoints = options.maxWaypoints ?? settings.route.maxWaypoints;
  const maxNodes = options.maxNodes ?? settings.route.maxNodes;
  const baseMargin = options.marginKm ?? settings.route.searchMarginKm;
  const isInside = options.isInside ??
    ((x: number, y: number) => isInsideMapFrame(x, y));

  if (!isInside(options.goal.x, options.goal.y)) {
    return { status: "none", waypoints: [], message: ROUTE_OUTSIDE, gridKm: baseGrid, nodes: 0 };
  }
  if (options.knownLand(options.goal.x, options.goal.y)) {
    return { status: "land", waypoints: [], message: ROUTE_LAND, gridKm: baseGrid, nodes: 0 };
  }
  if (
    routeSegmentClear(options.start, options.goal, options.knownLand) &&
    routeSegmentHasClearance(
      options.start,
      options.goal,
      options.knownLand,
      Math.min(clearanceKm, minimumClearanceKm),
      terminalClearanceKm,
    )
  ) {
    return {
      status: "ok",
      waypoints: [{ x: options.goal.x, y: options.goal.y }],
      message: null,
      gridKm: baseGrid,
      nodes: 0,
    };
  }

  let nodes = 0;
  let gridKm = baseGrid;
  let bestPartial: MapPoint[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let limitSeen = false;
    for (
      let margin = baseMargin;
      margin <= Math.max(baseMargin, settings.route.maxSearchMarginKm);
      margin *= 2
    ) {
      const result = searchGrid({
        ...options,
        isInside,
        gridKm,
        marginKm: margin,
        maxNodes,
        clearanceKm,
        minimumClearanceKm,
        softClearanceKm,
        softClearanceWeight,
        terminalClearanceKm,
        maxWaypoints,
      });
      nodes += result.nodes;
      if (result.reachedGoal) {
        const path = withGoal(result.path, options.goal, options.knownLand);
        const simplified = simplifyPath(
          path,
          options.knownLand,
          maxWaypoints,
          Math.min(clearanceKm, minimumClearanceKm),
          terminalClearanceKm,
        );
        return {
          status: "ok",
          waypoints: removeReversals(
            options.start,
            simplified,
            options.knownLand,
            Math.min(clearanceKm, minimumClearanceKm),
          ),
          message: null,
          gridKm,
          nodes,
        };
      }
      if (result.bestPath.length > bestPartial.length) bestPartial = result.bestPath;
      if (result.limitHit) limitSeen = true;
      if (!result.limitHit && !result.boundsHit) break;
      if (margin >= settings.route.maxSearchMarginKm) break;
    }

    if (attempt === 0 && limitSeen) {
      gridKm = settings.route.coarseGridKm;
      if (gridKm === baseGrid) gridKm = baseGrid * 2;
      continue;
    }
    break;
  }

  const waypoints = bestPartial.length > 1
    ? removeReversals(
        options.start,
        simplifyPath(
          withGoal(bestPartial, options.goal, options.knownLand),
          options.knownLand,
          maxWaypoints,
          Math.min(clearanceKm, minimumClearanceKm),
          terminalClearanceKm,
        ),
        options.knownLand,
        Math.min(clearanceKm, minimumClearanceKm),
      )
    : [];
  return {
    status: "partial",
    waypoints,
    message: ROUTE_NO_KNOWN,
    gridKm,
    nodes,
  };
}

/**
 * Walk outwards from a known-land destination until a sea point is found.
 * Used when land appears where the player originally ordered the ship.
 */
export function nearestSeaPoint(
  point: MapPoint,
  knownLand: (x: number, y: number) => boolean,
  maxKm = 80,
  isInside: (x: number, y: number) => boolean = isInsideMapFrame,
): MapPoint | null {
  if (!knownLand(point.x, point.y) && isInside(point.x, point.y)) {
    return { x: point.x, y: point.y };
  }
  for (let radius = settings.route.gridKm; radius <= maxKm; radius += settings.route.gridKm) {
    const steps = Math.max(12, Math.ceil((Math.PI * 2 * radius) / settings.route.gridKm));
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const candidate = {
        x: point.x + Math.sin(angle) * radius,
        y: point.y - Math.cos(angle) * radius,
      };
      if (!isInside(candidate.x, candidate.y)) continue;
      if (knownLand(candidate.x, candidate.y)) continue;
      return candidate;
    }
  }
  return null;
}
