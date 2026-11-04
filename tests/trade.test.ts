// Part A: goods, stores, provisions, production, prices and trade quotes.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  ALL_SHIP_TYPES,
  shipTypeFor,
} from "@naval/shared/ships";
import { findPortByName } from "@naval/shared/ports";
import {
  CARGO_GOOD_IDS,
  GOOD_IDS,
  GOODS,
  RESOURCE_IDS,
  TRADE_GOOD_IDS,
  goodName,
} from "@naval/shared/goods";
import {
  addGoodToStores,
  addLimitedProduction,
  advanceProvisions,
  cargoSpeedMultiplier,
  createPriceState,
  emptyCargo,
  emptyGoods,
  emptyStores,
  freeSpaceForGood,
  fullStores,
  initialNpcStock,
  initialPortStorage,
  npcRefillProduction,
  portProduction,
  postedPrice,
  priceList,
  priceRandomFor,
  priceTrendFor,
  provisionsDaysLeft,
  provisionsUsePerGameDay,
  quoteBuy,
  quoteSell,
  quoteTransfer,
  refillNpcStock,
  shiftPrices,
  shipStoreCapacities,
  totalGoods,
} from "@naval/shared/trade";
import { createShip, sailTo, stepShip } from "@naval/shared/sailing";

const ALL_GOOD_IDS = GOOD_IDS;

test("the posted goods and prices are the requested draft table", () => {
  assert.deepEqual(TRADE_GOOD_IDS, [
    "hides", "sugar", "tobacco", "coffee", "rum", "silver", "whaleOil",
  ]);
  assert.deepEqual(RESOURCE_IDS, [
    "provisions", "timber", "cloth", "repairMaterials", "ammunition",
  ]);
  assert.equal(ALL_GOOD_IDS.length, 12);
  assert.equal(CARGO_GOOD_IDS.length, 9);
  assert.equal(goodName("whaleOil"), "Whale oil");
  assert.equal(GOODS.repairMaterials.name, "Repair materials");
  assert.deepEqual(settings.trade.prices, {
    hides: 10,
    sugar: 15,
    tobacco: 20,
    coffee: 25,
    rum: 30,
    silver: 100,
    whaleOil: 20,
    provisions: 5,
    timber: 8,
    cloth: 10,
    repairMaterials: 12,
    ammunition: 15,
  });
});

test("all 24 ships have capacities that match their table formulas", () => {
  for (const type of ALL_SHIP_TYPES) {
    const capacities = shipStoreCapacities(type);
    assert.ok(
      Math.abs(
        capacities.provisions -
          type.storesDays * type.crew *
            settings.ships.stores.provisionsTonnesPerCrewPerGameDay,
      ) < 1e-9,
      `${type.navy} ${type.name} provisions`,
    );
    assert.ok(
      Math.abs(
        capacities.ammunition -
          (60 * type.broadsideLb) / settings.ships.stores.poundsPerTonne,
      ) < 1e-9,
      `${type.navy} ${type.name} ammunition`,
    );
    assert.equal(
      capacities.repairMaterials,
      type.hull / settings.ships.stores.repairHullPointsPerTonne,
    );
    assert.equal(capacities.cargo, type.cargoTonnes);
  }
});

test("a fully stocked frigate lasts exactly its stores days", () => {
  const type = shipTypeFor("British", "frigate");
  const stores = fullStores(type);
  const capacities = shipStoreCapacities(type);
  const almost = advanceProvisions(
    stores.provisions,
    type.crew,
    type.storesDays - 0.001,
  );
  assert.ok(almost.provisions > 0);
  assert.equal(almost.crewLost, 0);

  const exact = advanceProvisions(stores.provisions, type.crew, type.storesDays);
  assert.ok(Math.abs(exact.provisions) < 1e-9);
  assert.ok(Math.abs(exact.crew - type.crew) < 1e-9);
  assert.equal(exact.starving, true);
  assert.ok(Math.abs(provisionsDaysLeft(capacities.provisions, type.crew) - type.storesDays) < 1e-9);
});

test("starvation kills 8% of the crew per game day and no more", () => {
  const oneDay = advanceProvisions(0, 100, 1);
  assert.ok(Math.abs(oneDay.crew - 92) < 1e-9);
  assert.ok(Math.abs(oneDay.crewLost - 8) < 1e-9);
  assert.equal(oneDay.starving, true);

  const twoDays = advanceProvisions(0, 100, 2);
  assert.ok(Math.abs(twoDays.crew - 84.64) < 1e-9);
  assert.equal(advanceProvisions(0, 0, 1).crewLost, 0);
});

