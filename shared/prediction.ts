// Predicted route paths. This module runs the same sailing step as the world
// against a ghost copy of the ship, so the line on the chart is the path the
// helm will actually steer: tacks, turn rate, final approach and all.

import { routeLookAheadPoint } from "./route.js";
import { settings } from "./settings.js";
import {
  shipSpecFor,
  stepShip,
  type Ship,
  type ShipRoute,
  type ShipSpec,
} from "./sailing.js";
import type { MapPoint } from "./map.js";
import { shipPerformance } from "./combat.js";

export interface PredictedPath {
  points: MapPoint[];
  steps?: number;
  /** Game seconds simulated, for the budget report. */
  simulatedSeconds: number;
  /** True when the prediction stopped at the 60-minute cap. */
  truncated: boolean;
}

function ghostSpec(ship: Ship): ShipSpec {
  return shipSpecFor(ship);
}

function cloneShip(ship: Ship): Ship {
  return {
    ...ship,
    order: null,
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
 * Predict a route from the ship's real steering. The ghost follows the same
 * pure-pursuit look-ahead and the same stepShip function as the live ship.
 */
export function predictRoutePath(
  ship: Ship,
  route: ShipRoute,
  windFromDeg: number,
  maxGameSeconds: number = settings.route.predictionMaxGameMinutes * 60,
): PredictedPath {
  const ghost = cloneShip(ship);
  const path = route.curve && route.curve.length > 1 ? route.curve : route.waypoints;
  const points: MapPoint[] = [{ x: ship.x, y: ship.y }];
  const step = Math.max(0.5, settings.route.predictionStepGameSeconds);
  let elapsed = 0;
  let steps = 0;
  let truncated = false;
  const spec = ghostSpec(ghost);
  const performance = shipPerformance(spec, ghost.damage, windFromDeg);

  while (elapsed < maxGameSeconds) {
    if (!ghost.order) {
      if (Math.hypot(ghost.x - route.goal.x, ghost.y - route.goal.y) <=
        settings.sailing.arrivalRadiusKm) break;
      const aim = routeLookAheadPoint(path, ghost, settings.route.steerLookAheadKm);
      if (!aim || Math.hypot(aim.x - ghost.x, aim.y - ghost.y) <
        settings.sailing.minOrderDistanceKm) break;
      ghost.tackLine ??= {
        startX: ghost.x,
        startY: ghost.y,
        targetX: route.goal.x,
        targetY: route.goal.y,
      };
      ghost.order = { type: "sailTo", x: aim.x, y: aim.y };
      ghost.arrived = false;
    }
    stepShip(ghost, step, windFromDeg, undefined, undefined, undefined, undefined, false, { spec, performance });
    elapsed += step;
    steps += 1;
    points.push({ x: ghost.x, y: ghost.y });
    if (!ghost.order && Math.hypot(ghost.x - route.goal.x, ghost.y - route.goal.y) <=
      settings.sailing.arrivalRadiusKm) break;
  }
  if (elapsed >= maxGameSeconds) truncated = true;
  // Keep the two-second samples but cap the count. A stride is cheap and
  // preserves the real steering shape better than a coarse geometric filter.
  const simplified: MapPoint[] = [];
  const stride = Math.max(1, Math.ceil(points.length / settings.route.predictionMaxPoints));
  for (let index = 0; index < points.length; index += stride) simplified.push(points[index]!);
  const finalPoint = points[points.length - 1]!;
  if (simplified[simplified.length - 1] !== finalPoint) simplified.push(finalPoint);

  return { points: simplified, simulatedSeconds: elapsed, truncated, steps };
}
