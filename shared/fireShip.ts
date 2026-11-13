// Fire ship, towing and lights rules. Pure TypeScript with no world state.
//
// The AGREED numbers live in settings.ships.fireShips and the ship table. The
// server, the client and the tests all call these functions.

import { settings } from "./settings.js";
import type { RoomKind } from "./fog.js";
import type { ShipClassId } from "./data/ships.js";

/** The research tree is a later prompt; test and dev rooms are always open. */
export function fireShipsUnlocked(kind: RoomKind): boolean {
  return kind !== "normal";
}

export type IgniteMode = "now" | "contact";

export type IgniteRefusal =
  | "not a fire ship"
  | "already burning"
  | "towed"
  | "target is a port"
  | "target must be an enemy ship";

/** Why an Ignite order is refused, or null when it may start. */
export function igniteRefusal(options: {
  isFireShip: boolean;
  ignited: boolean;
  towed: boolean;
  mode: IgniteMode;
  targetIsPort?: boolean;
  targetIsEnemyShip?: boolean;
}): IgniteRefusal | null {
  if (!options.isFireShip) return "not a fire ship";
  if (options.ignited) return "already burning";
  if (options.towed) return "towed";
  if (options.mode === "now") return null;
  if (options.targetIsPort) return "target is a port";
  if (options.targetIsEnemyShip !== true) return "target must be an enemy ship";
  return null;
}

/** Towers under the 31 October towing rule. */
export function isTowerClass(classId: ShipClassId): boolean {
  return classId === "frigate" || classId === "line" || classId === "flagship";
}

export type TowRefusal =
  | "only a frigate, line ship or flagship can tow"
  | "the tow must be one of my fire ships"
  | "the fire ship is already burning"
  | "the fire ship is too far away"
  | "this tower is already towing a fire ship";

export function towRefusal(options: {
  towerClass: ShipClassId;
  towClass: ShipClassId;
  towIgnited: boolean;
  distanceM: number;
  towerBusy: boolean;
}): TowRefusal | null {
  if (!isTowerClass(options.towerClass)) return "only a frigate, line ship or flagship can tow";
  if (options.towClass !== "fireShip") return "the tow must be one of my fire ships";
  if (options.towIgnited) return "the fire ship is already burning";
  if (options.distanceM > settings.ships.fireShips.towRangeM) return "the fire ship is too far away";
  if (options.towerBusy) return "this tower is already towing a fire ship";
  return null;
}

/** The pair travels at the tower's speed less two knots, never below zero. */
export function towSpeedKnots(towerSpeedKnots: number): number {
  return Math.max(0, towerSpeedKnots - settings.ships.fireShips.towSpeedPenaltyKnots);
}

/**
 * Lights only matter at night. A lights-off enemy is seen only within the short
 * night range; lights on and daylight do not change the normal sight rule.
 */
export function withinNightLightsOffRange(
  isDay: boolean,
  lightsOff: boolean,
  distanceKm: number,
): boolean {
  if (isDay || !lightsOff) return true;
  return distanceKm <= settings.ships.fireShips.nightLightsOffSpotRangeKm;
}

/** The 06:00-18:00 window; keeps every caller on the same definition. */
export function isDaylightHour(hour: number): boolean {
  return hour >= settings.time.daylightStartHour && hour < settings.time.daylightEndHour;
}

/** Contact ignition is immediate inside this distance. */
export function contactIgnitionInRange(distanceM: number): boolean {
  return distanceM <= settings.ships.fireShips.igniteRangeM;
}

/** A badly shot-up fire ship lights itself once its hull is below 30%. */
export function hullTooLowToWait(hull: number, maxHull: number): boolean {
  if (!(maxHull > 0)) return false;
  return hull / maxHull < settings.ships.fireShips.hullIgniteShare;
}

/** True when a contact attack has spent its 150 seconds without success. */
export function contactAttackGivenUp(elapsedRealSeconds: number): boolean {
  return elapsedRealSeconds >= settings.ships.fireShips.giveUpSeconds;
}
