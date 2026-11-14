// Browser-free checks for 3H-d neutral colours, loot, privateer, escort and
// five-viewport sheets.

import assert from "node:assert/strict";
import { test } from "node:test";

import { navyColorNumber } from "@naval/shared/navies";
import {
  NPC_KIND_STYLES,
  contractRemainingText,
  escortSheet,
  escortStrip,
  neutralHullStyle,
  neutralMarker,
  npcBattleActions,
  npcLootSheet,
  npcSheetLayout,
  privateerSheet,
} from "@naval/shared/npc-ui";

const VIEWPORTS: Array<[number, number]> = [
  [360, 740],
  [412, 915],
  [740, 360],
  [768, 1024],
  [1280, 800],
];

test("neutral kinds use their own colours, shapes and labels", () => {
  const kinds = ["merchant", "whaler", "privateer"] as const;
  const fills = new Set<number>();
  const shapes = new Set<string>();
  for (const kind of kinds) {
    const style = NPC_KIND_STYLES[kind];
    const hull = neutralHullStyle(kind);
    const marker = neutralMarker(kind);
    assert.equal(hull.fill, style.fill);
    assert.equal(marker.shape, style.marker);
    assert.equal(marker.label, style.label);
    assert.ok(!["British", "French", "Spanish", "Dutch"].includes(style.label));
    fills.add(style.fill);
    shapes.add(style.marker);
    assert.notEqual(style.fill, navyColorNumber("British"));
  }
  assert.equal(fills.size, 3);
  assert.equal(shapes.size, 3);
  assert.equal(neutralMarker("privateer", true).hiredRing, true);
  assert.notEqual(neutralHullStyle("privateer", true).fill, neutralHullStyle("privateer").fill);
});

test("five viewport layouts fit with 44 px targets and scrolling sheets", () => {
  for (const [width, height] of VIEWPORTS) {
    const layout = npcSheetLayout(width, height);
    assert.equal(layout.minTargetPx, 44);
    assert.equal(layout.scrolls, true);
    assert.ok(layout.contentWidth > 0 && layout.contentWidth <= width);
    assert.ok(layout.maxHeight > 0 && layout.maxHeight <= height);
    assert.ok(layout.margin >= 8);
    assert.ok(layout.columns === 1 || layout.columns === 2);
    assert.equal(layout.sheet, width <= 640);
  }
});

test("the battle bar offers Loot & leave only for a struck neutral", () => {
  assert.deepEqual(
    npcBattleActions({ kind: "merchant", abandoned: false, surrendered: false })
      .map((action) => action.id),
    ["board"],
  );
  assert.deepEqual(
    npcBattleActions({ kind: "merchant", abandoned: true })
      .map((action) => action.id),
    ["loot", "claim"],
  );
  assert.deepEqual(
    npcBattleActions({ kind: "whaler", surrendered: true })
      .map((action) => action.id),
    ["loot"],
  );
  assert.deepEqual(
    npcBattleActions({ kind: "privateer", hiredByMe: false })
      .map((action) => action.id),
    ["hirePrivateer", "board"],
  );
  assert.deepEqual(
    npcBattleActions({ kind: "privateer", hiredByMe: true })
      .map((action) => action.id),
    ["manageContract"],
  );
  assert.deepEqual(npcBattleActions({ kind: null, abandoned: true }), []);
});

test("an unboarded neutral never shows cargo in the loot sheet", () => {
  const hidden = npcLootSheet({
    name: "Molly",
    kind: "merchant",
    eligible: false,
    lootCargo: [{ good: "sugar", tonnes: 42 }],
    freeTonnes: 80,
  });
  assert.equal(hidden.showCargo, false);
  assert.deepEqual(hidden.cargoRows, []);
  assert.equal(hidden.canLoot, false);
  assert.match(hidden.reason ?? "", /Board|surrendered|surrender/i);
  assert.equal(JSON.stringify(hidden).includes("42"), false);
});

