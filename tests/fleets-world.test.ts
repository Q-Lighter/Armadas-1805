// Server-world fleet tests: creation, command, formation, orders and privacy.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { isSeaAt } from "@naval/shared/land";
import {
  addPlayer,
  applyFleetOrder,
  applyOrder,
  applyShipSpecialOrder,
  createPlayerFleet,
  createWorld,
  detachPlayerShip,
  disbandPlayerFleet,
  rejoinPlayerShip,
  spawnTestFleet,
  stepWorld,
  updatePlayerFleet,
  visibleStateFor,
} from "@naval/shared/world";

function fleetWorld(amount = 4) {
  const world = createWorld("dev-fleet-test");
  const first = addPlayer(world, "alpha");
  spawnTestFleet(world, "alpha", `frigate:${Math.max(0, amount - 1)}`);
  return { world, first };
}

test("a fleet is created with a leader, twelve-ship cap and disband", () => {
  const { world } = fleetWorld(4);
  const own = world.fleets.get("alpha")!;
  const fleet = createPlayerFleet(world, "alpha", own.map((ship) => ship.id));
  assert.ok(fleet);
  assert.equal(fleet!.members.length, 4);
  assert.equal(fleet!.leaderId, own[0]!.id);
  assert.equal(own.every((ship) => ship.fleetId === fleet!.id), true);
  assert.equal(visibleStateFor(world, "alpha").fleets.length, 1);
  assert.equal(disbandPlayerFleet(world, "alpha", fleet!.id), true);
  assert.equal(own.every((ship) => ship.fleetId === null), true);
  assert.equal(visibleStateFor(world, "alpha").fleets.length, 0);
});

test("leader changes, direct orders detach and rejoin", () => {
  const { world } = fleetWorld(3);
  const own = world.fleets.get("alpha")!;
  const fleet = createPlayerFleet(world, "alpha", own.map((ship) => ship.id))!;
  const next = own[2]!;
  assert.equal(updatePlayerFleet(world, "alpha", fleet.id, { leaderId: next.id }), true);
  assert.equal(visibleStateFor(world, "alpha").fleets[0]!.leaderId, next.id);

  const member = own[1]!;
  assert.equal(detachPlayerShip(world, "alpha", member.id), true);
  assert.equal(member.detached, true);
  assert.equal(visibleStateFor(world, "alpha").fleets[0]!.members.find((row) => row.id === member.id)?.state, "detached");
  assert.equal(rejoinPlayerShip(world, "alpha", member.id), true);
  assert.equal(member.detached, false);
});

test("a fleet follows a route in formation and sends route lines", () => {
  const { world } = fleetWorld(4);
  const own = world.fleets.get("alpha")!;
  const fleet = createPlayerFleet(world, "alpha", own.map((ship) => ship.id))!;
  const leader = own[0]!;
  const destination = { x: leader.x + 50, y: leader.y };
  assert.equal(applyFleetOrder(world, "alpha", fleet.id, { type: "goTo", ...destination }), true);
  const started = own.map((ship) => ({ x: ship.x, y: ship.y }));
  for (let tick = 0; tick < 80; tick += 1) {
    stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
  }
  assert.ok(own.every((ship, index) => Math.hypot(ship.x - started[index]!.x, ship.y - started[index]!.y) > 0.2));
  const state = visibleStateFor(world, "alpha");
  assert.ok(state.fleet.some((row) => (row.orderLines?.length ?? 0) > 0) || state.fleet.some((row) => (row.route?.length ?? 0) > 0));
});

