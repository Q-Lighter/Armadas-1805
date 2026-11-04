// Part B: server-owned stores, trading, production, hunger and private state.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { findPortByName } from "@naval/shared/ports";
import { shipTypeFor } from "@naval/shared/ships";
import {
  addPlayer,
  buyGoods,
  buyShip,
  createWorld,
  hireCrew,
  npcStockFor,
  portStorageFor,
  resupplyShip,
  sellGoods,
  stepWorld,
  takeNotice,
  transferGoods,
  visibleStateFor,
  type World,
} from "@naval/shared/world";
import {
  addGoodToStores,
  cargoTotal,
  emptyGoods,
  goodAmount,
  shipStoreCapacities,
  totalGoods,
  type GoodsAmounts,
} from "@naval/shared/trade";
import type { PlacedPort } from "@naval/shared/ports";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const DAY_MS = settings.time.hoursPerDay * 60 * 60 * 1_000;

function markFound(world: World, playerId: string, portId: string): void {
  world.charts.get(playerId)!.foundPorts.add(portId);
}

function dock(world: World, playerId: string, port: PlacedPort): void {
  const ship = world.players.get(playerId)!;
  markFound(world, playerId, port.id);
  ship.x = port.anchorage.x;
  ship.y = port.anchorage.y;
  ship.dockedPortId = port.id;
  ship.waitingPortId = null;
  ship.portOrderId = null;
  ship.order = null;
  ship.speedKnots = 0;
}

function drainNotices(world: World, playerId: string): string[] {
  const notices: string[] = [];
  for (;;) {
    const notice = takeNotice(world, playerId);
    if (notice === null) return notices;
    notices.push(notice);
  }
}

function step(world: World, gameSeconds: number): void {
  stepWorld(world, gameSeconds);
}

function cap(port: PlacedPort): number {
  return settings.ports.sizes[port.size].storageTonnes;
}

test("starting ships are fully stored; bought ships are empty", () => {
  const normal = createWorld("main");
  const flagship = addPlayer(normal, "alpha");
  const type = shipTypeFor("British", "flagship");
  const capacities = shipStoreCapacities(type);
  assert.equal(flagship.stores.provisions, capacities.provisions);
  assert.equal(flagship.stores.ammunition, capacities.ammunition);
  assert.equal(flagship.stores.repairMaterials, capacities.repairMaterials);
  assert.equal(cargoTotal(flagship.stores.cargo), 0);
  assert.equal(flagship.starving, false);

  const testRoom = createWorld("test-stores", { startMoney: 50_000 });
  const starting = addPlayer(testRoom, "alpha");
  assert.equal(starting.stores.provisions, shipStoreCapacities(shipTypeFor("British", "frigate")).provisions);

  const port = findPortByName("Kingston")!;
  markFound(testRoom, "alpha", port.id);
  const bought = buyShip(testRoom, "alpha", port.id, "raider", "Tiny");
  assert.ok(bought);
  assert.equal(bought.crew, 0);
  assert.equal(bought.stores.provisions, 0);
  assert.equal(bought.stores.ammunition, 0);
  assert.equal(bought.stores.repairMaterials, 0);
  assert.equal(cargoTotal(bought.stores.cargo), 0);
});

