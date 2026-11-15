import assert from "node:assert/strict";
import { test } from "node:test";

import {
  battleRateFor,
  DataSaverGovernor,
  dueAtRate,
  holdFarShips,
  parseNetworkPreference,
} from "@naval/shared/net-rate";
import { settings } from "@naval/shared/settings";
import {
  applyStateDelta,
  buildStateDelta,
  decodeStateDelta,
  encodeStateDelta,
} from "@naval/shared/state-delta";
import {
  addPlayer,
  createWorld,
  giveSpareShips,
  stepWorld,
  visibleStateFor,
  type ShipSnapshot,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;

test("data saver turns on after 5 bad seconds and off after 15 good ones", () => {
  const governor = new DataSaverGovernor(5_000, 15_000, 250, 400);
  assert.equal(governor.update(0, { pingMs: 900, snapshotAgeMs: 0 }).active, false);
  assert.equal(governor.update(4_999, { pingMs: 900, snapshotAgeMs: 0 }).active, false);
  assert.equal(governor.update(5_000, { pingMs: 900, snapshotAgeMs: 0 }).active, true);
  assert.equal(governor.update(5_001, { pingMs: 10, snapshotAgeMs: 10 }).active, true);
  assert.equal(governor.update(20_000, { pingMs: 10, snapshotAgeMs: 10 }).active, true);
  assert.equal(governor.update(20_001, { pingMs: 10, snapshotAgeMs: 10 }).active, false);
  assert.equal(governor.effective("auto"), "auto");
});

test("a manual network choice overrides the automatic state", () => {
  const governor = new DataSaverGovernor();
  governor.active = true;
  assert.equal(governor.effective("full"), "full");
  assert.equal(governor.effective("saver"), "saver");
  assert.equal(governor.effective("auto"), "saver");
  assert.equal(parseNetworkPreference("auto"), "auto");
  assert.equal(parseNetworkPreference("full"), "full");
  assert.equal(parseNetworkPreference("nope"), null);
});

test("battle and far-entity rates follow the mode", () => {
  assert.equal(battleRateFor("auto"), 10);
  assert.equal(battleRateFor("saver"), 7);
  let sends = 0;
  for (let tick = 1; tick <= 10; tick += 1) {
    if (dueAtRate(tick, 7, 10)) sends += 1;
  }
  assert.equal(sends, 7);
  sends = 0;
  for (let tick = 1; tick <= 10; tick += 1) {
    if (dueAtRate(tick, 2, 10)) sends += 1;
  }
  assert.equal(sends, 2);
});

test("far ships are held between low-rate updates and own ships are not", () => {
  const old: ShipSnapshot[] = [
    ["near", "frigate", 0, 0, 0, 0, "British", null, null, 0, null],
    ["far", "frigate", 20, 0, 0, 0, "British", null, null, 0, null],
  ] as const;
  const current: ShipSnapshot[] = [
    ["near", "frigate", 0.1, 0, 0, 0, "British", null, null, 0, null],
    ["far", "frigate", 20.1, 0, 0, 0, "British", null, null, 0, null],
  ];
  const held = holdFarShips(old, current, new Set(["near"]), { x: 0, y: 0 }, "auto", 1, 10);
  assert.equal(held[0]![2], 0.1);
  assert.equal(held[1]![2], 20);
  const due = holdFarShips(old, current, new Set(["near"]), { x: 0, y: 0 }, "auto", 5, 10);
  assert.equal(due[1]![2], 20.1);
  assert.equal(holdFarShips(old, current, new Set(), { x: 0, y: 0 }, "full", 1, 10)[1]![2], 20.1);
});

test("fleet detail is patched, not resent, and rebuilds the same state", () => {
  const world = createWorld("test-fleet-patch");
  addPlayer(world, "own", "frigate", 50_000, "British");
  giveSpareShips(world, "own", 2);
  const before = visibleStateFor(world, "own", undefined, undefined, true);
  before.seq = 1;
  for (let index = 0; index < 4; index += 1) stepWorld(world, TICK);
  const after = visibleStateFor(world, "own", undefined, undefined, true);
  const delta = buildStateDelta(before, after, 2, true, false);
  const patch = delta.fields.fleetPatch as Array<Record<string, unknown>> | undefined;
  assert.ok(patch && patch.length > 0);
  for (const row of patch) {
    assert.equal(typeof row.id, "string");
    assert.equal("classId" in row, false, "static class detail must not be resent");
  }
  const applied = applyStateDelta(before, decodeStateDelta(encodeStateDelta(delta)));
  assert.deepEqual(
    applied.fleet?.map((ship) => ship.id).sort(),
    after.fleet?.map((ship) => ship.id).sort(),
  );
  assert.equal(applied.fleet?.find((ship) => ship.id === after.fleet![0]!.id)?.x, after.fleet![0]!.x);
});

test("empty flag lists are omitted and still clear on the client", () => {
  const world = createWorld("test-delta-flags");
  addPlayer(world, "own", "frigate", 50_000, "British");
  const before = visibleStateFor(world, "own");
  before.seq = 1;
  before.events = undefined;
  const after = visibleStateFor(world, "own");
  after.seq = 2;
  after.events = undefined;
  const delta = buildStateDelta(before, after, 2);
  assert.equal("events" in delta.fields, false);
  const applied = applyStateDelta(before, decodeStateDelta(encodeStateDelta(delta)));
  assert.equal(applied.events, undefined);
});
