// 3K-d: the sight function drives enemy visibility and chart discovery.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addPlayer,
  createWorld,
  setTestMoonPhase,
  setTestTimeOfDay,
  updateFog,
  visibleStateFor,
  type World,
} from "@naval/shared/world";

function nightWorld(): { world: World; ownId: string; otherId: string } {
  const world = addPlayerWorld();
  setTestTimeOfDay(world, 23);
  setTestMoonPhase(world, 0.25);
  return { world, ownId: "one", otherId: "two" };
}

function addPlayerWorld(): World {
  const world = createWorld("test-sight-3k");
  addPlayer(world, "one", "frigate", 50_000, "British");
  addPlayer(world, "two", "frigate", 50_000, "French");
  return world;
}

function visibleIds(world: World, playerId: string): Set<string> {
  return new Set(visibleStateFor(world, playerId).ships.map((ship) => ship[0]));
}

test("night hides a dark enemy beyond own sight and shows a lit one at ten km", () => {
  const { world, ownId, otherId } = nightWorld();
  const own = world.players.get(ownId)!;
  const other = world.players.get(otherId)!;
  other.x = own.x + 9;
  other.y = own.y;
  other.lightsOff = false;
  assert.ok(visibleIds(world, ownId).has(other.id), "lit enemy is visible at 9 km");
  other.x = own.x + 10.1;
  assert.ok(!visibleIds(world, ownId).has(other.id), "lit enemy is hidden beyond 10 km");
  other.x = own.x + 5;
  other.lightsOff = true;
  assert.ok(!visibleIds(world, ownId).has(other.id), "dark enemy is hidden beyond 4 km");
  other.x = own.x + 3.9;
  assert.ok(visibleIds(world, ownId).has(other.id), "dark enemy is visible inside 4 km");
});

test("daylight sees an enemy beyond the night radius", () => {
  const world = addPlayerWorld();
  setTestTimeOfDay(world, 12);
  const own = world.players.get("one")!;
  const other = world.players.get("two")!;
  other.x = own.x + 20;
  other.y = own.y;
  other.lightsOff = true;
  assert.ok(visibleIds(world, "one").has(other.id), "20 km is inside the 25 km day sight");
});

test("chart discovery is smaller at night than in daylight", () => {
  const day = addPlayerWorld();
  setTestTimeOfDay(day, 12);
  const dayChart = day.charts.get("one")!;
  const dayShip = day.players.get("one")!;
  dayShip.x = 2500;
  dayShip.y = 1000;
  dayChart.pendingCells.length = 0;
  updateFog(day);
  const dayCells = day.charts.get("one")?.pendingCells.length ?? 0;

  const night = addPlayerWorld();
  setTestTimeOfDay(night, 23);
  setTestMoonPhase(night, 0);
  const nightChart = night.charts.get("one")!;
  const nightShip = night.players.get("one")!;
  nightShip.x = 2500;
  nightShip.y = 1000;
  nightChart.pendingCells.length = 0;
  updateFog(night);
  const nightCells = night.charts.get("one")?.pendingCells.length ?? 0;

  assert.ok(dayCells > 0 && nightCells > 0);
  assert.ok(nightCells < dayCells, `night ${nightCells} < day ${dayCells}`);
});