test("buying respects NPC stock, money, cargo space and separate stores", () => {
  const world = createWorld("test-buy-goods", { startMoney: 10_000 });
  const ship = addPlayer(world, "alpha");
  const port = findPortByName("Montego Bay")!;
  assert.equal(port.npc, true);
  dock(world, "alpha", port);
  const stock = npcStockFor(world, port);
  stock.provisions = 2;
  ship.stores.provisions = 0;

  const moneyBefore = world.owners.get("alpha")!.money;
  assert.equal(buyGoods(world, "alpha", ship.id, port.id, "provisions", 10), true);
  assert.equal(stock.provisions, 0);
  assert.equal(ship.stores.provisions, 2);
  assert.ok(world.owners.get("alpha")!.money < moneyBefore);
  assert.match(drainNotices(world, "alpha").at(-1)!, /^Bought 2 t of Provisions/);

  // Stock is now zero, and the notice says so.
  assert.equal(buyGoods(world, "alpha", ship.id, port.id, "provisions", 1), false);
  assert.equal(drainNotices(world, "alpha").at(-1), "No stock at this port.");

  // Cargo resources share the hold.
  const cargoType = shipTypeFor("British", "frigate");
  addGoodToStores(ship.stores, "timber", cargoType.cargoTonnes - 1);
  stock.cloth = 50;
  assert.equal(buyGoods(world, "alpha", ship.id, port.id, "cloth", 10), true);
  assert.equal(ship.stores.cargo.cloth, 1);
  assert.equal(ship.stores.cargo.timber, cargoType.cargoTonnes - 1);

  // Money cannot buy a cargo load it cannot pay for.
  stock.ammunition = 100;
  world.owners.get("alpha")!.money = 1;
  assert.equal(buyGoods(world, "alpha", ship.id, port.id, "ammunition", 10), false);
  assert.equal(drainNotices(world, "alpha").at(-1), "Not enough money.");
});

test("selling creates money and only cargo goods can be sold", () => {
  const world = createWorld("test-sell-goods", { startMoney: 0 });
  const ship = addPlayer(world, "alpha");
  const port = findPortByName("Montego Bay")!;
  dock(world, "alpha", port);
  addGoodToStores(ship.stores, "rum", 10);
  addGoodToStores(ship.stores, "sugar", 5);

  assert.equal(sellGoods(world, "alpha", ship.id, port.id, "rum", 6), true);
  assert.equal(ship.stores.cargo.rum, 4);
  assert.ok(world.owners.get("alpha")!.money > 0);
  assert.match(drainNotices(world, "alpha").at(-1)!, /^Sold 6 t of Rum/);
  assert.equal(goodAmount(ship.stores, "provisions") > 0, true);

  const money = world.owners.get("alpha")!.money;
  assert.equal(sellGoods(world, "alpha", ship.id, port.id, "provisions", 1), false);
  assert.equal(world.owners.get("alpha")!.money, money);
});

test("selling into a usable port uses its storage and respects its limit", () => {
  const world = createWorld("main");
  const ship = addPlayer(world, "alpha");
  const port = findPortByName("Kingston")!;
  world.portOwners.set(port.id, "alpha");
  dock(world, "alpha", port);
  const storage = portStorageFor(world, port);
  for (const good of Object.keys(storage) as Array<keyof GoodsAmounts>) storage[good] = 0;
  storage.provisions = cap(port) - 2;
  addGoodToStores(ship.stores, "hides", 5);

  assert.equal(sellGoods(world, "alpha", ship.id, port.id, "hides", 5), true);
  assert.equal(storage.hides, 2);
  assert.equal(ship.stores.cargo.hides, 3);
  assert.equal(totalGoods(storage), cap(port));
  assert.equal(sellGoods(world, "alpha", ship.id, port.id, "hides", 1), false);
  assert.equal(drainNotices(world, "alpha").at(-1), "No space in the port's storage.");
});

test("a ship at a non-usable port cannot trade", () => {
  const world = createWorld("main");
  const ship = addPlayer(world, "alpha");
  const port = findPortByName("Kingston")!;
  markFound(world, "alpha", port.id);
  ship.dockedPortId = port.id;
  world.owners.get("alpha")!.money = 5_000;
  addGoodToStores(ship.stores, "hides", 2);

  assert.equal(buyGoods(world, "alpha", ship.id, port.id, "provisions", 1), false);
  assert.equal(sellGoods(world, "alpha", ship.id, port.id, "hides", 1), false);
  assert.equal(transferGoods(world, "alpha", ship.id, port.id, "hides", 1, "load"), false);

  // An NPC is fine for buying, but not for storage.
  const npc = findPortByName("Montego Bay")!;
  dock(world, "alpha", npc);
  assert.equal(transferGoods(world, "alpha", ship.id, npc.id, "provisions", 1, "load"), false);
});

