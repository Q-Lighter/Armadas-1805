// Tests for the authoritative world and its one outgoing state function.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyOrder,
  createWorld,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

test("new players get a flagship inside the start area", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");
  const area = settings.world.startArea;

  assert.equal(ship.classId, "flagship");
  assert.equal(world.players.size, 1);
  assert.ok(Math.hypot(ship.x - area.x, ship.y - area.y) <= area.radiusKm);
});

test("a returning player id keeps the same ship", () => {
  const world = createWorld();
  const first = addPlayer(world, "alpha");
  first.x = 42;

  const again = addPlayer(world, "alpha");
  assert.equal(again, first);
  assert.equal(again.x, 42);
  assert.equal(world.players.size, 1);
});

test("the state for one player is compact and public", () => {
  const world = createWorld();
  addPlayer(world, "alpha");
  addPlayer(world, "beta");

  const state = visibleStateFor(world, "alpha");
  const bytes = Buffer.byteLength(JSON.stringify(state), "utf8");

  assert.deepEqual(Object.keys(state).sort(), ["ships", "t", "tick", "w", "you"]);
  assert.equal(state.you, "alpha");
  assert.equal(state.ships.length, 2);
  assert.equal(state.ships[0]?.length, 6);

  // Two ships should fit in a small message.
  assert.ok(bytes < 300, `state was ${bytes} bytes`);
});

test("orders are checked before they reach a ship", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");

  assert.equal(applyOrder(world, "alpha", "north", 0), false);
  assert.equal(applyOrder(world, "alpha", Number.NaN, 0), false);
  assert.equal(applyOrder(world, "alpha", 10_000, 0), false);
  assert.equal(applyOrder(world, "alpha", -10_000, 0), false);
  assert.equal(applyOrder(world, "nobody", 10, 0), false);
  assert.equal(ship.order, null);

  assert.equal(applyOrder(world, "alpha", 10, 0), true);
  assert.notEqual(ship.order, null);
});

test("stepping the world moves ships and advances the tick", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");
  applyOrder(world, "alpha", ship.x + 20, ship.y);

  const startX = ship.x;
  for (let i = 0; i < 100; i += 1) {
    stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
  }

  assert.equal(world.tick, 100);
  assert.ok(ship.x > startX, "ship should have moved east");
  assert.ok(ship.speedKnots > 0);

  const state = visibleStateFor(world, "alpha");
  assert.equal(state.tick, 100);
  assert.equal(state.w, settings.weather.windFromDeg);
});

test("two players see each other's ships", () => {
  const world = createWorld();
  addPlayer(world, "alpha");
  addPlayer(world, "beta");

  for (const player of ["alpha", "beta"]) {
    const ids = visibleStateFor(world, player).ships.map((ship) => ship[0]).sort();
    assert.deepEqual(ids, ["alpha", "beta"]);
  }
});
