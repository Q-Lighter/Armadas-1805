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

  const testLine = fogDebugLine("test", false, cells, 2, {
    playerId: "0123456789abcdef",
    buildCommit: "abc123def4567890",
  });
  assert.ok(testLine?.startsWith("TEMP-DEBUG"));
  assert.match(testLine ?? "", /room type test/);
  assert.match(testLine ?? "", /3 discovered cells/);
  assert.match(testLine ?? "", /2 map blocks received/);
  assert.match(testLine ?? "", /build abc123def456/);
  assert.match(testLine ?? "", /player 01234567/);

  const devLine = fogDebugLine("dev", true, cells, 8, {
    buildCommit: "abc123def4567890",
    ships: 100,
    worldHz: 9.9,
    gapAvgMs: 101,
    gapMaxMs: 140,
    bytesAvg: 12_345,
    bytesMax: 3_000,
    receivedHz: 5,
    receivedGapMaxMs: 250,
  });
  assert.match(devLine ?? "", new RegExp(`${chartColumns * chartRows} discovered cells`));
  assert.match(devLine ?? "", /100 ships/);
  assert.match(devLine ?? "", /9\.9 world\/s/);
  assert.match(devLine ?? "", /gap avg 101 ms/);
  assert.match(devLine ?? "", /worst 140 ms/);
  assert.match(devLine ?? "", /5\.0 updates\/s received/);
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
