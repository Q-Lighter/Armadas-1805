// Fleet and formation rules. Plain TypeScript, so the server and tests share
// the same geometry and limits.
//
// Formation slots are offsets from the leader in map kilometres. The leader is
// always slot zero. `aim` is a little ahead of the slot, towards the way the
// follower is going, so a follower does not steer exactly sideways to catch up.

import { angleOffWindDeg } from "./sailing.js";
import { settings } from "./settings.js";
import type { MapPoint } from "./map.js";
import type { ShipClassId } from "./data/ships.js";
import { DEFAULT_STANCE, STANCES, type Stance } from "./stances.js";
import { DEFAULT_FIGHTING_STYLE, type FightingStyle } from "./fighting.js";

export type { Stance };

export type FormationId =
  | "lineAhead"
  | "lineAbreast"
  | "wedge"
  | "convoy"
  | "freeChase";

export type FleetStance = Stance;

export const FORMATION_IDS: readonly FormationId[] = [
  "lineAhead",
  "lineAbreast",
  "wedge",
  "convoy",
  "freeChase",
];

export const FLEET_STANCES: readonly FleetStance[] = STANCES;

export const DEFAULT_FLEET_STANCE: FleetStance = DEFAULT_STANCE;

export interface Fleet {
  id: string;
  name: string;
  leaderId: string;
  members: string[];
  formation: FormationId;
  stance: FleetStance;
  /** Stand and fire (default) or match the target alongside. */
  fightingStyle?: FightingStyle;
  /** Ships that still belong to the fleet but are sailing independently. */
  detached: string[];
  /** Bumped whenever command passes or the formation re-forms. */
  revision: number;
}

export interface FleetShipLike {
  id: string;
  classId: ShipClassId;
  /** Current speed after wind, cargo and any other present condition. */
  speedKnots: number;
}

export interface FormationSlot {
  /** Member order, matching the fleet's member list. */
  index: number;
  /** Offset from the leader, in map kilometres. */
  x: number;
  y: number;
  /** Offset of the point the follower steers for, ahead of the slot. */
  aimX: number;
  aimY: number;
}

export interface FormationOptions {
  formation: FormationId;
  members: readonly FleetShipLike[];
  headingRad: number;
  gapM?: number;
  lookAheadM?: number;
  /** Absolute recent leader path, oldest first, ending at the leader. */
  leaderPath?: readonly MapPoint[];
}

function gapKm(gapM?: number): number {
  const metres = Math.max(settings.fleets.minimumGapM, gapM ?? settings.fleets.defaultGapM);
  return metres / 1000;
}

function forward(headingRad: number): MapPoint {
  return { x: Math.sin(headingRad), y: -Math.cos(headingRad) };
}

function right(headingRad: number): MapPoint {
  return { x: Math.cos(headingRad), y: Math.sin(headingRad) };
}

function add(a: MapPoint, b: MapPoint, scale = 1): MapPoint {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale };
}

function localPoint(
  forwardPoint: MapPoint,
  rightPoint: MapPoint,
  aheadKm: number,
  outKm: number,
): MapPoint {
  return {
    x: forwardPoint.x * aheadKm + rightPoint.x * outKm,
    y: forwardPoint.y * aheadKm + rightPoint.y * outKm,
  };
}

/** Walk backwards from the end of a breadcrumb path by a map distance. */
export function pointBehindPath(
  path: readonly MapPoint[],
  distanceKm: number,
): MapPoint | null {
  if (path.length === 0) return null;
  const end = path[path.length - 1]!;
  if (distanceKm <= 0) return { ...end };
  let remaining = distanceKm;
  for (let index = path.length - 1; index > 0; index -= 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    if (remaining <= length) {
      const t = remaining / length;
      return { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t };
    }
    remaining -= length;
  }
  const first = path[0]!;
  const second = path[1] ?? first;
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { ...first };
  return {
    x: first.x + (dx / length) * remaining,
    y: first.y + (dy / length) * remaining,
  };
}

