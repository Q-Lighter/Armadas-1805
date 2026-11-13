import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { findPortByName } from "@naval/shared/ports";
import { shipTypeFor } from "@naval/shared/ships";
import { createShip, holdPosition } from "@naval/shared/sailing";
import { formationSlots } from "@naval/shared/fleets";
import {
  contactAttackGivenUp,
  fireShipsUnlocked,
  igniteRefusal,
  isDaylightHour,
  isTowerClass,
  towRefusal,
  towSpeedKnots,
  withinNightLightsOffRange,
} from "@naval/shared/fire-ship";
import {
  addPlayer,
  buyShip,
  castOffTow,
  createWorld,
  orderFireShipIgnite,
  orderTowFireShip,
  setShipLights,
  setTestTimeOfDay,
  spawnTestAnchoredFleet,
  spawnTestFireShips,
  stepWorld,
  takeNotice,
  visibleStateFor,
  type World,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const FS = settings.ships.fireShips;

function drain(world: World, playerId: string): string[] {
  const out: string[] = [];
  for (;;) {
    const notice = takeNotice(world, playerId);
    if (notice === null) return out;
    out.push(notice);
  }
}

function fireShipFor(world: World, playerId: string) {
  const ship = world.fleets.get(playerId)!.find((candidate) => candidate.classId === "fireShip");
  assert.ok(ship);
  return ship;
}

function enemyFrigate(world: World, x: number, y: number, headingRad = 0) {
  const ship = createShip(
    `test-enemy-${world.nextShipId++}`,
    "frigate",
    x,
    y,
    headingRad,
    "French",
    "Test frigate",
  );
  ship.crew = ship.fullCrew;
  ship.damage.crew = ship.crew;
  holdPosition(ship);
  world.botFleets.set("TEST-ENEMY", [...(world.botFleets.get("TEST-ENEMY") ?? []), ship]);
  return ship;
}

test("3G fire ship type: agreed stats, one type for every navy, crew sizing", () => {
  assert.equal(settings.ships.prices.fireShip, 500);
  for (const navy of ["British", "French", "Spanish", "Dutch"] as const) {
    const type = shipTypeFor(navy, "fireShip");
    const raider = shipTypeFor(navy, "raider");
    assert.equal(type.name, "Fire ship");
    assert.equal(type.cruiseKnots, 4);
    assert.equal(type.topKnots, 6);
    assert.equal(type.hull, 400);
    assert.equal(type.draughtM, 2.5);
    assert.equal(type.cargoTonnes, 0);
    assert.equal(type.guns, 0);
    assert.equal(type.crew, Math.max(3, Math.ceil(raider.crew * 0.1)));
    assert.ok(type.turn90GameMinutes > raider.turn90GameMinutes);
  }
});

test("3G research hook and buying: test rooms yes, normal rooms locked, NPC never", () => {
  assert.equal(fireShipsUnlocked("normal"), false);
  assert.equal(fireShipsUnlocked("test"), true);
  assert.equal(fireShipsUnlocked("dev"), true);

  const port = findPortByName("Matanzas")!;
  const world = createWorld("test-fire-buy");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  world.charts.get("alpha")!.foundPorts.add(port.id);
  const ship = buyShip(world, "alpha", port.id, "fireShip", "Brand");
  assert.ok(ship);
  assert.equal(ship.classId, "fireShip");
  assert.equal(ship.crew, 0);
  assert.equal(ship.fullCrew, shipTypeFor("British", "fireShip").crew);
  assert.equal(world.owners.get("alpha")!.money, 49_500);

  const normal = createWorld("main");
  addPlayer(normal, "alpha");
  normal.charts.get("alpha")!.foundPorts.add(port.id);
  normal.owners.get("alpha")!.money = 50_000;
  const noBuy = buyShip(normal, "alpha", port.id, "fireShip", "Locked");
  assert.equal(noBuy, null);
  assert.match(drain(normal, "alpha").at(-1)!, /Needs research/);
});

test("3G pure rules: ignition refusals, tow classes and 60% turn", () => {
  assert.equal(igniteRefusal({
    isFireShip: true, ignited: false, towed: false, mode: "now",
  }), null);
  assert.equal(igniteRefusal({
    isFireShip: true, ignited: false, towed: true, mode: "now",
  }), "towed");
  assert.equal(igniteRefusal({
    isFireShip: true, ignited: false, towed: false, mode: "contact", targetIsPort: true,
  }), "target is a port");

  for (const tower of ["frigate", "line", "flagship"] as const) {
    assert.equal(isTowerClass(tower), true);
    assert.equal(towRefusal({
      towerClass: tower, towClass: "fireShip", towIgnited: false,
      distanceM: 100, towerBusy: false,
    }), null);
  }
  for (const other of ["raider", "escort", "trade"] as const) {
    assert.equal(isTowerClass(other), false);
    assert.equal(towRefusal({
      towerClass: other, towClass: "fireShip", towIgnited: false,
      distanceM: 100, towerBusy: false,
    }), "only a frigate, line ship or flagship can tow");
  }
  assert.equal(towSpeedKnots(9), 7);
  assert.equal(towSpeedKnots(1), 0);
  assert.equal(contactAttackGivenUp(149), false);
  assert.equal(contactAttackGivenUp(150), true);
});

test("3G Ignite now: crew escape, fire 100, speed falls, then the hulk drifts", () => {
  const world = createWorld("test-ignite-now");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  assert.equal(spawnTestFireShips(world, "alpha", 1), 1);
  const fire = fireShipFor(world, "alpha");
  fire.speedKnots = 6;
  assert.equal(orderFireShipIgnite(world, "alpha", fire.id, "now"), true);
  assert.equal(fire.crew, 0);
  assert.equal(fire.fire?.burning, true);
  assert.equal(fire.fire?.strength, FS.burnStrength);
  assert.equal(fire.fireShip?.ignited, true);
  assert.match(drain(world, "alpha").join("|"), /Fire ship ignited/);

  for (let index = 0; index < 30; index += 1) stepWorld(world, TICK);
  assert.ok(fire.speedKnots <= 6);
  for (let index = 0; index < 300; index += 1) stepWorld(world, TICK);
  assert.equal(fire.speedKnots <= 0.5, true);
});

test("3G contact ignition at 100 m and the low-hull trigger", () => {
  const world = createWorld("test-ignite-contact");
  const leader = addPlayer(world, "alpha", "frigate", 50_000, "British");
  spawnTestFireShips(world, "alpha", 1);
  const fire = fireShipFor(world, "alpha");
  fire.x = leader.x + 0.2;
  fire.y = leader.y;
  const target = enemyFrigate(world, fire.x + 0.5, fire.y);
  assert.equal(orderFireShipIgnite(world, "alpha", fire.id, "contact", target.id), true);
  for (let index = 0; index < 500 && fire.fireShip?.ignited !== true; index += 1) {
    stepWorld(world, TICK);
  }
  assert.equal(fire.fireShip?.ignited, true);
  // Spread is a chance per second under the normal fire rules, so let the
  // burning hulk sit beside the target long enough for one ignition roll.
  for (let index = 0; index < 3_000 && target.fire?.burning !== true; index += 1) {
    stepWorld(world, TICK);
  }
  assert.equal(target.fire?.burning, true);
});

test("3G contact gives up when the target is faster and after 150 seconds", () => {
  const world = createWorld("test-ignite-fast");
  const leader = addPlayer(world, "alpha", "frigate", 50_000, "British");
  spawnTestFireShips(world, "alpha", 1);
  const fire = fireShipFor(world, "alpha");
  fire.x = leader.x + 0.2;
  const target = enemyFrigate(world, fire.x + 4, leader.y);
  target.speedKnots = 13;
  assert.equal(orderFireShipIgnite(world, "alpha", fire.id, "contact", target.id), true);
  stepWorld(world, TICK);
  assert.equal(fire.fireShip?.gaveUp, true);
  assert.match(drain(world, "alpha").join("|"), /Cannot reach: target is faster/);
  assert.equal(fire.speedKnots, 0);
});

test("3G low hull ignites at once even out of contact range", () => {
  const world = createWorld("test-ignite-hull");
  const leader = addPlayer(world, "alpha", "frigate", 50_000, "British");
  spawnTestFireShips(world, "alpha", 1);
  const fire = fireShipFor(world, "alpha");
  fire.x = leader.x + 0.2;
  const target = enemyFrigate(world, fire.x + 2, leader.y);
  fire.damage.hull = 100;
  assert.equal(orderFireShipIgnite(world, "alpha", fire.id, "contact", target.id), true);
  stepWorld(world, TICK);
  assert.equal(fire.fireShip?.ignited, true);
});

test("3G an ignited hulk burns away and sinks", () => {
  const world = createWorld("test-fire-burn-out");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  spawnTestFireShips(world, "alpha", 1);
  const fire = fireShipFor(world, "alpha");
  assert.equal(orderFireShipIgnite(world, "alpha", fire.id, "now"), true);
  fire.damage.hull = 0.05;
  for (let index = 0; index < 20; index += 1) stepWorld(world, TICK);
  assert.equal(world.sinkingShips.some((entry) => entry.ship.id === fire.id), true);
  assert.equal(world.fleets.get("alpha")!.some((ship) => ship.id === fire.id), false);
});

test("3G sinking before ignition reports the notice and never ignites", () => {
  const world = createWorld("test-fire-sink");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  spawnTestFireShips(world, "alpha", 1);
  const fire = fireShipFor(world, "alpha");
  fire.damage.hull = 0;
  stepWorld(world, TICK);
  assert.equal(fire.fireShip?.ignited, undefined);
  assert.match(drain(world, "alpha").join("|"), /Fire ship sunk before ignition/);
});

test("3G towing follows 120 m behind at tower speed less 2 knots; cast off holds", () => {
  const world = createWorld("test-tow");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  const tower = world.fleets.get("alpha")![0]!;
  spawnTestFireShips(world, "alpha", 1);
  const fire = fireShipFor(world, "alpha");
  fire.x = tower.x + 0.1;
  fire.y = tower.y;
  tower.speedKnots = 9;
  assert.equal(orderTowFireShip(world, "alpha", tower.id, fire.id), true);
  assert.equal(fire.towerShipId, tower.id);
  stepWorld(world, TICK);
  assert.ok(Math.abs(Math.hypot(tower.x - fire.x, tower.y - fire.y) * 1000 - 120) < 0.01);
  assert.ok(fire.speedKnots <= 7.01);

  assert.equal(orderFireShipIgnite(world, "alpha", fire.id, "now"), false);
  assert.match(drain(world, "alpha").join("|"), /Cast off first/);
  assert.equal(castOffTow(world, "alpha", tower.id), true);
  assert.equal(tower.towedShipId, null);
  assert.equal(fire.towerShipId, null);
  assert.equal(fire.speedKnots, 0);
});

test("3G auto cast off when a towed pair is in battle, and one tow per tower", () => {
  const world = createWorld("test-tow-battle");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  const tower = world.fleets.get("alpha")![0]!;
  spawnTestFireShips(world, "alpha", 2);
  const fires = world.fleets.get("alpha")!.filter((ship) => ship.classId === "fireShip");
  fires[0]!.x = tower.x + 0.1;
  fires[1]!.x = tower.x - 0.1;
  assert.equal(orderTowFireShip(world, "alpha", tower.id, fires[0]!.id), true);
  assert.equal(orderTowFireShip(world, "alpha", tower.id, fires[1]!.id), false);
  enemyFrigate(world, tower.x + 2, tower.y);
  tower.lastCombatRealMs = 1_000_000;
  stepWorld(world, TICK);
  assert.equal(tower.towedShipId ?? null, null);
  assert.match(drain(world, "alpha").join("|"), /Tow cast off: battle nearby/);
});

test("3G lights matter only at night and never for capture", () => {
  const world = createWorld("test-lights");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  const own = world.fleets.get("alpha")![0]!;
  const enemy = enemyFrigate(world, own.x + 7, own.y);
  enemy.lightsOff = false;

  let state = visibleStateFor(world, "alpha");
  assert.ok(state.ships.some((ship) => ship[0] === enemy.id));

  setTestTimeOfDay(world, 23);
  state = visibleStateFor(world, "alpha");
  assert.equal(state.ships.some((ship) => ship[0] === enemy.id), true);

  enemy.lightsOff = true;
  state = visibleStateFor(world, "alpha");
  assert.equal(state.ships.some((ship) => ship[0] === enemy.id), false);

  enemy.x = own.x + 4;
  state = visibleStateFor(world, "alpha");
  assert.equal(state.ships.some((ship) => ship[0] === enemy.id), true);

  assert.equal(withinNightLightsOffRange(false, false, 25), true);
  assert.equal(withinNightLightsOffRange(true, true, 25), true);
  assert.equal(withinNightLightsOffRange(false, true, 6), false);
  assert.equal(isDaylightHour(6), true);
  assert.equal(isDaylightHour(18), false);
});

test("3G test helpers only run in test/dev rooms and convoy protects a fire ship", () => {
  const normal = createWorld("main");
  addPlayer(normal, "alpha");
  assert.equal(spawnTestFireShips(normal, "alpha", 2), 0);
  assert.equal(spawnTestAnchoredFleet(normal, "alpha", "engage"), 0);

  const members = [
    { id: "leader", classId: "frigate" as const, speedKnots: 8 },
    { id: "fire", classId: "fireShip" as const, speedKnots: 4 },
    { id: "trade", classId: "trade" as const, speedKnots: 5 },
    { id: "escort", classId: "escort" as const, speedKnots: 8 },
  ];
  const slots = formationSlots({ formation: "convoy", members, headingRad: 0 });
  const fire = slots[1]!;
  const trade = slots[2]!;
  const forward = (slot: { x: number; y: number }) => -slot.y;
  assert.ok(forward(fire) < 0);
  assert.ok(Math.abs(forward(fire) - forward(trade)) < 1e-9);

  const world = createWorld("dev-fire-helper");
  addPlayer(world, "alpha");
  assert.equal(spawnTestAnchoredFleet(world, "alpha", "engage"), 5);
  assert.equal(world.botFleets.get("TEST-ENEMY")!.every((ship) => ship.hoveTo), true);
});

test("3G lights order is private and defaults on", () => {
  const world = createWorld("test-light-order");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  const ship = world.fleets.get("alpha")![0]!;
  assert.equal(ship.lightsOff, undefined);
  assert.equal(setShipLights(world, "alpha", ship.id, false), true);
  assert.equal(ship.lightsOff, true);
  const ownState = visibleStateFor(world, "alpha").fleet.find((row) => row.id === ship.id)!;
  assert.equal(ownState.lightsOn, false);
  setShipLights(world, "alpha", ship.id, true);
  assert.equal(ship.lightsOff, false);
});
