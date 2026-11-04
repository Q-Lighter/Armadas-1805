// Part C: fleet, shipyard and crew presentation, tested without a browser.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  buildFleetRow,
  crewPercent,
  crewQuickTargets,
  crewQuote,
  fleetCountText,
  formatDuration,
  formatMoney,
  shipyardCards,
} from "@naval/shared/fleet-view";
import type { OwnShipSnapshot } from "@naval/shared/world";
import { buildPortPanelModel, type PortInfo } from "@naval/shared/port-view";
import { shipTypeFor } from "@naval/shared/ships";
import {
  fullStores,
  shipStoreCapacities,
} from "@naval/shared/trade";

function ship(overrides: Partial<OwnShipSnapshot> = {}): OwnShipSnapshot {
  const type = shipTypeFor("British", "frigate");
  return {
    id: "alpha",
    name: "Agamemnon",
    classId: "frigate",
    navy: "British",
    crew: 284,
    fullCrew: 284,
    status: "sailing",
    portId: null,
    deliveryLeftMs: 0,
    x: 10,
    y: 20,
    stores: fullStores(type),
    capacities: shipStoreCapacities(type),
    cargoUsed: 0,
    provisionsDays: type.storesDays,
    starving: false,
    ...overrides,
  };
}

function port(overrides: Partial<PortInfo> = {}): PortInfo {
  return {
    id: "port-kingston",
    name: "Kingston",
    size: "L",
    npc: false,
    x: 0,
    y: 0,
    region: "Greater Antilles",
    good: "sugar",
    found: true,
    buyable: true,
    crewAvailable: 500,
    ...overrides,
  };
}

test("money, durations and crew percentages read clearly", () => {
  assert.equal(formatMoney(0), "0");
  assert.equal(formatMoney(50_000), "50,000");
  assert.equal(formatMoney(1_234_567), "1,234,567");
  assert.equal(crewPercent(0, 284), 0);
  assert.equal(crewPercent(142, 284), 50);
  assert.equal(crewPercent(300, 284), 100);
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(settings.time.sailingTimeScale * 1_000 * 61), "1:01");
  assert.equal(fleetCountText(7), "7 of 30");
});

test("Fleet rows show state, crew percentage and the red crew warning", () => {
  const sailing = buildFleetRow(ship({ crew: 10 }), null);
  assert.equal(sailing.name, "Agamemnon");
  assert.match(sailing.typeName, /frigate/i);
  assert.equal(sailing.crewText, "4% (10/284)");
  assert.equal(sailing.stateText, "Sailing");
  assert.equal(sailing.needsCrew, true);
  assert.equal(sailing.selectable, true);

  const docked = buildFleetRow(
    ship({ status: "docked", portId: "port-kingston" }),
    "Kingston",
  );
  assert.equal(docked.stateText, "Docked at Kingston");
  assert.equal(docked.needsCrew, false);

  const waiting = buildFleetRow(ship({ status: "waiting" }), null);
  assert.equal(waiting.stateText, "Waiting at anchor");

  const delivery = buildFleetRow(
    ship({
      status: "delivery",
      crew: 0,
      deliveryLeftMs: 83 * settings.time.sailingTimeScale * 1_000,
    }),
    null,
  );
  assert.match(delivery.stateText, /In delivery · 1:23/);
  assert.equal(delivery.selectable, false);
});

test("shipyard cards follow the port size and show every table fact", () => {
  const small = shipyardCards("test", "small", "British");
  assert.deepEqual(small.map((card) => card.classId), ["escort", "raider"]);
  assert.equal(small.find((card) => card.classId === "raider")?.price, 1_000);

  const medium = shipyardCards("test", "mid", "French");
  assert.deepEqual(medium.map((card) => card.classId), ["frigate", "escort", "raider", "trade"]);
  const frigate = medium.find((card) => card.classId === "frigate")!;
  assert.equal(frigate.crew, 330);
  assert.equal(frigate.guns, "40 (0H / 28M / 12L)");
  assert.equal(frigate.speed, "9.5 / 13 kn");
  assert.match(frigate.deliveryText, /2 game days/);

  const large = shipyardCards("dev", "large", "Dutch");
  assert.deepEqual(
    large.map((card) => card.classId),
    ["line", "frigate", "escort", "raider", "trade"],
  );
});

test("crew quick targets and quotes respect current, pool and money", () => {
  const frigate = ship({ crew: 0 });
  assert.deepEqual(crewQuickTargets(frigate), { minimum: 29, half: 142, full: 284 });

  assert.deepEqual(crewQuote(frigate, 29, 200, 1_000), {
    target: 29,
    count: 29,
    cost: 145,
    poolLeft: 171,
    canHire: true,
    reason: null,
  });
  assert.equal(crewQuote(frigate, 100, 50, 1_000).canHire, false);
  assert.match(crewQuote(frigate, 100, 50, 1_000).reason ?? "", /sailors/);
  assert.equal(crewQuote(frigate, 100, 200, 100).canHire, false);
  assert.match(crewQuote(frigate, 100, 200, 100).reason ?? "", /money/);
  assert.equal(crewQuote(frigate, 500, 500, 10_000).target, 284);
  assert.equal(crewQuote(frigate, 0, 500, 10_000).canHire, false);
});

test("port panel gains shipyard and hire actions only when allowed", () => {
  const base = {
    port: port(),
    distanceKm: 0,
    dockedHere: true,
    hasShip: true,
    canBuy: true,
    hasDockedShip: true,
  };
  assert.deepEqual(buildPortPanelModel(base).buttons, [
    "undock",
    "shipyard",
    "hire",
  ]);

  assert.deepEqual(
    buildPortPanelModel({
      ...base,
      port: port({ npc: true, buyable: false }),
      canBuy: false,
    }).buttons,
    ["undock", "hire"],
  );

  assert.deepEqual(
    buildPortPanelModel({
      port: port({ buyable: false }),
      distanceKm: 10,
      dockedHere: false,
      hasShip: true,
      hasDockedShip: false,
    }).buttons,
    ["sail"],
  );
});