test("loading and unloading respect both the ship and the port", () => {
  const world = createWorld("test-transfer", { startMoney: 0 });
  const ship = addPlayer(world, "alpha");
  const port = findPortByName("Kingston")!;
  dock(world, "alpha", port);
  const storage = portStorageFor(world, port);
  for (const good of Object.keys(storage) as Array<keyof GoodsAmounts>) storage[good] = 0;
  storage.hides = 5;

  assert.equal(transferGoods(world, "alpha", ship.id, port.id, "hides", 3, "load"), true);
  assert.equal(storage.hides, 2);
  assert.equal(ship.stores.cargo.hides, 3);
  assert.equal(transferGoods(world, "alpha", ship.id, port.id, "hides", 1, "unload"), true);
  assert.equal(storage.hides, 3);
  assert.equal(ship.stores.cargo.hides, 2);

  // The ship's cargo hold is the limit on loading.
  const type = shipTypeFor("British", "frigate");
  addGoodToStores(ship.stores, "timber", type.cargoTonnes);
  storage.cloth = 100;
  assert.equal(transferGoods(world, "alpha", ship.id, port.id, "cloth", 1, "load"), false);
  assert.equal(drainNotices(world, "alpha").at(-1), "No space in the ship's stores.");

  // Port storage is the limit on unloading.
  for (const good of Object.keys(storage) as Array<keyof GoodsAmounts>) storage[good] = 0;
  storage.provisions = cap(port);
  assert.equal(transferGoods(world, "alpha", ship.id, port.id, "hides", 1, "unload"), false);
  assert.equal(drainNotices(world, "alpha").at(-1), "No space in the port's storage.");
});

test("production runs every three game days and stops at the storage limit", () => {
  const world = createWorld("test-production");
  const port = findPortByName("Kingston")!;
  const storage = portStorageFor(world, port);
  const starting = totalGoods(storage);
  step(world, 3 * 24 * 60 * 60);
  assert.ok(totalGoods(storage) > starting);
  assert.ok(totalGoods(storage) <= cap(port));

  for (const good of Object.keys(storage) as Array<keyof GoodsAmounts>) {
    storage[good] = 0;
  }
  storage.sugar = cap(port);
  step(world, 3 * 24 * 60 * 60);
  assert.equal(totalGoods(storage), cap(port));
});

test("NPC stock refills each cycle and never exceeds its cap", () => {
  const world = createWorld("test-npc-cycle");
  const port = findPortByName("Montego Bay")!;
  const stock = npcStockFor(world, port);
  for (const good of Object.keys(stock) as Array<keyof GoodsAmounts>) stock[good] = 0;
  step(world, 3 * 24 * 60 * 60);
  assert.ok(stock.provisions > 0);
  assert.ok(stock.cloth > 0);
  assert.ok(stock.repairMaterials > 0);
  assert.ok(stock.ammunition > 0);
  const stockCap = settings.trade.production.npcStockCapTonnes[port.size];
  for (const good of Object.keys(stock) as Array<keyof GoodsAmounts>) {
    assert.ok(stock[good] <= stockCap);
  }
});

test("starvation only starts when provisions are zero", () => {
  const world = createWorld("test-starving", { hungerMultiplier: 1 });
  const ship = addPlayer(world, "alpha");
  const crew = ship.crew;
  step(world, 24 * 60 * 60);
  assert.equal(ship.crew, crew);
  assert.equal(ship.starving, false);

  ship.stores.provisions = 0;
  step(world, 24 * 60 * 60);
  assert.ok(ship.crew < crew);
  assert.ok(Math.abs(ship.crew - crew * 0.92) < 1e-9);
  assert.equal(ship.starving, true);
  assert.match(drainNotices(world, "alpha").join(" | "), /Starving/);
});

