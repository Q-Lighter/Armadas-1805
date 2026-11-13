// Part B: money, fleets, buying, delivery, crew and private state.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { isSeaAt } from "@naval/shared/land";
import { findPortByName } from "@naval/shared/ports";
import { shipTypeFor } from "@naval/shared/ships";
import { deliveryGameMs, parseShipClass } from "@naval/shared/ship-rules";
import {
  addPlayer,
  applyOrder,
  applyPortOrder,
  buyShip,
  createWorld,
  hireCrew,
  ownerMoney,
  portCrewPool,
  selectShip,
  selectedShip,
  stepWorld,
  takeNotice,
  visibleStateFor,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;

function pointNear(point: { x: number; y: number }, distanceKm: number) {
  for (let ray = 0; ray < 72; ray += 1) {
    const angle = (ray / 72) * Math.PI * 2;
    const candidate = {
      x: point.x + Math.sin(angle) * distanceKm,
      y: point.y - Math.cos(angle) * distanceKm,
    };
    if (isSeaAt(candidate.x, candidate.y)) return candidate;
  }
  throw new Error("no sea point found");
}

function markFound(
  world: ReturnType<typeof createWorld>,
  playerId: string,
  portId: string,
): void {
  world.charts.get(playerId)!.foundPorts.add(portId);
}

function drainNotices(world: ReturnType<typeof createWorld>, playerId: string): string[] {
  const notices: string[] = [];
  for (;;) {
    const notice = takeNotice(world, playerId);
    if (notice === null) return notices;
    notices.push(notice);
  }
}

function stepUntil(world: ReturnType<typeof createWorld>, check: () => boolean, limit: number): number {
  let ticks = 0;
  while (!check() && ticks < limit) {
    stepWorld(world, TICK);
    ticks += 1;
  }
  return ticks;
}

test("normal starts use the fully crewed national flagship and no money", () => {
  const world = createWorld("main");
  const ship = addPlayer(world, "alpha");
  assert.equal(ship.classId, "flagship");
  assert.equal(ship.navy, "British");
  assert.equal(ship.name.length > 0, true);
  assert.equal(ship.crew, ship.fullCrew);
  assert.equal(ship.fullCrew, shipTypeFor("British", "flagship").crew);
  assert.equal(ownerMoney(world, "alpha"), 0);
  assert.equal(visibleStateFor(world, "alpha").m, 0);
});

test("test and dev starts choose a class and money, including cash override", () => {
  assert.equal(parseShipClass("FLAGSHIP"), "flagship");
  assert.equal(parseShipClass("line"), "line");
  assert.equal(parseShipClass("sloop"), null);

  const world = createWorld("test-start", { shipClass: "line", startMoney: 123 });
  const ship = addPlayer(world, "alpha");
  assert.equal(ship.classId, "line");
  assert.equal(ship.crew, ship.fullCrew);
  assert.equal(ownerMoney(world, "alpha"), 123);

  const override = createWorld("dev-start");
  addPlayer(override, "beta", "frigate", 777);
  assert.equal(ownerMoney(override, "beta"), 777);
  assert.equal(ownerMoney(createWorld("main"), "nobody"), 0);
});

test("buying refuses no money, wrong port size and an unowned normal port", () => {
  const small = findPortByName("Matanzas")!;
  assert.equal(small.size, "S");
  const world = createWorld("test-buy");
  const ship = addPlayer(world, "alpha");
  markFound(world, "alpha", small.id);
  world.owners.get("alpha")!.money = 500;

  assert.equal(buyShip(world, "alpha", small.id, "raider", "Little Wing"), null);
  assert.equal(world.fleets.get("alpha")!.length, 1);
  assert.deepEqual(drainNotices(world, "alpha"), ["Not enough money."]);

  world.owners.get("alpha")!.money = 50_000;
  // A small capturable port sells raiders and escort brigs, not frigates.
  const escort = buyShip(world, "alpha", small.id, "escort", "Little Escort");
  assert.ok(escort);
  assert.equal(buyShip(world, "alpha", small.id, "frigate", "Too Big"), null);
  assert.match(drainNotices(world, "alpha").at(-1)!, /does not sell that ship/);
  assert.equal(world.fleets.get("alpha")!.length, 2);

  // A normal room has no owned ports, so its shipyard is closed.
  const normal = createWorld("main");
  addPlayer(normal, "alpha");
  normal.owners.get("alpha")!.money = 50_000;
  markFound(normal, "alpha", small.id);
  assert.equal(buyShip(normal, "alpha", small.id, "raider", "Closed"), null);
  assert.deepEqual(
    drainNotices(normal, "alpha"),
    ["You must own a port to buy ships here."],
  );

  // NPC ports never sell, even in a test room.
  const npc = findPortByName("Montego Bay")!;
  assert.equal(npc.npc, true);
  markFound(world, "alpha", npc.id);
  assert.equal(buyShip(world, "alpha", npc.id, "raider", "Neutral"), null);
  assert.match(drainNotices(world, "alpha").at(-1)!, /does not sell ships/);

  assert.equal(ship.dockedPortId, null);
});

test("a bought ship is delivered empty after game time and then docks", () => {
  const port = findPortByName("Matanzas")!;
  const world = createWorld("test-delivery");
  const starter = addPlayer(world, "alpha");
  world.owners.get("alpha")!.money = 50_000;
  markFound(world, "alpha", port.id);

  const bought = buyShip(world, "alpha", port.id, "raider", "Kestrel");
  assert.ok(bought);
  assert.equal(world.fleets.get("alpha")!.length, 2);
  assert.equal(ownerMoney(world, "alpha"), 49_000);
  assert.equal(bought.crew, 0);
  assert.equal(bought.fullCrew, shipTypeFor("British", "raider").crew);
  assert.equal(bought.deliveryPortId, port.id);
  assert.equal(bought.deliveryReadyGameMs, deliveryGameMs("test", "raider"));

  const before = visibleStateFor(world, "alpha");
  const mine = before.fleet.find((ship) => ship.id === bought.id)!;
  assert.equal(mine.status, "delivery");
  assert.equal(mine.deliveryLeftMs, deliveryGameMs("test", "raider"));
  assert.equal(before.ships.some(([id]) => id === bought.id), false);

  assert.equal(selectShip(world, "alpha", bought.id), false);
  for (let tick = 0; tick < 10; tick += 1) stepWorld(world, TICK);
  const pausedAt = bought.deliveryReadyGameMs - world.gameMs;
  assert.equal(bought.deliveryPortId, port.id);
  assert.equal(world.gameMs, TICK * 10 * 1_000);
  assert.equal(bought.deliveryReadyGameMs - world.gameMs, pausedAt);

  const ticks = stepUntil(world, () => bought.deliveryPortId === null, 700);
  assert.ok(ticks <= 600, `delivery took ${ticks} ticks`);
  assert.equal(bought.crew, 0);
  assert.equal(bought.dockedPortId, port.id);
  assert.equal(bought.waitingPortId, null);
  assert.equal(selectShip(world, "alpha", bought.id), true);
  assert.equal(selectedShip(world, "alpha")?.id, bought.id);

  const after = visibleStateFor(world, "alpha");
  assert.equal(after.fleet.find((ship) => ship.id === bought.id)?.status, "docked");
  assert.equal(after.fleet.find((ship) => ship.id === bought.id)?.crew, 0);
  assert.equal(after.sel, bought.id);

  drainNotices(world, "alpha");
  assert.equal(applyOrder(world, "alpha", bought.x + 10, bought.y, bought.id), false);
  assert.deepEqual(drainNotices(world, "alpha"), ["Needs crew."]);

  // The starter ship is unaffected and can still sail.
  assert.equal(applyOrder(world, "alpha", starter.x + 20, starter.y, starter.id), true);
});

test("the 30-ship cap counts ships still being delivered", () => {
  const port = findPortByName("Kingston")!;
  const world = createWorld("test-cap");
  addPlayer(world, "alpha");
  const owner = world.owners.get("alpha")!;
  owner.money = 1_000_000;
  markFound(world, "alpha", port.id);

  for (let index = 0; index < 29; index += 1) {
    const ship = buyShip(world, "alpha", port.id, "raider", `Packet ${index + 1}`);
    assert.ok(ship, `purchase ${index + 1}`);
    assert.equal(ship.crew, 0);
  }
  const fleet = world.fleets.get("alpha")!;
  assert.equal(fleet.length, settings.ships.maxShipsPerPlayer);
  assert.equal(fleet.filter((ship) => ship.deliveryPortId !== null).length, 29);

  owner.money = 1_000_000;
  assert.equal(buyShip(world, "alpha", port.id, "raider", "One Too Many"), null);
  assert.equal(fleet.length, 30);
  assert.equal(owner.money, 1_000_000);
  assert.match(drainNotices(world, "alpha").at(-1)!, /Over the ship limit \(31 of 30\)/);
});

test("hiring is limited by complement, money and the shared port pool", () => {
  const port = findPortByName("Montego Bay")!;
  const world = createWorld("test-hire");
  const alpha = addPlayer(world, "alpha");
  const near = pointNear(port.anchorage, 1);
  alpha.x = near.x;
  alpha.y = near.y;
  markFound(world, "alpha", port.id);
  assert.equal(applyPortOrder(world, "alpha", port.id, alpha.id), true);
  alpha.crew = 0;
  world.owners.get("alpha")!.money = 1_000;

  const pool = portCrewPool(world, port);
  assert.equal(pool.crew, settings.ports.sizes.S.crewPool);
  assert.equal(hireCrew(world, "alpha", alpha.id, port.id, 10), true);
  assert.equal(alpha.crew, 10);
  assert.equal(pool.crew, 190);
  assert.equal(ownerMoney(world, "alpha"), 950);

  assert.equal(
    hireCrew(world, "alpha", alpha.id, port.id, alpha.fullCrew),
    false,
    "over the complement",
  );

  pool.crew = 3;
  assert.equal(hireCrew(world, "alpha", alpha.id, port.id, 4), false);
  assert.equal(alpha.crew, 10);

  world.owners.get("alpha")!.money = 0;
  pool.crew = 200;
  assert.equal(hireCrew(world, "alpha", alpha.id, port.id, 1), false);
  assert.equal(alpha.crew, 10);

  // A second player at the same berth draws on the same pool.
  const beta = addPlayer(world, "beta");
  const betaNear = pointNear(port.anchorage, 1);
  beta.x = betaNear.x;
  beta.y = betaNear.y;
  markFound(world, "beta", port.id);
  assert.equal(applyPortOrder(world, "beta", port.id, beta.id), true);
  beta.crew = 0;
  world.owners.get("beta")!.money = 1_000;
  pool.crew = 50;
  assert.equal(hireCrew(world, "beta", beta.id, port.id, 20), true);
  assert.equal(beta.crew, 20);
  assert.equal(pool.crew, 30);
  assert.equal(ownerMoney(world, "beta"), 900);

  // The refill uses real minutes, so a half pool refill takes 12.5 minutes.
  pool.crew = 0;
  stepWorld(world, 12.5 * 60 * settings.time.sailingTimeScale);
  assert.ok(Math.abs(pool.crew - settings.ports.sizes.S.crewPool / 2) < 1e-9);
});

test("one player never receives another player's fleet details", () => {
  const port = findPortByName("Kingston")!;
  const world = createWorld("test-private");
  addPlayer(world, "alpha");
  addPlayer(world, "beta");
  world.owners.get("alpha")!.money = 40_000;
  world.owners.get("beta")!.money = 50_000;
  markFound(world, "alpha", port.id);

  const bought = buyShip(world, "alpha", port.id, "raider", "Secret Kestrel");
  assert.ok(bought);
  const betaState = visibleStateFor(world, "beta");
  const text = JSON.stringify(betaState);
  assert.equal(betaState.m, 50_000);
  assert.equal(betaState.fleet.length, 1);
  assert.equal(betaState.fleet[0]!.id, "beta");
  assert.equal(text.includes("Secret Kestrel"), false);
  assert.equal(text.includes('"m":40000'), false);
  assert.ok(betaState.ships.every((ship) => ship.length === 9));

  const alphaState = visibleStateFor(world, "alpha");
  assert.equal(alphaState.fleet.some((ship) => ship.name === "Secret Kestrel"), true);
});

test("orders and selection reject a ship owned by someone else", () => {
  const world = createWorld("test-select");
  const alpha = addPlayer(world, "alpha");
  const beta = addPlayer(world, "beta");

  assert.equal(selectShip(world, "alpha", beta.id), false);
  assert.equal(selectShip(world, "alpha", alpha.id), true);
  assert.equal(selectedShip(world, "alpha")?.id, alpha.id);
  assert.equal(applyOrder(world, "alpha", alpha.x + 10, alpha.y, beta.id), false);
  assert.equal(applyOrder(world, "alpha", alpha.x + 10, alpha.y, "missing"), false);
  assert.equal(applyOrder(world, "alpha", alpha.x + 10, alpha.y, alpha.id), true);
});
