// Geometry checks against the real committed private chart blocks and the
// real server land lookup. No browser is needed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CHART_BLOCKS } from "@naval/shared/chart-blocks";
import { orderedChartBlocks } from "@naval/shared/chart-draw";
import { isLandAt } from "@naval/shared/land";
import { settings } from "@naval/shared/settings";
import { chartBlockKm, chartColumns } from "@naval/shared/fog";
import {
  fogPaintPlan,
  type CellRange,
  type FogRect,
} from "@naval/shared/fog-paint";

function ringArea(ring: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    sum += ring[i]! * ring[j + 1]! - ring[j]! * ring[i + 1]!;
  }
  return Math.abs(sum / 2);
}

function pointInRing(x: number, y: number, ring: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!;
    const yi = ring[i + 1]!;
    const xj = ring[j]!;
    const yj = ring[j + 1]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function landFromBlocks(x: number, y: number): boolean {
  const id = `${Math.floor(x / chartBlockKm)}_${Math.floor(y / chartBlockKm)}`;
  const block = CHART_BLOCKS.get(id);
  return block ? block.fill.some((ring) => pointInRing(x, y, ring)) : false;
}

function onCoreEdge(
  block: { x: number; y: number; km: number },
  a: readonly [number, number],
  b: readonly [number, number],
): boolean {
  const x0 = block.x;
  const x1 = block.x + block.km;
  const y0 = block.y;
  const y1 = block.y + block.km;
  const eps = 0.01;
  const bothX = Math.abs(a[0] - b[0]) < eps;
  const bothY = Math.abs(a[1] - b[1]) < eps;
  return (
    (bothX && ((Math.abs(a[0] - x0) < eps && Math.abs(b[0] - x0) < eps) ||
      (Math.abs(a[0] - x1) < eps && Math.abs(b[0] - x1) < eps))) ||
    (bothY && ((Math.abs(a[1] - y0) < eps && Math.abs(b[1] - y0) < eps) ||
      (Math.abs(a[1] - y1) < eps && Math.abs(b[1] - y1) < eps)))
  );
}

function nearBoundary(x: number, y: number, radiusKm = 1.25): boolean {
  for (let direction = 0; direction < 16; direction += 1) {
    const angle = (direction / 16) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let previous = isLandAt(x, y);
    for (let distance = 0.1; distance <= radiusKm + 1e-9; distance += 0.1) {
      const current = isLandAt(x + dx * distance, y + dy * distance);
      if (current !== previous) return true;
      previous = current;
    }
  }
  return false;
}

test("rebuilt land matches the server lookup across real chart blocks", () => {
  let seed = 1805;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4_294_967_296;
  };

  const blocks = [...CHART_BLOCKS.values()];
  let mismatches = 0;
  const total = 12_000;
  const byBlock = new Map<string, number>();

  for (let sample = 0; sample < total; sample += 1) {
    const block = blocks[Math.floor(random() * blocks.length)]!;
    const x = block.x + 0.25 + random() * (block.km - 0.5);
    const y = block.y + 0.25 + random() * (block.km - 0.5);
    if (landFromBlocks(x, y) !== isLandAt(x, y)) {
      mismatches += 1;
      byBlock.set(block.id, (byBlock.get(block.id) ?? 0) + 1);
    }
  }

  const clusters = [...byBlock.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const rate = mismatches / total;
  console.log(`chart land reconstruction: ${mismatches}/${total} mismatches (${(rate * 100).toFixed(3)}%), clusters ${JSON.stringify(clusters)}`);
  assert.ok(rate < 0.005, `mismatch rate ${rate}; clusters ${JSON.stringify(clusters)}`);
});

test("no ink lies on a block or chart edge, and every coast edge is near a real boundary", () => {
  let segments = 0;
  let borderOffenders = 0;
  let boundaryOffenders = 0;
  const examples: string[] = [];

  for (const block of CHART_BLOCKS.values()) {
    for (const line of block.coast) {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const a: [number, number] = [line[i]!, line[i + 1]!];
        const b: [number, number] = [line[i + 2]!, line[i + 3]!];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.01) continue;
        segments += 1;
        if (onCoreEdge(block, a, b)) borderOffenders += 1;

        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        if (!nearBoundary(mx, my)) {
          boundaryOffenders += 1;
          if (examples.length < 10) examples.push(`${block.id} @ ${mx.toFixed(1)},${my.toFixed(1)}`);
        }
      }
    }
  }

  console.log(`chart ink: ${segments} segments, ${borderOffenders} on block edges, ${boundaryOffenders} away from lookup boundaries; ${JSON.stringify(examples)}`);
  assert.equal(borderOffenders, 0, `block-edge ink: ${JSON.stringify(examples)}`);
  assert.equal(boundaryOffenders, 0, `coast away from a boundary: ${JSON.stringify(examples)}`);
});

