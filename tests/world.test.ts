// Tests for the authoritative world and its one outgoing state function.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { lonLatToMap } from "@naval/shared/map";
import { isSeaAt } from "@naval/shared/land";
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
  const area = settings.world;
  const start = settings.navies.British.start;
  const centre = lonLatToMap(start.lonDeg, start.latDeg);

  assert.equal(ship.classId, "flagship");
  assert.equal(ship.navy, "British");
  assert.equal(world.players.size, 1);
  assert.ok(Math.hypot(ship.x - centre.x, ship.y - centre.y) <= area.startRadiusKm);
  assert.equal(isSeaAt(ship.x, ship.y), true, "the British start is water");
});

test("a returning player id keeps the same ship and chart", () => {
  const world = createWorld();
  const first = addPlayer(world, "alpha");
  first.x = 42;
  first.headingRad = 1.25;
  const chart = world.charts.get("alpha");
  assert.ok(chart);
  const before = chart.bits.slice();

  const again = addPlayer(world, "alpha");
  assert.equal(again, first);
  assert.equal(again.x, 42);
  assert.equal(again.headingRad, 1.25);
  assert.equal(world.players.size, 1);
  assert.equal(world.charts.get("alpha"), chart);
  assert.deepEqual(chart.bits, before);
});

test("the state for one player is compact and public", () => {
  const world = createWorld();
  addPlayer(world, "alpha");
  addPlayer(world, "beta");

  const state = visibleStateFor(world, "alpha");
  const bytes = Buffer.byteLength(JSON.stringify(state), "utf8");

  assert.deepEqual(Object.keys(state).sort(), [
    "chart", "fleet", "g", "k", "l", "m", "ports", "sel", "ships", "t", "tick", "w", "you",
  ]);
  assert.equal(state.g, 0);
  assert.equal(state.you, "alpha");
  assert.equal(state.k, "normal");
  assert.equal(state.ships.length, 2);
  assert.equal(state.ships[0]?.length, 9);
  assert.equal(state.ships[0]?.[6], "British");
  assert.ok(Array.isArray(state.l));
  assert.ok(Array.isArray(state.chart.cells));

  // Two ships plus the first chart cells stay small.
  assert.ok(bytes < 2_500, `state was ${bytes} bytes`);
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

  assert.equal(applyOrder(world, "alpha", ship.x + 10, ship.y), true);
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
