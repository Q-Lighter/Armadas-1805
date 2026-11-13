// Part B: the server side of the minimal attack order, damage, events and repairs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyFleetOrder,
  repairAtPort,
  applyShipSpecialOrder,
  createPlayerFleet,
  createWorld,
  setPlayerRepair,
  shipsForOwner,
  spawnTestEnemyFleet,
  spawnTestFleet,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

function testWorld() {
  return createWorld("test-combat");
}

function placeEnemy(world: ReturnType<typeof testWorld>, playerId: string, dx: number, dy: number) {
  const own = shipsForOwner(world, playerId)[0]!;
  const enemy = world.botFleets.get("TEST-ENEMY")![0]!;
  enemy.x = own.x + dx;
  enemy.y = own.y + dy;
  enemy.headingRad = 0;
  own.headingRad = 0;
  return { own, enemy };
}

test("engage ship starts a target, sails into range and fires when a group bears", () => {
  const world = testWorld();
  const own = addPlayer(world, "p");
  assert.equal(spawnTestEnemyFleet(world, "p", "frigate:1"), 1);
  const { enemy } = placeEnemy(world, "p", 0.5, 0);
  own.headingRad = 0;

  assert.equal(
    applyShipSpecialOrder(world, "p", own.id, { type: "engage", shipId: enemy.id, objective: "sink" }),
    true,
  );
  assert.equal(world.engagements.get(own.id)?.targetShipId, enemy.id);
  assert.equal(world.engagements.get(own.id)?.objective, "sink");

  // Beam-on: the broadside bears at once.
  for (let index = 0; index < 3; index += 1) stepWorld(world, 14.4);
  assert.ok(world.combatEvents.some((event) => event.kind === "fire" && event.shipId === own.id));
  assert.ok(enemy.damage.hull < 4600, "the enemy took real damage");

  // The engaged ship closes to about the 250 m station.
  for (let index = 0; index < 80; index += 1) stepWorld(world, 14.4);
  assert.ok(Math.hypot(enemy.x - own.x, enemy.y - own.y) < 0.45);
});

test("nothing fires into the blind arcs between bow and broadside", () => {
  const world = testWorld();
  const own = addPlayer(world, "p");
  spawnTestEnemyFleet(world, "p", "frigate:1");
  const enemy = world.botFleets.get("TEST-ENEMY")![0]!;
  const angle = Math.PI / 4;
  enemy.x = own.x + Math.sin(angle) * 0.5;
  enemy.y = own.y + Math.cos(angle) * 0.5;
  own.headingRad = 0;
  applyShipSpecialOrder(world, "p", own.id, { type: "engage", shipId: enemy.id, objective: "sink" });
  stepWorld(world, 1);
  assert.equal(world.combatEvents.filter((event) => event.kind === "fire").length, 0);
});

test("a sunk ship leaves the fleet, the ship count and every engagement", () => {
  const world = testWorld();
  addPlayer(world, "p");
  spawnTestFleet(world, "p", "frigate:1");
  const fleet = createPlayerFleet(world, "p", shipsForOwner(world, "p").map((ship) => ship.id));
  assert.ok(fleet);
  const own = shipsForOwner(world, "p");
  const before = own.length;
  const lost = own[1]!;
  lost.damage.hull = 0;
  stepWorld(world, 14.4);

  assert.equal(shipsForOwner(world, "p").length, before - 1);
  assert.equal(world.fleets.get("p")?.length, before - 1);
  assert.ok(!shipsForOwner(world, "p").some((ship) => ship.id === lost.id));
});

test("a lost flagship only records the event for the later rules", () => {
  const world = testWorld();
  const ship = addPlayer(world, "p", "flagship");
  ship.damage.hull = 0;
  stepWorld(world, 14.4);
  assert.equal(world.flagshipLost.length, 1);
  assert.equal(world.flagshipLost[0]?.shipId, ship.id);
  assert.equal(world.flagshipLost[0]?.ownerId, "p");
  assert.ok(world.combatEvents.some((event) => event.kind === "flagshipLost"));
});

test("combat events are visible only to players who can see the spot", () => {
  const world = testWorld();
  const own = addPlayer(world, "p");
  const near = addPlayer(world, "q");
  const far = addPlayer(world, "r");
  spawnTestEnemyFleet(world, "p", "frigate:1");
  const enemy = world.botFleets.get("TEST-ENEMY")![0]!;
  enemy.x = own.x + 0.4;
  enemy.y = own.y;
  near.x = own.x + 0.2;
  near.y = own.y + 0.2;
  far.x = own.x + 40;
  far.y = own.y + 40;
  applyShipSpecialOrder(world, "p", own.id, { type: "engage", shipId: enemy.id, objective: "sink" });
  // Stand-and-fire must heave to and pivot before its broadside bears.
  for (let index = 0; index < 200; index += 1) stepWorld(world, 14.4);

  assert.ok((visibleStateFor(world, "p").events?.length ?? 0) > 0);
  assert.equal((visibleStateFor(world, "r").events?.length ?? 0), 0);
});

