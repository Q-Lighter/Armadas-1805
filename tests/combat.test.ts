// Part A: the gunnery, damage, repair and damaged-sailing rules.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_SHIP_TYPES,
  type ShipClassId,
} from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";
import { shipStoreCapacities } from "@naval/shared/trade";
import {
  DAMAGE_AREAS,
  ammunitionBroadsideCount,
  angleBetweenDegrees,
  applyAreaDamage,
  applyDriftingHullDamage,
  bearingGunGroups,
  bowBears,
  broadsideSide,
  canRepair,
  createSeededRandom,
  createShipDamage,
  crewPercent,
  crewReloadMultiplier,
  crewRepairMultiplier,
  crewTooLow,
  damageAreaPercent,
  damageCapacities,
  damagePercents,
  gunClassDamageMultiplier,
  gunPounds,
  hitChanceAtRange,
  isBigClass,
  isInCombat,
  isShipSunk,
  isSmallClass,
  isUpwind,
  objectiveAreaWeights,
  pickDamageArea,
  reloadRealSeconds,
  repairCostForArea,
  repairShip,
  resolveFiring,
  seededGunCount,
  shipPerformance,
  shotDamageMultiplier,
  shotTypeForArea,
  sternBears,
} from "@naval/shared/combat";
import { shipTypeFor } from "@naval/shared/ships";
import type { NavyId } from "@naval/shared/navies";

const TABLE: Record<NavyId, Record<ShipClassId, [number, number, number, number, number, number]>> = {
  British: {
    flagship: [58, 44, 2, 1130, 3.5, 20000],
    line: [28, 28, 1, 640, 3, 11000],
    frigate: [0, 28, 10, 230, 2, 5200],
    escort: [0, 8, 10, 90, 1.5, 1800],
    raider: [0, 0, 10, 30, 1, 800],
    trade: [0, 0, 12, 40, 3, 3000],
  },
  French: {
    flagship: [66, 54, 0, 1300, 3.5, 22000],
    line: [28, 30, 1, 650, 3, 10000],
    frigate: [0, 28, 12, 230, 2, 4600],
    escort: [0, 4, 12, 60, 1.5, 1600],
    raider: [0, 0, 14, 40, 1, 900],
    trade: [0, 0, 8, 20, 3, 2400],
  },
  Spanish: {
    flagship: [62, 52, 2, 1300, 4, 26000],
    line: [28, 30, 1, 650, 3, 12000],
    frigate: [0, 26, 14, 220, 2, 5400],
    escort: [0, 2, 14, 60, 1.5, 1700],
    raider: [0, 4, 20, 90, 1, 1200],
    trade: [0, 0, 24, 70, 2.5, 3600],
  },
  Dutch: {
    flagship: [30, 30, 1, 680, 3, 15000],
    line: [26, 28, 1, 600, 3, 9000],
    frigate: [0, 26, 10, 210, 2, 4400],
    escort: [0, 0, 16, 50, 1.5, 1600],
    raider: [0, 0, 8, 24, 1, 700],
    trade: [0, 0, 8, 20, 3.5, 3200],
  },
};

test("all 24 ships match the supplied combat table", () => {
  for (const type of ALL_SHIP_TYPES) {
    const [h, m, l, broadside, reload, hull] = TABLE[type.navy][type.classId];
    assert.deepEqual(
      [type.heavyGuns, type.mediumGuns, type.lightGuns, type.broadsideLb,
        type.reloadGameMinutes, type.hull],
      [h, m, l, broadside, reload, hull],
      `${type.navy} ${type.classId}`,
    );
    assert.equal(type.guns, h + m + l, `${type.navy} ${type.classId} total`);
  }
});

test("the broadside split adds back to the table weight", () => {
  for (const type of ALL_SHIP_TYPES) {
    const pounds = gunPounds(type);
    const total = type.heavyGuns * pounds.heavy +
      type.mediumGuns * pounds.medium +
      type.lightGuns * pounds.light;
    assert.ok(Math.abs(total - type.broadsideLb) < 1e-8, type.name);
  }
});

