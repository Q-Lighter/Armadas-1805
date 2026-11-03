// Port data is checked against the same 1 km land lookup the server uses.
// These tests catch a port anchored on land, too far offshore, or in a lagoon
// that does not connect to the open ocean.

import assert from "node:assert/strict";
import { test } from "node:test";

import { isLandAt, landLookup } from "@naval/shared/land";
import { lonLatToMap } from "@naval/shared/map";
import {
  PORTS,
  PLACED_PORTS,
  RIVER_PORTS,
  findPortByName,
} from "@naval/shared/ports";

function countBy<T extends string>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Nearest land-cell centre, in kilometres. */
function nearestLandKm(x: number, y: number): number {
  const { width, height, cellKm } = landLookup;
  const reach = 8;
  let nearest = Number.POSITIVE_INFINITY;
  const minX = Math.max(0, Math.floor((x - reach) / cellKm));
  const maxX = Math.min(width - 1, Math.floor((x + reach) / cellKm));
  const minY = Math.max(0, Math.floor((y - reach) / cellKm));
  const maxY = Math.min(height - 1, Math.floor((y + reach) / cellKm));

  for (let row = minY; row <= maxY; row += 1) {
    for (let column = minX; column <= maxX; column += 1) {
      if (!isLandAt((column + 0.5) * cellKm, (row + 0.5) * cellKm)) continue;
      nearest = Math.min(
        nearest,
        Math.hypot((column + 0.5) * cellKm - x, (row + 0.5) * cellKm - y),
      );
    }
  }
  return nearest;
}

/** Sea cells reachable from an edge of the chart, the same coarse grid. */
function openOceanCells(): Uint8Array {
  const { width, height, cellKm } = landLookup;
  const total = width * height;
  const sea = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height &&
    !isLandAt((x + 0.5) * cellKm, (y + 0.5) * cellKm);

  const open = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const add = (x: number, y: number): void => {
    if (!sea(x, y)) return;
    const index = y * width + x;
    if (open[index]) return;
    open[index] = 1;
    queue[tail++] = index;
  };

  for (let column = 0; column < width; column += 1) {
    add(column, 0);
    add(column, height - 1);
  }
  for (let row = 0; row < height; row += 1) {
    add(0, row);
    add(width - 1, row);
  }

  while (head < tail) {
    const index = queue[head++]!;
    const column = index % width;
    const row = Math.floor(index / width);
    add(column - 1, row);
    add(column + 1, row);
    add(column, row - 1);
    add(column, row + 1);
  }
  return open;
}

test("the port table has 97 ports with the expected sizes, NPCs and rivers", () => {
  assert.equal(PORTS.length, 97);
  assert.deepEqual(countBy(PORTS.map((port) => port.size)), new Map([
    ["S", 61],
    ["M", 24],
    ["L", 12],
  ]));
  assert.equal(PORTS.filter((port) => port.npc).length, 10);
  assert.equal(RIVER_PORTS.length, 8);
  assert.equal(PLACED_PORTS.length, 89);
  assert.deepEqual(countBy(PLACED_PORTS.map((port) => port.size)), new Map([
    ["S", 55],
    ["M", 22],
    ["L", 12],
  ]));
  assert.equal(new Set(PORTS.map((port) => port.id)).size, 97);
  assert.equal(new Set(PORTS.map((port) => port.name)).size, 97);
  assert.equal(findPortByName("montego bay")?.id, "port-montego-bay");
  assert.equal(findPortByName("not a port"), null);
  for (const port of PORTS) {
    assert.deepEqual(port.listed, lonLatToMap(port.lonDeg, port.latDeg));
  }
});

test("only the 89 non-river ports have anchorages, and every one is open sea", () => {
  const open = openOceanCells();
  const { width, cellKm } = landLookup;

  for (const port of PORTS) {
    if (port.river) {
      assert.equal(port.riverPending, true, `${port.name} must wait for rivers`);
      assert.equal(port.anchorage, null, `${port.name} must not have an anchorage`);
      continue;
    }

    assert.equal(port.riverPending, false, `${port.name} must be placed`);
    assert.ok(port.anchorage, `${port.name} needs an anchorage`);
    const { x, y } = port.anchorage;
    assert.equal(isLandAt(x, y), false, `${port.name} is anchored on land`);

    const landDistance = nearestLandKm(x, y);
    assert.ok(landDistance >= 2.95, `${port.name} is only ${landDistance.toFixed(2)} km from land`);
    assert.ok(landDistance <= 6, `${port.name} is ${landDistance.toFixed(2)} km from land`);

    const column = Math.floor(x / cellKm);
    const row = Math.floor(y / cellKm);
    assert.equal(
      open[row * width + column],
      1,
      `${port.name} is not connected to the open ocean`,
    );
  }
});