test("another player never receives my private damage numbers", () => {
  const world = testWorld();
  const mine = addPlayer(world, "p");
  addPlayer(world, "q");
  mine.damage.hull = 1200;
  mine.damage.sails = 3;
  mine.lastCombatRealMs = 0;
  const other = visibleStateFor(world, "q");
  const publicShip = other.ships.find((ship) => ship[0] === mine.id);
  assert.ok(publicShip);
  assert.equal(publicShip.length, 9);
  assert.equal(other.fleet.some((ship) => ship.id === mine.id), false);
  const ownState = visibleStateFor(world, "p");
  assert.ok(ownState.fleet[0]?.damage);
  assert.ok(ownState.fleet[0]?.damagePoints);
});

test("the enemy helper works only in test and dev rooms", () => {
  const normal = createWorld("main");
  addPlayer(normal, "p");
  assert.equal(spawnTestEnemyFleet(normal, "p", "frigate:1"), 0);
  assert.equal(normal.botFleets.has("TEST-ENEMY"), false);

  const dev = createWorld("dev-combat");
  addPlayer(dev, "p");
  assert.equal(spawnTestEnemyFleet(dev, "p", "frigate:1"), 1);
  assert.equal(dev.botFleets.get("TEST-ENEMY")?.length, 1);
});

test("a fleet engage suspends formation and a new fleet order restores it", () => {
  const world = testWorld();
  addPlayer(world, "p");
  spawnTestFleet(world, "p", "frigate:1");
  spawnTestEnemyFleet(world, "p", "frigate:1");
  const enemy = world.botFleets.get("TEST-ENEMY")![0]!;
  const own = shipsForOwner(world, "p");
  const fleet = createPlayerFleet(world, "p", own.map((ship) => ship.id));
  assert.ok(fleet);
  for (const ship of own) {
    ship.x = enemy.x - 0.4 - own.indexOf(ship) * 0.05;
    ship.y = enemy.y;
  }
  assert.equal(
    applyFleetOrder(world, "p", fleet.id, { type: "engage", shipId: enemy.id, objective: "sink" }),
    true,
  );
  assert.equal(world.fleetCommands.get(fleet.id)?.order.type, "engage");
  assert.equal(own.every((ship) => world.engagements.has(ship.id)), true);

  assert.equal(applyFleetOrder(world, "p", fleet.id, { type: "hold" }), true);
  assert.equal(world.engagements.size, 0);
  assert.equal(world.fleetCommands.get(fleet.id)?.order.type, "hold");

  assert.equal(applyFleetOrder(world, "p", fleet.id, { type: "goTo", x: own[0]!.x + 2, y: own[0]!.y }), true);
  assert.equal(world.fleetCommands.get(fleet.id)?.order.type, "goTo");
  assert.equal(world.engagements.size, 0);
});

test("repairs run only after the 30 second combat timer", () => {
  const world = testWorld();
  const ship = addPlayer(world, "p");
  ship.damage.hull = 2600;
  ship.stores.repairMaterials = 100;
  ship.lastCombatRealMs = 0;
  const before = ship.damage.hull;
  stepWorld(world, 10);
  assert.equal(ship.damage.hull, before, "no repairs while in combat");

  ship.lastCombatRealMs = -100_000;
  stepWorld(world, 60);
  assert.ok(ship.damage.hull > before, "repairs resume after the timer");
});

test("the repair toggle can be turned off and on by the owner", () => {
  const world = testWorld();
  const ship = addPlayer(world, "p");
  assert.equal(setPlayerRepair(world, "p", ship.id, false), true);
  assert.equal(ship.repairEnabled, false);
  assert.equal(setPlayerRepair(world, "p", ship.id, true), true);
  assert.equal(ship.repairEnabled, true);
  assert.equal(setPlayerRepair(world, "q", ship.id, true), false);
});

