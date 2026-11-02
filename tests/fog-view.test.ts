// Tests for the client's paper-cover rule and TEMP-DEBUG readout.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cellIsOutsideSight,
  cellNeedsPaper,
  discoveredCellCount,
  fogDebugLine,
} from "@naval/shared/fog-view";
import { chartCellKm, chartColumns, chartRows } from "@naval/shared/fog";

test("test and dev rooms show the fog debug line; normal rooms do not", () => {
  const cells = new Set([1, 2, 3]);
  assert.equal(fogDebugLine("normal", false, cells, 2), null);

  const testLine = fogDebugLine("test", false, cells, 2);
  assert.ok(testLine?.startsWith("TEMP-DEBUG"));
  assert.match(testLine ?? "", /room type test/);
  assert.match(testLine ?? "", /3 discovered cells/);
  assert.match(testLine ?? "", /2 map blocks received/);

  const devLine = fogDebugLine("dev", true, cells, 8);
  assert.match(devLine ?? "", new RegExp(`${chartColumns * chartRows} discovered cells`));
});

test("live sight hides paper inside the circle and leaves the outside blank", () => {
  const centre = { x: 10 * chartCellKm, y: 10 * chartCellKm };
  const inside = 10 * chartColumns + 10;
  const far = 80 * chartColumns + 80;

  assert.equal(cellIsOutsideSight(inside, [centre]), false);
  assert.equal(cellIsOutsideSight(far, [centre]), true);
  assert.equal(cellNeedsPaper(inside, false, new Set()), true);
  assert.equal(cellNeedsPaper(far, false, new Set()), true);
});

test("discovered ground never becomes blank paper again", () => {
  const far = 80 * chartColumns + 80;
  const discovered = new Set([far]);
  assert.equal(cellNeedsPaper(far, false, discovered), false);
  assert.equal(cellNeedsPaper(far, true, new Set()), false);
  assert.equal(discoveredCellCount(true, new Set()), chartColumns * chartRows);
  assert.equal(discoveredCellCount(false, discovered), 1);
  assert.ok(chartRows > 0);
});
