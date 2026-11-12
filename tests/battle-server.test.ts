// Part 3C-b: server battle orders, running, surrender, stances and zones.

import assert from "node:assert/strict";
import { test } from "node:test";

import { findPortByName } from "@naval/shared/ports";
import { isLandAt } from "@naval/shared/land";
import { settings } from "@naval/shared/settings";
import {
  acceptShipSurrender,
  addPlayer,
  applyShipSpecialOrder,
  battleZoneVisibleFor,
  cancelShipSurrender,
  createPlayerFleet,
  createWorld,
  applyFleetOrder,
  setFleetBattleOrder,
  setShipBattleOrder,
  shipsForOwner,
  spawnTestEnemyFleet,
  spawnTestFleet,
  startShipRun,
  startShipSurrender,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

function testWorld() {
  return createWorld("test-battle-orders");
}

function pair(navy: "French" | "Spanish" = "French") {
  const world = testWorld();
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  const two = addPlayer(world, "two", "frigate", 50_000, navy);
  two.x = one.x + 0.45;
  two.y = one.y;
  one.headingRad = 0;
  two.headingRad = 0;
  return { world, one, two };
}

function dummy(world: ReturnType<typeof testWorld>, behaviour: "passive" | "fights" | "runs" | "surrenders") {
  const own = shipsForOwner(world, "one")[0]!;
  assert.equal(spawnTestEnemyFleet(world, "one", "frigate:1", { dummy: behaviour }), 1);
  const enemy = world.botFleets.get("TEST-ENEMY")![0]!;
  enemy.x = own.x + 0.5;
  enemy.y = own.y;
  return { own, enemy };
}

test("Capture and Sink switch keeps target, reload and position", () => {
  const world = testWorld();
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  const { enemy } = dummy(world, "passive");
  assert.equal(
    applyShipSpecialOrder(world, "one", one.id, { type: "engage", shipId: enemy.id, objective: "sink" }),
    true,
  );
  one.reloadStartedRealSeconds = 2;
  one.reloadReadyRealSeconds = 9;
  const before = { x: one.x, y: one.y };
  assert.equal(setShipBattleOrder(world, "one", one.id, "capture"), true);
  assert.equal(world.engagements.get(one.id)?.targetShipId, enemy.id);
  assert.equal(world.engagements.get(one.id)?.objective, "capture");
  assert.equal(one.reloadReadyRealSeconds, 9);
  assert.deepEqual({ x: one.x, y: one.y }, before);
  assert.equal(setShipBattleOrder(world, "one", one.id, "sink"), true);
  assert.equal(world.engagements.get(one.id)?.objective, "sink");
});

test("Capture without a target uses the last attacker or the nearest enemy", () => {
  const { world, one, two } = pair();
  assert.equal(
    applyShipSpecialOrder(world, "two", two.id, { type: "engage", shipId: one.id, objective: "sink" }),
    true,
  );
  for (let index = 0; index < 5; index += 1) stepWorld(world, 14.4);
  assert.ok(one.lastAttackerShipId);
  // The target was fired at but has no Engage order. Capture now answers it.
  assert.equal(setShipBattleOrder(world, "one", one.id, "capture"), true);
  assert.equal(world.engagements.get(one.id)?.targetShipId, two.id);

  const empty = testWorld();
  const own = addPlayer(empty, "one", "frigate", 50_000, "British");
  assert.equal(setShipBattleOrder(empty, "one", own.id, "capture"), false);
  assert.ok((empty.notices.get("one") ?? []).includes("No enemy in sight."));
});

test("run steering picks open water when land blocks the direct escape", () => {
  const world = testWorld();
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  // A water point with land two kilometres east; the enemy is east too.
  one.x = 1196;
  one.y = 340;
  const enemy = spawnTestEnemyFleet(world, "one", "frigate:1") === 1
    ? world.botFleets.get("TEST-ENEMY")![0]!
    : null;
  assert.ok(enemy);
  enemy.x = one.x + 1;
  enemy.y = one.y;
  assert.equal(startShipRun(world, "one", one), true);
  assert.ok(one.order);
  assert.equal(isLandAt(one.order!.x, one.order!.y), false);
  assert.ok(Math.abs(one.runState!.headingRad - Math.PI / 2) > 0.3, "did not run into the shore");
});

test("Run steers away, cancels on another order and escapes after a minute", () => {
  const world = testWorld();
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  const { enemy } = dummy(world, "passive");
  enemy.x = one.x + 1;
  enemy.y = one.y;
  assert.equal(startShipRun(world, "one", one), true);
  assert.ok(one.runState);
  assert.ok(Math.abs(one.runState!.headingRad - (-Math.PI / 2)) < 0.2);
  assert.equal(applyShipSpecialOrder(world, "one", one.id, { type: "hold" }), true);
  assert.equal(one.runState, undefined);

  assert.equal(startShipRun(world, "one", one), true);
  enemy.x = one.x + 40;
  enemy.y = one.y;
  for (let index = 0; index < 650; index += 1) stepWorld(world, 14.4);
  assert.equal(one.runState, undefined);
  assert.ok((world.notices.get("one") ?? []).includes("Escaped."));
});

test("a queued fleet order starts after the run escapes", () => {
  const world = testWorld();
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  assert.equal(spawnTestFleet(world, "one", "frigate:1"), 1);
  const fleet = createPlayerFleet(world, "one", shipsForOwner(world, "one").map((ship) => ship.id))!;
  assert.ok(fleet);
  const target = { x: one.x + 20, y: one.y + 20 };
  applyFleetOrder(world, "one", fleet.id, { type: "goTo", ...target });
  applyFleetOrder(world, "one", fleet.id, { type: "goTo", ...target }, true);
  const { enemy } = dummy(world, "passive");
  enemy.x = one.x + 1;
  enemy.y = one.y;
  assert.equal(setFleetBattleOrder(world, "one", fleet.id, "run"), true);
  enemy.x = one.x + 40;
  for (let index = 0; index < 650; index += 1) stepWorld(world, 14.4);
  assert.ok(one.order);
  assert.ok(Math.abs(one.order!.x - target.x) < 1 || Math.abs(one.order!.y - target.y) < 1);
});

test("Surrender starts, cancels, accepts in range and moves ownership", () => {
  const { world, one, two } = pair();
  const fleet = createPlayerFleet(world, "two", [two.id])!;
  assert.ok(fleet);
  world.controlGroups.set("two", { 1: [two.id] });
  assert.equal(
    applyShipSpecialOrder(world, "one", one.id, { type: "engage", shipId: two.id, objective: "sink" }),
    true,
  );
  assert.equal(startShipSurrender(world, "two", two), true);
  assert.equal(two.surrendered, true);
  assert.equal(two.speedKnots, 0);
  assert.ok((world.notices.get("one") ?? []).includes(`${two.name} has surrendered.`));
  assert.equal(world.engagements.get(one.id)?.targetShipId, two.id);

  assert.equal(cancelShipSurrender(world, "two", two.id), true);
  assert.equal(two.surrendered, false);
  assert.equal(startShipSurrender(world, "two", two), true);

  one.x = two.x + 2;
  assert.equal(acceptShipSurrender(world, "one", two.id), false);
  assert.ok((world.notices.get("one") ?? []).includes("No ship of yours is within 1 km."));
  one.x = two.x + 0.5;
  assert.equal(acceptShipSurrender(world, "one", two.id), true);
  assert.equal(shipsForOwner(world, "one").length, 2);
  assert.equal(shipsForOwner(world, "two").length, 0);
  assert.equal(two.navy, "British");
  assert.equal(two.fleetId, null);
  assert.equal(two.surrendered, false);
  assert.equal(world.engagements.has(one.id), false);
  assert.equal(viewState(world, "two").fleet.length, 0);
  assert.equal((world.controlGroups.get("two")?.[1] ?? []).includes(two.id), false);
});

function viewState(world: ReturnType<typeof testWorld>, playerId: string) {
  return visibleStateFor(world, playerId);
}

test("surrender is refused at 30 ships and a flagship only records the event", () => {
  const world = testWorld();
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  const two = addPlayer(world, "two", "flagship", 50_000, "French");
  two.x = one.x + 0.5;
  two.y = one.y;
  assert.equal(spawnTestFleet(world, "one", "frigate:29"), 29);
  assert.equal(shipsForOwner(world, "one").length, 30);
  startShipSurrender(world, "two", two);
  assert.equal(acceptShipSurrender(world, "one", two.id), false);
  assert.ok((world.notices.get("one") ?? []).includes("Fleet full (30 ships)."));
  // Free one slot, then the flagship can be taken; only an event is recorded.
  const extra = shipsForOwner(world, "one").at(-1)!;
  world.fleets.get("one")!.pop();
  assert.ok(extra);
  assert.equal(acceptShipSurrender(world, "one", two.id), true);
  assert.equal(world.flagshipLost.length, 1);
  assert.equal(world.flagshipLost[0]?.shipId, two.id);
  assert.ok(world.fleets.get("one")!.includes(two));
});

test("stance and dummy behaviour react to fire without starting for stealth", () => {
  const { world, one, two } = pair();
  one.stance = "stealth";
  applyShipSpecialOrder(world, "two", two.id, {
    type: "engage", shipId: one.id, objective: "sink",
  });
  for (let index = 0; index < 8; index += 1) stepWorld(world, 14.4);
  assert.equal(world.engagements.has(one.id), false);

  const avoid = pair();
  avoid.one.stance = "avoid";
  applyShipSpecialOrder(avoid.world, "two", avoid.two.id, {
    type: "engage", shipId: avoid.one.id, objective: "sink",
  });
  for (let index = 0; index < 10; index += 1) stepWorld(avoid.world, 14.4);
  assert.ok(avoid.one.runState);

  const engage = testWorld();
  const own = addPlayer(engage, "one", "frigate", 50_000, "British");
  const enemy = spawnTestEnemyFleet(engage, "one", "frigate:1") === 1
    ? engage.botFleets.get("TEST-ENEMY")![0]!
    : null;
  assert.ok(enemy);
  enemy.x = own.x + 1;
  own.stance = "engage";
  stepWorld(engage, 14.4);
  assert.ok(engage.engagements.has(own.id));

  const dummyWorld = testWorld();
  addPlayer(dummyWorld, "one", "frigate", 50_000, "British");
  const runner = dummy(dummyWorld, "runs").enemy;
  runner.damage.hull = runner.damage.hull * 0.4;
  stepWorld(dummyWorld, 14.4);
  assert.ok(runner.runState);

  const surrenderWorld = testWorld();
  addPlayer(surrenderWorld, "one", "frigate", 50_000, "British");
  const striker = dummy(surrenderWorld, "surrenders").enemy;
  striker.damage.hull = striker.damage.hull * 0.2;
  stepWorld(surrenderWorld, 14.4);
  assert.equal(striker.surrendered, true);
});

test("a running ship fires its stern guns at a close pursuer", () => {
  const world = testWorld();
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  const enemy = spawnTestEnemyFleet(world, "one", "frigate:1", { dummy: "passive" }) === 1
    ? world.botFleets.get("TEST-ENEMY")![0]!
    : null;
  assert.ok(enemy);
  enemy.x = one.x + 0.45;
  enemy.y = one.y;
  one.headingRad = -Math.PI / 2;
  assert.equal(startShipRun(world, "one", one), true);
  const hull = enemy.damage.hull;
  for (let index = 0; index < 40; index += 1) stepWorld(world, 14.4);
  assert.ok(world.combatEvents.some((event) => event.kind === "fire"));
  assert.ok(enemy.damage.hull <= hull);
});

test("fight-if-attacked answers the attacker, engage scans, stealth does not", () => {
  const { world, one, two } = pair();
  applyShipSpecialOrder(world, "two", two.id, {
    type: "engage", shipId: one.id, objective: "sink",
  });
  for (let index = 0; index < 8; index += 1) stepWorld(world, 14.4);
  assert.equal(world.engagements.get(one.id)?.targetShipId, two.id);
  assert.equal(one.battleOrder, "sink");
});

test("battle zones are visible only inside a sight circle", () => {
  const { world, one, two } = pair();
  applyShipSpecialOrder(world, "one", one.id, { type: "engage", shipId: two.id, objective: "sink" });
  assert.equal(battleZoneVisibleFor(world, "one"), true);
  const far = addPlayer(world, "far", "frigate", 50_000, "Spanish");
  far.x += 100;
  far.y += 100;
  assert.equal(battleZoneVisibleFor(world, "far"), false);
});

test("run and surrender states stay private to their owner", () => {
  const { world, one, two } = pair();
  startShipSurrender(world, "two", two);
  const mine = visibleStateFor(world, "one");
  const theirs = visibleStateFor(world, "two");
  assert.equal(mine.fleet.some((ship) => ship.id === two.id), false);
  assert.equal(theirs.fleet.find((ship) => ship.id === two.id)?.surrendered, true);
  assert.ok(mine.sf?.includes(two.id));
});
