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
import { DEFAULT_STANCE, type Stance } from "./stances.js";
import {
  createShipDamage,
  shipPerformance,
  type ShipDamage,
} from "./combat.js";

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
  /** Dense, land-checked curve for drawing and look-ahead steering. */
  curve?: Array<{ x: number; y: number }>;
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
  /** Combat intention. Stored now; combat has no effect yet. */
  stance: Stance;
  /** Fleet membership, if any, and whether a direct order detached it. */
  fleetId: string | null;
  detached: boolean;
  /** Station keeping may not exceed this speed, in knots. */
  stationSpeedLimit?: number;
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
  /** The six combat areas. Crew here is the living count. */
  damage: ShipDamage;
  /** Battle clock, in real seconds from the room start. */
  reloadStartedRealSeconds: number;
  reloadReadyRealSeconds: number;
  /** Last shot fired at or by this ship, in real seconds. */
  lastCombatRealMs: number | null;
  /** The player's repair toggle. Repairs still stop while in combat. */
  repairEnabled: boolean;
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

/**
 * Choose the first tack that points into the larger pocket of free water.
 * The probes include the same clearance used by the planner, so a lee shore
 * is not counted as free water just because the exact point is sea.
 */
export function chooseTackSide(
  ship: Ship,
  spec: ShipSpec,
  target: { x: number; y: number },
  windFromDeg: number,
  knownLand: (x: number, y: number) => boolean,
  clearanceKm: number = settings.route.clearanceKm,
): TackSide {
  const bearing = Math.atan2(target.x - ship.x, -(target.y - ship.y));
  if (angleOffWindDeg(bearing, windFromDeg) >= spec.closestAngleDeg - 1e-9) {
    return ship.tackSide;
  }
  const wind = windFromDeg * DEG;
  const limit = Math.max(18, settings.sailing.tackHalfWidthKm * 2 + clearanceKm);
  const freeDistance = (side: TackSide): number => {
    const heading = wind + side * spec.closestAngleDeg * DEG;
    const dx = Math.sin(heading);
    const dy = -Math.cos(heading);
    for (let distance = 2; distance <= limit; distance += 2) {
      const x = ship.x + dx * distance;
      const y = ship.y + dy * distance;
      if (knownLand(x, y)) return distance - 2;
      for (let probe = 0; probe < 8; probe += 1) {
        const angle = (probe / 8) * Math.PI * 2;
        if (knownLand(x + Math.cos(angle) * clearanceKm, y + Math.sin(angle) * clearanceKm)) {
          return distance - 2;
        }
      }
    }
    return limit;
  };
  const left = freeDistance(1);
  const right = freeDistance(-1);
  if (left === right) return ship.tackSide;
  return left > right ? 1 : -1;
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
    stance: DEFAULT_STANCE,
    fleetId: null,
    detached: false,
    route: null,
    tackSide: 1,
    arrived: false,
    dockedPortId: null,
    waitingPortId: null,
    portOrderId: null,
    waitingSinceGameMs: 0,
    damage: createShipDamage(type, crew ?? type.crew),
    reloadStartedRealSeconds: 0,
    reloadReadyRealSeconds: 0,
    lastCombatRealMs: null,
    repairEnabled: true,
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
  arrivalRadiusKm: number = settings.sailing.arrivalRadiusKm,
): void {
  if (!(dtGameSeconds > 0) || !Number.isFinite(dtGameSeconds)) return;

  const spec = shipSpecFor(ship);
  const order = ship.order;
  const performance = shipPerformance(spec, ship.damage, windFromDeg);

  if (performance.crewTooLow) {
    ship.speedKnots = 0;
    return;
  }

  if (!order) {
    if (performance.driftSpeedKnots > 0) {
      const maxTurnDeg = performance.turnRateDegPerSecond * dtGameSeconds;
      const turnDeg = Math.max(
        -maxTurnDeg,
        Math.min(maxTurnDeg, shortestTurnDegrees(ship.headingRad, performance.driftHeadingRad)),
      );
      ship.headingRad += turnDeg * DEG;
      ship.speedKnots = performance.driftSpeedKnots;
      const travelKm = ship.speedKnots * KM_PER_HOUR_PER_KNOT * (dtGameSeconds / 3600);
      ship.x += Math.sin(ship.headingRad) * travelKm;
      ship.y -= Math.cos(ship.headingRad) * travelKm;
      return;
    }
    ship.speedKnots = 0;
    return;
  }

  const dx = order.x - ship.x;
  const dy = order.y - ship.y;
  const distanceKm = Math.hypot(dx, dy);

  if (distanceKm <= arrivalRadiusKm) {
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
  const badlySteered = performance.wantsDownwind;
  const wantedRad = forcedHeadingRad ??
    (badlySteered
      ? performance.driftHeadingRad
      : sailable
        ? bearingRad
        : upwindHeadingRad(ship, spec, order, windFromDeg, preferredTackSide));

  // Turn gradually towards the wanted heading, at the damaged turn rate.
  const maxTurnDeg = performance.turnRateDegPerSecond * dtGameSeconds;
  const turnDeg = Math.max(
    -maxTurnDeg,
    Math.min(maxTurnDeg, shortestTurnDegrees(ship.headingRad, wantedRad)),
  );
  ship.headingRad += turnDeg * DEG;

  // A ship with no effective sail drifts downwind. Otherwise the effective
  // sail product and the loaded cargo hold reduce the normal speed.
  if (performance.driftSpeedKnots > 0) {
    ship.speedKnots = performance.driftSpeedKnots;
  } else {
    ship.speedKnots = speedForHeading(spec, ship.headingRad, windFromDeg) *
      performance.speedFactor *
      cargoSpeedMultiplier(ship.stores, spec.cargoTonnes);
  }
  if (ship.stationSpeedLimit !== undefined) {
    ship.speedKnots = Math.min(ship.speedKnots, ship.stationSpeedLimit);
  }
  const travelKm = ship.speedKnots * KM_PER_HOUR_PER_KNOT * (dtGameSeconds / 3600);
  ship.x += Math.sin(ship.headingRad) * travelKm;
  ship.y -= Math.cos(ship.headingRad) * travelKm;
}