test("damage capacities use the agreed shares of hull points", () => {
  const line = shipTypeFor("British", "line");
  const capacities = damageCapacities(line);
  assert.equal(capacities.hull, 11000);
  assert.ok(Math.abs(capacities.sails - 3300) < 1e-9);
  assert.ok(Math.abs(capacities.masts - 4400) < 1e-9);
  assert.ok(Math.abs(capacities.rudder - 2200) < 1e-9);
  assert.ok(Math.abs(capacities.guns - 3300) < 1e-9);
  assert.equal(capacities.crew, 590);
});

test("pounds damage the right area and never go below zero", () => {
  const line = shipTypeFor("British", "line");
  const capacities = damageCapacities(line);
  const fresh = createShipDamage(line);
  const hull = applyAreaDamage(fresh, capacities, "hull", 110);
  assert.ok(Math.abs(damageAreaPercent(hull, capacities, "hull") - 99) < 1e-9);
  const sails = applyAreaDamage(fresh, capacities, "sails", 33);
  assert.ok(Math.abs(damageAreaPercent(sails, capacities, "sails") - 99) < 1e-9);
  const crew = applyAreaDamage(fresh, capacities, "crew", 10);
  assert.equal(crew.crew, 589);
  const none = applyAreaDamage(fresh, capacities, "hull", 1e9);
  assert.equal(none.hull, 0);
  assert.equal(damageAreaPercent(none, capacities, "hull"), 0);
});

test("effective sail is a product, and no sail means downwind drift", () => {
  const raider = shipTypeFor("British", "raider");
  const capacities = damageCapacities(raider);
  const damaged = createShipDamage(raider);
  damaged.sails = capacities.sails * 0.5;
  damaged.masts = capacities.masts * 0.5;
  const half = shipPerformance(raider, damaged, 315);
  assert.ok(Math.abs(half.effectiveSailPercent - 25) < 1e-9);
  assert.ok(Math.abs(half.speedFactor - 0.25) < 1e-9);

  damaged.sails = 0;
  const drifting = shipPerformance(raider, damaged, 315);
  assert.equal(drifting.effectiveSailPercent, 0);
  assert.ok(Math.abs(drifting.driftSpeedKnots - 1.2) < 1e-9);
  assert.ok(Math.abs(drifting.driftHeadingRad - (315 + 180) * Math.PI / 180) < 1e-9);
  assert.equal(drifting.canSail, true);
});

test("a rudderless ship turns slowly downwind; low crew stops everything", () => {
  const frigate = shipTypeFor("Dutch", "frigate");
  const capacities = damageCapacities(frigate);
  const damage = createShipDamage(frigate);
  damage.rudder = 0;
  const noRudder = shipPerformance(frigate, damage, 0);
  assert.ok(Math.abs(noRudder.turnRateFactor - settings.combat.zeroRudderTurnShare) < 1e-9);
  assert.equal(noRudder.wantsDownwind, true);

  const low = createShipDamage(frigate, Math.ceil(capacities.crew * 0.09));
  assert.equal(crewTooLow(low, capacities), true);
  const stopped = shipPerformance(frigate, low, 0);
  assert.equal(stopped.canSail, false);
  assert.equal(stopped.canFight, false);
  assert.equal(stopped.speedFactor, 0);
  assert.equal(stopped.turnRateFactor, 0);
});

test("crew reload endpoints are one and three, with a straight line between", () => {
  assert.equal(crewReloadMultiplier(100), 1);
  assert.equal(crewReloadMultiplier(10), 3);
  assert.equal(crewReloadMultiplier(55), 2);
  assert.equal(crewRepairMultiplier(50), 0.5);
  const line = shipTypeFor("British", "line");
  const expected = line.reloadGameMinutes * settings.combat.battleSecondsPerGameMinute * 2;
  assert.ok(Math.abs(reloadRealSeconds(line, 55) - expected) < 1e-9);
});

test("broadside, bow and stern arcs leave the four quarter gaps empty", () => {
  const frigate = shipTypeFor("British", "frigate");
  assert.equal(broadsideSide(0, Math.PI / 2), "starboard");
  assert.equal(broadsideSide(0, -Math.PI / 2), "port");
  assert.equal(broadsideSide(0, 0), null);
  assert.equal(bowBears(0, Math.PI / 6), true);
  assert.equal(sternBears(0, 5 * Math.PI / 6), true);
  assert.equal(sternBears(0, Math.PI * 0.8), false);
  assert.equal(sternBears(0, Math.PI * -0.8), false);
  assert.equal(bearingGunGroups(frigate, 0, Math.PI / 4).length, 0);
  assert.deepEqual(
    bearingGunGroups(frigate, 0, Math.PI / 2).map((group) => [group.mount, group.gunClass]),
    [["broadside", "medium"], ["broadside", "light"]],
  );
  assert.deepEqual(
    bearingGunGroups(frigate, 0, 0).map((group) => [group.mount, group.gunClass, group.baseGuns]),
    [["bow", "light", 2]],
  );
});

