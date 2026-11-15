// 3J-a: the test-room event recorder and the on-demand session report.
// Pure ring-buffer, privacy and size tests plus the Developer-sheet markup.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  appendRecorded,
  buildSessionReport,
  RECORDER_LIMIT,
  recordedForPlayer,
  type RecordedEvent,
} from "@naval/shared/recorder";
import {
  addPlayer,
  createWorld,
  recordSessionNote,
  recordWorldEvent,
  sessionReportFor,
  shipsForOwner,
} from "@naval/shared/world";

function event(seq: number, overrides: Partial<RecordedEvent> = {}): RecordedEvent {
  return {
    seq,
    realMs: 1_700_000_000_000 + seq * 5,
    gameMs: seq * 100,
    kind: "sailing",
    text: `order ${seq}`,
    privateTo: "alpha",
    ...overrides,
  };
}

test("3J-a recorder keeps exactly the newest 3,000 events", () => {
  const events: RecordedEvent[] = [];
  for (let index = 0; index < 3_200; index += 1) {
    appendRecorded(events, {
      realMs: index,
      gameMs: index,
      kind: "sailing",
      text: `event ${index}`,
      privateTo: "alpha",
    });
  }
  assert.equal(RECORDER_LIMIT, 3_000);
  assert.equal(events.length, 3_000);
  assert.equal(events[0]?.text, "event 200");
  assert.equal(events.at(-1)?.text, "event 3199");
  assert.equal(events.at(-1)?.seq, 3200);
});

