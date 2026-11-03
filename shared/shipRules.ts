// Pure shipyard and crew rules. No world state and no browser code.
//
// The data table is in shared/data/ships.ts. Every price, delivery time, crew
// share and pool size is read from settings so a designer can tune it.

import { settings } from "./settings.js";
import {
  BUYABLE_SHIP_CLASS_IDS,
  SHIP_NAMES,
  SHIP_SIZE_BY_CLASS,
  shipTypeFor,
  type BuyableShipClassId,
  type ShipClassId,
  type ShipSize,
} from "./data/ships.js";
import type { RoomKind } from "./fog.js";
import type { NavyId } from "./navies.js";

/** Ports sell their own size class and anything smaller. */
export function portSellsShip(portSize: ShipSize, classId: ShipClassId): boolean {
  if (!isBuyableShipClass(classId)) return false;
  const shipSize = SHIP_SIZE_BY_CLASS[classId];
  if (portSize === "small") return shipSize === "small";
  if (portSize === "mid") return shipSize !== "large";
  return true;
}

export function isBuyableShipClass(classId: ShipClassId): classId is BuyableShipClassId {
  return (BUYABLE_SHIP_CLASS_IDS as readonly string[]).includes(classId);
}

/** Price in pieces of eight. Flagships cannot be bought. */
export function shipPrice(classId: ShipClassId): number | null {
  if (!isBuyableShipClass(classId)) return null;
  return settings.ships.prices[classId];
}

/** Delivery in game milliseconds, including the test/dev speed-up. */
export function deliveryGameMs(kind: RoomKind, classId: ShipClassId): number {
  const days = settings.ships.deliveryGameDays[SHIP_SIZE_BY_CLASS[classId]];
  const multiplier = kind === "normal" ? 1 : settings.ships.testDeliveryMultiplier;
  return Math.round(
    days * settings.time.hoursPerDay * 60 * 60 * 1_000 * multiplier,
  );
}

/** Delivery time as real minutes, for the shipyard card. */
export function deliveryRealMinutes(kind: RoomKind, classId: ShipClassId): number {
  return deliveryGameMs(kind, classId) /
    (settings.time.sailingTimeScale * 60 * 1_000);
}

/** 10% of a full complement, rounded up, and always at least one sailor. */
export function minimumCrew(fullCrew: number): number {
  return Math.max(1, Math.ceil(fullCrew * settings.ships.minimumCrewShare));
}

export function canShipSail(ship: { crew: number; fullCrew: number }): boolean {
  return ship.crew >= minimumCrew(ship.fullCrew);
}

export function crewHireCost(sailors: number): number {
  if (!Number.isFinite(sailors) || sailors <= 0) return 0;
  return Math.ceil(sailors) * settings.ships.crewHireFee;
}

/** One port pool, refilled continuously. `elapsedRealSeconds` is not game time. */
export function refillCrewPool(
  current: number,
  capacity: number,
  elapsedRealSeconds: number,
): number {
  if (current >= capacity || elapsedRealSeconds <= 0) return Math.min(current, capacity);
  const perSecond = capacity / (settings.ships.crewRefillRealMinutes * 60);
  return Math.min(capacity, current + perSecond * elapsedRealSeconds);
}

export function canAddShip(currentShips: number): boolean {
  return currentShips < settings.ships.maxShipsPerPlayer;
}

/** A random name from the selected navy's twenty-name pool. */
export function suggestShipName(
  navy: NavyId,
  random: () => number = Math.random,
): string {
  const pool = SHIP_NAMES[navy];
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index] ?? "Unnamed";
}

/** Trim and check a permanent name. The client shows the same rule. */
export function cleanShipName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > settings.ships.maxNameLength) return null;
  if (!/^[\p{L}0-9 '’-]+$/u.test(trimmed)) return null;
  return trimmed;
}

/** The full sailing record for a navy's role. */
export function shipTypeForNavy(navy: NavyId, classId: ShipClassId) {
  return shipTypeFor(navy, classId);
}