test("hunger scaling is ten times in test/dev and ordinary in normal rooms", () => {
  const normal = createWorld("main", { hungerMultiplier: 99 });
  assert.equal(normal.hungerMultiplier, settings.trade.normalHungerMultiplier);
  const slow = createWorld("test-hunger-slow", { hungerMultiplier: 1 });
  const fast = createWorld("test-hunger-fast", { hungerMultiplier: 10 });
  assert.equal(fast.hungerMultiplier, settings.trade.testHungerMultiplier);

  const slowShip = addPlayer(slow, "alpha");
  const fastShip = addPlayer(fast, "alpha");
  const slowStore = slowShip.stores.provisions;
  const fastStore = fastShip.stores.provisions;
  step(slow, 24 * 60 * 60);
  step(fast, 24 * 60 * 60);
  const slowUse = slowStore - slowShip.stores.provisions;
  const fastUse = fastStore - fastShip.stores.provisions;
  assert.ok(Math.abs(fastUse / slowUse - 10) < 1e-9);
});

test("the &hunger option only changes test and dev rooms", () => {
  const normal = createWorld("main", { hungerMultiplier: 3 });
  const testRoom = createWorld("test-hunger-option", { hungerMultiplier: 3 });
  const dev = createWorld("dev-hunger-option", { hungerMultiplier: 3 });
  assert.equal(normal.hungerMultiplier, 1);
  assert.equal(testRoom.hungerMultiplier, 3);
  assert.equal(dev.hungerMultiplier, 3);
  assert.equal(visibleStateFor(normal, "nobody").h, undefined);
  assert.equal(visibleStateFor(testRoom, "nobody").h, 3);
});

test("prices and storage are only sent to players who may see them", () => {
  const world = createWorld("main");
  const alpha = addPlayer(world, "alpha");
  addPlayer(world, "beta");
  const npc = findPortByName("Montego Bay")!;
  const owned = findPortByName("Kingston")!;
  dock(world, "alpha", npc);
  markFound(world, "alpha", owned.id);
  markFound(world, "beta", npc.id);
  markFound(world, "beta", owned.id);
  world.portOwners.set(owned.id, "alpha");

  const alphaState = visibleStateFor(world, "alpha");
  const betaState = visibleStateFor(world, "beta");
  const alphaNpc = alphaState.ports.find((port) => port[0] === npc.id)!;
  const betaNpc = betaState.ports.find((port) => port[0] === npc.id)!;
  assert.ok(alphaNpc[11]?.prices);
  assert.ok(alphaNpc[11]?.npcStock);
  assert.equal(alphaNpc[11]?.storage, null);
  assert.equal(betaNpc[11]?.prices, null);
  assert.equal(betaNpc[11]?.npcStock, null);
  assert.equal(betaNpc[11]?.storage, null);

  const alphaOwned = alphaState.ports.find((port) => port[0] === owned.id)!;
  const betaOwned = betaState.ports.find((port) => port[0] === owned.id)!;
  assert.ok(alphaOwned[11]?.prices);
  assert.ok(alphaOwned[11]?.storage);
  assert.equal(betaOwned[11]?.prices, null);
  assert.equal(betaOwned[11]?.storage, null);

  // Own stores are private and each player receives only its own fleet.
  world.players.get("alpha")!.stores.provisions = 1;
  world.players.get("beta")!.stores.provisions = 2;
  const alphaAfter = visibleStateFor(world, "alpha");
  const betaAfter = visibleStateFor(world, "beta");
  assert.equal(alphaAfter.fleet[0]!.stores.provisions, 1);
  assert.equal(betaAfter.fleet[0]!.stores.provisions, 2);
  assert.notEqual(alphaAfter.fleet[0]!.id, betaAfter.fleet[0]!.id);
});

test("prices shift once at each sixty game days", () => {
  const world = createWorld("test-prices", { hungerMultiplier: 0 });
  addPlayer(world, "alpha");
  markFound(world, "alpha", findPortByName("Kingston")!.id);
  const first = world.priceState.shift;
  step(world, 60 * 24 * 60 * 60);
  assert.equal(world.priceState.shift, first + 1);
  const port = findPortByName("Kingston")!;
  const state = visibleStateFor(world, "alpha");
  const found = state.ports.find((entry) => entry[0] === port.id);
  // Test rooms know all ports, so Kingston's price list is visible.
  assert.ok(found?.[11]?.prices);
});

