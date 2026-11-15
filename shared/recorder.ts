// 3J-a: test-room event recorder and session report.
//
// Temporary playtest tooling. It records structured events in a small ring
// buffer and builds a plain-text report only when a player asks for one.
// Removed before release.

import { settings } from "./settings.js";
import type { NavyId } from "./navies.js";

export const RECORDER_LIMIT = settings.testing.recorderLimit;

export type RecordedValue = string | number | boolean;
export type RecordedData = Record<string, RecordedValue>;

export interface RecordedEvent {
  seq: number;
  realMs: number;
  gameMs: number;
  kind: string;
  text: string;
  /** Only this player may read the event. */
  privateTo?: string;
  /** When set, only these players may read the event. */
  audience?: string[];
  data?: RecordedData;
}

export interface SessionNote {
  text: string;
  realMs: number;
  gameMs: number;
  snapshot: string;
  /** Only this player's notes appear in their report. */
  ownerId?: string;
}

export interface SessionReportInput {
  buildId: string;
  roomCode: string;
  roomKind: string;
  dateIso: string;
  players: Array<{ id: string; name: string; navy: NavyId }>;
  layout: string;
  width: number;
  height: number;
  events: RecordedEvent[];
  notes: SessionNote[];
  scenario?: string | null;
  seed?: number | string | null;
}

/** Append one event and keep the newest RECORDER_LIMIT entries. */
export function appendRecorded(
  events: RecordedEvent[],
  event: Omit<RecordedEvent, "seq">,
  limit = RECORDER_LIMIT,
): RecordedEvent {
  const next = { ...event, seq: (events.at(-1)?.seq ?? 0) + 1 };
  events.push(next);
  while (events.length > Math.max(1, limit)) events.shift();
  return next;
}

/** Only events this player saw, plus their own private events. */
export function recordedForPlayer(
  events: readonly RecordedEvent[],
  playerId: string,
): RecordedEvent[] {
  return events.filter((event) => {
    if (event.privateTo) return event.privateTo === playerId;
    if (event.audience) return event.audience.includes(playerId);
    return false;
  });
}

function short(text: string, limit = 74): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

function value(event: RecordedEvent, key: string): RecordedValue | undefined {
  return event.data?.[key];
}

