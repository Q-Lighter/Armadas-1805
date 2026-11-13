// Journeys are the player's own record of where each ship has been. They live
// in OwnerState, so a socket refresh or reconnect keeps them, and are never
// built from another player's fleet.

import type { MapPoint } from "./map.js";
import { settings } from "./settings.js";
import type { Ship } from "./sailing.js";
import type { World } from "./world.js";

export interface JourneyState {
  shipId: string;
  startedGameMs: number;
  trail: MapPoint[];
  /** Total distance sailed while this journey was active, in km. */
  distanceKm: number;
  /** Game time of the most recent trail point. */
  lastPointGameMs: number;
}

export type JourneyEndReason = "stopped" | "lost";
export type ChartTrailMode = "selected" | "all" | "none";

/** The own-ship ids whose trails the Chart control should draw. */
export function trailIdsForMode(
  mode: ChartTrailMode,
  ownIds: readonly string[],
  selectedIds: readonly string[],
): string[] {
  if (mode === "none") return [];
  if (mode === "all") return [...ownIds];
  const own = new Set(ownIds);
  return selectedIds.filter((id) => own.has(id));
}

function pointOf(ship: Ship): MapPoint {
  return { x: ship.x, y: ship.y };
}

/** Begin a journey when a ship undocks or first gets an order at sea. */
export function startJourney(world: World, ownerId: string, ship: Ship): void {
  const owner = world.owners.get(ownerId);
  if (!owner || ship.dockedPortId) return;
  if (owner.journeys.has(ship.id)) return;
  owner.journeys.set(ship.id, {
    shipId: ship.id,
    startedGameMs: world.gameMs,
    trail: [pointOf(ship)],
    distanceKm: 0,
    lastPointGameMs: world.gameMs,
  });
}

/** Finish one journey. A lost ship leaves an X at its last recorded point. */
export function endJourney(
  world: World,
  ownerId: string,
  shipId: string,
  reason: JourneyEndReason,
  at?: MapPoint,
): boolean {
  const owner = world.owners.get(ownerId);
  const journey = owner?.journeys.get(shipId);
  if (!owner || !journey) return false;
  owner.journeys.delete(shipId);
  if (reason === "lost") {
    owner.lostMarks.push(at ?? journey.trail[journey.trail.length - 1] ?? at ?? { x: 0, y: 0 });
    if (owner.lostMarks.length > settings.journey.maxLostMarks) owner.lostMarks.shift();
  }
  return true;
}

/** The player's explicit "End journey" / "Clear all trails" action. */
export function stopJourney(world: World, playerId: string, shipId: string): boolean {
  return endJourney(world, playerId, shipId, "stopped");
}

export function stopAllJourneys(world: World, playerId: string): number {
  const owner = world.owners.get(playerId);
  if (!owner) return 0;
  let stopped = 0;
  for (const shipId of [...owner.journeys.keys()]) {
    if (endJourney(world, playerId, shipId, "stopped")) stopped += 1;
  }
  return stopped;
}

/** Thin the older half of a full trail, keeping its shape and recent detail. */
function thinOlderHalf(trail: MapPoint[]): void {
  const half = Math.floor(trail.length / 2);
  if (half < 2) return;
  const thinned: MapPoint[] = [];
  for (let index = 0; index < half; index += 2) thinned.push(trail[index]!);
  trail.splice(0, half, ...thinned);
}

/** A compact send path: at most 300 points, preserving both ends. */
export function simplifyTrail(trail: readonly MapPoint[], limit = settings.journey.maxSentPoints): MapPoint[] {
  if (trail.length <= limit) return trail.map((point) => ({ ...point }));
  const stride = Math.max(1, Math.ceil((trail.length - 1) / (limit - 1)));
  const result: MapPoint[] = [];
  for (let index = 0; index < trail.length; index += stride) result.push({ ...trail[index]! });
  const last = trail[trail.length - 1]!;
  if (result[result.length - 1]!.x !== last.x || result[result.length - 1]!.y !== last.y) {
    if (result.length >= limit) result.pop();
    result.push({ ...last });
  }
  return result;
}

/**
 * Advance every owner's journeys once per world tick. Docking is deliberately
 * ignored; only a missing ship, abandonment, sinking or capture ends a trail.
 */
export function recordJourneys(world: World): void {
  for (const [ownerId, owner] of world.owners) {
    const fleet = world.fleets.get(ownerId);
    const byId = new Map((fleet ?? []).map((ship) => [ship.id, ship]));
    for (const [shipId, journey] of [...owner.journeys]) {
      const ship = byId.get(shipId);
      const sinking = world.sinkingShips.some((entry) => entry.ship.id === shipId);
      const abandoned = !ship || ship.abandoned === true;
      if (!ship || sinking || abandoned) {
        endJourney(world, ownerId, shipId, "lost", ship ? pointOf(ship) : undefined);
        continue;
      }
      if (ship.dockedPortId) continue;
      const last = journey.trail[journey.trail.length - 1] ?? pointOf(ship);
      const moved = Math.hypot(ship.x - last.x, ship.y - last.y);
      journey.distanceKm += moved;
      if (
        moved >= settings.journey.trailPointKm ||
        world.gameMs - journey.lastPointGameMs >= settings.journey.trailPointGameSeconds * 1000
      ) {
        journey.trail.push(pointOf(ship));
        journey.lastPointGameMs = world.gameMs;
        while (journey.trail.length > settings.journey.maxTrailPoints) thinOlderHalf(journey.trail);
      }
    }
  }
}
