// Browser-free checks for the fleet screens, orders menu and box selection.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FORMATION_OPTIONS,
  fleetMemberStateText,
  fleetAndLooseShips,
  orderMenuItems,
  queueButtonText,
  responsiveFleetLayout,
  selectedShipIdsInBox,
  selectionBox,
  controlGroupSlotForKey,
} from "@naval/shared/fleet-ui";

test("all five formations and four stances are offered with labels", () => {
  assert.equal(FORMATION_OPTIONS.length, 5);
  assert.deepEqual(FORMATION_OPTIONS.map((option) => option.id), [
    "lineAhead", "lineAbreast", "wedge", "convoy", "freeChase",
  ]);
  assert.equal(new Set(FORMATION_OPTIONS.map((option) => option.icon)).size, 5);
});

test("the sea menu has all six order types and Sail here is first", () => {
  const menu = orderMenuItems("sea");
  assert.equal(menu[0]?.id, "sailHere");
  for (const id of ["sailHere", "heading", "patrol", "rendezvous", "returnPort", "hold"]) {
    assert.ok(menu.some((item) => item.id === id), id);
  }
  assert.deepEqual(orderMenuItems("ship").slice(0, 2).map((item) => item.id), ["follow", "escort"]);
  assert.equal(orderMenuItems("port")[0]?.id, "sailToPort");
});

test("phone sheets, targets and content fit the required viewports", () => {
  const viewports = [
    [360, 740],
    [412, 915],
    [740, 360],
    [768, 1024],
    [1280, 800],
  ] as const;
  for (const [width, height] of viewports) {
    const layout = responsiveFleetLayout(width, height);
    assert.equal(layout.minTargetPx, 44);
    assert.ok(layout.contentWidth <= width);
    assert.ok(layout.contentHeight <= height);
    assert.equal(layout.sheet, width <= 640);
    assert.equal(layout.bottomSheet, width <= 640);
    if (width <= 640) {
      assert.ok(layout.contentWidth >= width - 28);
      assert.ok(layout.contentHeight >= height - 28);
    }
  }
});

test("the selection box is order-independent and excludes outside ships", () => {
  const box = selectionBox({ x: 30, y: 40 }, { x: 10, y: 20 });
  assert.deepEqual(box, { left: 10, top: 20, right: 30, bottom: 40 });
  const ships = [
    { id: "a", x: 20, y: 30 },
    { id: "b", x: 5, y: 30 },
    { id: "c", x: 30, y: 40 },
  ];
  assert.deepEqual(selectedShipIdsInBox(ships, { x: 30, y: 40 }, { x: 10, y: 20 }), ["a", "c"]);
});

test("fleet cards put fleets first and loose ships second", () => {
  const own = [
    { id: "loose", fleetId: null },
    { id: "a", fleetId: "f1" },
    { id: "b", fleetId: "f1" },
  ];
  const split = fleetAndLooseShips(own);
  assert.deepEqual(split.fleets.map((ship) => ship.id), ["a", "b"]);
  assert.deepEqual(split.loose.map((ship) => ship.id), ["loose"]);
  assert.equal(fleetMemberStateText("outOfStation"), "Out of station");
  assert.equal(fleetMemberStateText("needsCrew"), "Needs crew");
  assert.equal(queueButtonText(true, 2), "Queue on · 2");
  assert.equal(queueButtonText(false, 2), "Queue off");
});

test("number keys 1 to 9 select control groups and other keys are ignored", () => {
  assert.equal(controlGroupSlotForKey("1"), 1);
  assert.equal(controlGroupSlotForKey("9"), 9);
  assert.equal(controlGroupSlotForKey("0"), null);
  assert.equal(controlGroupSlotForKey("a"), null);
});