/** Line ahead follows the leader's actual recent track, not a straight line. */
function lineAheadSlots(
  members: readonly FleetShipLike[],
  headingRad: number,
  gap: number,
  lookAhead: number,
  path: readonly MapPoint[] | undefined,
): FormationSlot[] {
  const f = forward(headingRad);
  const leader = path?.[path.length - 1];
  const slots: FormationSlot[] = [];
  for (let index = 0; index < members.length; index += 1) {
    if (index === 0) {
      slots.push({ index, x: 0, y: 0, aimX: f.x * lookAhead, aimY: f.y * lookAhead });
      continue;
    }
    const behind = gap * index;
    let point: MapPoint | null = null;
    let aimPoint: MapPoint | null = null;
    if (path && path.length >= 2 && leader) {
      point = pointBehindPath(path, behind);
      aimPoint = pointBehindPath(path, Math.max(0, behind - lookAhead));
    }
    if (!point || !leader) {
      point = { x: -f.x * behind, y: -f.y * behind };
      aimPoint = { x: -f.x * Math.max(0, behind - lookAhead), y: -f.y * Math.max(0, behind - lookAhead) };
    } else {
      point = { x: point.x - leader.x, y: point.y - leader.y };
      aimPoint = aimPoint
        ? { x: aimPoint.x - leader.x, y: aimPoint.y - leader.y }
        : point;
    }
    slots.push({ index, x: point.x, y: point.y, aimX: aimPoint.x, aimY: aimPoint.y });
  }
  return slots;
}

function lineAbreastSlots(
  members: readonly FleetShipLike[],
  headingRad: number,
  gap: number,
  lookAhead: number,
): FormationSlot[] {
  const f = forward(headingRad);
  const r = right(headingRad);
  return members.map((_, index) => {
    if (index === 0) return { index, x: 0, y: 0, aimX: f.x * lookAhead, aimY: f.y * lookAhead };
    const side = index % 2 === 1 ? 1 : -1;
    const rank = Math.ceil(index / 2);
    const point = localPoint(f, r, 0, side * gap * rank);
    const aim = localPoint(f, r, lookAhead, side * gap * rank);
    return { index, x: point.x, y: point.y, aimX: aim.x, aimY: aim.y };
  });
}

function wedgeSlots(
  members: readonly FleetShipLike[],
  headingRad: number,
  gap: number,
  lookAhead: number,
): FormationSlot[] {
  const f = forward(headingRad);
  const r = right(headingRad);
  return members.map((_, index) => {
    if (index === 0) return { index, x: 0, y: 0, aimX: f.x * lookAhead, aimY: f.y * lookAhead };
    const rank = Math.ceil(index / 2);
    const side = index % 2 === 1 ? 1 : -1;
    const point = localPoint(f, r, -gap * rank, side * gap * rank);
    const aim = localPoint(f, r, -gap * rank + lookAhead, side * gap * rank);
    return { index, x: point.x, y: point.y, aimX: aim.x, aimY: aim.y };
  });
}

function convoySlots(
  members: readonly FleetShipLike[],
  headingRad: number,
  gap: number,
  lookAhead: number,
): FormationSlot[] {
  const f = forward(headingRad);
  const r = right(headingRad);
  const traders: number[] = [];
  const escorts: number[] = [];
  members.forEach((ship, index) => {
    if (index === 0) return;
    (ship.classId === "trade" || ship.classId === "fireShip" ? traders : escorts).push(index);
  });
  const columns = traders.length >= 5 ? 3 : 2;
  const rows = Math.ceil(traders.length / columns);
  const slots: FormationSlot[] = members.map((_, index) => ({
    index,
    x: 0,
    y: 0,
    aimX: f.x * lookAhead,
    aimY: f.y * lookAhead,
  }));

  traders.forEach((memberIndex, order) => {
    const column = order % columns;
    const row = Math.floor(order / columns) + 1;
    const point = localPoint(f, r, -gap * row, (column - (columns - 1) / 2) * gap);
    slots[memberIndex] = {
      index: memberIndex,
      x: point.x,
      y: point.y,
      aimX: point.x + f.x * lookAhead,
      aimY: point.y + f.y * lookAhead,
    };
  });

  escorts.forEach((memberIndex, order) => {
    let ahead: number;
    let out: number;
    if (order === 0) {
      ahead = gap;
      out = 0;
    } else if (order === 1) {
      ahead = -gap * (rows + 1);
      out = 0;
    } else {
      const side = order % 2 === 0 ? 1 : -1;
      const rank = Math.floor((order - 2) / 2) + 1;
      ahead = -gap * rank;
      out = side * gap * (Math.ceil(columns / 2) + 1);
    }
    const point = localPoint(f, r, ahead, out);
    slots[memberIndex] = {
      index: memberIndex,
      x: point.x,
      y: point.y,
      aimX: point.x + f.x * lookAhead,
      aimY: point.y + f.y * lookAhead,
    };
  });

  return slots;
}