test("the loot sheet shows cargo and only enables Loot & leave alongside", () => {
  const plan = npcLootSheet({
    name: "Molly",
    kind: "merchant",
    eligible: true,
    lootCargo: [
      { good: "sugar", tonnes: 42 },
      { good: "rum", tonnes: 3.5 },
    ],
    freeTonnes: 50,
    alongside: true,
  });
  assert.equal(plan.showCargo, true);
  assert.equal(plan.cargoRows.length, 2);
  assert.equal(plan.totalTonnes, 45.5);
  assert.equal(plan.canLoot, true);
  assert.equal(plan.actionLabel, "Loot & leave");
  assert.equal(npcLootSheet({
    name: "Molly",
    kind: "merchant",
    eligible: true,
    lootCargo: [{ good: "sugar", tonnes: 42 }],
    freeTonnes: 0,
    alongside: true,
  }).canLoot, false);
  assert.equal(npcLootSheet({
    name: "Molly",
    kind: "merchant",
    eligible: true,
    lootCargo: [{ good: "sugar", tonnes: 42 }],
    freeTonnes: 20,
    alongside: false,
  }).canLoot, false);
  const looted = npcLootSheet({
    name: "Molly",
    kind: "merchant",
    eligible: true,
    lootCargo: [],
    looted: true,
    freeTonnes: 20,
    alongside: true,
  });
  assert.equal(looted.looted, true);
  assert.match(looted.reason ?? "", /looted/i);
});

test("privateer contracts show fees, three modes and six game days", () => {
  const unowned = privateerSheet({
    name: "Swift",
    hiredByMe: false,
    visible: true,
    mode: "patrol",
    fee: 1_200,
    remainingGameSeconds: 0,
    money: 5_000,
  });
  assert.equal(unowned.canHire, true);
  assert.equal(unowned.modes.length, 3);
  assert.deepEqual(unowned.modes.map((mode) => mode.id), ["patrol", "escort", "raid"]);
  assert.match(unowned.hireLabel, /1,200/);
  assert.match(unowned.escortLabel, /900/);
  assert.match(unowned.contractText, /Six game days/);

  const poor = privateerSheet({
    name: "Swift",
    hiredByMe: false,
    visible: true,
    mode: "patrol",
    fee: 1_200,
    remainingGameSeconds: 0,
    money: 100,
  });
  assert.equal(poor.canHire, false);
  assert.match(poor.reason ?? "", /money/i);

  const hired = privateerSheet({
    name: "Swift",
    hiredByMe: true,
    mode: "raid",
    fee: 1_200,
    remainingGameSeconds: 6 * 24 * 3_600,
    money: 5_000,
  });
  assert.equal(hired.canHire, false);
  assert.equal(hired.modes.every((mode) => !mode.disabled), true);
  assert.equal(hired.modes.find((mode) => mode.active)?.id, "raid");
  assert.match(hired.contractText, /6d 0h left/);
  assert.equal(contractRemainingText(0), "contract ended");
});

test("an escort chooses one of your ships and charges the escort fee", () => {
  const plan = escortSheet({
    privateerName: "Swift",
    hiredByMe: false,
    fee: 900,
    money: 5_000,
    targets: [
      { id: "a", name: "Lively", classId: "frigate" },
      { id: "b", name: "Superb", classId: "line" },
    ],
    selectedTargetId: "b",
  });
  assert.equal(plan.targets.length, 2);
  assert.equal(plan.selectedTargetId, "b");
  assert.equal(plan.targets.find((row) => row.selected)?.id, "b");
  assert.match(plan.confirmLabel, /900/);
  assert.equal(plan.canConfirm, true);
  assert.equal(escortSheet({
    privateerName: "Swift",
    hiredByMe: false,
    fee: 900,
    money: 0,
    targets: [{ id: "a", name: "Lively", classId: "frigate" }],
  }).canConfirm, false);
  assert.equal(escortSheet({
    privateerName: "Swift",
    hiredByMe: true,
    fee: 900,
    money: 0,
    targets: [],
  }).reason, "You need a ship to escort.");
});

test("the escort strip lists mode, target and time left", () => {
  const plan = escortStrip([
    {
      id: "p1",
      name: "Swift",
      mode: "escort",
      targetName: "Lively",
      contractRemainingGameSeconds: 5 * 24 * 3_600,
    },
    {
      id: "p2",
      name: "Grey",
      mode: "raid",
      contractRemainingGameSeconds: 2 * 3_600,
    },
  ]);
  assert.equal(plan.shown, true);
  assert.equal(plan.items.length, 2);
  assert.match(plan.text, /Swift escorts Lively/);
  assert.match(plan.text, /5d 0h left/);
  assert.match(plan.text, /Grey raids neutral trade/);
  assert.equal(escortStrip([]).shown, false);
});
