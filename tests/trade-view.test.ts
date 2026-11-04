// Part C: browser-free trade rows and ship store presentation.

import assert from "node:assert/strict";
import { test } from "node:test";

import { shipTypeFor } from "@naval/shared/ships";
import {
  buildShipStoreBars,
  buildFleetRow,
  provisionsDaysText,
} from "@naval/shared/fleet-view";
import { buildPortPanelModel, type PortInfo } from "@naval/shared/port-view";
import {
  buildBuyRows,
  buildSellRows,
  buildStorageRows,
  formatPrice,
  formatTonnes,
  priceBookRows,
} from "@naval/shared/trade-view";
import {
  addGoodToStores,
  fullStores,
  shipStoreCapacities,
} from "@naval/shared/trade";
import type { OwnShipSnapshot } from "@naval/shared/world";

const type = shipTypeFor("British", "frigate");

function ship(overrides: Partial<OwnShipSnapshot> = {}): OwnShipSnapshot {
  return {
    id: "alpha",
    name: "Agamemnon",
    classId: "frigate",
    navy: "British",
    crew: 284,
    fullCrew: 284,
    status: "docked",
    portId: "port-npc",
    deliveryLeftMs: 0,
    x: 0,
    y: 0,
    stores: fullStores(type),
    capacities: shipStoreCapacities(type),
    cargoUsed: 0,
    provisionsDays: type.storesDays,
    starving: false,
    ...overrides,
  };
}

const allPrices = {
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
} as const;

function port(overrides: Partial<PortInfo> = {}): PortInfo {
  return {
    id: "port-npc",
    name: "Montego Bay",
    size: "S",
    npc: true,
    x: 0,
    y: 0,
    region: "Greater Antilles",
    good: "sugar",
    found: true,
    buyable: false,
    prices: { ...allPrices },
    npcStock: {
      provisions: 100,
      timber: 100,
      cloth: 100,
      repairMaterials: 100,
      ammunition: 100,
    },
    ...overrides,
  };
}

test("ship store bars show amounts, days and urgent red ink", () => {
  const bars = buildShipStoreBars(ship());
  assert.deepEqual(bars.map((bar) => bar.key), [
    "provisions",
    "repair",
    "ammunition",
    "cargo",
  ]);
  assert.equal(bars[0]?.percent, 100);
  assert.match(bars[0]?.detail ?? "", /days left/);
  assert.equal(bars[0]?.urgent, false);

  const low = buildShipStoreBars(
    ship({ provisionsDays: 8.2, starving: true, cargoUsed: 0 }),
  );
  assert.equal(low[0]?.urgent, true);
  assert.match(low[0]?.detail ?? "", /8.2 days left/);
  assert.equal(provisionsDaysText(1), "1 day left");
  assert.equal(provisionsDaysText(9_999), "—");

  const fleet = buildFleetRow(ship({ provisionsDays: 7, starving: true }), "Montego Bay");
  assert.equal(fleet.provisionsText, "7 days left");
  assert.equal(fleet.provisionsLow, true);
  assert.equal(fleet.starving, true);
});

test("buy rows respect stock, money, correct store and free space", () => {
  const stores = fullStores(type);
  stores.provisions = 0;
  const holdFull = ship({ stores });
  const rows = buildBuyRows(port(), holdFull, 20);
  const provisions = rows.find((row) => row.good === "provisions")!;
  assert.equal(provisions.price, 5);
  assert.equal(provisions.max, 4, "money limits four tonnes");
  assert.equal(provisions.regional, false);

  const sugar = rows.find((row) => row.good === "sugar");
  assert.equal(sugar, undefined, "NPC buy tab only lists resources");

  addGoodToStores(holdFull.stores, "timber", type.cargoTonnes);
  const timber = buildBuyRows(port(), holdFull, 10_000).find(
    (row) => row.good === "timber",
  )!;
  assert.equal(timber.max, 0, "a full cargo hold leaves no space");
});

test("sell rows list only carried cargo and storage rows use both limits", () => {
  const stores = fullStores(type);
  addGoodToStores(stores, "rum", 4);
  addGoodToStores(stores, "hides", 2);
  addGoodToStores(stores, "timber", 3);
  const owned = port({
    id: "port-owned",
    npc: false,
    buyable: true,
    storageLimit: 1_000,
    storage: { provisions: 995, hides: 0 },
  });
  const rows = buildSellRows(owned, ship({ stores }));
  assert.deepEqual(rows.map((row) => row.good), ["hides", "rum", "timber"]);
  assert.equal(rows.find((row) => row.good === "hides")?.max, 2);
  assert.equal(rows.find((row) => row.good === "rum")?.max, 4);
  assert.equal(rows.find((row) => row.good === "timber")?.max, 3);

  const storage = buildStorageRows(owned, ship({ stores }));
  const hides = storage.find((row) => row.good === "hides")!;
  assert.equal(hides.unloadMax, 2);
  assert.equal(hides.portFree, 5);
  const provisions = storage.find((row) => row.good === "provisions")!;
  assert.equal(provisions.loadMax, 0);
});

test("price book marks the regional good cheap and formats cleanly", () => {
  const rows = priceBookRows(port());
  assert.equal(rows.length, 12);
  assert.equal(rows.find((row) => row.good === "sugar")?.cheap, true);
  assert.equal(rows.find((row) => row.good === "rum")?.cheap, false);
  assert.equal(formatPrice(1_234), "1,234");
  assert.equal(formatTonnes(2.5), "2.5");
  assert.equal(formatTonnes(2.0), "2");
});

test("the port panel gains Trade only when the player may trade there", () => {
  const base = {
    port: port({ buyable: true }),
    distanceKm: 0,
    dockedHere: true,
    hasShip: true,
    canTrade: true,
  };
  assert.deepEqual(buildPortPanelModel(base).buttons, ["undock", "trade", "shipyard"]);

  const noTrade = buildPortPanelModel({
    ...base,
    canTrade: false,
    port: port({ buyable: false }),
  });
  assert.deepEqual(noTrade.buttons, ["undock"]);
});
