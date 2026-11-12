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
