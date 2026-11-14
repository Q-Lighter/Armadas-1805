import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCaptureUnlocks,
  awardDiscoveredBlocks,
  awardPortCapture,
  awardPortDiscovery,
  balanceReport,
  buyResearch,
  canBuildFortification,
  computeResearchModifiers,
  emptyResearch,
  firstHourSimulation,
  fireShipsUnlockedFor,
  fittedAfterUpgrade,
  fittingPlan,
  fortificationResearchTier,
  newShipUpgrades,
  perShipSightKm,
  portOutputMultiplier,
  researchBuyProblem,
  researchCostPoints,
  researchUnits,
  type NavyResearch,
} from "@naval/shared/research";
import {
  RESEARCH_UPGRADES,
  researchLevelCostUnits,
  researchTreeFor,
  researchUpgrade,
} from "@naval/shared/research-data";
import { settings } from "@naval/shared/settings";
import { NAVY_IDS } from "@naval/shared/navies";
import { GAME_DAY_MS } from "@naval/shared/time";

test("3I each navy has 31 upgrades with the same total cost", () => {
  assert.equal(NAVY_IDS.length, 4);
  let sharedCount = 0;
  let uniqueCount = 0;
  for (const upgrade of RESEARCH_UPGRADES) {
    if (upgrade.navy) uniqueCount += 1;
    else sharedCount += 1;
  }
  assert.equal(sharedCount, 25);
  assert.equal(uniqueCount, 24);
  assert.equal(sharedCount + uniqueCount, 49);

  for (const navy of NAVY_IDS) {
    const tree = researchTreeFor(navy);
    assert.equal(tree.length, 31, navy);
    assert.equal(tree.filter((upgrade) => upgrade.branch !== "unique").length, 25);
    assert.equal(tree.filter((upgrade) => upgrade.navy === navy).length, 6);
    let total = 0;
    for (const upgrade of tree) {
      assert.equal(upgrade.levels.length, upgrade.cold ? 1 : 3, upgrade.id);
      for (let level = 1; level <= upgrade.levels.length; level += 1) {
        total += researchLevelCostUnits(upgrade, level);
      }
    }
    assert.equal(total, 216, `${navy} total units`);
  }

  assert.equal(researchLevelCostUnits(researchUpgrade("coldWeatherClothing")!, 1), 2);
  assert.equal(researchLevelCostUnits(researchUpgrade("fortification")!, 1), 3);
  assert.equal(researchLevelCostUnits(researchUpgrade("fortification")!, 2), 6);
  assert.equal(researchLevelCostUnits(researchUpgrade("fortification")!, 3), 12);
  assert.equal(researchCostPoints("fortification", 3), 1_200);
});

test("3I point sources, unit conversion and the first-hour simulation", () => {
  let state = emptyResearch();
  assert.equal(researchUnits(250), 2);
  const first = awardPortDiscovery(state, "port-kingston", "L");
  state = first.state;
  assert.equal(first.awarded, 40);
  assert.equal(awardPortDiscovery(state, "port-kingston", "L").awarded, 0);

  const blocks = awardDiscoveredBlocks(state, ["1_1", "1_1", "2_1"]);
  state = blocks.state;
  assert.equal(blocks.added, 2);
  assert.equal(blocks.awarded, 1);

  const capture = awardPortCapture(state, "port-kingston", "S");
  state = capture.state;
  assert.equal(capture.awarded, 120);
  assert.ok(Math.abs(state.points - 161) < 1e-9);

  const hour = firstHourSimulation();
  assert.deepEqual(hour, {
    foundPortPoints: 80,
    blockPoints: 50,
    capturePoints: 120,
    totalPoints: 250,
    units: 2,
    blocks: 100,
    portsFound: ["S", "M", "L"],
    capturedPort: "S",
  });
  assert.equal(settings.research.pointsPerUnit, 100);
});

test("3I levels are bought in order from one shared pool", () => {
  const shared: NavyResearch = {
    ...emptyResearch(),
    points: 700,
    levels: new Map(),
  };
  const first = buyResearch(shared, "copperSheathing", 1);
  assert.equal(first.problem, null);
  assert.equal(first.spent, 100);
  assert.equal(first.state.levels.get("copperSheathing"), 1);
  // The original is unchanged, so two teammates can share the latest state.
  assert.equal(shared.levels.get("copperSheathing"), undefined);

  assert.equal(researchBuyProblem(first.state, "copperSheathing", 3), "Level 2 first");
  assert.equal(researchBuyProblem(first.state, "copperSheathing", 2), null);
  const second = buyResearch(first.state, "copperSheathing", 2);
  assert.equal(second.spent, 200);
  const third = buyResearch(second.state, "copperSheathing", 3);
  assert.equal(third.spent, 400);
  assert.equal(third.state.points, 0);
  assert.equal(third.state.levels.get("copperSheathing"), 3);
  assert.equal(researchBuyProblem(third.state, "copperSheathing", 3), "Already owned");
  assert.equal(researchBuyProblem(third.state, "gunneryDrill", 1), "Not enough points");
});

