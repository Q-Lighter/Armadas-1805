// Part C: whole-fleet orders must stay fleet orders, the station readout must
// exist, and a real 10 v 10 battle must never leave two hulls inside 40 m.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyFleetOrder,
  createPlayerFleet,
  createWorld,
  giveSpareShips,
  shipsForOwner,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

const WIND = 315;
const TICK = 1 / settings.server.tickHz;
const DT = settings.time.sailingTimeScale * TICK;

function allPairMinimum(world: ReturnType<typeof createWorld>): { minimum: number; pair: [string, string] } {
  const ships = [...world.fleets.values()].flat();
  let minimum = Infinity;
  let pair: [string, string] = ["", ""];
  for (let a = 0; a < ships.length; a += 1) {
    for (let b = a + 1; b < ships.length; b += 1) {
      const distance = Math.hypot(ships[a]!.x - ships[b]!.x, ships[a]!.y - ships[b]!.y) * 1000;
      if (distance < minimum) {
        minimum = distance;
        pair = [ships[a]!.id, ships[b]!.id];
      }
    }
  }
  return { minimum, pair };
}

test("a whole-fleet order keeps every member attached, even when the leader is last in the list", () => {
  const world = createWorld("test-formation-order");
  const leader = addPlayer(world, "owner", "flagship", 50_000, "British");
  leader.x = 1_693.8;
  leader.y = 442.4;
  giveSpareShips(world, "owner", 9);
  const own = shipsForOwner(world, "owner");
  const fleet = createPlayerFleet(world, "owner", [...own.filter((ship) => ship.id !== leader.id).map((ship) => ship.id), leader.id]);
  assert.ok(fleet);
  assert.equal(fleet.leaderId, leader.id, "flagship must be the leader");
  assert.equal(fleet.members[fleet.members.length - 1], leader.id, "leader deliberately last");
  assert.equal(applyFleetOrder(world, "owner", fleet.id, { type: "goTo", x: 1_700, y: 449 }), true);
  stepWorld(world, DT, WIND);
  assert.equal(world.fleetCommands.size, 1, "the fleet order must still exist");
  assert.equal(fleet.members.length, 10);
  for (const ship of own) assert.equal(ship.detached, false, `${ship.id} was detached by a fleet order`);
  const state = visibleStateFor(world, "owner");
  const snapshot = state.fleets?.find((entry) => entry.id === fleet.id);
  assert.ok(snapshot, "fleet card snapshot missing");
  assert.equal(snapshot.station.total, 10);
  assert.ok(snapshot.station.inStation >= 1 && snapshot.station.inStation <= 10);
  assert.equal(snapshot.station.out.length, 10 - snapshot.station.inStation);
  const reasons = new Set(["waiting for slower ship", "tacking", "blocked by land", "out of position", "detached", "docked", "needs crew"]);
  for (const row of snapshot.station.out) assert.ok(reasons.has(row.reason), `unknown station reason ${row.reason}`);
});

test("10 v 10 battle: real movement never leaves two hulls closer than 40 m", () => {
  const world = createWorld("test-formation-battle");
  const a = addPlayer(world, "a", "flagship", 50_000, "British");
  a.x = 1_693.8;
  a.y = 442.4;
  const b = addPlayer(world, "b", "frigate", 50_000, "French");
  b.x = 1_695.6;
  b.y = 443.5;
  giveSpareShips(world, "a", 9);
  giveSpareShips(world, "b", 9);
  const fleetA = createPlayerFleet(world, "a", shipsForOwner(world, "a").map((ship) => ship.id));
  const fleetB = createPlayerFleet(world, "b", shipsForOwner(world, "b").map((ship) => ship.id));
  assert.ok(fleetA);
  assert.ok(fleetB);
  assert.equal(applyFleetOrder(world, "a", fleetA.id, { type: "engage", shipId: b.id, objective: "sink" }), true);
  assert.equal(applyFleetOrder(world, "b", fleetB.id, { type: "engage", shipId: a.id, objective: "sink" }), true);
  let minimum = Infinity;
  let pair: [string, string] = ["", ""];
  for (let step = 0; step < 900; step += 1) {
    stepWorld(world, DT, WIND);
    const report = allPairMinimum(world);
    if (report.minimum < minimum) {
      minimum = report.minimum;
      pair = report.pair;
    }
  }
  console.log(`10 v 10 closest pair over 90 s: ${minimum.toFixed(1)} m (${pair.join(" / ")})`);
  assert.ok(minimum >= 40, `two hulls came within ${minimum.toFixed(1)} m (${pair.join(" / ")})`);
});
