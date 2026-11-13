// Full predicted route paths. The ghost runs the same stepShip function as the
// real ship. A job can be advanced a little each server tick so the client
// keeps the old line until the new one is complete.

import { routeLookAheadPoint } from "./route.js";
import { settings } from "./settings.js";
import {
  shipSpecFor,
  stepShip,
  type Ship,
  type ShipRoute,
  type ShipSpec,
} from "./sailing.js";
import { shipPerformance } from "./combat.js";
import type { MapPoint } from "./map.js";

export interface PredictedPath {
  points: MapPoint[];
  steps: number;
  simulatedSeconds: number;
  /** True when the ghost could not reach the goal inside the safety horizon. */
  truncated: boolean;
  reached: boolean;
}

export interface PredictionJob {
  points: MapPoint[];
  elapsed: number;
  steps: number;
  done: boolean;
  reached: boolean;
  truncated: boolean;
  ghost: Ship;
  route: ShipRoute;
  windFromDeg: number;
  spec: ShipSpec;
}

function cloneShip(ship: Ship): Ship {
  return {
    ...ship,
    order: null,
    helmTarget: undefined,
    route: null,
    stationSpeedLimit: undefined,
    formationStation: false,
    boardingPowerKnots: undefined,
    boardingForcedHeadingRad: undefined,
    runState: undefined,
    coastEscapeHeadingRad: null,
    tackLine: undefined,
    tackCooldownSeconds: 0,
    tackManoeuvreSeconds: 0,
    tackHoldSign: undefined,
  };
}

/** Perpendicular-distance simplification (Ramer-Douglas-Peucker). */
export function simplifyPath(points: readonly MapPoint[], toleranceKm: number): MapPoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const a = points[first]!;
    const b = points[last]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    let best = -1;
    let bestDistance = toleranceKm;
    for (let index = first + 1; index < last; index += 1) {
      const point = points[index]!;
      const distance = length < 1e-9
        ? Math.hypot(point.x - a.x, point.y - a.y)
        : Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([first, best], [best, last]);
    }
  }
  return points.filter((_, index) => keep[index] === 1).map((point) => ({ ...point }));
}

/**
 * Keep more samples near the ship: the first half of the points get twice the
 * share of the 400-point budget. Both ends are always preserved.
 */
export function predictionSendPoints(points: readonly MapPoint[]): MapPoint[] {
  const limit = settings.route.predictionMaxPoints;
  if (points.length <= limit) return points.map((point) => ({ ...point }));
  const half = Math.floor(points.length / 2);
  const nearLimit = Math.min(limit - 1, Math.ceil(limit * 2 / 3));
  const farLimit = Math.max(1, limit - nearLimit);
  const sample = (from: number, to: number, count: number): MapPoint[] => {
    const result: MapPoint[] = [];
    const stride = Math.max(1, Math.ceil((to - from) / Math.max(1, count)));
    for (let index = from; index < to; index += stride) result.push({ ...points[index]! });
    return result;
  };
  const near = sample(0, half, nearLimit);
  const far = sample(half, points.length, farLimit);
  const last = points[points.length - 1]!;
  const combined = [...near, ...far];
  if (combined[combined.length - 1]!.x !== last.x || combined[combined.length - 1]!.y !== last.y) {
    if (combined.length >= limit) combined.pop();
    combined.push({ ...last });
  }
  return combined;
}

/** Create a lazy ghost job. No step has run yet. */
export function createPredictionJob(
  ship: Ship,
  route: ShipRoute,
  windFromDeg: number,
): PredictionJob {
  const ghost = cloneShip(ship);
  return {
    points: [{ x: ghost.x, y: ghost.y }],
    elapsed: 0,
    steps: 0,
    done: false,
    reached: false,
    truncated: false,
    ghost,
    route,
    windFromDeg,
    spec: shipSpecFor(ghost),
  };
}

function nextAim(job: PredictionJob): { x: number; y: number } | null {
  const { ghost, route } = job;
  if (Math.hypot(ghost.x - route.goal.x, ghost.y - route.goal.y) <=
    settings.sailing.arrivalRadiusKm) return null;
  const path = route.curve && route.curve.length > 1 ? route.curve : route.waypoints;
  const aim = routeLookAheadPoint(path, ghost, settings.route.steerLookAheadKm);
  if (!aim || Math.hypot(aim.x - ghost.x, aim.y - ghost.y) <
    settings.sailing.minOrderDistanceKm) return null;
  return aim;
}

/** Advance one or more steps. Returns true when the job finishes. */
export function advancePredictionJob(
  job: PredictionJob,
  maxMilliseconds = Number.POSITIVE_INFINITY,
  maxSteps = Number.POSITIVE_INFINITY,
): boolean {
  const started = Date.now();
  const performanceData = shipPerformance(job.spec, job.ghost.damage, job.windFromDeg);
  let stepsThisCall = 0;
  while (!job.done) {
    if (stepsThisCall >= maxSteps) break;
    if (job.steps > 0 && Date.now() - started >= maxMilliseconds) break;
    if (!job.ghost.order) {
      const aim = nextAim(job);
      if (!aim) {
        job.reached = true;
        job.done = true;
        break;
      }
      job.ghost.tackLine ??= {
        startX: job.ghost.x,
        startY: job.ghost.y,
        targetX: job.route.goal.x,
        targetY: job.route.goal.y,
      };
      job.ghost.order = { type: "sailTo", x: aim.x, y: aim.y };
      job.ghost.arrived = false;
    }
    const step = job.elapsed < settings.route.predictionFineGameMinutes * 60
      ? settings.route.predictionStepGameSeconds
      : Math.max(
          settings.route.predictionStepGameSeconds,
          settings.route.predictionCoarseStepGameSeconds,
        );
    stepShip(job.ghost, step, job.windFromDeg, undefined, undefined, undefined, undefined, false, {
      spec: job.spec,
      performance: performanceData,
    });
    job.elapsed += step;
    job.steps += 1;
    stepsThisCall += 1;
    job.points.push({ x: job.ghost.x, y: job.ghost.y });
    if (!job.ghost.order) {
      if (Math.hypot(job.ghost.x - job.route.goal.x, job.ghost.y - job.route.goal.y) <=
        settings.sailing.arrivalRadiusKm) {
        job.reached = true;
        job.done = true;
        break;
      }
      if (job.elapsed > settings.route.predictionMaxGameHours * 3600) {
        job.truncated = true;
        job.done = true;
        break;
      }
    }
    if (job.elapsed > settings.route.predictionMaxGameHours * 3600) {
      job.truncated = true;
      job.done = true;
      break;
    }
  }
  return job.done;
}

export function jobPath(job: PredictionJob): PredictedPath {
  return {
    points: predictionSendPoints(job.points),
    steps: job.steps,
    simulatedSeconds: job.elapsed,
    truncated: job.truncated,
    reached: job.reached,
  };
}

/** Full synchronous prediction used by tests and one-shot callers. */
export function predictRoutePath(
  ship: Ship,
  route: ShipRoute,
  windFromDeg: number,
  _maxGameSeconds?: number,
): PredictedPath {
  const job = createPredictionJob(ship, route, windFromDeg);
  advancePredictionJob(job);
  return jobPath(job);
}