test("range bands and the upwind bonus use the agreed edges", () => {
  assert.equal(hitChanceAtRange(0.299), 0.5);
  assert.equal(hitChanceAtRange(0.3), 0.3);
  assert.equal(hitChanceAtRange(0.599), 0.3);
  assert.equal(hitChanceAtRange(0.6), 0.12);
  assert.equal(hitChanceAtRange(1), 0.12);
  assert.equal(hitChanceAtRange(1.001), 0);
  assert.ok(Math.abs(hitChanceAtRange(0.45, true) - 0.33) < 1e-9);
  assert.equal(isUpwind(Math.PI, 0), true);
  assert.equal(isUpwind(0, 0), false);
  assert.equal(isUpwind(Math.PI / 2, 0), false);
  assert.equal(hitChanceAtRange(0.45, false, { seaState: 0.5, crewAccuracy: 2, morale: 1 }), 0.3);
});

test("light and heavy shot use the size multipliers", () => {
  assert.equal(isSmallClass("raider"), true);
  assert.equal(isSmallClass("frigate"), false);
  assert.equal(isBigClass("line"), true);
  assert.equal(isBigClass("trade"), false);
  assert.equal(gunClassDamageMultiplier("light", "line"), 0.5);
  assert.equal(gunClassDamageMultiplier("light", "frigate"), 1);
  assert.equal(gunClassDamageMultiplier("heavy", "escort"), 1.5);
  assert.equal(gunClassDamageMultiplier("heavy", "flagship"), 1);
});

test("Sink and Capture area weights land within two points over 10,000 hits", () => {
  for (const objective of ["sink", "capture"] as const) {
    const random = createSeededRandom(objective === "sink" ? 42 : 84);
    const counts = Object.fromEntries(DAMAGE_AREAS.map((area) => [area, 0])) as Record<string, number>;
    for (let hit = 0; hit < 10_000; hit += 1) counts[pickDamageArea(objective, random)]! += 1;
    const weights = objectiveAreaWeights(objective);
    for (const area of DAMAGE_AREAS) {
      const observed = counts[area]! / 100;
      assert.ok(
        Math.abs(observed - weights[area]) <= 2,
        `${objective} ${area}: ${observed}%`,
      );
    }
  }
});

test("chain doubles sails and masts, grape doubles crew only inside 300 m", () => {
  assert.equal(shotTypeForArea("sails", 0.5), "chain");
  assert.equal(shotTypeForArea("masts", 0.5), "chain");
  assert.equal(shotDamageMultiplier("sails", 0.5), 2);
  assert.equal(shotTypeForArea("crew", 0.2), "grape");
  assert.equal(shotTypeForArea("crew", 0.4), "round");
  assert.equal(shotDamageMultiplier("crew", 0.2), 2);
  assert.equal(shotDamageMultiplier("crew", 0.4), 1);
  assert.equal(shotTypeForArea("hull", 0.2), "round");
  assert.equal(shotTypeForArea("guns", 0.2), "round");
  assert.equal(shotDamageMultiplier("hull", 0.2), 1);
});

