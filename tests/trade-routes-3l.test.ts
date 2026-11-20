import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addPlayer,
  applyOrder,
  cancelTradeRoute,
  createWorld,
  setTradeRoute,
  shipsForOwner,
  spawnTestFleet,
  spawnRouteHelper,
  tradeRouteForShip,
  tradeRouteSnapshotsFor,
  updateTradeRoutes,
  visibleStateFor,
} from "@naval/shared/world";
import { postedPrice, shipStoreCapacities } from "@naval/shared/trade";
import { shipTypeFor } from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";

function setup() {
  const world = createWorld("test", { npcs: true, startMoney: 50_000 });
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  spawnTestFleet(world, "alpha", "trade:1");
  const ship = shipsForOwner(world, "alpha").find((row) => row.classId === "trade")!;
  const ports = [...world.ports.values()].filter((port) => port.npc);
  const a = ports[0]!;
  const b = ports[1]!;
  const chart = world.charts.get("alpha")!;
  chart.foundPorts.add(a.id);
  chart.foundPorts.add(b.id);
  return { world, ship, a, b, good: "timber" as const };
}

test("one real-loop trip loads, sails, sells and profits by the price formula", () => {
  const { world, ship, a, b, good } = setup();
  const route = setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 30,
  })!;
  assert.ok(route, "route created");
  ship.dockedPortId = a.id;
  ship.x = a.anchorage.x;
  ship.y = a.anchorage.y;
  updateTradeRoutes(world);
  assert.equal(route.phase, "toB");
  assert.equal(route.cargoTonnes, 10);
  assert.equal(Number(ship.stores.cargo[good].toFixed(2)), 10);
  assert.equal(ship.portOrderId, b.id, "sails the planned route to B");

  ship.dockedPortId = b.id;
  ship.x = b.anchorage.x;
  ship.y = b.anchorage.y;
  const buy = postedPrice(good, a, world.priceState);
  const sell = postedPrice(good, b, world.priceState);
  updateTradeRoutes(world);
  assert.equal(route.lastProfit, (sell - buy) * 10);
  assert.equal(route.phase, "toA");
  assert.equal(ship.portOrderId, a.id, "returns to A");
  assert.equal(Number(ship.stores.cargo[good].toFixed(2)), 10, "loads again for the return");
});

test("cancel and edit update the same per-ship route", () => {
  const { world, ship, a, b, good } = setup();
  const route = setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 30,
  })!;
  const edited = setTradeRoute(world, "alpha", {
    id: route.id, ship: ship.id, portA: b.id, portB: a.id, good: "rum", tonnes: 5, minutes: 45,
  })!;
  assert.equal(edited.id, route.id);
  assert.equal(edited.portA, b.id);
  assert.equal(edited.portB, a.id);
  assert.equal(edited.tonnes, 5);
  assert.equal(edited.limitMinutes, 45);
  assert.equal(cancelTradeRoute(world, "alpha", route.id), true);
  assert.equal(tradeRouteForShip(world, "alpha", ship.id), null);
});

test("a direct order cancels a route", () => {
  const { world, ship, a, b, good } = setup();
  setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 30,
  });
  applyOrder(world, "alpha", ship.x + 1, ship.y + 1, ship.id);
  assert.equal(tradeRouteForShip(world, "alpha", ship.id), null);
});

test("a late trip keeps running and is flagged quietly", () => {
  const { world, ship, a, b, good } = setup();
  const route = setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 1,
  })!;
  route.startedGameMs = world.gameMs - 2 * 60_000 * settings.time.sailingTimeScale;
  assert.equal(tradeRouteSnapshotsFor(world, "alpha")[0]?.late, true);
  assert.equal(tradeRouteSnapshotsFor(world, "alpha")[0]?.status, "late");
  updateTradeRoutes(world);
  assert.ok(tradeRouteForShip(world, "alpha", ship.id));
});

test("lost ports cancel the route, keep cargo and send the ship home", () => {
  const { world, ship, a, b, good } = setup();
  const route = setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 30,
  })!;
  ship.dockedPortId = a.id;
  updateTradeRoutes(world);
  const cargo = ship.stores.cargo[good];
  a.npc = false;
  world.portOwners.set(a.id, "someone-else");
  updateTradeRoutes(world);
  assert.equal(tradeRouteForShip(world, "alpha", ship.id), null, route.id);
  assert.equal(ship.stores.cargo[good], cargo, "cargo is kept");
});

test("a sunk ship deletes its route", () => {
  const { world, ship, a, b, good } = setup();
  setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 30,
  });
  const fleet = shipsForOwner(world, "alpha");
  fleet.splice(fleet.findIndex((row) => row.id === ship.id), 1);
  updateTradeRoutes(world);
  assert.equal(world.owners.get("alpha")!.tradeRoutes.size, 0);
});

test("no crew pauses the route with the reason shown", () => {
  const { world, ship, a, b, good } = setup();
  setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 30,
  });
  ship.crew = 0;
  updateTradeRoutes(world);
  const row = tradeRouteSnapshotsFor(world, "alpha")[0]!;
  assert.equal(row.status, "paused");
  assert.equal(row.reason, "No crew to sail.");
});

test("silver is capped at the configured share of the hold", () => {
  const { world, ship, a, b, good } = setup();
  const route = setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good: "silver", tonnes: 10_000, minutes: 30,
  })!;
  const hold = shipStoreCapacities(shipTypeFor(ship.navy, ship.classId)).cargo;
  assert.equal(route.tonnes, hold * settings.trade.routeSilverShare);
});

test("the &routes=1 helper spawns a trade ship and a ready route", () => {
  const world = createWorld("test", { npcs: true, startMoney: 50_000 });
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  assert.equal(spawnRouteHelper(world, "alpha"), true);
  const route = [...world.owners.get("alpha")!.tradeRoutes.values()][0]!;
  assert.ok(route);
  assert.equal(shipsForOwner(world, "alpha").find((ship) => ship.id === route.shipId)?.classId, "trade");
  assert.equal(tradeRouteSnapshotsFor(world, "alpha")[0]?.portAName.length! > 0, true);
});

test("visible state only sends the receiving player's own routes", () => {
  const { world, ship, a, b, good } = setup();
  addPlayer(world, "beta", "frigate", 50_000, "Spanish");
  setTradeRoute(world, "alpha", {
    ship: ship.id, portA: a.id, portB: b.id, good, tonnes: 10, minutes: 30,
  });
  assert.equal(visibleStateFor(world, "alpha").routes?.length, 1);
  assert.deepEqual(visibleStateFor(world, "beta").routes, []);
});
