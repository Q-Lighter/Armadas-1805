// 3I-c research and ship-upgrade screens, tested without a browser.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { researchScreenView, researchLayoutPlan, shipUpgradeRows } from "@naval/shared/research-view";
import { shipyardCards } from "@naval/shared/fleet-view";
import { buildScreenLayout } from "@naval/shared/screen-layout";

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 412, height: 915 },
  { width: 740, height: 360 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const NAVIES = ["British", "French", "Spanish", "Dutch"] as const;

test("3I-c every navy shows exactly its own 31 upgrades and no other navy's unique", () => {
  for (const navy of NAVIES) {
    const view = researchScreenView({ navy, points: 0, levels: new Map() });
    assert.equal(view.branches.length, 6, `${navy} branches`);
    assert.equal(view.branches.reduce((sum, branch) => sum + branch.rows.length, 0), 31, navy);
    assert.equal(view.branches.filter((branch) => branch.id === "unique").length, 1);
    const foreign = NAVIES.filter((other) => other !== navy)
      .flatMap((other) => researchScreenView({ navy: other, points: 0, levels: new Map() })
        .branches.find((branch) => branch.id === "unique")?.rows.map((row) => row.id) ?? []);
    const ids = new Set(view.branches.flatMap((branch) => branch.rows.map((row) => row.id)));
    for (const id of foreign) assert.equal(ids.has(id), false, `${navy} leaked ${id}`);
    for (const branch of view.branches) {
      for (const row of branch.rows) {
        assert.equal(row.pips.length, row.levels);
        assert.ok(row.effect.length > 0);
      }
    }
  }
});

test("3I-c buy buttons stay visible and say why they are disabled", () => {
  const poor = researchScreenView({ navy: "British", points: 0, levels: new Map() });
  const copper = poor.branches.flatMap((branch) => branch.rows)
    .find((row) => row.id === "copperSheathing")!;
  assert.equal(copper.state, "locked");
  assert.equal(copper.disabled, true);
  assert.equal(copper.reason, "Not enough points");
  assert.equal(copper.costUnits, 1);

  const rich = researchScreenView({
    navy: "British",
    points: 10_000,
    levels: new Map([["copperSheathing", 1]]),
  });
  const nextCopper = rich.branches.flatMap((branch) => branch.rows)
    .find((row) => row.id === "copperSheathing")!;
  assert.equal(nextCopper.state, "available");
  assert.equal(nextCopper.level, 1);
  assert.equal(nextCopper.nextLevel, 2);
  assert.equal(nextCopper.disabled, false);

  const maxed = researchScreenView({
    navy: "British",
    points: 10_000,
    levels: new Map([["copperSheathing", 3]]),
  });
  const owned = maxed.branches.flatMap((branch) => branch.rows)
    .find((row) => row.id === "copperSheathing")!;
  assert.equal(owned.state, "owned");
  assert.equal(owned.disabled, true);
  assert.equal(owned.reason, "Fully researched");
});

test("3I-c hook upgrades say when they will take effect", () => {
  const view = researchScreenView({ navy: "British", points: 10_000, levels: new Map() });
  const storm = view.branches.flatMap((branch) => branch.rows)
    .find((row) => row.id === "stormSeamanship")!;
  assert.match(storm.hook ?? "", /Takes effect when storms arrives/);
  const night = view.branches.flatMap((branch) => branch.rows)
    .find((row) => row.id === "nightWatch")!;
  assert.match(night.hook ?? "", /night sight/);
  const active = view.branches.flatMap((branch) => branch.rows)
    .find((row) => row.id === "gunCarriages")!;
  assert.equal(active.hook, null);
});

test("3I-c ship rows compare fitted and unlocked levels", () => {
  const rows = shipUpgradeRows(
    "British",
    { copperSheathing: 1, gunCarriages: 2 },
    { copperSheathing: 2, gunCarriages: 2, gunneryDrill: 1 },
  );
  const copper = rows.find((row) => row.id === "copperSheathing")!;
  assert.equal(copper.fitted, 1);
  assert.equal(copper.unlocked, 2);
  assert.equal(rows.find((row) => row.id === "gunCarriages")!.fitted, 2);
  assert.equal(rows.find((row) => row.id === "gunneryDrill")!.fitted, 0);
  assert.equal(rows.some((row) => row.id === "warehouse"), false);
});

test("3I-c fire ships stay locked with a reason until researched", () => {
  const locked = shipyardCards("normal", "large", "British", false)
    .find((card) => card.classId === "fireShip")!;
  assert.equal(locked.locked, true);
  assert.equal(locked.lockedReason, "Needs research: Fire ships");
  const unlocked = shipyardCards("normal", "large", "British", true)
    .find((card) => card.classId === "fireShip")!;
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.lockedReason, undefined);
});

test("3I-c research panel fits and scrolls at all five review viewports", () => {
  for (const viewport of VIEWPORTS) {
    const plan = researchLayoutPlan(viewport.width, viewport.height);
    assert.equal(plan.scroll, true);
    assert.equal(plan.minTargetPx, 44);
    assert.ok(plan.panelMaxHeightShare > 0 && plan.panelMaxHeightShare <= 1);

    const layout = buildScreenLayout({
      ...viewport,
      state: { dockPanel: "research", ownShipSelected: true },
    });
    assert.deepEqual(layout.audit(), [], `${viewport.width}x${viewport.height}`);
    const panel = layout.elements.find((element) => element.id === "research-panel")!;
    assert.equal(panel.visible, true, `${viewport.width}: research panel visible`);
    assert.equal(panel.scrollable, true);
    assert.ok(panel.rect.width >= 44 && panel.rect.height >= 44);
    for (const element of layout.elements) {
      if (element.visible && element.interactive) {
        assert.ok(element.rect.width >= 44, `${viewport.width}: ${element.id} width`);
        assert.ok(element.rect.height >= 44, `${viewport.width}: ${element.id} height`);
      }
    }
  }
});

test("3I-c the research and upgrade markup exists for the client", () => {
  const html = readFileSync("client/index.html", "utf8");
  for (const id of [
    "research-panel",
    "dock-tab-research",
    "research-branches",
    "ship-tab-upgrades",
    "ship-upgrade-list",
    "fleet-upgrade-all",
    "research-btn",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} missing`);
  }
  const css = readFileSync("client/paper.css", "utf8");
  assert.match(css, /\.research-row \.btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.ship-upgrade-list\s*\{[^}]*overflow-y:\s*auto/s);
});
