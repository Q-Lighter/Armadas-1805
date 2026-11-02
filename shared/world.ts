// The game world. Plain TypeScript, so the server runs it and the tests can
// run it without a browser or a network.
//
// The world lives in kilometres. One ship per player for now.

import { settings } from "./settings.js";
import { createShip, sailTo, stepShip, type Ship } from "./sailing.js";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export interface World {
  /** Number of world steps taken. */
  tick: number;
  /** The ships in this room, by player id. */
  players: Map<string, Ship>;
}

/** One ship in a state message: [id, class, x, y, heading in degrees, knots]. */
export type ShipSnapshot = [
  id: string,
  classId: string,
  x: number,
  y: number,
  headingDeg: number,
  speedKnots: number,
];

/**
 * The only shape of world information that is ever sent to a client.
 * A later phase will trim the ships list to what this player has seen.
 */
export interface StateMessage {
  /** "s" means world state. */
  t: "s";
  tick: number;
  /** The receiving player's own id. */
  you: string;
  /** Wind direction in compass degrees (where it blows FROM). */
  w: number;
  ships: ShipSnapshot[];
}

export function createWorld(): World {
  return { tick: 0, players: new Map() };
}

/** A stable spot in the start area, different for each player id. */
function startSpot(playerId: string): { x: number; y: number; headingRad: number } {
  const area = settings.world.startArea;

  // A small deterministic hash, so a returning player gets the same berth.
  let hash = 2166136261;
  for (let i = 0; i < playerId.length; i += 1) {
    hash ^= playerId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash >>>= 0;

  const bearingRad = (hash % 360) * DEG;
  const share = 0.35 + (((hash >>> 8) % 1000) / 1000) * 0.65;
  const distanceKm = area.radiusKm * share;

  return {
    x: area.x + Math.sin(bearingRad) * distanceKm,
    y: area.y + Math.cos(bearingRad) * distanceKm,
    // Face the middle of the start area.
    headingRad: bearingRad + Math.PI,
  };
}

/** Add a player's ship once. A returning id keeps its existing ship. */
export function addPlayer(world: World, playerId: string): Ship {
  const existing = world.players.get(playerId);
  if (existing) return existing;

  const spot = startSpot(playerId);
  // New players start with a British flagship, as the design asks.
  const ship = createShip(playerId, "flagship", spot.x, spot.y, spot.headingRad);
  world.players.set(playerId, ship);
  return ship;
}

/** Apply a sail-to order from a player. Bad orders are simply refused. */
export function applyOrder(world: World, playerId: string, x: unknown, y: unknown): boolean {
  if (typeof x !== "number" || typeof y !== "number") return false;

  const ship = world.players.get(playerId);
  if (!ship) return false;

  return sailTo(ship, x, y);
}

/** Advance every ship by a number of game seconds. */
export function stepWorld(world: World, dtGameSeconds: number): void {
  for (const ship of world.players.values()) {
    stepShip(ship, dtGameSeconds);
  }
  world.tick += 1;
}

/** Normalise a heading in radians to whole compass degrees. */
function headingDegrees(headingRad: number): number {
  return Math.round(((headingRad * RAD) % 360 + 360) % 360) % 360;
}

/**
 * Turn the world into the update one player may see.
 *
 * This is the ONLY function that world information may leave through. The
 * server sends its result and nothing else; when hidden information arrives,
 * this is the one place that filters it.
 */
export function visibleStateFor(world: World, playerId: string): StateMessage {
  const ships: ShipSnapshot[] = [];

  for (const ship of world.players.values()) {
    ships.push([
      ship.id,
      ship.classId,
      Number(ship.x.toFixed(2)),
      Number(ship.y.toFixed(2)),
      headingDegrees(ship.headingRad),
      Number(ship.speedKnots.toFixed(1)),
    ]);
  }

  return {
    t: "s",
    tick: world.tick,
    you: playerId,
    w: settings.weather.windFromDeg,
    ships,
  };
}
