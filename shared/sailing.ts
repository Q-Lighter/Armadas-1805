// Sailing rules. Plain TypeScript: no browser code and no server code, so the
// same functions run in the client, the server and the tests.
//
// The world is in kilometres. Heading is in radians, 0 = north and growing
// clockwise (east is +x, north is +y). Wind direction is where it blows FROM.

import { settings } from "./settings.js";

/** One knot is 1.852 km/h. A definition, not a tuning value. */
export const KM_PER_HOUR_PER_KNOT = 1.852;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export type ShipClassId = keyof typeof settings.ships.types;
export type ShipSpec = (typeof settings.ships.types)[ShipClassId];

/** Which side of the wind the ship is tacking on. */
export type TackSide = 1 | -1;

export interface SailToOrder {
  readonly type: "sailTo";
  readonly x: number;
  readonly y: number;
}

export interface Ship {
  readonly id: string;
  readonly classId: ShipClassId;
  x: number;
  y: number;
  /** Radians, 0 = north, clockwise. */
  headingRad: number;
  /** Current speed in knots. */
  speedKnots: number;
  /** The current order, or null when the ship is holding position. */
  order: SailToOrder | null;
  /** The tack the ship will use the next time it has to beat upwind. */
  tackSide: TackSide;
  /** True once the last order was completed. */
  arrived: boolean;
}

/** Normalise an angle in degrees to 0..360. */
export function normalizeDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** The signed shortest turn from one heading to another, in degrees. */
export function shortestTurnDegrees(fromRad: number, toRad: number): number {
  const diff = normalizeDegrees((toRad - fromRad) * RAD) + 180;
  return (diff % 360) - 180;
}

/** The angle between a heading and the direction the wind blows from, 0..180. */
export function angleOffWindDeg(headingRad: number, windFromDeg: number): number {
  return Math.abs(shortestTurnDegrees(headingRad, windFromDeg * DEG));
}

/** Turn rate in degrees per game second for a ship class. */
export function turnRateDegPerSecond(spec: ShipSpec): number {
  return 90 / (spec.turn90GameMinutes * 60);
}

/** Speed factor from the settings curve, smoothly joined between key values. */
export function speedFactorAtAngle(angleDeg: number): number {
  const curve = settings.sailing.speedCurve;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;

  if (angleDeg <= first.angleOffWindDeg) return first.speedFactor;
  if (angleDeg >= last.angleOffWindDeg) return last.speedFactor;

  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    if (angleDeg <= b.angleOffWindDeg) {
      const t = (angleDeg - a.angleOffWindDeg) / (b.angleOffWindDeg - a.angleOffWindDeg);
      const smooth = t * t * (3 - 2 * t);
      return a.speedFactor + (b.speedFactor - a.speedFactor) * smooth;
    }
  }
  return last.speedFactor;
}

/** Speed in knots for a heading. Zero inside the ship's no-sail angle. */
export function speedForHeading(
  spec: ShipSpec,
  headingRad: number,
  windFromDeg: number = settings.weather.windFromDeg,
): number {
  const angle = angleOffWindDeg(headingRad, windFromDeg);
  if (angle + 1e-9 < spec.closestAngleDeg) return 0;
  return spec.cruiseKnots * speedFactorAtAngle(angle);
}

/** A new ship, stopped, with no order. */
export function createShip(
  id: string,
  classId: ShipClassId,
  x: number,
  y: number,
  headingRad = 0,
): Ship {
  return {
    id,
    classId,
    x,
    y,
    headingRad,
    speedKnots: 0,
    order: null,
    tackSide: 1,
    arrived: false,
  };
}

/** Give a sail-to order. Returns false for an order the server should refuse. */
export function sailTo(ship: Ship, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const distance = Math.hypot(x - ship.x, y - ship.y);
  if (distance < settings.sailing.minOrderDistanceKm) return false;
  if (distance > settings.sailing.maxOrderDistanceKm) return false;

  ship.order = { type: "sailTo", x, y };
  ship.arrived = false;
  return true;
}

/** Stop the ship where it is and forget the order. */
export function holdPosition(ship: Ship): void {
  ship.order = null;
  ship.speedKnots = 0;
}

