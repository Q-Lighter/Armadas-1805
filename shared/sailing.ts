// Sailing rules. Plain TypeScript: no browser code and no server code, so the
// same functions run in the client, the server and the tests.
//
// The world is in kilometres. Heading is in radians, 0 = north and growing
// clockwise (east is +x, north is +y). Wind direction is where it blows FROM.

import { settings } from "./settings.js";
import type { NavyId } from "./navies.js";
import {
  shipTypeFor,
  type ShipClassId,
  type ShipType,
} from "./data/ships.js";
import {
  cargoSpeedMultiplier,
  emptyStores,
  type ShipStores,
} from "./trade.js";

/** One knot is 1.852 km/h. A definition, not a tuning value. */
export const KM_PER_HOUR_PER_KNOT = 1.852;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export type { ShipClassId };

/** The sailing numbers used by the code, from the real ship table. */
export type ShipSpec = ShipType;

/** Which side of the wind the ship is tacking on. */
export type TackSide = 1 | -1;

export interface SailToOrder {
  readonly type: "sailTo";
  readonly x: number;
  readonly y: number;
}

/** A planned route being followed one leg at a time. */
export interface ShipRoute {
  waypoints: Array<{ x: number; y: number }>;
  index: number;
  /** The final destination, which may differ from the last waypoint. */
  goal: { x: number; y: number };
  kind: "point" | "port";
  portId: string | null;
  partial: boolean;
  message: string | null;
  plannedTick: number;
}

export interface Ship {
  readonly id: string;
  readonly classId: ShipClassId;
  readonly navy: NavyId;
  /** Permanent name chosen for this ship. */
  readonly name: string;
  /** Sailors aboard, and the full complement from the ship table. */
  crew: number;
  readonly fullCrew: number;
  /** Provisions, ammunition, repair materials and cargo, in tonnes. */
  stores: ShipStores;
  /** True while the ship has no provisions and still has crew. */
  starving: boolean;
  /** A ship under construction has a port and a game-time delivery moment. */
  deliveryPortId: string | null;
  deliveryReadyGameMs: number;
  x: number;
  y: number;
  /** Radians, 0 = north, clockwise. */
  headingRad: number;
  /** Current speed in knots. */
  speedKnots: number;
  /** The current order, or null when the ship is holding position. */
  order: SailToOrder | null;
  /** The planned route behind the current order, or null. */
  route: ShipRoute | null;
  /** The tack the ship will use the next time it has to beat upwind. */
  tackSide: TackSide;
  /** A held escape heading while turning away from a nearby coast. */
  coastEscapeHeadingRad?: number | null;
  /** True once the last order was completed. */
  arrived: boolean;
  /** The port this ship is docked at, or null when at sea. */
  dockedPortId: string | null;
  /** The full port this ship is waiting outside, or null. */
  waitingPortId: string | null;
  /** The port this ship was ordered to, until it arrives or the order ends. */
  portOrderId: string | null;
  /** Game time when this ship joined a port's waiting queue. */
  waitingSinceGameMs: number;
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
  navy: NavyId = "British",
  name?: string,
  crew?: number,
): Ship {
  const type = shipTypeFor(navy, classId);
  return {
    id,
    classId,
    navy,
    name: name ?? type.name,
    crew: crew ?? type.crew,
    fullCrew: type.crew,
    stores: emptyStores(),
    starving: false,
    deliveryPortId: null,
    deliveryReadyGameMs: 0,
    x,
    y,
    headingRad,
    speedKnots: 0,
    order: null,
    route: null,
    tackSide: 1,
    arrived: false,
    dockedPortId: null,
    waitingPortId: null,
    portOrderId: null,
    waitingSinceGameMs: 0,
  };
}

/** The sailing numbers for one ship, looked up by its navy and role. */
export function shipSpecFor(ship: Pick<Ship, "classId" | "navy">): ShipSpec {
  return shipTypeFor(ship.navy, ship.classId);
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
function upwindHeadingRad(
  ship: Ship,
  spec: ShipSpec,
  order: SailToOrder,
  windFromDeg: number,
  preferredTackSide?: TackSide,
): number {
  const windFromRad = windFromDeg * DEG;

  // Unit vector across the wind line, used to measure the ship's offset.
  // The world's y grows south, so a compass heading h points along
  // (sin h, -cos h).
  const acrossX = Math.cos(windFromRad);
  const acrossY = Math.sin(windFromRad);
  const offsetKm = (ship.x - order.x) * acrossX + (ship.y - order.y) * acrossY;

  let side = preferredTackSide ?? ship.tackSide;
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

  // Only change tack when this tack is pushing the ship outwards. A coast
  // preference is held until the ship is safely away from land.
  if (
    preferredTackSide === undefined &&
    ship.speedKnots > 0.1 &&
    offsetKm * acrossRate > 0 &&
    Math.abs(offsetKm) >= switchAtKm
  ) {
    side = side === 1 ? -1 : 1;
    ship.tackSide = side;
  }
  if (preferredTackSide !== undefined) ship.tackSide = side;

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
  preferredTackSide?: TackSide,
  forcedHeadingRad?: number,
): void {
  if (!(dtGameSeconds > 0) || !Number.isFinite(dtGameSeconds)) return;

  const spec = shipSpecFor(ship);
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
  const wantedRad = forcedHeadingRad ??
    (sailable ? bearingRad : upwindHeadingRad(ship, spec, order, windFromDeg, preferredTackSide));

  // Turn gradually towards the wanted heading.
  const maxTurnDeg = turnRateDegPerSecond(spec) * dtGameSeconds;
  const turnDeg = Math.max(
    -maxTurnDeg,
    Math.min(maxTurnDeg, shortestTurnDegrees(ship.headingRad, wantedRad)),
  );
  ship.headingRad += turnDeg * DEG;

  // Speed follows the angle to the wind, then a loaded cargo hold slows it.
  ship.speedKnots = speedForHeading(spec, ship.headingRad, windFromDeg) *
    cargoSpeedMultiplier(ship.stores, spec.cargoTonnes);
  const travelKm = ship.speedKnots * KM_PER_HOUR_PER_KNOT * (dtGameSeconds / 3600);
  ship.x += Math.sin(ship.headingRad) * travelKm;
  ship.y -= Math.cos(ship.headingRad) * travelKm;
}
