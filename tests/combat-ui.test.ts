// Part C: browser-free checks for the damage screen, attack menu, log,
// notifications, effects and port repair presentation.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attackMenuItems,
  battleLogLines,
  combatLayout,
  damageRows,
  notificationAllowed,
  portRepairChoices,
  visibleCombatEffects,
} from "@naval/shared/combat-ui";

const VIEWPORTS = [
  [360, 740],
  [412, 915],
  [740, 360],
  [768, 1024],
  [1280, 800],
] as const;

test("damage and attack sheets fit the five viewports and keep 44 px targets", () => {
  for (const [width, height] of VIEWPORTS) {
    const layout = combatLayout(width, height);
    assert.equal(layout.minTargetPx, 44);
    assert.ok(layout.contentWidth > 0 && layout.contentWidth <= width);
    assert.ok(layout.damageScrollHeight >= 80);
    assert.ok(layout.damageScrollHeight <= Math.max(80, height));
    assert.ok(layout.logHeight > 0 && layout.logHeight < height);
    assert.ok(layout.attackColumns === 1 || layout.attackColumns === 2);
    assert.equal(damageRows(undefined).length, 6);
    assert.ok(damageRows(undefined).every((row) => row.percent === 100));
  }
});

test("the attack menu appears only on a visible foreign ship", () => {
  assert.equal(attackMenuItems(false, false).length, 0);
  assert.equal(attackMenuItems(true, true).length, 0);
  const items = attackMenuItems(true, false);
  assert.deepEqual(items.map((item) => item.label), [
    "Attack: Sink",
    "Attack: Capture",
    "Cancel",
  ]);
});

test("the battle log keeps only lines involving my own ships", () => {
  const lines = [
    "Your Lively hit the Pickle: hull -2%, crew -3%.",
    "Pickle hit the Lively: hull -9%.",
    "Enemy private damage: hull -70%.",
    "The Vengeur hit your Lively: sails -4%.",
  ];
  assert.deepEqual(battleLogLines(lines), [
    "Your Lively hit the Pickle: hull -2%, crew -3%.",
    "The Vengeur hit your Lively: sails -4%.",
  ]);
});

test("notifications allow one of each kind per ship per minute", () => {
  const seen = new Map<string, number>();
  assert.equal(notificationAllowed(seen, "p:lively:battle", 1_000), true);
  assert.equal(notificationAllowed(seen, "p:lively:battle", 30_000), false);
  assert.equal(notificationAllowed(seen, "p:lively:battle", 61_000), true);
  assert.equal(notificationAllowed(seen, "p:lively:crewLow", 61_000), true);
  assert.equal(notificationAllowed(seen, "q:lively:battle", 61_000), true);
});

test("effects are filtered to the sight circles", () => {
  const own = [{ x: 0, y: 0 }];
  const events = [
    { x: 0.1, y: 0.1, kind: "hit" },
    { x: 1.4, y: 0, kind: "miss" },
    { x: 20, y: 20, kind: "fire" },
  ];
  assert.deepEqual(
    visibleCombatEffects(events, own, 1).map((event) => event.kind),
    ["hit"],
  );
});

test("port repair choices show the same cost that is charged", () => {
  const choices = portRepairChoices(12.34, 246.8);
  assert.equal(choices[0]?.usesMaterials, 12.34);
  assert.equal(choices[0]?.chargesMoney, 0);
  assert.equal(choices[0]?.label, "Repair with stores: 12.3 t at x4");
  assert.equal(choices[1]?.usesMaterials, 0);
  assert.equal(choices[1]?.chargesMoney, 247);
  assert.equal(choices[1]?.label, "Pay locals: 247 pieces at x2, x6");
});

// --- 3C-c: battle bar and surrender screens --------------------------------

import { battleBarItems, battleBarLayout, battleBarVisible, surrenderOffer, surrenderSheetLayout, whiteFlagVisible } from "@naval/shared/combat-ui";

