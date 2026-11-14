// 3I-b: the shared navy research pool, fitting, capture unlocks and the
// private state boundary. These are server/world tests; the pure tree and
// effects tests live in research-3i.test.ts.

import assert from "node:assert/strict";
import { test } from "node:test";

import { GAME_DAY_MS } from "@naval/shared/time";
import { PLACED_PORTS } from "@naval/shared/ports";
import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  acceptShipSurrender,
  canFitAtDock,
  createWorld,
  fitAllDockedShips,
  fitShipUpgrades,
  giveResearchUnits,
  giveSpareShips,
  navyForPlayer,
  portModifiersFor,
  researchStateForNavy,
  researchStateForPlayer,
  researchUpgradeOrder,
  resetNavyResearch,
  setCapturePoints,
  shipSightRadiusKm,
  shipsForOwner,
  undock,
  unlockAllResearch,
  visibleStateFor,
} from "@naval/shared/world";
import { computeResearchModifiers } from "@naval/shared/research";
import { shipSpecFor } from "@naval/shared/sailing";

function testWorld(code = "test-research-server") {
  const world = createWorld(code);
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  return { world, ship };
}

function openPort() {
  const port = PLACED_PORTS.find((candidate) => !candidate.npc);
  assert.ok(port);
  return port;
}

function dock(world: ReturnType<typeof createWorld>, shipId: string, portId: string): void {
  const ship = shipsForOwner(world, "alpha").find((candidate) => candidate.id === shipId);
  assert.ok(ship);
  ship.dockedPortId = portId;
  ship.speedKnots = 0;
}

test("3I research is one navy pool shared by teammates, and levels are bought in order", () => {
  const { world } = testWorld();
  const mate = addPlayer(world, "mate", "frigate", 0, "British");
  assert.equal(navyForPlayer(world, "alpha"), "British");
  assert.equal(giveResearchUnits(world, "alpha", 5), 5);

  assert.equal(researchUpgradeOrder(world, "alpha", "copperSheathing", 2), false);
  assert.match(world.notices.get("alpha")!.at(-1)!, /Level 1 first/);
  assert.equal(researchUpgradeOrder(world, "alpha", "copperSheathing", 1), true);
  assert.equal(researchStateForPlayer(world, "alpha")!.levels.get("copperSheathing"), 1);
  assert.equal(researchStateForPlayer(world, "alpha")!.points, 400);

  const mateState = visibleStateFor(world, "mate");
  assert.equal(mateState.research?.levels.copperSheathing, 1);
  assert.ok((mateState.research?.points ?? 0) >= 400);
  assert.ok(mate.id.length > 0);
});

test("3I research rejects an upgrade outside the navy tree and unaffordable levels", () => {
  const { world } = testWorld();
  assert.equal(researchUpgradeOrder(world, "alpha", "saneHullLines", 1), false);
  assert.match(world.notices.get("alpha")!.at(-1)!, /not in your navy/);
  assert.equal(researchUpgradeOrder(world, "alpha", "copperSheathing", 1), false);
  assert.match(world.notices.get("alpha")!.at(-1)!, /Not enough points/);
});

test("3I fitting costs money, docks for one game day, and cannot be left early", () => {
  const { world, ship } = testWorld();
  const port = openPort();
  dock(world, ship.id, port.id);
  const beforeMoney = world.owners.get("alpha")!.money;
  giveResearchUnits(world, "alpha", 5);
  assert.equal(researchUpgradeOrder(world, "alpha", "copperSheathing", 1), true);

  assert.equal(canFitAtDock(world, "alpha", ship), true);
  assert.equal(fitShipUpgrades(world, "alpha", ship.id), true);
  assert.equal(ship.research?.fitted.get("copperSheathing"), 1);
  assert.ok((ship.research?.dockUntilGameMs ?? 0) > world.gameMs);
  assert.ok(world.owners.get("alpha")!.money < beforeMoney);
  const spec = shipSpecFor(ship);
  assert.ok(spec.cruiseKnots > 0);
  assert.equal(undock(world, "alpha", ship.id), false);
  world.gameMs += GAME_DAY_MS;
  assert.equal(undock(world, "alpha", ship.id), true);
});

test("3I upgrade all fits every eligible docked ship, and new ships keep all unlocked upgrades", () => {
  const { world, ship } = testWorld();
  const port = openPort();
  giveResearchUnits(world, "alpha", 20);
  assert.equal(researchUpgradeOrder(world, "alpha", "copperSheathing", 1), true);
  assert.equal(researchUpgradeOrder(world, "alpha", "copperSheathing", 2), true);
  giveSpareShips(world, "alpha", 1);
  const [second] = shipsForOwner(world, "alpha").filter((candidate) => candidate.id !== ship.id);
  assert.ok(second);
  dock(world, ship.id, port.id);
  dock(world, second.id, port.id);
  assert.equal(fitAllDockedShips(world, "alpha"), 2);
  assert.equal(second.research?.fitted.get("copperSheathing"), 2);

  const newcomer = addPlayer(world, "newcomer", "frigate", 0, "British");
  assert.equal(newcomer.research?.fitted.get("copperSheathing"), 2);
});