test("provisions use follows crew, days and the hunger multiplier", () => {
  assert.ok(
    Math.abs(provisionsUsePerGameDay(100) - 0.65) < 1e-9,
  );
  assert.ok(
    Math.abs(provisionsUsePerGameDay(100, 10) - 6.5) < 1e-9,
  );
  assert.ok(Math.abs(provisionsDaysLeft(6.5, 100, 10) - 1) < 1e-9);
  assert.equal(provisionsDaysLeft(10, 0), Number.POSITIVE_INFINITY);
});

test("a full cargo hold gives the 0.90 speed multiplier", () => {
  const type = shipTypeFor("British", "frigate");
  const stores = emptyStores();
  addGoodToStores(stores, "sugar", type.cargoTonnes);
  assert.equal(cargoSpeedMultiplier(stores, type.cargoTonnes), 0.9);

  const half = emptyStores();
  addGoodToStores(half, "hides", type.cargoTonnes / 2);
  assert.equal(cargoSpeedMultiplier(half, type.cargoTonnes), 0.95);
  assert.equal(cargoSpeedMultiplier(emptyStores(), type.cargoTonnes), 1);
});

test("the sailing step applies the cargo speed multiplier", () => {
  const downwindHeading = ((settings.weather.windFromDeg + 180) * Math.PI) / 180;
  const empty = createShip("empty", "frigate", 0, 0, downwindHeading);
  const loaded = createShip("loaded", "frigate", 0, 0, downwindHeading);
  const type = shipTypeFor("British", "frigate");
  addGoodToStores(loaded.stores, "sugar", type.cargoTonnes);
  sailTo(empty, 300, 0);
  sailTo(loaded, 300, 0);
  stepShip(empty, 10);
  stepShip(loaded, 10);
  assert.ok(empty.speedKnots > 0);
  assert.ok(Math.abs(loaded.speedKnots / empty.speedKnots - 0.9) < 1e-9);
});

test("production follows the regional-good and basic-resource table", () => {
  const sugar = findPortByName("Kingston")!;
  assert.equal(sugar.good, "sugar");
  const sugarBundle = portProduction(sugar);
  assert.equal(sugarBundle.sugar, 20);
  assert.equal(sugarBundle.provisions, 30);
  assert.equal(sugarBundle.cloth, 30);
  assert.equal(sugarBundle.timber, 0);
  assert.equal(sugarBundle.repairMaterials, 10);
  assert.equal(sugarBundle.ammunition, 10);

  const timber = findPortByName("Campeche")!;
  assert.equal(timber.good, "timber");
  const timberBundle = portProduction(timber);
  assert.equal(timberBundle.timber, 50);
  assert.equal(timberBundle.provisions, 30);
  assert.equal(timberBundle.cloth, 0);

  const cloth = { good: "cloth" };
  const clothBundle = portProduction(cloth);
  assert.equal(clothBundle.cloth, 50);
  assert.equal(clothBundle.provisions, 30);
});

test("storage starts half full and production stops at the limit", () => {
  const port = findPortByName("Kingston")!;
  const storage = initialPortStorage(port);
  const cap = settings.ports.sizes[port.size].storageTonnes;
  assert.ok(Math.abs(totalGoods(storage) - cap / 2) < 1e-9);

  const full = initialPortStorage(port);
  const before = totalGoods(full);
  const produced = addLimitedProduction(full, cap, portProduction(port));
  assert.ok(totalGoods(full) <= cap);
  assert.ok(totalGoods(full) >= before);
  assert.ok(totalGoods(produced) > 0);

  const exactly = emptyGoods();
  exactly.provisions = cap;
  const none = addLimitedProduction(exactly, cap, portProduction(port));
  assert.equal(totalGoods(none), 0);
  assert.equal(totalGoods(exactly), cap);
});

test("NPC stock starts full, is capped, and refills each cycle", () => {
  const port = findPortByName("Kingston")!;
  const stock = initialNpcStock(port);
  const cap = settings.trade.production.npcStockCapTonnes[port.size];
  for (const good of RESOURCE_IDS) assert.equal(stock[good], cap);

  stock.provisions = 0;
  refillNpcStock(stock, port);
  assert.equal(stock.provisions, 30);
  assert.ok(stock.repairMaterials <= cap);
  assert.ok(stock.ammunition <= cap);

  const bundle = npcRefillProduction(port);
  assert.equal(bundle.sugar, 20);
  assert.equal(bundle.repairMaterials, 30);
  assert.equal(bundle.ammunition, 30);
});

