// The chart detail plan is pure: same stored blocks and cells, two paint modes.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chartDetailBlend,
  chartDetailLevel,
  chartTextureSize,
  planChartDetail,
} from "@naval/shared/chart-detail";
import {
  chartCellKm,
  chartColumns,
  type ChartBlock,
} from "@naval/shared/fog";
import { settings } from "@naval/shared/settings";

function block(id: string, x: number, y: number): ChartBlock {
  return { id, x, y, km: 25, fill: [], coast: [] };
}

function cellAt(column: number, row: number): number {
  return row * chartColumns + column;
}

test("the view texture is screen-sized, capped and never upscaled", () => {
  assert.deepEqual(chartTextureSize(1280, 800, 1, 2_048), {
    width: 1_280,
    height: 800,
  });
  const retina = chartTextureSize(1280, 800, 2, 2_048);
  assert.ok(retina.width <= 2_048 && retina.height <= 2_048);
  assert.ok(retina.width <= 1280 * 2 && retina.height <= 800 * 2);
  assert.deepEqual(retina, { width: 2_048, height: 1_280 });

  const phone = chartTextureSize(360, 740, 3, 2_048);
  assert.ok(phone.width <= 360 * 3 && phone.height <= 740 * 3);
  assert.ok(phone.width <= 2_048 && phone.height <= 2_048);
});

test("the detail level switches below the configured view width", () => {
  const threshold = 300;
  assert.equal(chartDetailLevel(299, threshold), "vector");
  assert.equal(chartDetailLevel(300, threshold), "texture");
  assert.equal(chartDetailBlend(300, threshold, 40), 0);
  assert.equal(chartDetailBlend(280, threshold, 40), 0.5);
  assert.equal(chartDetailBlend(240, threshold, 40), 1);
});

test("the vector chart only includes blocks and cells in the view", () => {
  const blocks = new Map<string, ChartBlock>([
    ["a", block("a", 0, 0)],
    ["b", block("b", 25, 0)],
    ["outside", block("outside", 500, 500)],
  ]);
  const discovered = new Set([cellAt(1, 1), cellAt(20, 20)]);
  const plan = planChartDetail({
    blocks,
    discovered,
    viewport: { left: 0, top: 0, right: 60, bottom: 60 },
    kmAcross: 100,
    thresholdKm: 300,
    chartAll: false,
    maxBlocks: 300,
  });

  assert.equal(plan.level, "vector");
  assert.deepEqual(plan.blocks.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(plan.cells, [cellAt(1, 1)]);
  assert.equal(plan.graphicsCount, 3);
});

test("switching detail level keeps the same chart contents", () => {
  const blocks = new Map<string, ChartBlock>([
    ["a", block("a", 0, 0)],
    ["b", block("b", 25, 0)],
  ]);
  const discovered = new Set([cellAt(1, 1), cellAt(2, 1)]);
  const base = {
    blocks,
    discovered,
    viewport: { left: 0, top: 0, right: 80, bottom: 80 },
    thresholdKm: 300,
    chartAll: false,
    maxBlocks: 300,
  };
  const vector = planChartDetail({ ...base, kmAcross: 120 });
  const texture = planChartDetail({ ...base, kmAcross: 800 });

  assert.equal(vector.level, "vector");
  assert.equal(texture.level, "texture");
  assert.deepEqual(
    vector.blocks.map((item) => item.id),
    texture.blocks.map((item) => item.id),
  );
  assert.deepEqual(vector.cells, texture.cells);
});

test("vector graphics stay within the block cap", () => {
  const blocks = new Map<string, ChartBlock>();
  for (let index = 0; index < 12; index += 1) {
    blocks.set(`b${index}`, block(`b${index}`, index * 2, 0));
  }
  const plan = planChartDetail({
    blocks,
    discovered: new Set<number>(),
    viewport: { left: 0, top: 0, right: 100, bottom: 100 },
    kmAcross: 80,
    thresholdKm: 300,
    chartAll: true,
    maxBlocks: 5,
  });

  assert.equal(plan.blocks.length, 5);
  assert.equal(plan.graphicsCount, 6);
  assert.equal(plan.capped, true);
  assert.deepEqual(
    plan.blocks.map((item) => item.id),
    ["b10", "b11", "b7", "b8", "b9"],
  );
  assert.ok(
    plan.graphicsCount <= settings.view.maxLiveBlockGraphics + 1,
    "vector graphics exceeded the shared block cap",
  );
});