test("firing resolves guns, hits, ammunition and no fire with dry guns", () => {
  const frigate = shipTypeFor("British", "frigate");
  const damage = createShipDamage(frigate);
  const capacities = damageCapacities(frigate);
  const magazine = shipStoreCapacities(frigate).ammunition;
  const result = resolveFiring({
    spec: frigate,
    damage,
    targetClass: "frigate",
    distanceKm: 0.45,
    targetBearingRad: Math.PI / 2,
    headingRad: 0,
    windFromDeg: 0,
    ammunitionTonnes: magazine,
    objective: "sink",
    random: createSeededRandom(7),
  });
  assert.equal(result.fired, true);
  assert.ok(result.gunsFired > 0);
  assert.ok(result.hits > 0);
  assert.ok(Math.abs(result.ammunitionUsed - frigate.broadsideLb / 2000) < 1e-9);
  assert.ok(result.damage.hull < capacities.hull || result.areaHits.hull === 0);

  const dry = resolveFiring({
    spec: frigate,
    damage,
    targetClass: "frigate",
    distanceKm: 0.45,
    targetBearingRad: Math.PI / 2,
    headingRad: 0,
    ammunitionTonnes: 0,
    objective: "sink",
    random: createSeededRandom(7),
  });
  assert.equal(dry.fired, false);
  assert.equal(dry.ammunitionUsed, 0);

  const partial = resolveFiring({
    spec: frigate,
    damage,
    targetClass: "frigate",
    distanceKm: 0.45,
    targetBearingRad: Math.PI / 2,
    headingRad: 0,
    ammunitionTonnes: 0.01,
    objective: "sink",
    random: createSeededRandom(7),
  });
  assert.equal(partial.fired, true);
  assert.ok(partial.ammunitionUsed <= 0.01 + 1e-12);
  assert.ok(partial.gunsFired < result.gunsFired);
});

test("seeded gun rounding is repeatable", () => {
  const first = createSeededRandom(9);
  const second = createSeededRandom(9);
  assert.deepEqual(
    Array.from({ length: 8 }, () => seededGunCount(2.5, first)),
    Array.from({ length: 8 }, () => seededGunCount(2.5, second)),
  );
});

test("repairs are blocked in combat and resume after thirty seconds", () => {
  assert.equal(isInCombat(1_000, 30_999), true);
  assert.equal(isInCombat(1_000, 31_000), false);
  assert.equal(canRepair(1_000, 30_999), false);
  assert.equal(canRepair(null, 1), true);
  assert.equal(settings.combat.combatSeconds, 30);
});

test("repair works most-damaged first, costs materials and stops when empty", () => {
  const line = shipTypeFor("British", "line");
  const capacities = damageCapacities(line);
  const damage = createShipDamage(line);
  damage.hull = 0;
  const materialCapacity = shipStoreCapacities(line).repairMaterials;
  const fullHullCost = repairCostForArea(line, "hull", materialCapacity);
  assert.ok(Math.abs(fullHullCost / materialCapacity - 0.5 * (capacities.hull / 24200)) < 1e-9);

  const result = repairShip(
    damage,
    line,
    materialCapacity,
    materialCapacity,
    1,
  );
  assert.ok(Math.abs((result.repaired.hull ?? 0) - 1.5) < 1e-9);
  assert.ok(result.materialsUsed > 0);
  assert.ok(result.damage.hull > 0);

  const tiny = repairShip(damage, line, 0.001, materialCapacity, 100);
  assert.ok(Math.abs(tiny.materialsUsed - 0.001) < 1e-12);
  assert.ok(tiny.materialsLeft <= 1e-12);
});

test("a drifting ship with no materials loses hull, and hull at zero sinks", () => {
  const raider = shipTypeFor("British", "raider");
  const damage = createShipDamage(raider);
  const after = applyDriftingHullDamage(damage, raider, 1);
  assert.ok(Math.abs((damage.hull - after.hull) - raider.hull * 0.002) < 1e-9);
  const sunk = { ...damage, hull: 0 };
  assert.equal(isShipSunk(sunk), true);
});

test("ammunition is counted in full broadsides", () => {
  const line = shipTypeFor("British", "line");
  const tonnes = 640 / 2000 * 60;
  assert.ok(Math.abs(ammunitionBroadsideCount(line, tonnes) - 60) < 1e-9);
});

test("a crew just below ten percent cannot fight or sail", () => {
  const line = shipTypeFor("British", "line");
  const capacities = damageCapacities(line);
  const low = createShipDamage(line, capacities.crew * 0.099);
  assert.equal(crewTooLow(low, capacities), true);
  assert.equal(shipPerformance(line, low).canFight, false);
  assert.equal(crewPercent(low, capacities), 9.9);
  assert.equal(damagePercents(createShipDamage(line), capacities).hull, 100);
  assert.ok(angleBetweenDegrees(0, 0) < 1e-9);
});