test("3I fitting costs 5% per missing level, uses the Shipyard discount and one day", () => {
  const unlocked = new Map([
    ["copperSheathing", 2],
    ["gunneryDrill", 1],
    ["rustyBulkheads", 3],
  ]);
  const fitted = new Map([["copperSheathing", 1]]);
  const plan = fittingPlan({ classId: "frigate", fitted, unlocked });
  // Frigate 6,000 x 5% x (1 missing copper + 1 gunnery) = 600.
  assert.equal(plan.missingLevels, 2);
  assert.equal(plan.cost, 600);
  assert.equal(plan.gameDays, 1);
  assert.equal(plan.gameMs, GAME_DAY_MS);
  assert.equal(plan.levels.get("gunneryDrill"), 1);

  const discounted = fittingPlan({
    classId: "frigate",
    fitted,
    unlocked,
    portModifiers: { upgradeCost: 0.7 },
  });
  assert.equal(discounted.cost, 420);

  const after = fittedAfterUpgrade(fitted, plan);
  assert.equal(after.get("copperSheathing"), 2);
  assert.equal(after.get("gunneryDrill"), 1);
  // An already better captured fitting is never lowered.
  assert.equal(fittedAfterUpgrade(new Map([["gunneryDrill", 3]]), plan).get("gunneryDrill"), 3);

  const free = newShipUpgrades(unlocked);
  assert.equal(free.get("copperSheathing"), 2);
  assert.equal(free.get("gunneryDrill"), 1);
  assert.equal(free.has("rustyBulkheads"), false);
});

test("3I capture unlocks the first level, then one level per three points", () => {
  let state: NavyResearch = emptyResearch();
  const first = applyCaptureUnlocks(state, { copperSheathing: 2, nightWatch: 1 });
  state = first.state;
  assert.deepEqual(first.unlocked, [
    { id: "copperSheathing", level: 1 },
    { id: "nightWatch", level: 1 },
  ]);
  assert.equal(state.levels.get("copperSheathing"), 1);

  let next = applyCaptureUnlocks(state, { copperSheathing: 2 });
  state = next.state;
  assert.equal(state.capturePoints.get("copperSheathing"), 1);
  assert.equal(state.levels.get("copperSheathing"), 1);
  next = applyCaptureUnlocks(state, { copperSheathing: 2 });
  state = next.state;
  next = applyCaptureUnlocks(state, { copperSheathing: 2 });
  state = next.state;
  assert.equal(state.levels.get("copperSheathing"), 2);
  assert.equal(state.capturePoints.get("copperSheathing"), 0);

  // A captured level 3 cannot go above level 3.
  let capped = emptyResearch();
  capped = applyCaptureUnlocks(capped, { gunneryDrill: 3 }).state;
  for (let index = 0; index < 8; index += 1) {
    capped = applyCaptureUnlocks(capped, { gunneryDrill: 3 }).state;
  }
  assert.equal(capped.levels.get("gunneryDrill"), 3);
});

test("3I fortification and fire ship gates use research, not the room kind", () => {
  const levels = new Map([["fortification", 1], ["fireShips", 1], ["hotShot", 1]]);
  assert.equal(fortificationResearchTier(levels), 1);
  assert.equal(canBuildFortification(1, 0), true);
  assert.equal(canBuildFortification(1, 1), false);
  assert.equal(canBuildFortification(3, 2), true);
  assert.equal(fireShipsUnlockedFor(levels), true);
  assert.equal(fireShipsUnlockedFor(new Map()), false);
  const mods = computeResearchModifiers(levels);
  assert.equal(mods.fireShipUnlocked, true);
  assert.equal(mods.hotShotUnlocked, true);
  assert.ok(mods.hotShotChance > 0);
});

test("3I ACTIVE effects reach the registry and stack multiplicatively", () => {
  const levels = new Map([
    ["copperSheathing", 3],
    ["improvedRigging", 3],
    ["chronometerCharts", 3],
    ["gunCarriages", 3],
    ["gunneryDrill", 3],
    ["specialistShot", 3],
    ["fireShips", 3],
    ["hotShot", 3],
    ["shipyard", 3],
    ["warehouse", 3],
    ["harbour", 3],
    ["signalFlags", 3],
    ["boardingDrill", 3],
    ["prizeCrews", 3],
    ["heavyTimbers", 3],
    ["roomyHolds", 3],
    ["bankingHouses", 3],
    ["blockadeDiscipline", 3],
    ["dockyardMethods", 3],
    ["fortification", 3],
  ]);
  const mods = computeResearchModifiers(levels);
  assert.ok(Math.abs(mods.speed - 1.08) < 1e-9);
  assert.equal(mods.closestToWindDeg, 6);
  assert.ok(Math.abs(mods.sight - 1.15) < 1e-9);
  assert.ok(Math.abs(mods.reload - 0.85) < 1e-9);
  assert.ok(Math.abs(mods.hitChance - 1.1) < 1e-9);
  assert.equal(mods.chainGrape, 2.6);
  assert.equal(mods.grapeRangeM, 450);
  assert.equal(mods.fireShipUnlocked, true);
  assert.equal(mods.ignitionRangeM, 125);
  assert.equal(mods.fireShipSpot, 0.8);
  assert.equal(mods.fireShipPrice, 0.7);
  assert.equal(mods.hotShotUnlocked, true);
  assert.ok(Math.abs(mods.hotShotChance - 0.1) < 1e-9);
  assert.ok(Math.abs(mods.supplies - 1.15) < 1e-9);
  assert.ok(Math.abs(mods.seaRepair - 1.3) < 1e-9);
  assert.ok(Math.abs(mods.hull - 1.06) < 1e-9);
  assert.ok(Math.abs(mods.cargo - 1.12) < 1e-9);
  assert.ok(Math.abs(mods.boardingStrength - 1.15) < 1e-9);
  assert.ok(Math.abs(mods.prizeJoin - 1) < 1e-9);
  assert.ok(Math.abs(mods.formationRotation - 1.5) < 1e-9);
  assert.ok(Math.abs(mods.port.shipPrice - 0.637) < 1e-9); // 10% Shipyard + 9% banking
  assert.ok(Math.abs(mods.port.repairTime - 0.7) < 1e-9);
  assert.ok(Math.abs(mods.port.repairCost - 0.7) < 1e-9);
  assert.ok(Math.abs(mods.port.upgradeCost - 0.7) < 1e-9);
  assert.ok(Math.abs(mods.port.storage - 1.75) < 1e-9);
  assert.ok(Math.abs(mods.port.repairSpeed - 1.6) < 1e-9);
});