test("3I another navy never receives my research or my ships' fitted levels", () => {
  const world = createWorld("test-research-private");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  const beta = addPlayer(world, "beta", "frigate", 50_000, "French");
  giveResearchUnits(world, "beta", 10);
  assert.equal(researchUpgradeOrder(world, "beta", "saneHullLines", 1), true);
  beta.research!.fitted.set("copperSheathing", 2);

  const alphaState = visibleStateFor(world, "alpha");
  assert.equal(alphaState.research?.levels.saneHullLines, undefined);
  const json = JSON.stringify(alphaState);
  assert.ok(!json.includes("saneHullLines"));
  // Enemy ships may be visible, but a visible ship row is public only and
  // never carries fitted research; the private fleet row is mine alone.
  assert.equal(alphaState.fleet.some((entry) => entry.id === beta.id), false);
  assert.equal(alphaState.fleet.some((entry) => entry.research?.fitted.copperSheathing === 2), false);
});

test("3I first port discovery pays the navy, once, and blocks are only paid once", () => {
  const { world, ship } = testWorld();
  const port = PLACED_PORTS.find((candidate) => !candidate.npc && candidate.size === "L");
  assert.ok(port);
  ship.x = port.anchorage.x;
  ship.y = port.anchorage.y;
  const state = visibleStateFor(world, "alpha");
  assert.equal(world.charts.get("alpha")!.foundPorts.has(port.id), true);
  assert.ok((state.research?.points ?? 0) >= settings.research.foundPortPoints.L);
  const points = researchStateForPlayer(world, "alpha")!.points;
  visibleStateFor(world, "alpha");
  assert.equal(researchStateForPlayer(world, "alpha")!.points, points);
});

test("3I accepting a surrender unlocks the captured ship's fitted upgrade", () => {
  const world = createWorld("test-research-capture");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  addPlayer(world, "beta", "frigate", 50_000, "French");
  giveSpareShips(world, "beta", 1);
  const alpha = shipsForOwner(world, "alpha")[0]!;
  const prize = shipsForOwner(world, "beta").find((candidate) => !candidate.isFlagship);
  assert.ok(prize);
  prize.x = alpha.x + 0.1;
  prize.y = alpha.y;
  prize.surrendered = true;
  prize.research!.fitted.set("copperSheathing", 2);
  assert.equal(acceptShipSurrender(world, "alpha", prize.id), true);
  assert.equal(researchStateForPlayer(world, "alpha")!.levels.get("copperSheathing"), 1);
  assert.equal(prize.research?.fitted.get("copperSheathing"), 2, "the prize keeps its fittings");
});

test("3I test research tools only work in test and dev rooms", () => {
  const normal = createWorld("main");
  addPlayer(normal, "alpha");
  assert.equal(giveResearchUnits(normal, "alpha", 5), 0);
  assert.equal(unlockAllResearch(normal, "alpha"), 0);
  assert.equal(resetNavyResearch(normal, "alpha"), false);
  assert.equal(setCapturePoints(normal, "alpha", "copperSheathing", 2), false);

  const { world } = testWorld();
  assert.equal(unlockAllResearch(world, "alpha"), 31);
  assert.equal(researchStateForNavy(world, "British").levels.get("fortification"), 3);
  assert.equal(setCapturePoints(world, "alpha", "copperSheathing", 2), true);
  assert.equal(resetNavyResearch(world, "alpha"), true);
  assert.equal(researchStateForNavy(world, "British").levels.size, 0);
});

test("3I port modifiers respond to researched port upgrades", () => {
  const { world } = testWorld();
  const port = openPort();
  world.portOwners.set(port.id, "alpha");
  world.portBattles.get(port.id)!.ownerId = "alpha";
  const before = portModifiersFor(world, port.id);
  giveResearchUnits(world, "alpha", 10);
  assert.equal(researchUpgradeOrder(world, "alpha", "warehouse", 1), true);
  const after = portModifiersFor(world, port.id);
  assert.ok(after.storage > before.storage);
});

test("3I the effects registry benchmark stays cheap for 100 ships", () => {
  const levels = new Map<string, number>();
  const { world } = testWorld();
  unlockAllResearch(world, "alpha");
  for (const [id, level] of researchStateForNavy(world, "British").levels) levels.set(id, level);
  const started = performance.now();
  for (let index = 0; index < 100; index += 1) computeResearchModifiers(levels);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `100 effects-registry calls took ${elapsed.toFixed(1)} ms`);
  assert.ok(shipSightRadiusKm({ classId: "frigate", research: { fitted: levels, dockUntilGameMs: 0 } }) > 25);
});