/** Slots for every member, including leader slot zero. */
export function formationSlots(options: FormationOptions): FormationSlot[] {
  const members = options.members;
  if (options.formation === "freeChase" || members.length === 0) return [];
  const gap = gapKm(options.gapM);
  const lookAhead = Math.max(0, options.lookAheadM ??
    settings.fleets.stationLookAheadM) / 1000;

  if (options.formation === "lineAhead") {
    return lineAheadSlots(members, options.headingRad, gap, lookAhead, options.leaderPath);
  }
  if (options.formation === "lineAbreast") {
    return lineAbreastSlots(members, options.headingRad, gap, lookAhead);
  }
  if (options.formation === "wedge") {
    return wedgeSlots(members, options.headingRad, gap, lookAhead);
  }
  return convoySlots(members, options.headingRad, gap, lookAhead);
}

/** A formation cannot face into the wind; it falls back to line ahead. */
export function formationForLeg(
  formation: FormationId,
  headingRad: number,
  windFromDeg: number,
  closestAngleDeg: number,
): FormationId {
  if (formation === "freeChase") return formation;
  const margin = settings.fleets.upwindFormationMarginDeg;
  const angle = angleOffWindDeg(headingRad, windFromDeg);
  return angle < closestAngleDeg + margin ? "lineAhead" : formation;
}

export function defaultFleetName(index: number): string {
  return `Fleet ${Math.max(1, Math.floor(index))}`;
}

export function nextFleetName(existing: readonly Fleet[]): string {
  const used = new Set(existing.map((fleet) => fleet.name));
  for (let index = 1; index <= settings.fleets.maxShipsPerFleet + 1; index += 1) {
    const name = defaultFleetName(index);
    if (!used.has(name)) return name;
  }
  return defaultFleetName(existing.length + 1);
}

export function validateFleet(fleet: Fleet): string | null {
  if (!fleet.id || !fleet.name) return "Fleet needs an id and a name.";
  if (fleet.members.length === 0) return "Fleet needs at least one ship.";
  if (fleet.members.length > settings.fleets.maxShipsPerFleet) {
    return `A fleet may contain at most ${settings.fleets.maxShipsPerFleet} ships.`;
  }
  if (new Set(fleet.members).size !== fleet.members.length) return "A ship appears twice.";
  if (!fleet.members.includes(fleet.leaderId)) return "The leader must belong to the fleet.";
  if (!FORMATION_IDS.includes(fleet.formation)) return "Unknown formation.";
  if (!FLEET_STANCES.includes(fleet.stance)) return "Unknown stance.";
  return null;
}

export function createFleet(input: {
  id: string;
  members: readonly string[];
  name?: string;
  leaderId?: string;
  formation?: FormationId;
  stance?: FleetStance;
}): Fleet {
  const members = [...new Set(input.members)];
  const fleet: Fleet = {
    id: input.id,
    name: input.name ?? defaultFleetName(1),
    leaderId: input.leaderId ?? members[0] ?? "",
    members,
    formation: input.formation ?? "lineAhead",
    stance: input.stance ?? DEFAULT_FLEET_STANCE,
    fightingStyle: DEFAULT_FIGHTING_STYLE,
    detached: [],
    revision: 1,
  };
  const error = validateFleet(fleet);
  if (error) throw new Error(error);
  return fleet;
}

export function fleetHasShip(fleets: readonly Fleet[], shipId: string): Fleet | null {
  return fleets.find((fleet) => fleet.members.includes(shipId)) ?? null;
}

/**
 * Add a ship to one fleet, refusing if it already belongs to another. This is
 * the pure guard behind the server's one-fleet-per-ship rule.
 */
export function assignShipToFleet(
  fleets: readonly Fleet[],
  fleetId: string,
  shipId: string,
): Fleet[] | null {
  const current = fleetHasShip(fleets, shipId);
  if (current && current.id !== fleetId) return null;
  const target = fleets.find((fleet) => fleet.id === fleetId);
  if (!target) return null;
  if (current) return [...fleets];
  return fleets.map((fleet) =>
    fleet.id === fleetId ? addFleetMember(fleet, shipId) : fleet);
}