test("3J-a a report for 3,000 events stays under 20 KB", () => {
  const events: RecordedEvent[] = [];
  const kinds = ["shot", "sailing", "fireStarted", "npc", "research", "order", "perf"];
  for (let index = 0; index < 3_000; index += 1) {
    appendRecorded(events, {
      realMs: 1_700_000_000_000 + index,
      gameMs: index * 10,
      kind: kinds[index % kinds.length]!,
      text: `a deliberately long recorded event line number ${index} `.repeat(3),
      privateTo: "alpha",
      data: {
        fightId: "alpha>beta",
        attacker: "alpha",
        attackerClass: "frigate",
        targetClass: "frigate",
        shots: 10,
        hits: 4,
        hull: 12,
        sails: 3,
        stepMs: 1.2,
        bytesPerPlayerSecond: 900,
        snapshotAgeMs: 80,
        action: "coastAvoidance",
      },
    });
  }
  const notes = Array.from({ length: 20 }, (_, index) => ({
    text: `note ${index} `.repeat(18),
    realMs: 1_700_000_000_000 + index,
    gameMs: index,
    snapshot: "ship frigate: sailing · near: frigate/French 1.2km 90deg idle ".repeat(8),
    ownerId: "alpha",
  }));
  const text = buildSessionReport({
    buildId: "abc123",
    roomCode: "test-alpha",
    roomKind: "test",
    dateIso: "2026-11-15T12:00:00.000Z",
    players: [{ id: "alpha", name: "Alpha", navy: "British" }],
    layout: "desktop",
    width: 1280,
    height: 800,
    events,
    notes,
  });
  assert.ok(text.length < 20 * 1024, `report was ${text.length} bytes`);
  assert.match(text, /ARMADA'S 1805 - SESSION REPORT/);
  assert.match(text, /FIGHTS/);
  assert.match(text, /BOARDING AND CAPTURE/);
  assert.match(text, /FIRE/);
  assert.match(text, /PORT ATTACKS/);
  assert.match(text, /NPC/);
  assert.match(text, /SAILING/);
  assert.match(text, /RESEARCH/);
  assert.match(text, /ERRORS AND REJECTED ORDERS/);
  assert.match(text, /PERFORMANCE/);
  assert.match(text, /MY NOTES/);
  assert.match(text, /\[report truncated to 20 KB\]/);
});

test("3J-a reports only include events the player saw or owns", () => {
  const events: RecordedEvent[] = [
    event(1, { privateTo: "alpha", text: "alpha secret" }),
    event(2, { privateTo: "beta", text: "beta secret" }),
    event(3, { privateTo: undefined, audience: ["beta"], text: "beta audience only" }),
    event(4, { privateTo: undefined, audience: ["alpha", "beta"], text: "shared sighting" }),
    event(5, { privateTo: undefined, text: "unaddressed internal bookkeeping" }),
  ];
  const visible = recordedForPlayer(events, "alpha");
  assert.deepEqual(visible.map((entry) => entry.text), ["alpha secret", "shared sighting"]);
  const text = buildSessionReport({
    buildId: "abc",
    roomCode: "test-alpha",
    roomKind: "test",
    dateIso: "2026-11-15T12:00:00.000Z",
    players: [{ id: "alpha", name: "Alpha", navy: "British" }],
    layout: "phone",
    width: 360,
    height: 740,
    events,
    notes: [{ text: "my note", realMs: 1, gameMs: 1, snapshot: "", ownerId: "alpha" }],
  });
  assert.match(text, /alpha secret/);
  assert.match(text, /shared sighting/);
  assert.doesNotMatch(text, /beta secret/);
  assert.doesNotMatch(text, /beta audience only/);
  assert.doesNotMatch(text, /unaddressed internal/);
});

test("3J-a world reports filter the other player's private events and notes", () => {
  const world = createWorld("test-recorder-privacy");
  addPlayer(world, "alpha", "frigate", 0, "British");
  addPlayer(world, "beta", "frigate", 0, "French");
  recordWorldEvent(world, "sailing", "alpha private order", { privateTo: "alpha" });
  recordWorldEvent(world, "sailing", "beta private order", { privateTo: "beta" });
  world.sessionNotes.push(
    { text: "alpha note", realMs: 1, gameMs: 1, snapshot: "", ownerId: "alpha" },
    { text: "beta note", realMs: 2, gameMs: 2, snapshot: "", ownerId: "beta" },
  );
  const alphaReport = sessionReportFor(world, "alpha", { buildId: "b1", layout: "desktop" });
  assert.match(alphaReport, /alpha private order/);
  assert.doesNotMatch(alphaReport, /beta private order/);
  assert.match(alphaReport, /alpha note/);
  assert.doesNotMatch(alphaReport, /beta note/);
  assert.match(alphaReport, /alpha \(British\) \*/);
});

test("3J-a notes save the requested snapshot and appear in the report", () => {
  const world = createWorld("test-recorder-note");
  const own = addPlayer(world, "alpha", "frigate", 0, "British");
  addPlayer(world, "beta", "line", 0, "French");
  own.speedKnots = 6.4;
  own.order = { type: "sailTo", x: 10, y: 10, queued: false, arrivalKm: 0.2 } as typeof own.order;
  world.owners.get("alpha")!.selectedShipId = own.id;
  recordWorldEvent(world, "perf", "step 1.0ms", {
    audience: ["alpha"],
    data: { stepMs: 1, bytesPerPlayerSecond: 100, snapshotAgeMs: 50 },
  });
  const note = recordSessionNote(world, "alpha", "tacking badly near the fort", {
    zoomKm: 8,
    layout: "phone",
  });
  assert.ok(note);
  assert.match(note.snapshot, /ship frigate/);
  assert.match(note.snapshot, /firing (ready to fire|reloading)/);
  assert.match(note.snapshot, /manoeuvre/);
  assert.match(note.snapshot, /near: line\/French/);
  assert.match(note.snapshot, /zoom 8km layout phone/);
  assert.match(note.snapshot, /perf step 1.0ms/);
  assert.equal(shipsForOwner(world, "alpha").length, 1);
  const report = sessionReportFor(world, "alpha", { buildId: "b", layout: "phone" });
  assert.match(report, /tacking badly near the fort/);
  assert.match(report, /MY NOTES/);
});

test("3J-a normal rooms record nothing and reject test notes", () => {
  const world = createWorld("main");
  addPlayer(world, "alpha", "frigate", 0, "British");
  assert.equal(recordWorldEvent(world, "order", "ignored"), null);
  assert.equal(world.recorder.length, 0);
  assert.equal(recordSessionNote(world, "alpha", "ignored"), null);
  assert.equal(world.sessionNotes.length, 0);
});

test("3J-a the Developer sheet has report, copy, download, clear and note controls", () => {
  const html = readFileSync("client/index.html", "utf8");
  for (const id of [
    "test-report",
    "test-report-copy",
    "test-report-download",
    "test-report-text",
    "test-clear-recorder",
    "test-note",
    "test-note-toggle",
    "note-fab",
    "note-sheet",
    "note-text",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /Test tools, removed before release/);
  const css = readFileSync("client/paper.css", "utf8");
  assert.match(css, /\.test-report-text/);
  assert.match(css, /\.note-fab[\s\S]*?width: 44px/);
  assert.match(css, /\.test-report-actions \.btn \{ min-height: 44px/);
  const main = readFileSync("client/main.ts", "utf8");
  assert.match(main, /navigator\.clipboard\?\.writeText/);
  assert.match(main, /new Blob\(\[text\], \{ type: "text\/plain;charset=utf-8" \}\)/);
  assert.match(main, /t: "sessionReport"/);
  assert.match(main, /t: "clearRecorder"/);
  assert.match(main, /t: "sessionNote"/);
});
