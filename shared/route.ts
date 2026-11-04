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

// Clearance probes are computed once; these run for every A* node. Eight
// compass directions keep the 3 km clearance check cheap; the exact segment
// check below still rejects every land crossing on the route itself.
const CLEARANCE_PROBES = Array.from({ length: 8 }, (_, index) => {
  const angle = (index / 8) * Math.PI * 2;
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
  return hasRouteClearance(point, search.knownLand, search.clearanceKm);
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
      const g = current.g + step;
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
): MapPoint[] {
  if (points.length <= 2) return points.slice(1);
  const result: MapPoint[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (
      next > anchor + 1 &&
      !routeSegmentClear(points[anchor]!, points[next]!, knownLand)
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
  if (routeSegmentClear(options.start, options.goal, options.knownLand)) {
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
        terminalClearanceKm,
        maxWaypoints,
      });
      nodes += result.nodes;
      if (result.reachedGoal) {
        const path = withGoal(result.path, options.goal, options.knownLand);
        return {
          status: "ok",
          waypoints: simplifyPath(path, options.knownLand, maxWaypoints),
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
    ? simplifyPath(withGoal(bestPartial, options.goal, options.knownLand), options.knownLand, maxWaypoints)
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
