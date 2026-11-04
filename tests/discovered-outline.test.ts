// The discovered wash must be smooth, not a staircase of five-kilometre cells.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDiscoveredOutline } from "@naval/shared/discovered-outline";

function grid(columns: number, rows: number, cells: Array<[number, number]>): Set<number> {
  return new Set(cells.map(([column, row]) => row * columns + column));
}

function inside(point: { x: number; y: number }, flat: number[]): boolean {
  let hit = false;
  for (let index = 0, previous = flat.length - 2; index < flat.length; previous = index, index += 2) {
    const xi = flat[index]!;
    const yi = flat[index + 1]!;
    const xj = flat[previous]!;
    const yj = flat[previous + 1]!;
    if (
      (yi > point.y) !== (yj > point.y) &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    ) {
      hit = !hit;
    }
  }
  return hit;
}

test("a rectangular explored area becomes one rounded rectangle", () => {
  const outline = buildDiscoveredOutline(grid(10, 10, [[2, 2], [3, 2], [2, 3], [3, 3]]), 10, 10, 5);
  assert.equal(outline.rings.length, 1);
  assert.ok(outline.rings[0]!.points.length > 16);
  assert.ok(outline.rings[0]!.area > 0);
});

test("the smoothed outline contains every discovered cell centre", () => {
  const columns = 8;
  const rows = 8;
  const cells: Array<[number, number]> = [
    [1, 1], [2, 1], [3, 1], [2, 2], [2, 3], [3, 3], [4, 3],
  ];
  const discovered = grid(columns, rows, cells);
  const outline = buildDiscoveredOutline(discovered, columns, rows, 5);
  assert.ok(outline.rings.length > 0);
  for (const [column, row] of cells) {
    const point = { x: (column + 0.5) * 5, y: (row + 0.5) * 5 };
    assert.ok(
      outline.rings.some((ring) => inside(point, ring.points)),
      `cell ${column},${row} is outside the smoothed wash`,
    );
  }
});

test("a staircase edge has no square steps after smoothing", () => {
  const cells: Array<[number, number]> = [];
  for (let step = 0; step < 6; step += 1) {
    for (let row = 0; row <= step; row += 1) cells.push([step, row]);
  }
  const outline = buildDiscoveredOutline(grid(10, 10, cells), 10, 10, 5);
  const ring = outline.rings[0]!;
  for (let index = 0; index < ring.points.length; index += 2) {
    const next = (index + 2) % ring.points.length;
    const after = (index + 4) % ring.points.length;
    const ax = ring.points[next]! - ring.points[index]!;
    const ay = ring.points[next + 1]! - ring.points[index + 1]!;
    const bx = ring.points[after]! - ring.points[next]!;
    const by = ring.points[after + 1]! - ring.points[next + 1]!;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (denominator < 1e-9) continue;
    const cosine = Math.abs((ax * bx + ay * by) / denominator);
    assert.ok(cosine > 0.8, "the smoothed outline still has a square step");
  }
});