function numberValue(event: RecordedEvent, key: string): number {
  const raw = value(event, key);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function stringValue(event: RecordedEvent, key: string): string {
  const raw = value(event, key);
  return typeof raw === "string" ? raw : "";
}

function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

interface FightRow {
  id: string;
  startMs: number;
  endMs: number;
  mineShots: number;
  mineHits: number;
  theirShots: number;
  theirHits: number;
  hull: number;
  sails: number;
  masts: number;
  rudder: number;
  guns: number;
  crew: number;
  theirHull: number;
  theirSails: number;
  theirMasts: number;
  theirRudder: number;
  theirGuns: number;
  theirCrew: number;
  lost: number;
  crewLost: number;
}

function fightRows(events: readonly RecordedEvent[], playerId: string): FightRow[] {
  const rows = new Map<string, FightRow>();
  for (const event of events) {
    if (event.kind !== "shot") continue;
    const id = stringValue(event, "fightId");
    if (!id) continue;
    let row = rows.get(id);
    if (!row) {
      row = {
        id,
        startMs: event.realMs,
        endMs: event.realMs,
        mineShots: 0,
        mineHits: 0,
        theirShots: 0,
        theirHits: 0,
        hull: 0,
        sails: 0,
        masts: 0,
        rudder: 0,
        guns: 0,
        crew: 0,
        theirHull: 0,
        theirSails: 0,
        theirMasts: 0,
        theirRudder: 0,
        theirGuns: 0,
        theirCrew: 0,
        lost: 0,
        crewLost: 0,
      };
      rows.set(id, row);
    }
    row.startMs = Math.min(row.startMs, event.realMs);
    row.endMs = Math.max(row.endMs, event.realMs);
    const mine = stringValue(event, "attacker") === playerId ||
      stringValue(event, "attackerNavy") === playerId;
    const shots = numberValue(event, "shots");
    const hits = numberValue(event, "hits");
    if (mine) {
      row.mineShots += shots;
      row.mineHits += hits;
    } else {
      row.theirShots += shots;
      row.theirHits += hits;
    }
    if (mine) {
      row.hull += numberValue(event, "hull");
      row.sails += numberValue(event, "sails");
      row.masts += numberValue(event, "masts");
      row.rudder += numberValue(event, "rudder");
      row.guns += numberValue(event, "guns");
      row.crew += numberValue(event, "crew");
    } else {
      row.theirHull += numberValue(event, "hull");
      row.theirSails += numberValue(event, "sails");
      row.theirMasts += numberValue(event, "masts");
      row.theirRudder += numberValue(event, "rudder");
      row.theirGuns += numberValue(event, "guns");
      row.theirCrew += numberValue(event, "crew");
    }
  }
  for (const event of events) {
    if (event.kind === "sink" || event.kind === "explosion") {
      const id = stringValue(event, "fightId");
      const row = id ? rows.get(id) : undefined;
      if (!row) continue;
      row.endMs = Math.max(row.endMs, event.realMs);
      if (stringValue(event, "owner") === playerId) {
        row.lost += 1;
        row.crewLost += numberValue(event, "crewLost");
      }
    }
  }
  return [...rows.values()];
}

function section(lines: string[], title: string): void {
  lines.push("", title, "-".repeat(Math.min(20, title.length)));
}

/**
 * A compact plain-text session report. Aggregated tables plus only the last
 * 30 errors and rejections keep 3,000 recorded events under 20 KB.
 */
export function buildSessionReport(input: SessionReportInput): string {
  const playerId = input.players[0]?.id ?? "";
  // Defence in depth: the caller filters too, but a report can never print an
  // event with no explicit sighting or ownership for its reader.
  const events = playerId ? recordedForPlayer(input.events, playerId) : [];
  const notes = playerId
    ? input.notes.filter((note) => !note.ownerId || note.ownerId === playerId)
    : [];
  const lines: string[] = [];
  lines.push("ARMADA'S 1805 - SESSION REPORT");
  lines.push("Test tools, removed before release.");
  lines.push(`Build: ${short(input.buildId, 40) || "unknown"}  Room: ${input.roomCode} (${input.roomKind})`);
  lines.push(`Date: ${input.dateIso}`);
  lines.push(`Layout: ${input.layout} ${Math.round(input.width)}x${Math.round(input.height)}`);
  if (input.seed !== null && input.seed !== undefined) lines.push(`Seed: ${input.seed}`);
  lines.push("Players:");
  for (const player of input.players) {
    lines.push(`  ${short(player.name, 20)} (${player.navy})${player.id === input.players[0]?.id ? " *" : ""}`);
  }

  section(lines, "SCENARIO RESULTS");
  const results = events.filter((event) => event.kind === "scenarioResult");
  if (results.length === 0) lines.push("none");
  for (const event of results) {
    lines.push(short(event.text, 160));
    const rating = stringValue(event, "rating");
    if (rating) lines.push(`  rating: ${rating}`);
  }

  section(lines, "FIGHTS");
  const fights = fightRows(input.events, input.players[0]?.id ?? "");
  if (fights.length === 0) lines.push("none");
  for (const fight of fights.slice(-12)) {
    lines.push(
      `${fight.id} ${seconds(fight.endMs - fight.startMs)} ` +
      `shots ${fight.mineShots}/${fight.mineHits} vs ${fight.theirShots}/${fight.theirHits} ` +
      `dmg H${Math.round(fight.hull)} S${Math.round(fight.sails)} M${Math.round(fight.masts)} ` +
      `R${Math.round(fight.rudder)} G${Math.round(fight.guns)} C${Math.round(fight.crew)} ` +
      `taken H${Math.round(fight.theirHull)} S${Math.round(fight.theirSails)} ` +
      `M${Math.round(fight.theirMasts)} R${Math.round(fight.theirRudder)} ` +
      `G${Math.round(fight.theirGuns)} C${Math.round(fight.theirCrew)} ` +
      `lost ${fight.lost} crew ${fight.crewLost}`,
    );
  }

  section(lines, "BOARDING AND CAPTURE");
  const boarding = events.filter((event) =>
    ["boarding", "surrender", "surrenderAccepted", "claim"].includes(event.kind));
  if (boarding.length === 0) lines.push("none");
  for (const event of boarding.slice(-20)) lines.push(short(`${event.kind}: ${event.text}`, 140));

  section(lines, "FIRE");
  const fires = events.filter((event) =>
    ["fireStarted", "fireSpread", "fireOut", "fireShipIgnite", "explosion", "friendlyFire"].includes(event.kind));
  if (fires.length === 0) lines.push("none");
  for (const event of fires.slice(-20)) lines.push(short(`${event.kind}: ${event.text}`, 140));

  section(lines, "PORT ATTACKS");
  const ports = events.filter((event) =>
    ["portAttack", "portSilenced", "portCaptured"].includes(event.kind));
  if (ports.length === 0) lines.push("none");
  for (const event of ports.slice(-20)) lines.push(short(`${event.kind}: ${event.text}`, 140));

  section(lines, "NPC");
  const npcs = events.filter((event) => event.kind === "npc");
  if (npcs.length === 0) lines.push("none");
  for (const event of npcs.slice(-20)) lines.push(short(event.text, 140));

  section(lines, "SAILING");
  const sailing = events.filter((event) => event.kind === "sailing");
  if (sailing.length === 0) lines.push("none");
  const sailingCounts = new Map<string, number>();
  for (const event of sailing) {
    const action = stringValue(event, "action") || "other";
    sailingCounts.set(action, (sailingCounts.get(action) ?? 0) + 1);
  }
  for (const [action, count] of sailingCounts) lines.push(`${short(action, 30)}: ${count}`);
  for (const event of sailing.slice(-12)) lines.push(short(event.text, 130));

  section(lines, "RESEARCH");
  const research = events.filter((event) =>
    event.kind === "research" || event.kind === "upgrade");
  if (research.length === 0) lines.push("none");
  for (const event of research.slice(-20)) lines.push(short(event.text, 130));

  section(lines, "ERRORS AND REJECTED ORDERS (last 30)");
  const errors = events.filter((event) =>
    event.kind === "clientError" ||
    (event.kind === "order" && value(event, "accepted") === false));
  if (errors.length === 0) lines.push("none");
  for (const event of errors.slice(-30)) lines.push(short(event.text, 160));

  section(lines, "PERFORMANCE");
  const perf = events.filter((event) => event.kind === "perf");
  if (perf.length === 0) lines.push("none");
  const steps = perf.map((event) => numberValue(event, "stepMs"));
  const bytes = perf.map((event) =>
    numberValue(event, "bytesPerPlayerSecond") || numberValue(event, "bytesPerSecond"));
  const ages = perf.map((event) => numberValue(event, "snapshotAgeMs"));
  const frames = perf.map((event) => numberValue(event, "clientFrameMs")).filter((value) => value > 0);
  if (steps.length > 0) {
    lines.push(`server step avg ${(steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(2)} ms, worst ${Math.max(...steps).toFixed(2)} ms`);
    lines.push(`bytes/player/s avg ${Math.round(bytes.reduce((a, b) => a + b, 0) / bytes.length)}, snapshot age worst ${Math.round(Math.max(...ages))} ms`);
  }
  if (frames.length > 0) {
    lines.push(`client frame avg ${(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(1)} ms, worst ${Math.max(...frames).toFixed(1)} ms`);
  }

  section(lines, "MY NOTES");
  if (notes.length === 0) lines.push("none");
  for (const note of notes.slice(-20)) {
    lines.push(`[${new Date(note.realMs).toISOString().slice(11, 19)}] ${short(note.text, 300)}`);
    if (note.snapshot) lines.push(`  ${short(note.snapshot, 500)}`);
  }
  if (input.scenario) lines.push("", `Active scenario: ${input.scenario}`);

  let text = `${lines.join("\n")}\n`;
  const max = 19_500;
  if (text.length > max) {
    text = `${text.slice(0, max - 40)}\n[report truncated to 20 KB]\n`;
  }
  return text;
}
