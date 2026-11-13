// Part A: the catalogue (24 ships plus the fire ship) and the pure rules.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { NAVY_IDS } from "@naval/shared/navies";
import {
  ALL_SHIP_TYPES,
  BUYABLE_SHIP_CLASS_IDS,
  SHIP_CLASS_IDS,
  SHIP_NAMES,
  SHIP_SIZE_BY_CLASS,
  shipTypeFor,
} from "@naval/shared/ships";
import {
  canAddShip,
  canShipSail,
  cleanShipName,
  crewHireCost,
  deliveryGameMs,
  deliveryRealMinutes,
  minimumCrew,
  portSellsShip,
  refillCrewPool,
  shipPrice,
  suggestShipName,
} from "@naval/shared/ship-rules";

test("the table has six ships for each navy and every value reads back", () => {
  assert.equal(ALL_SHIP_TYPES.length, 24);
  assert.deepEqual(NAVY_IDS, ["British", "Dutch", "Spanish", "French"]);

  for (const navy of NAVY_IDS) {
    for (const classId of SHIP_CLASS_IDS) {
      const type = shipTypeFor(navy, classId);
      assert.equal(type.navy, navy);
      assert.equal(type.classId, classId);
      assert.ok(type.name.length > 0);
      assert.equal(type.heavyGuns + type.mediumGuns + type.lightGuns, type.guns);
      assert.ok(type.crew > 0);
      assert.ok(type.cruiseKnots > 0);
      assert.ok(type.topKnots >= type.cruiseKnots);
      assert.ok(type.turn90GameMinutes > 0);
      assert.ok(type.draughtM > 0);
    }
  }
});

test("the role sizes and prices are the draft rules", () => {
  assert.equal(SHIP_SIZE_BY_CLASS.raider, "small");
  assert.equal(SHIP_SIZE_BY_CLASS.escort, "small");
  assert.equal(SHIP_SIZE_BY_CLASS.trade, "mid");
  assert.equal(SHIP_SIZE_BY_CLASS.frigate, "mid");
  assert.equal(SHIP_SIZE_BY_CLASS.line, "large");
  assert.equal(SHIP_SIZE_BY_CLASS.flagship, "large");

  assert.deepEqual(BUYABLE_SHIP_CLASS_IDS, ["line", "frigate", "escort", "raider", "trade", "fireShip"]);
  assert.equal(shipPrice("raider"), 1_000);
  assert.equal(shipPrice("escort"), 2_500);
  assert.equal(shipPrice("trade"), 3_000);
  assert.equal(shipPrice("frigate"), 6_000);
  assert.equal(shipPrice("line"), 14_000);
  assert.equal(shipPrice("fireShip"), 500);
  assert.equal(shipPrice("flagship"), null);
});

test("each port size sells its own class and smaller", () => {
  for (const size of ["small", "mid", "large"] as const) {
    for (const classId of SHIP_CLASS_IDS) {
      const expected = classId === "flagship"
        ? false
        : size === "large" ||
          (size === "mid" && SHIP_SIZE_BY_CLASS[classId] !== "large") ||
          (size === "small" && SHIP_SIZE_BY_CLASS[classId] === "small");
      assert.equal(portSellsShip(size, classId), expected, `${size}/${classId}`);
    }
  }
});

test("delivery is in game days and faster in test and dev rooms", () => {
  const oneDay = 24 * 60 * 60 * 1_000;
  assert.equal(deliveryGameMs("normal", "raider"), oneDay);
  assert.equal(deliveryGameMs("normal", "frigate"), oneDay * 2);
  assert.equal(deliveryGameMs("normal", "line"), oneDay * 3);
  assert.equal(deliveryGameMs("test", "line"), oneDay * 3 * 0.1);
  assert.equal(deliveryGameMs("dev", "frigate"), oneDay * 2 * 0.1);
  assert.equal(deliveryRealMinutes("normal", "line"), 30);
  assert.equal(deliveryRealMinutes("test", "line"), 3);
});

test("crew minimum, hire cost, pool refill and cap use settings", () => {
  assert.equal(minimumCrew(40), 4);
  assert.equal(minimumCrew(284), 29);
  assert.equal(minimumCrew(820), 82);
  assert.equal(canShipSail({ crew: 28, fullCrew: 284 }), false);
  assert.equal(canShipSail({ crew: 29, fullCrew: 284 }), true);
  assert.equal(crewHireCost(0), 0);
  assert.equal(crewHireCost(12), 60);
  assert.equal(canAddShip(29), true);
  assert.equal(canAddShip(30), false);

  assert.equal(settings.ships.crewRefillRealMinutes, 25);
  const half = refillCrewPool(0, 400, 12.5 * 60);
  assert.ok(Math.abs(half - 200) < 1e-9);
  assert.equal(refillCrewPool(400, 400, 100), 400);
});

test("each navy has twenty different names and can suggest one", () => {
  for (const navy of NAVY_IDS) {
    const names = SHIP_NAMES[navy];
    assert.equal(names.length, 20);
    assert.equal(new Set(names).size, 20);
    const chosen = suggestShipName(navy, () => 0.5);
    assert.ok(names.includes(chosen));
  }
  assert.equal(cleanShipName("  HMS   Agamemnon "), "HMS Agamemnon");
  assert.equal(cleanShipName(""), null);
  assert.equal(cleanShipName("Bad!"), null);
  assert.equal(cleanShipName("x".repeat(settings.ships.maxNameLength + 1)), null);
});