test("the same seed gives repeatable regional and port price factors", () => {
  const ports = [
    findPortByName("Kingston")!,
    findPortByName("Havana")!,
    findPortByName("Veracruz")!,
  ];
  const first = shiftPrices(createPriceState(12345), ports);
  const again = shiftPrices(createPriceState(12345), ports);
  assert.deepEqual([...first.regionTrends], [...again.regionTrends]);
  assert.deepEqual([...first.portRandoms], [...again.portRandoms]);
  assert.equal(first.shift, 1);

  const different = shiftPrices(createPriceState(54321), ports);
  assert.notDeepEqual([...first.regionTrends], [...different.regionTrends]);

  for (const trend of first.regionTrends.values()) {
    assert.ok(trend >= 1 - settings.trade.pricesCycle.regionalTrendMax - 1e-12);
    assert.ok(trend <= 1 + settings.trade.pricesCycle.regionalTrendMax + 1e-12);
  }
  for (const random of first.portRandoms.values()) {
    assert.ok(random >= 1 - settings.trade.pricesCycle.portRandomMax - 1e-12);
    assert.ok(random <= 1 + settings.trade.pricesCycle.portRandomMax + 1e-12);
  }
  assert.equal(priceTrendFor(createPriceState(1), "nowhere"), 1);
  assert.equal(priceRandomFor(createPriceState(1), "nowhere"), 1);
});

test("initial prices are base with only the producer discount", () => {
  const port = findPortByName("Kingston")!;
  const state = createPriceState(7);
  const prices = priceList(port, state);
  assert.equal(prices.sugar, Math.round(15 * 0.75));
  assert.equal(prices.hides, 10);
  assert.equal(prices.provisions, 5);
  assert.equal(postedPrice("silver", port, state), 100);
  assert.ok(prices.sugar < 15, "the producer discount lowers sugar");
});

test("buy quotes are limited by stock, money and the correct store", () => {
  const line = shipTypeFor("British", "line");
  const capacities = shipStoreCapacities(line);
  const stores = emptyStores();
  const base = {
    requested: 100,
    stock: 150,
    money: 1_000,
    stores,
    capacities,
    unitPrice: 10,
  };

  assert.equal(quoteBuy({ ...base, good: "provisions", requested: 20, stock: 12 }).amount, 12);
  assert.equal(quoteBuy({ ...base, good: "provisions", money: 50 }).amount, 5);
  assert.equal(quoteBuy({ ...base, good: "provisions", stock: 0 }).reason, "No stock at this port.");
  assert.equal(quoteBuy({ ...base, good: "provisions", money: 0 }).reason, "Not enough money.");

  // Cargo resources share one hold; the raider's is only 15 t.
  const small = shipTypeFor("British", "raider");
  const smallCaps = shipStoreCapacities(small);
  const smallStores = emptyStores();
  addGoodToStores(smallStores, "timber", 12);
  assert.equal(freeSpaceForGood(smallStores, smallCaps, "cloth"), 3);
  assert.equal(quoteBuy({
    good: "cloth",
    requested: 100,
    stock: 150,
    money: 1_000,
    stores: smallStores,
    capacities: smallCaps,
    unitPrice: 10,
  }).amount, 3);

  // Separate stores do not consume one another.
  assert.ok(freeSpaceForGood(stores, capacities, "provisions") > 10);
  assert.ok(freeSpaceForGood(stores, capacities, "ammunition") > 0);
  assert.ok(freeSpaceForGood(stores, capacities, "repairMaterials") > 0);
});

test("sell quotes use only cargo goods and respect port storage", () => {
  const quote = quoteSell({
    good: "rum",
    requested: 20,
    hold: 12,
    unitPrice: 30,
  });
  assert.equal(quote.amount, 12);
  assert.equal(quote.total, 360);
  assert.equal(quoteSell({ good: "rum", requested: 5, hold: 12, unitPrice: 30, portFreeSpace: 2 }).amount, 2);
  assert.equal(quoteSell({ good: "rum", requested: 5, hold: 0, unitPrice: 30 }).reason, "No stock at this port.");
  assert.equal(quoteSell({ good: "provisions", requested: 5, hold: 10, unitPrice: 5 }).amount, 0);
});

test("load and unload quotes respect both sides", () => {
  const load = quoteTransfer({
    direction: "load",
    good: "sugar",
    requested: 20,
    shipAmount: 0,
    portAmount: 12,
    shipFree: 8,
    portFree: 100,
  });
  assert.equal(load.amount, 8);

  const unload = quoteTransfer({
    direction: "unload",
    good: "sugar",
    requested: 20,
    shipAmount: 12,
    portAmount: 0,
    shipFree: 0,
    portFree: 5,
  });
  assert.equal(unload.amount, 5);
  assert.equal(
    quoteTransfer({
      direction: "load",
      good: "sugar",
      requested: 20,
      shipAmount: 0,
      portAmount: 0,
      shipFree: 20,
      portFree: 20,
    }).reason,
    "No stock at this port.",
  );
});

test("empty cargo stores are complete and independent", () => {
  const first = emptyCargo();
  const second = emptyCargo();
  first.hides = 4;
  assert.equal(second.hides, 0);
  assert.equal(CARGO_GOOD_IDS.every((good) => good in first), true);
});