/** Add one ship; a ship already in another fleet must be removed first. */
export function addFleetMember(fleet: Fleet, shipId: string): Fleet {
  if (fleet.members.includes(shipId)) return fleet;
  if (fleet.members.length >= settings.fleets.maxShipsPerFleet) {
    throw new Error(`A fleet may contain at most ${settings.fleets.maxShipsPerFleet} ships.`);
  }
  return {
    ...fleet,
    members: [...fleet.members, shipId],
    revision: fleet.revision + 1,
  };
}

/** Remove a ship, passing command to the next member if the leader is lost. */
export function removeFleetMember(fleet: Fleet, shipId: string): Fleet | null {
  if (!fleet.members.includes(shipId)) return fleet;
  const members = fleet.members.filter((id) => id !== shipId);
  if (members.length === 0) return null;
  const leaderChanged = fleet.leaderId === shipId;
  return {
    ...fleet,
    members,
    leaderId: leaderChanged ? members[0]! : fleet.leaderId,
    detached: fleet.detached.filter((id) => id !== shipId),
    revision: fleet.revision + 1,
  };
}

/**
 * A direct order detaches a member without throwing it out of the fleet.
 * If the leader is detached, command passes and the formation re-forms.
 */
export function detachFleetMember(fleet: Fleet, shipId: string): Fleet {
  if (!fleet.members.includes(shipId) || fleet.detached.includes(shipId)) return fleet;
  const members = fleet.members.filter((id) => id !== shipId);
  if (members.length === 0) return fleet;
  const leaderChanged = fleet.leaderId === shipId;
  return {
    ...fleet,
    leaderId: leaderChanged ? members[0]! : fleet.leaderId,
    detached: [...fleet.detached, shipId],
    revision: fleet.revision + 1,
  };
}

export function rejoinFleetMember(fleet: Fleet, shipId: string): Fleet {
  if (!fleet.members.includes(shipId) || !fleet.detached.includes(shipId)) return fleet;
  return {
    ...fleet,
    detached: fleet.detached.filter((id) => id !== shipId),
    revision: fleet.revision + 1,
  };
}

export function changeFleetLeader(fleet: Fleet, shipId: string): Fleet {
  if (!fleet.members.includes(shipId) || fleet.detached.includes(shipId)) return fleet;
  if (fleet.leaderId === shipId) return fleet;
  return { ...fleet, leaderId: shipId, revision: fleet.revision + 1 };
}

/** The slowest member's current speed; zero if any ship is stopped. */
export function fleetSpeedKnots(ships: readonly FleetShipLike[]): number {
  if (ships.length === 0) return 0;
  let speed = Number.POSITIVE_INFINITY;
  for (const ship of ships) {
    const current = Number.isFinite(ship.speedKnots) ? Math.max(0, ship.speedKnots) : 0;
    speed = Math.min(speed, current);
  }
  return Number.isFinite(speed) ? speed : 0;
}

/** A follower can change speed by only the configured share of fleet speed. */
export function stationSpeedRange(fleetSpeed: number): { min: number; max: number } {
  const speed = Math.max(0, fleetSpeed);
  const share = Math.max(0, settings.fleets.stationSpeedShare);
  return { min: speed * (1 - share), max: speed * (1 + share) };
}

export function distanceToSlot(
  position: MapPoint,
  leader: MapPoint,
  slot: FormationSlot,
): number {
  return Math.hypot(position.x - (leader.x + slot.x), position.y - (leader.y + slot.y));
}

export function isOutOfStation(
  position: MapPoint,
  leader: MapPoint,
  slot: FormationSlot,
): boolean {
  return distanceToSlot(position, leader, slot) >
    settings.fleets.outOfStationM / 1000;
}

/** Save a numbered selection (1 to 9). An empty selection clears its slot. */
export function saveControlGroup(
  groups: Readonly<Record<number, readonly string[]>>,
  slot: number,
  ids: readonly string[],
): Record<number, string[]> {
  if (!Number.isInteger(slot) || slot < 1 || slot > settings.fleets.maxControlGroups) {
    throw new Error(`Control group must be 1 to ${settings.fleets.maxControlGroups}.`);
  }
  const next: Record<number, string[]> = {};
  for (const [key, value] of Object.entries(groups)) {
    const number = Number(key);
    if (number >= 1 && number <= settings.fleets.maxControlGroups && value.length > 0) {
      next[number] = [...value];
    }
  }
  if (ids.length > 0) next[slot] = [...new Set(ids)];
  else delete next[slot];
  return next;
}

export type { ShipClassId };

