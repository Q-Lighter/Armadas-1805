// Compact per-tick state updates. The full state still comes only from
// visibleStateFor(); this module turns two such states into one binary delta
// and applies that delta back on the client. Ship positions use whole metres
// relative to a per-player origin, headings 0.1 degree and speeds 0.1 knot.

import type { CombatEvent, ShipSnapshot, StateMessage } from "./world.js";

// The shared build is deliberately DOM-free; Workers and browsers both provide
// these globals at runtime.
declare const TextEncoder: { new(): { encode(input: string): Uint8Array } };
declare const TextDecoder: { new(): { decode(input: Uint8Array): string } };

const MAGIC = 0x314441; // "AD1" in little-endian order.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface StateDelta {
  t: "sd";
  seq: number;
  base: number;
  tick: number;
  g: number;
  w: number;
  originX: number;
  originY: number;
  fields: Record<string, unknown>;
  ships: ShipSnapshot[];
  removed: string[];
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedFields(previous: StateMessage, current: StateMessage, includeFleet: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of ["m", "sel", "sp", "h", "d", "sv", "out", "go", "roster", "ports", "fleets", "groups", "chart", "l", "trailAdds", "trailReset", "lostMarks"] as const) {
    if (!equal(previous[key], current[key])) fields[key] = current[key];
  }
  if (includeFleet) fields.fleet = current.fleet;
  // These small flag lists must be sent even when empty so the client clears
  // a flag that has gone away.
  fields.events = current.events ?? [];
  // Trail lists are only needed when there is something new to append or a
  // previous list that must be cleared; an empty full state stays compact.
  if ((Object.keys(current.trailAdds ?? {}).length > 0) ||
      (Object.keys(previous.trailAdds ?? {}).length > 0)) {
    fields.trailAdds = current.trailAdds ?? {};
  }
  if ((current.trailReset?.length ?? 0) > 0 || (previous.trailReset?.length ?? 0) > 0) {
    fields.trailReset = current.trailReset ?? [];
  }
  if ((current.lostMarks?.length ?? 0) > 0 || (previous.lostMarks?.length ?? 0) > 0) {
    fields.lostMarks = current.lostMarks ?? [];
  }
  fields.sf = current.sf ?? [];
  fields.abandoned = current.abandoned ?? [];
  fields.burning = current.burning ?? [];
  fields.grappled = current.grappled ?? [];
  fields.sinking = current.sinking ?? [];
  fields.log = current.log ?? [];
  return fields;
}

/** Build a delta from the state the client already has to the newest state. */
export function buildStateDelta(
  previous: StateMessage,
  current: StateMessage,
  seq: number,
  includeFleet = false,
): StateDelta {
  const previousShips = new Map(previous.ships.map((ship) => [ship[0], ship]));
  const ships: ShipSnapshot[] = [];
  for (const ship of current.ships) {
    const old = previousShips.get(ship[0]);
    if (!old || !equal(old, ship)) ships.push(ship);
  }
  const currentIds = new Set(current.ships.map((ship) => ship[0]));
  const removed = previous.ships.map((ship) => ship[0]).filter((id) => !currentIds.has(id));
  const first = current.ships[0];
  return {
    t: "sd",
    seq,
    base: previous.seq ?? 0,
    tick: current.tick,
    g: current.g,
    w: current.w,
    originX: first ? first[2] : 0,
    originY: first ? first[3] : 0,
    fields: changedFields(previous, current, includeFleet),
    ships,
    removed,
  };
}

function writeString(view: DataView, bytes: Uint8Array, offset: number, value: string): number {
  const text = encoder.encode(value);
  view.setUint8(offset, Math.min(255, text.length));
  bytes.set(text.subarray(0, 255), offset + 1);
  return offset + 1 + Math.min(255, text.length);
}

function readString(view: DataView, bytes: Uint8Array, offset: number): { value: string; offset: number } {
  const length = view.getUint8(offset);
  const value = decoder.decode(bytes.subarray(offset + 1, offset + 1 + length));
  return { value, offset: offset + 1 + length };
}