test("clipped land rings are closed, non-degenerate and match the lookup area", () => {
  let checked = 0;
  let badRings = 0;
  let badAreas = 0;
  const examples: string[] = [];

  for (const block of CHART_BLOCKS.values()) {
    for (const ring of block.fill) {
      checked += 1;
      const area = ringArea(ring);
      if (ring.length < 6 || area <= 0.05) badRings += 1;
      for (let i = 2; i < ring.length; i += 2) {
        if (
          Math.abs(ring[i]! - ring[i - 2]!) < 0.001 &&
          Math.abs(ring[i + 1]! - ring[i - 1]!) < 0.001
        ) {
          badRings += 1;
          break;
        }
      }
    }

    let polygonArea = 0;
    for (const ring of block.fill) polygonArea += ringArea(ring);
    let landSamples = 0;
    let totalSamples = 0;
    for (let y = block.y + 0.25; y < block.y + block.km; y += 0.5) {
      for (let x = block.x + 0.25; x < block.x + block.km; x += 0.5) {
        totalSamples += 1;
        if (isLandAt(x, y)) landSamples += 1;
      }
    }
    const lookupArea = (landSamples / totalSamples) * block.km * block.km;
    // The lookup is a 1 km raster and the drawing is high-resolution Natural
    // Earth geometry, so a small block-edge sliver can differ by a full cell.
    const tolerance = Math.max(30, lookupArea * 0.3);
    if (Math.abs(polygonArea - lookupArea) > tolerance) {
      badAreas += 1;
      if (examples.length < 8) {
        examples.push(`${block.id}: polygon ${polygonArea.toFixed(0)} km² vs lookup ${lookupArea.toFixed(0)} km²`);
      }
    }
  }

  console.log(`chart rings: ${checked} rings; ${badRings} degenerate; ${badAreas} block-area mismatches; ${JSON.stringify(examples)}`);
  assert.equal(badRings, 0);
  assert.equal(badAreas, 0, `area mismatches: ${JSON.stringify(examples)}`);
});

test("block order and replacement produce one deterministic drawing plan", () => {
  const entries = [...CHART_BLOCKS.entries()].slice(0, 80);
  const forward = new Map(entries);
  const reverse = new Map([...entries].reverse());
  assert.deepEqual(orderedChartBlocks(forward), orderedChartBlocks(reverse));

  const id = entries[0]![0];
  const original = entries[0]![1];
  const replacement = {
    ...original,
    fill: [[original.x, original.y, original.x + 5, original.y, original.x, original.y + 5]],
  };
  forward.set(id, original);
  forward.set(id, replacement);
  assert.equal(forward.size, entries.length);
  const replaced = orderedChartBlocks(forward).filter((block) => block.id === id);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0], replacement);
});

test("discovered sea is one alpha layer with a seam-free opaque mask", () => {
  const range: CellRange = { firstColumn: 2, lastColumn: 4, firstRow: 3, lastRow: 5 };
  const discovered = new Set<number>([
    3 * chartColumns + 2,
    3 * chartColumns + 3,
    4 * chartColumns + 4,
  ]);
  const cellRect = (column: number, row: number): FogRect => ({
    x: column * 5,
    y: row * 5,
    width: 5,
    height: 5,
  });
  const plan = fogPaintPlan(800, 600, false, false, discovered, range, cellRect);

  assert.ok(plan.paper);
  assert.equal(plan.paper.width, 800);
  assert.equal(plan.seaAlpha, settings.view.fogDimAlpha + 0.22);
  assert.equal(plan.mask.length, 3);

  for (let i = 0; i < plan.mask.length; i += 1) {
    for (let j = i + 1; j < plan.mask.length; j += 1) {
      const a = plan.mask[i]!;
      const b = plan.mask[j]!;
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      assert.equal(overlapX * overlapY, 0, "mask cells must not overlap");
    }
  }

  const empty = fogPaintPlan(800, 600, false, false, new Set(), range, cellRect);
  assert.equal(empty.paper?.width, 800);
  assert.equal(empty.mask.length, 0);
});