/**
 * Pick a close-hauled heading when the target lies inside the no-sail angle.
 *
 * The ship zigzags across the wind line running through the target. It changes
 * tack early enough that the sideways drift during the turn keeps the zigzag
 * inside `tackHalfWidthKm`. Because that half-width is smaller than the
 * arrival radius, crossing the target's wind line always brings the ship
 * within arrival range, so it can never circle short of the target.
 */
function upwindHeadingRad(ship: Ship, spec: ShipSpec, order: SailToOrder): number {
  const windFromRad = settings.weather.windFromDeg * DEG;

  // Unit vector across the wind line, used to measure the ship's offset.
  // The world's y grows south, so a compass heading h points along
  // (sin h, -cos h).
  const acrossX = Math.cos(windFromRad);
  const acrossY = Math.sin(windFromRad);
  const offsetKm = (ship.x - order.x) * acrossX + (ship.y - order.y) * acrossY;

  let side = ship.tackSide;
  const tackHeading = windFromRad + side * spec.closestAngleDeg * DEG;

  // How fast this tack pushes the ship further across the wind line.
  const acrossRate = Math.sin(tackHeading) * acrossX - Math.cos(tackHeading) * acrossY;
  const tackSpeedKmh = speedForHeading(spec, tackHeading) * KM_PER_HOUR_PER_KNOT;
  const turnSeconds =
    Math.abs(shortestTurnDegrees(ship.headingRad, tackHeading)) /
    (turnRateDegPerSecond(spec) * DEG);

  // Start the turn early, so the drift during it stays inside the zigzag.
  const driftKm =
    Math.abs(acrossRate) * (tackSpeedKmh / 3600) * turnSeconds * settings.sailing.tackTurnLeadFactor;
  const switchAtKm = settings.sailing.tackHalfWidthKm - driftKm;

  // Only change tack when this tack is pushing the ship outwards.
  if (offsetKm * acrossRate > 0 && Math.abs(offsetKm) >= switchAtKm) {
    side = side === 1 ? -1 : 1;
    ship.tackSide = side;
  }

  return windFromRad + side * spec.closestAngleDeg * DEG;
}

/**
 * Advance one ship by a number of game seconds.
 *
 * With no order the ship stops. With an order it steers towards the target,
 * turning gradually at its own rate, and tacks automatically when the wind is
 * against it. It stops and clears the order on arrival.
 */
export function stepShip(
  ship: Ship,
  dtGameSeconds: number,
  windFromDeg: number = settings.weather.windFromDeg,
): void {
  if (!(dtGameSeconds > 0) || !Number.isFinite(dtGameSeconds)) return;

  const spec = settings.ships.types[ship.classId];
  const order = ship.order;

  if (!order) {
    ship.speedKnots = 0;
    return;
  }

  const dx = order.x - ship.x;
  const dy = order.y - ship.y;
  const distanceKm = Math.hypot(dx, dy);

  if (distanceKm <= settings.sailing.arrivalRadiusKm) {
    // Arrived: stop exactly here. Never keep circling a near target.
    ship.speedKnots = 0;
    ship.order = null;
    ship.arrived = true;
    return;
  }

  // Bearing to the target, 0 = north, clockwise. The world's y grows
  // south, so north is negative y.
  const bearingRad = Math.atan2(dx, -dy);
  const sailable = angleOffWindDeg(bearingRad, windFromDeg) >= spec.closestAngleDeg - 1e-9;
  const wantedRad = sailable ? bearingRad : upwindHeadingRad(ship, spec, order);

  // Turn gradually towards the wanted heading.
  const maxTurnDeg = turnRateDegPerSecond(spec) * dtGameSeconds;
  const turnDeg = Math.max(
    -maxTurnDeg,
    Math.min(maxTurnDeg, shortestTurnDegrees(ship.headingRad, wantedRad)),
  );
  ship.headingRad += turnDeg * DEG;

  // Speed follows the angle to the wind, then the ship moves along its heading.
  ship.speedKnots = speedForHeading(spec, ship.headingRad, windFromDeg);
  const travelKm = ship.speedKnots * KM_PER_HOUR_PER_KNOT * (dtGameSeconds / 3600);
  ship.x += Math.sin(ship.headingRad) * travelKm;
  ship.y -= Math.cos(ship.headingRad) * travelKm;
}