export function encodeStateDelta(delta: StateDelta): ArrayBuffer {
  const header = encoder.encode(JSON.stringify({
    t: delta.t,
    seq: delta.seq,
    base: delta.base,
    tick: delta.tick,
    g: delta.g,
    w: delta.w,
    originX: delta.originX,
    originY: delta.originY,
    fields: delta.fields,
    removed: delta.removed,
  }));
  // Estimate a safe upper bound: header plus roughly 40 bytes per ship.
  const buffer = new ArrayBuffer(10 + header.length + delta.ships.length * 96);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, header.length, true);
  view.setUint16(8, delta.ships.length, true);
  bytes.set(header, 10);
  let offset = 10 + header.length;
  for (const ship of delta.ships) {
    offset = writeString(view, bytes, offset, ship[0]);
    offset = writeString(view, bytes, offset, ship[1]);
    view.setInt32(offset, Math.round((ship[2] - delta.originX) * 1000), true);
    offset += 4;
    view.setInt32(offset, Math.round((ship[3] - delta.originY) * 1000), true);
    offset += 4;
    const heading = ((Math.round(ship[4] * 10) % 3600) + 3600) % 3600;
    view.setUint16(offset, heading, true);
    offset += 2;
    view.setUint16(offset, Math.max(0, Math.min(65535, Math.round(ship[5] * 10))), true);
    offset += 2;
    offset = writeString(view, bytes, offset, ship[6]);
    const docked = typeof ship[7] === "string";
    const waiting = typeof ship[8] === "string";
    view.setUint8(offset, (docked ? 1 : 0) | (waiting ? 2 : 0));
    offset += 1;
    if (docked) offset = writeString(view, bytes, offset, ship[7] as string);
    if (waiting) offset = writeString(view, bytes, offset, ship[8] as string);
  }
  return buffer.slice(0, offset);
}

export function decodeStateDelta(buffer: ArrayBuffer): StateDelta {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("Not an Armadas state delta");
  const headerLength = view.getUint32(4, true);
  const count = view.getUint16(8, true);
  const bytes = new Uint8Array(buffer);
  const header = JSON.parse(decoder.decode(bytes.subarray(10, 10 + headerLength))) as Omit<StateDelta, "ships">;
  let offset = 10 + headerLength;
  const ships: ShipSnapshot[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = readString(view, bytes, offset);
    offset = id.offset;
    const classId = readString(view, bytes, offset);
    offset = classId.offset;
    const x = header.originX + view.getInt32(offset, true) / 1000;
    offset += 4;
    const y = header.originY + view.getInt32(offset, true) / 1000;
    offset += 4;
    const heading = view.getUint16(offset, true) / 10;
    offset += 2;
    const speed = view.getUint16(offset, true) / 10;
    offset += 2;
    const navy = readString(view, bytes, offset);
    offset = navy.offset;
    const flags = view.getUint8(offset);
    offset += 1;
    let docked: string | null = null;
    let waiting: string | null = null;
    if (flags & 1) {
      const value = readString(view, bytes, offset);
      docked = value.value;
      offset = value.offset;
    }
    if (flags & 2) {
      const value = readString(view, bytes, offset);
      waiting = value.value;
      offset = value.offset;
    }
    ships.push([id.value, classId.value, x, y, heading, speed, navy.value as ShipSnapshot[6], docked, waiting]);
  }
  return { ...header, ships };
}

/** Apply a delta to the state the client already has. */
export function applyStateDelta(base: StateMessage, delta: StateDelta): StateMessage {
  const next: StateMessage = {
    ...base,
    ...(delta.fields as Partial<StateMessage>),
    t: "s",
    tick: delta.tick,
    g: delta.g,
    w: delta.w,
    seq: delta.seq,
  };
  if ("out" in delta.fields && delta.fields.out === undefined) delete next.out;
  if ("go" in delta.fields && delta.fields.go === undefined) delete next.go;
  // The full state omits empty optional lists. Keep the delta result identical
  // rather than leaving a harmless but different empty array behind.
  for (const key of ["events", "sf", "abandoned", "burning", "grappled", "sinking", "log"] as const) {
    if (Array.isArray(next[key]) && (next[key] as unknown[]).length === 0) delete next[key];
  }
  const ships = new Map(base.ships.map((ship) => [ship[0], ship]));
  for (const id of delta.removed) ships.delete(id);
  for (const ship of delta.ships) ships.set(ship[0], ship);
  next.ships = [...ships.values()];
  return next;
}

/** Keep the newest snapshot but preserve every event from the skipped ones. */
export function newestStateWithEvents(states: readonly StateMessage[]): StateMessage | null {
  const newest = states[states.length - 1];
  if (!newest) return null;
  const events: CombatEvent[] = [];
  const seen = new Set<number>();
  for (const state of states) {
    for (const event of state.events ?? []) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
  }
  // Skipped updates may contain trail additions. Merge them into the newest
  // state so a slow frame never loses the older part of a journey.
  const trailAdds: Record<string, Array<[number, number]>> = {};
  const trailReset = new Set<string>();
  for (const state of states) {
    for (const [id, points] of Object.entries(state.trailAdds ?? {})) {
      if (!Array.isArray(points)) continue;
      (trailAdds[id] ??= []).push(...points);
    }
    for (const id of state.trailReset ?? []) trailReset.add(id);
  }
  for (const id of trailReset) delete trailAdds[id];
  const merged: StateMessage = { ...newest, events };
  if (Object.keys(trailAdds).length > 0) merged.trailAdds = trailAdds;
  if (trailReset.size > 0) merged.trailReset = [...trailReset];
  if (newest.lostMarks !== undefined) merged.lostMarks = newest.lostMarks;
  return merged;
}