test("resupply buys from an NPC and fills the three stores", () => {
  const world = createWorld("test-resupply", { startMoney: 50_000 });
  const ship = addPlayer(world, "alpha");
  const port = findPortByName("Montego Bay")!;
  dock(world, "alpha", port);
  ship.stores.provisions = 0;
  ship.stores.ammunition = 0;
  ship.stores.repairMaterials = 0;

  assert.equal(resupplyShip(world, "alpha", ship.id, port.id), true);
  assert.ok(ship.stores.provisions > 0);
  assert.ok(ship.stores.ammunition > 0);
  assert.ok(ship.stores.repairMaterials > 0);
  assert.ok(world.owners.get("alpha")!.money < 50_000);
  assert.match(drainNotices(world, "alpha").at(-1)!, /^Resupplied:/);
});

test("bought ships do not consume provisions while empty and delivered", () => {
  const world = createWorld("test-empty-delivery", { startMoney: 50_000 });
  const port = findPortByName("Kingston")!;
  addPlayer(world, "alpha");
  markFound(world, "alpha", port.id);
  const bought = buyShip(world, "alpha", port.id, "raider", "Empty")!;
  const emptyStores = goodAmount(bought.stores, "provisions");
  step(world, 2 * 24 * 60 * 60);
  assert.equal(goodAmount(bought.stores, "provisions"), emptyStores);
  assert.equal(bought.stores.provisions, 0);
  assert.equal(bought.starving, false);
});

test("port storage and prices are still visible for owned ports after a shift", () => {
  const world = createWorld("main");
  addPlayer(world, "alpha");
  const port = findPortByName("Kingston")!;
  markFound(world, "alpha", port.id);
  world.portOwners.set(port.id, "alpha");
  step(world, 60 * 24 * 60 * 60);
  const state = visibleStateFor(world, "alpha");
  const snapshot = state.ports.find((entry) => entry[0] === port.id)!;
  assert.ok(snapshot[11]?.prices);
  assert.ok(snapshot[11]?.storage);
  assert.equal(Object.keys(snapshot[11]!.storage!).length, 12);
});

test("a player cannot buy their own port's goods or use an NPC for storage", () => {
  const world = createWorld("main");
  const ship = addPlayer(world, "alpha");
  const port = findPortByName("Kingston")!;
  world.portOwners.set(port.id, "alpha");
  dock(world, "alpha", port);
  assert.equal(buyGoods(world, "alpha", ship.id, port.id, "provisions", 1), false);
  assert.match(drainNotices(world, "alpha").at(-1)!, /does not sell supplies/);

  const npc = findPortByName("Montego Bay")!;
  dock(world, "alpha", npc);
  assert.equal(transferGoods(world, "alpha", ship.id, npc.id, "provisions", 1, "load"), false);
});

test("a starving ship shows its lowered crew and provisions in private state", () => {
  const world = createWorld("test-state-stores", { hungerMultiplier: 1 });
  const ship = addPlayer(world, "alpha");
  ship.stores.provisions = 0;
  step(world, 24 * 60 * 60);
  const state = visibleStateFor(world, "alpha");
  assert.equal(state.fleet[0]!.starving, true);
  assert.equal(state.fleet[0]!.stores.provisions, 0);
  assert.equal(state.fleet[0]!.provisionsDays, 0);
  assert.ok(state.fleet[0]!.capacities.provisions > 0);
  assert.equal(state.fleet[0]!.cargoUsed, 0);
});

test("empty goods helper is independent of live storage", () => {
  const one = emptyGoods();
  const two = emptyGoods();
  one.sugar = 100;
  assert.equal(two.sugar, 0);
  assert.equal(emptyGoods().ammunition, 0);
});