test("the battle log is private and battle notices are throttled", () => {
  const world = testWorld();
  const own = addPlayer(world, "p");
  const far = addPlayer(world, "q");
  far.x += 40;
  far.y += 40;
  spawnTestEnemyFleet(world, "p", "frigate:1");
  const enemy = world.botFleets.get("TEST-ENEMY")![0]!;
  enemy.x = own.x + 0.4;
  enemy.y = own.y;
  own.headingRad = 0;
  applyShipSpecialOrder(world, "p", own.id, { type: "engage", shipId: enemy.id, objective: "sink" });
  for (let index = 0; index < 5; index += 1) stepWorld(world, 14.4);
  const mine = visibleStateFor(world, "p");
  assert.ok((mine.log?.length ?? 0) > 0);
  assert.ok(mine.log?.every((line) => /your/i.test(line)));
  assert.equal(visibleStateFor(world, "q").log, undefined);
  const notices = world.notices.get("p") ?? [];
  assert.equal(notices.filter((text) => text === "Battle begun.").length, 1);
  for (let index = 0; index < 20; index += 1) stepWorld(world, 14.4);
  assert.equal(
    (world.notices.get("p") ?? []).filter((text) => text === "Battle begun.").length,
    1,
  );
});

test("port repair charges exactly the quoted pay cost and NPC ports refuse", () => {
  const world = testWorld();
  const ship = addPlayer(world, "p");
  const port = [...world.ports.values()].find((candidate) => !candidate.npc)!;
  ship.dockedPortId = port.id;
  ship.x = port.anchorage.x;
  ship.y = port.anchorage.y;
  ship.damage.hull = ship.damage.hull * 0.4;
  world.charts.get("p")!.foundPorts.add(port.id);
  world.owners.get("p")!.money = 50_000;
  const quoted = visibleStateFor(world, "p").fleet[0]?.portRepair;
  assert.ok(quoted);
  assert.equal(quoted!.active, false);
  const before = world.owners.get("p")!.money;
  const materialsBefore = ship.stores.repairMaterials;
  assert.equal(repairAtPort(world, "p", ship.id, port.id, "pay"), true);
  assert.equal(world.owners.get("p")!.money, before - quoted!.money);
  assert.equal(ship.portRepair?.mode, "pay");
  assert.equal(ship.stores.repairMaterials, materialsBefore);

  const npc = [...world.ports.values()].find((candidate) => candidate.npc)!;
  ship.dockedPortId = npc.id;
  world.charts.get("p")!.foundPorts.add(npc.id);
  assert.equal(repairAtPort(world, "p", ship.id, npc.id, "stores"), false);
});

test("a first broadside that misses still starts the battle and warns the target", () => {
  const world = testWorld();
  const shooter = addPlayer(world, "p");
  const target = addPlayer(world, "q", "frigate", 50_000, "French");
  target.x = shooter.x + 0.45;
  target.y = shooter.y;
  shooter.headingRad = 0;
  target.headingRad = 0;
  world.combatRandom = () => 0.99;
  assert.equal(
    applyShipSpecialOrder(world, "p", shooter.id, {
      type: "engage",
      shipId: target.id,
      objective: "sink",
    }),
    true,
  );
  for (let index = 0; index < 3; index += 1) stepWorld(world, 14.4);
  assert.equal(world.combatEvents.filter((event) => event.kind === "hit").length, 0);
  assert.ok(world.combatEvents.some((event) => event.kind === "miss"));
  assert.ok((world.notices.get("p") ?? []).includes("Battle begun."));
  assert.ok((world.notices.get("q") ?? []).includes("Battle begun."));
  assert.ok((world.notices.get("q") ?? []).includes("Ship under fire."));
});

test("test rooms expose the why-not-firing line but normal rooms do not", () => {
  const world = testWorld();
  addPlayer(world, "p");
  assert.equal(spawnTestEnemyFleet(world, "p", "frigate:1"), 1);
  const own = shipsForOwner(world, "p")[0]!;
  own.headingRad = 0;
  const enemy = world.botFleets.get("TEST-ENEMY")![0]!;
  own.stores.ammunition = 100;
  enemy.x = own.x + 1;
  enemy.y = own.y;
  assert.equal(applyShipSpecialOrder(world, "p", own.id, {
    type: "engage", shipId: enemy.id, objective: "sink",
  }), true);
  for (let index = 0; index < 100; index += 1) stepWorld(world, 14.4);
  const snapshot = visibleStateFor(world, "p").fleet[0]!;
  assert.match(snapshot.debugCombat ?? "", /^Order: Sink\. Step: /);
  assert.match(snapshot.debugCombat ?? "", /(Not firing|Guns ready)/);
  assert.ok(["Sailing", "Hove to", "In irons", "Drifting"].includes(snapshot.stateLabel ?? ""));

  const normal = createWorld("normal-readout");
  addPlayer(normal, "p");
  assert.equal(visibleStateFor(normal, "p").fleet[0]?.debugCombat, undefined);
  assert.equal(visibleStateFor(normal, "p").fleet[0]?.stateLabel, "Hove to");
});
