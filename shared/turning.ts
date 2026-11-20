// Smooth turning. This is the one helm model used by the live ship, the route
// ghost, the planner and the tests.
//
// Turn rates are per GAME second because stepShip receives game seconds. The
// designer sets the feel in REAL seconds; the 144x clock converts it.

import { settings } from "./settings.js";
import type { ShipClassId } from "./data/ships.js";

const DEG = Math.PI / 180;

/** The target time for a 90 degree turn at cruise, in real seconds. */
export function turn90RealSeconds(classId: ShipClassId): number {
  const table = settings.sailing.turn90RealSeconds;
  return table[classId] ?? table.frigate ?? 3;
}

/**
 * The maximum sustained rate, in degrees per game second. The ease-in and
 * ease-out each take `angularEaseRealSeconds`, so the sustained part is
 * shortened to keep the whole turn at the Draft time.
 */
export function maxTurnRateDegPerGameSecond(classId: ShipClassId): number {
  const ease = settings.sailing.angularEaseRealSeconds;
  const turnReal = Math.max(ease + 0.1, turn90RealSeconds(classId));
  return 90 / ((turnReal - ease) * settings.time.sailingTimeScale);
}

/** Angular acceleration in degrees per game second squared. */
export function turnAccelerationDegPerGameSecond2(maxRateDegPerGameSecond: number): number {
  return maxRateDegPerGameSecond /
    Math.max(0.05, settings.sailing.angularEaseRealSeconds * settings.time.sailingTimeScale);
}

export interface TurningBody {
  headingRad: number;
  /** Last applied turn rate, in degrees per game second. */
  turnRateDegPerSec?: number;
}

function shortestDegrees(fromRad: number, toRad: number): number {
  const diff = (((toRad - fromRad) / DEG) % 360 + 540) % 360 - 180;
  return diff;
}

/**
 * Ease the heading towards a target. The rate builds over the ease time, then
 * brakes on a square-root profile as the target nears. No step turns further
 * than the maximum rate allows. Returns the heading change in degrees.
 */
export function easeHeading(
  body: TurningBody,
  targetRad: number,
  maxRateDegPerGameSecond: number,
  dtGameSeconds: number,
): number {
  if (!(dtGameSeconds > 0) || !Number.isFinite(dtGameSeconds)) return 0;
  const error = shortestDegrees(body.headingRad, targetRad);
  if (Math.abs(error) <= settings.sailing.turnArrivalDeg) {
    body.headingRad = targetRad;
    body.turnRateDegPerSec = 0;
    return error;
  }
  if (!(maxRateDegPerGameSecond > 0)) {
    body.turnRateDegPerSec = 0;
    return 0;
  }

  const accel = turnAccelerationDegPerGameSecond2(maxRateDegPerGameSecond);
  const current = body.turnRateDegPerSec ?? 0;
  // Brake early enough to stop on the target: v = sqrt(2 a s).
  const wantedMagnitude = Math.min(
    maxRateDegPerGameSecond,
    Math.sqrt(2 * accel * Math.abs(error)),
  );
  const wanted = Math.sign(error) * wantedMagnitude;
  const rateStep = accel * dtGameSeconds;
  const nextRate = current + Math.max(-rateStep, Math.min(rateStep, wanted - current));
  let change = nextRate * dtGameSeconds;

  // The rate itself is rate-limited, so even the last step onto the target
  // cannot produce a heading snap. A tiny residual is absorbed when the rate
  // has already fallen to almost nothing.
  body.headingRad += change * DEG;
  body.turnRateDegPerSec = nextRate;
  return change;
}

/** The visible 90 degree time for a class, including the ease. */
export function turn90RealSecondsForRate(maxRateDegPerGameSecond: number): number {
  if (!(maxRateDegPerGameSecond > 0)) return Infinity;
  return 90 / maxRateDegPerGameSecond / settings.time.sailingTimeScale +
    settings.sailing.angularEaseRealSeconds;
}
