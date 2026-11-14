import assert from "node:assert/strict";
import test from "node:test";

import {
  auditScreenLayout,
  buildScreenLayout,
  contextStripVisible,
  resolveLayoutMode,
  UI_ELEMENTS,
  type LayoutState,
} from "@naval/shared/screen-layout";

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 412, height: 915 },
  { width: 740, height: 360 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const STATES: Array<{ name: string; state: LayoutState }> = [
  { name: "idle", state: {} },
  { name: "own ship selected", state: { ownShipSelected: true, dockPanel: "ship" } },
  {
    name: "combat with enemy selected",
    state: {
      ownShipSelected: true,
      inCombat: true,
      enemySelected: true,
      dockPanel: "target",
      enemyChip: { x: 300, y: 420 },
    },
  },
  {
    name: "surrender offered",
    state: { inCombat: true, enemySelected: true, surrenderOffered: true },
  },
  { name: "enemy port selected", state: { enemyPortSelected: true, dockPanel: "port" } },
  { name: "own port selected", state: { ownPortSelected: true, dockPanel: "port" } },
  {
    name: "fire ship with tow",
    state: { fireShipSelected: true, towAvailable: true, dockPanel: "ship" },
  },
  { name: "chart with trails", state: { chartOpen: true, trailsOpen: true } },
  { name: "menu open", state: { menuOpen: true } },
  { name: "developer sheet open", state: { developerOpen: true } },
  { name: "loot modal", state: { modal: "loot" } },
  { name: "board modal", state: { modal: "board" } },
  { name: "privateer hire modal", state: { modal: "privateer" } },
  { name: "resign modal", state: { modal: "resign" } },
  { name: "victory modal", state: { modal: "victory" } },
  { name: "five notices", state: { noticeCount: 5 } },
  { name: "ship sheet", state: { shipSheetOpen: true } },
  { name: "battle log sheet", state: { battleLogOpen: true, battleLogUnread: 4 } },
  { name: "orders sheet", state: { ordersOpen: true } },
];

test("3I inventory has one unique registration for every planned element", () => {
  const ids = UI_ELEMENTS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("map-compass"));
  assert.ok(ids.includes("scale-bar"));
  assert.ok(ids.includes("dock-tab-ship"));
  assert.ok(ids.includes("notice-2"));
});

test("3I chooses the three modes from size and the remembered preference", () => {
  assert.equal(resolveLayoutMode(1280, 800), "desktop");
  assert.equal(resolveLayoutMode(768, 1024), "desktop");
  assert.equal(resolveLayoutMode(360, 740), "phonePortrait");
  assert.equal(resolveLayoutMode(412, 915), "phonePortrait");
  assert.equal(resolveLayoutMode(740, 360), "phoneLandscape");
  assert.equal(resolveLayoutMode(1280, 800, "phone"), "phonePortrait");
  assert.equal(resolveLayoutMode(360, 740, "desktop"), "desktop");
});

test("3I render plan is clean in every review viewport and state", () => {
  for (const viewport of VIEWPORTS) {
    for (const { name, state } of STATES) {
      const plan = buildScreenLayout({ ...viewport, state });
      const issues = plan.audit();
      assert.deepEqual(
        issues,
        [],
        `${viewport.width}x${viewport.height} ${name}: ${JSON.stringify(issues)}`,
      );
      assert.deepEqual(auditScreenLayout(plan), issues);
      for (const element of plan.elements) {
        if (element.visible && element.interactive) {
          assert.ok(element.rect.width >= 44, `${name}: ${element.id} width`);
          assert.ok(element.rect.height >= 44, `${name}: ${element.id} height`);
        }
        if (element.visible && element.contentHeight > element.rect.height + 1) {
          assert.equal(element.scrollable, true, `${name}: ${element.id} should scroll`);
        }
      }
    }
  }
});

test("3I context strip is absent when no target action applies", () => {
  const plan = buildScreenLayout({ width: 360, height: 740, state: {} });
  assert.equal(plan.elements.find((element) => element.id === "battle-bar")?.visible, false);
  assert.equal(contextStripVisible({}), false);
  for (const state of [
    { inCombat: true },
    { enemySelected: true },
    { surrenderOffered: true },
    { enemyPortSelected: true },
    { ownPortSelected: true },
    { fireShipSelected: true },
  ]) {
    assert.equal(contextStripVisible(state), true);
  }
});

test("3I dock, menu and modal panels scroll instead of clipping", () => {
  const desktop = buildScreenLayout({ width: 1280, height: 800, state: { dockPanel: "ship" } });
  const dock = desktop.elements.find((element) => element.id === "ship-panel")!;
  assert.equal(dock.scrollable, true);
  assert.ok(dock.contentHeight > dock.rect.height);

  for (const [state, id] of [
    [{ menuOpen: true }, "menu-panel"],
    [{ developerOpen: true }, "test-tools"],
    [{ modal: "victory" as const }, "victory-screen"],
  ] as const) {
    const plan = buildScreenLayout({ width: 360, height: 740, state });
    const sheet = plan.elements.find((element) => element.id === id)!;
    assert.equal(sheet.scrollable, true);
    assert.ok(sheet.contentHeight > sheet.rect.height);
  }
});

test("3I toolbar keeps unavailable controls visible with a reason", () => {
  const plan = buildScreenLayout({ width: 1280, height: 800, state: {} });
  for (const id of ["tap-btn", "move-btn", "multi-btn", "follow-btn", "queue-btn"]) {
    assert.equal(plan.elements.find((element) => element.id === id)?.visible, true);
  }
  const move = plan.elements.find((element) => element.id === "move-btn")!;
  assert.equal(move.disabled, true);
  assert.ok(move.reason && move.reason.length > 0);
});
