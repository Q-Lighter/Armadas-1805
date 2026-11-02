// TEMP-DEBUG: temporary computer-controlled ships for the dev-room load test.
//
// This module is the only place that creates or steers bots. It must never be
// reachable from a normal or test room. The real server still owns every ship
// and uses the same sailing, coast and fog rules as it does for players.

import { settings } from "./settings.js";
import { createShip, sailTo, type Ship } from "./sailing.js";
import { isSeaAt } from "./land.js";
import { lonLatToMap } from "./map.js";
import { createChart, revealCircle } from "./fog.js";
import type { World } from "./world.js";

export const BOT_OWNER_PREFIX = "TEMP-BOT-";

type Random = () => number;

/** The number of fake players, or null when a dev-room bot count is invalid. */
export function botCountForRoom(roomCode: string, raw: string | null): number | null {
  if (!roomCode.startsWith("dev-")) return 0;
  if (raw === null || raw === "") return 0;
  if (!/^\d+$/.test(raw)) return null;

  const count = Number(raw);
  const { minBots, maxBots } = settings.loadTest;
  if (!Number.isInteger(count) || count < minBots || count > maxBots) return null;
  return count;
}

/** The internal owner id used by a fake player. */
export function botOwnerId(index: number): string {
  return `${BOT_OWNER_PREFIX}${index}`;
}

function randomBetween(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

function nearSeaPoint(
  centre: { x: number; y: number },
  minKm: number,
  maxKm: number,
  random: Random,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(minKm * minKm + random() * (maxKm * maxKm - minKm * minKm));
    const x = centre.x + Math.sin(angle) * radius;
    const y = centre.y - Math.cos(angle) * radius;
    if (isSeaAt(x, y)) return { x, y };
  }
  return null;
}

function randomSeaPointInRegion(
  lonMin: number,
  lonMax: number,
  latMin: number,
  latMax: number,
  random: Random,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const point = lonLatToMap(
      randomBetween(random, lonMin, lonMax),
      randomBetween(random, latMin, latMax),
    );
    if (isSeaAt(point.x, point.y)) return point;
  }
  return null;
}

/** A new sea destination within normal order range of the ship. */
function chooseSeaDestination(ship: Ship, random: Random): { x: number; y: number } | null {
  const { destinationMinKm, destinationMaxKm } = settings.loadTest;
  return nearSeaPoint(ship, destinationMinKm, destinationMaxKm, random);
}

function sendBotToSea(ship: Ship, random: Random): void {
  const destination = chooseSeaDestination(ship, random);
  if (destination) sailTo(ship, destination.x, destination.y);
}

/**
 * Add computer ships to a dev room. The caller supplies the first human so
 * about a tenth of the bots begin within visual range of that player.
 */
export function addBots(
  world: World,
  count: number,
  firstHumanId: string,
  random: Random = Math.random,
): number {
  if (world.kind !== "dev") return 0;

  const max = settings.loadTest.maxBots;
  const total = Math.max(0, Math.min(max, Math.floor(count)));
  if (total === 0) return 0;

  const human = world.players.get(firstHumanId);
  const humanPoint = human ?? [...world.players.values()][0];
  const nearCount = humanPoint
    ? Math.round(total * settings.loadTest.nearHumanShare)
    : 0;
  const ownerCount = settings.loadTest.fakePlayers;

  for (let index = 0; index < total; index += 1) {
    const owner = botOwnerId(index % ownerCount);
    let spawn: { x: number; y: number } | null = null;

    if (index < nearCount && humanPoint) {
      spawn = nearSeaPoint(
        humanPoint,
        settings.loadTest.nearHumanMinKm,
        settings.loadTest.nearHumanMaxKm,
        random,
      );
    }

    if (!spawn) {
      const region = index % 2 === 0
        ? settings.loadTest.caribbean
        : settings.loadTest.northernSouthAmerica;
      spawn = randomSeaPointInRegion(
        region.lonMinDeg,
        region.lonMaxDeg,
        region.latMinDeg,
        region.latMaxDeg,
        random,
      );
    }

    // The regions are sea-rich, but a tiny map or changed frame must still
    // produce a valid ship rather than placing one on land.
    if (!spawn) {
      spawn = humanPoint
        ? nearSeaPoint(humanPoint, 1, settings.loadTest.nearHumanMaxKm, random)
        : null;
    }
    if (!spawn) continue;

    const ship = createShip(
      `${owner}-ship-${index}`,
      "frigate",
      spawn.x,
      spawn.y,
      random() * Math.PI * 2,
    );
    sendBotToSea(ship, random);

    const fleet = world.botFleets.get(owner) ?? [];
    fleet.push(ship);
    world.botFleets.set(owner, fleet);

    let chart = world.charts.get(owner);
    if (!chart) {
      // A fake player must do real discovery work, even in an otherwise fully
      // explored dev room.
      chart = createChart("normal");
      world.charts.set(owner, chart);
    }
    revealCircle(chart, ship.x, ship.y);
  }

  return [...world.botFleets.values()].reduce((sum, fleet) => sum + fleet.length, 0);
}

/** Replace a missing/arrived/coast-stopped order with a new sea destination. */
export function refreshBotOrders(world: World, random: Random = Math.random): void {
  for (const fleet of world.botFleets.values()) {
    for (const ship of fleet) {
      if (!ship.order || ship.arrived) {
        ship.arrived = false;
        sendBotToSea(ship, random);
      }
    }
  }
}

/** The number of computer ships currently in the room. */
export function botShipCount(world: World): number {
  let count = 0;
  for (const fleet of world.botFleets.values()) count += fleet.length;
  return count;
}