test("battle bar orders, active objective and fleet surrender", () => {
  assert.deepEqual(
    battleBarItems({ fleet: false, surrendered: false, battleOrder: "capture" })
      .map((item) => `${item.label}:${item.active ? "on" : "off"}`),
    ["Capture:on", "Sink:off", "Run:off", "Surrender:off"],
  );
  assert.equal(
    battleBarItems({ fleet: true, surrendered: false }).some((item) => item.id === "surrender"),
    false,
  );
  assert.deepEqual(
    battleBarItems({ fleet: false, surrendered: true }).map((item) => item.label),
    ["Take down flag"],
  );
  assert.equal(
    battleBarItems({ fleet: false, surrendered: false, running: true })
      .find((item) => item.id === "run")?.active,
    true,
  );
});

test("battle bar visibility needs combat, an enemy or a run", () => {
  assert.equal(battleBarVisible({ hasOwnShip: true, inCombat: true, fleetInCombat: false, enemySelected: false }), true);
  assert.equal(battleBarVisible({ hasOwnShip: true, inCombat: false, fleetInCombat: true, enemySelected: false }), true);
  assert.equal(battleBarVisible({ hasOwnShip: true, inCombat: false, fleetInCombat: false, enemySelected: true }), true);
  assert.equal(battleBarVisible({ hasOwnShip: true, inCombat: false, fleetInCombat: false, enemySelected: false }), false);
  assert.equal(battleBarVisible({ hasOwnShip: false, inCombat: false, fleetInCombat: false, enemySelected: false }), false);
});

test("surrender sheet explains range and fleet-full reasons", () => {
  const near = surrenderOffer({
    visible: true, name: "Lively", navy: "French", classId: "frigate",
    fleetCount: 24, maxShips: 30, nearestShipKm: 0.8,
  })!;
  assert.match(near.title, /Lively of the French has struck her flag/);
  assert.equal(near.acceptEnabled, true);
  assert.equal(near.reason, null);
  assert.equal(near.fleetText, "Your fleet: 24 of 30");

  const far = surrenderOffer({
    visible: true, name: "", navy: "French", classId: "frigate",
    fleetCount: 24, maxShips: 30, nearestShipKm: 2,
  })!;
  assert.equal(far.acceptEnabled, false);
  assert.match(far.reason ?? "", /within 1 km/);
  assert.equal(far.sailThere, true);

  const full = surrenderOffer({
    visible: true, name: "Lively", navy: "French", classId: "frigate",
    fleetCount: 30, maxShips: 30, nearestShipKm: 0.8,
  })!;
  assert.equal(full.acceptEnabled, false);
  assert.match(full.reason ?? "", /Fleet full/);
  assert.equal(surrenderOffer({
    visible: false, name: "Lively", navy: "French", classId: "frigate",
    fleetCount: 1, maxShips: 30, nearestShipKm: 0.2,
  }), null);
});

test("battle bar and surrender sheet fit the five viewports", () => {
  for (const [width, height] of VIEWPORTS) {
    const layout = battleBarLayout(width, height);
    assert.equal(layout.minTargetPx, 44);
    assert.ok(layout.barHeight >= 44);
    assert.ok(layout.maxBarHeight >= 44);
    assert.ok(layout.contentWidth > 0 && layout.contentWidth <= width);
    assert.equal(layout.sheet, width <= 640);
    const sheet = surrenderSheetLayout(width, height);
    assert.equal(sheet.minTargetPx, 44);
    assert.equal(sheet.scrolls, true);
    assert.ok(sheet.width > 0 && sheet.width <= width);
    assert.ok(sheet.maxHeight > 0 && sheet.maxHeight <= height);
  }
});

test("white flags draw only for visible surrendered ships", () => {
  assert.equal(whiteFlagVisible(true, true), true);
  assert.equal(whiteFlagVisible(false, true), false);
  assert.equal(whiteFlagVisible(true, false), false);
});

test("battle log accepts you/your surrender lines", () => {
  assert.deepEqual(battleLogLines([
    "Your Lively surrendered.",
    "You accepted the surrender of the French frigate.",
    "The Vengeur hit your Lively: hull -2%.",
  ]), [
    "Your Lively surrendered.",
    "You accepted the surrender of the French frigate.",
    "The Vengeur hit your Lively: hull -2%.",
  ]);
});