test("3I per-ship sight is class base times Chronometer", () => {
  const none = computeResearchModifiers(new Map());
  assert.equal(perShipSightKm("frigate", none), 25);
  assert.equal(perShipSightKm("fireShip", none), 15);
  const charts = computeResearchModifiers(new Map([["chronometerCharts", 3]]));
  assert.ok(Math.abs(perShipSightKm("frigate", charts) - 28.75) < 1e-9);
  assert.ok(Math.abs(perShipSightKm("fireShip", charts) - 17.25) < 1e-9);
});

test("3I HOOK effects are reported but change nothing", () => {
  const levels = new Map([
    ["nightWatch", 3],
    ["masterPilots", 3],
    ["stormSeamanship", 3],
    ["lightningConductors", 3],
    ["market", 3],
    ["hospital", 3],
    ["shallowDraughtHulls", 3],
  ]);
  const mods = computeResearchModifiers(levels);
  assert.equal(mods.nightSight, 1);
  assert.equal(mods.groundingDamage, 1);
  assert.equal(mods.stormDamage, 1);
  assert.equal(mods.lightningChance, 1);
  assert.equal(mods.port.income, 1);
  assert.equal(mods.port.healingCost, 1);
  assert.equal(mods.draughtReductionM, 0);
  assert.ok(mods.hooks.some((hook) => hook.kind === "nightSight" && hook.system === "night sight"));
  assert.ok(mods.hooks.some((hook) => hook.kind === "portIncome" && hook.system === "port income"));
});

test("3I regional output bonuses use the port region and good", () => {
  const levels = new Map([
    ["hondurasMosquito", 3],
    ["caribbeanPlanters", 3],
    ["silverPeruMexico", 3],
    ["riverPlateHides", 3],
    ["guianasRiver", 3],
  ]);
  assert.ok(Math.abs(portOutputMultiplier({ region: "Central America", good: "timber" }, levels) - 1.75) < 1e-9);
  assert.ok(Math.abs(portOutputMultiplier({ region: "Greater Antilles", good: "sugar" }, levels) - 1.75) < 1e-9);
  assert.ok(Math.abs(portOutputMultiplier({ region: "Pacific coast", good: "silver" }, levels) - 1.75) < 1e-9);
  assert.ok(Math.abs(portOutputMultiplier({ region: "River Plate", good: "hides" }, levels) - 1.75) < 1e-9);
  assert.ok(Math.abs(portOutputMultiplier({ region: "Guianas/Amazon", good: "timber" }, levels) - 1.3) < 1e-9);
  assert.equal(portOutputMultiplier({ region: "NE Brazil", good: "sugar" }, levels), 1);
});

test("3I balance report has a numeric row for every upgrade and level", () => {
  const rows = balanceReport();
  assert.equal(rows.length, 49);
  const copper = rows.find((row) => row.id === "copperSheathing")!;
  assert.equal(copper.levels.length, 3);
  assert.ok(Math.abs(copper.levels[2]!.frigate.speedKnots - 9 * 1.08) < 1e-9);
  assert.equal(copper.levels[2]!.units, 4);
  assert.equal(copper.levels[2]!.points, 400);
  assert.match(copper.levels[2]!.effects, /Speed \+8%/);
  const night = rows.find((row) => row.id === "nightWatch")!;
  assert.equal(night.active, false);
  assert.equal(night.hook, "night sight");
  assert.match(night.levels[0]!.hook ?? "", /Takes effect when night sight arrives/);
  const fort = rows.find((row) => row.id === "fortification")!;
  assert.equal(fort.levels[2]!.units, 12);
  assert.equal(fort.levels[2]!.points, 1_200);
  assert.ok(rows.every((row) => row.levels.every((level) => level.points > 0)));
});