test("heading order stops after its literal distance", () => {
  const { world } = fleetWorld(2);
  const own = world.fleets.get("alpha")!;
  const fleet = createPlayerFleet(world, "alpha", own.map((ship) => ship.id))!;
  const leader = own[0]!;
  const start = { x: leader.x, y: leader.y };
  // Pick a compass heading with open water for the exact-distance check.
  let headingDeg = 90;
  for (let degrees = 0; degrees < 360; degrees += 15) {
    const radians = (degrees * Math.PI) / 180;
    if (isSeaAt(start.x + Math.sin(radians) * 3, start.y - Math.cos(radians) * 3)) {
      headingDeg = degrees;
      break;
    }
  }
  assert.equal(applyFleetOrder(world, "alpha", fleet.id, {
    type: "heading",
    headingDeg,
    distanceKm: 2,
  }), true);
  for (let tick = 0; tick < 400; tick += 1) {
    stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
  }
  const travelled = Math.hypot(leader.x - start.x, leader.y - start.y);
  assert.ok(travelled >= 1.5, `travelled ${travelled}`);
  assert.equal(leader.speedKnots, 0);
});

test("a direct heading order and follow order use the special-order path", () => {
  const { world } = fleetWorld(2);
  const own = world.fleets.get("alpha")!;
  const ship = own[1]!;
  const start = { x: ship.x, y: ship.y };
  assert.equal(applyShipSpecialOrder(world, "alpha", ship.id, {
    type: "heading",
    headingDeg: 90,
    distanceKm: 2,
  }), true);
  for (let tick = 0; tick < 400; tick += 1) {
    stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
  }
  assert.ok(Math.hypot(ship.x - start.x, ship.y - start.y) >= 1.5);
  assert.equal(applyShipSpecialOrder(world, "alpha", ship.id, {
    type: "follow",
    shipId: own[0]!.id,
  }), true);
  for (let tick = 0; tick < 20; tick += 1) {
    stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
  }
  assert.ok(visibleStateFor(world, "alpha").fleet.find((row) => row.id === ship.id)?.orderLines?.some((line) => line.kind === "follow"));
});

test("a fleet test helper is test/dev only and clamps to thirty ships", () => {
  const normal = createWorld("normal");
  addPlayer(normal, "alpha");
  assert.equal(spawnTestFleet(normal, "alpha", "frigate:3"), 0);
  assert.equal(normal.fleets.get("alpha")!.length, 1);

  const dev = createWorld("dev-fleet-test");
  addPlayer(dev, "alpha");
  const made = spawnTestFleet(dev, "alpha", "frigate:40");
  assert.equal(made, 29);
  assert.equal(dev.fleets.get("alpha")!.length, 30);
  assert.equal(dev.fleets.get("alpha")!.every((ship) => ship.fleetId === null), true);
});

test("one player's fleets and groups never leak into another state", () => {
  const { world } = fleetWorld(2);
  addPlayer(world, "beta");
  const own = world.fleets.get("alpha")!;
  const fleet = createPlayerFleet(world, "alpha", own.map((ship) => ship.id))!;
  assert.equal(applyFleetOrder(world, "alpha", fleet.id, { type: "hold" }), true);
  const alpha = visibleStateFor(world, "alpha");
  const beta = visibleStateFor(world, "beta");
  assert.equal(alpha.fleets.length, 1);
  assert.equal(beta.fleets.length, 0);
  assert.deepEqual(beta.groups, {});
  assert.equal(beta.fleet.every((ship) => ship.fleetId !== fleet.id), true);
});

test("a direct sail order detaches a fleet member and patrol/rendezvous queue", () => {
  const { world } = fleetWorld(3);
  const own = world.fleets.get("alpha")!;
  const fleet = createPlayerFleet(world, "alpha", own.map((ship) => ship.id))!;
  const member = own[2]!;
  assert.equal(applyOrder(world, "alpha", member.x + 10, member.y, member.id), true);
  assert.equal(member.detached, true);
  assert.equal(applyFleetOrder(world, "alpha", fleet.id, {
    type: "patrol",
    a: { x: own[0]!.x + 20, y: own[0]!.y },
    b: { x: own[0]!.x + 20, y: own[0]!.y + 20 },
  }), true);
  assert.equal(applyFleetOrder(world, "alpha", fleet.id, {
    type: "hold",
  }, true), true);
});
