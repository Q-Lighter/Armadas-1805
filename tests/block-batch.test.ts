// Dev rooms must not dump the whole private chart into one state message.

import assert from "node:assert/strict";
import { test } from "node:test";

import { BlockSendBudget } from "@naval/shared/block-batch";
import { takeChartUpdate, type ChartBlock } from "@naval/shared/fog";
import { settings } from "@naval/shared/settings";

function block(id: string, x: number, y: number): ChartBlock {
  return {
    id,
    x,
    y,
    km: settings.fog.chartBlockKm,
    fill: [[x, y, x + 10, y, x + 10, y + 10]],
    coast: [[x, y, x + 10, y + 10]],
  };
}

test("block batches send the nearest blocks first", () => {
  const chart = {
    bits: new Uint8Array(0),
    pendingCells: [],
    pendingBlocks: new Set(["far", "middle", "near", "farther"]),
    sentBlocks: new Set<string>(),
    all: true,
    seen: new Map(),
    foundPorts: new Set<string>(),
    discoveredCount: 0,
  };
  const blocks = new Map([
    ["far", block("far", 200, 200)],
    ["middle", block("middle", 50, 0)],
    ["near", block("near", 0, 0)],
    ["farther", block("farther", 400, 0)],
  ]);

  const update = takeChartUpdate(chart, blocks, 2, { x: 0, y: 0 });
  assert.deepEqual(update.blocks.map((entry) => entry.id), ["near", "middle"]);
  assert.equal(chart.pendingBlocks.has("near"), false);
  assert.equal(chart.pendingBlocks.has("middle"), false);
  assert.equal(chart.pendingBlocks.has("far"), true);
});

test("the block budget never exceeds its per-second or per-message limits", () => {
  const budget = new BlockSendBudget(settings.fog.blockBatchPerSecond, 8);
  let total = 0;

  for (let message = 0; message < 6; message += 1) {
    const allowed = budget.take(0);
    assert.ok(allowed <= 8);
    total += allowed;
    budget.note(allowed, 0);
  }

  assert.equal(total, settings.fog.blockBatchPerSecond);
  assert.equal(budget.take(0), 0);

  // A later second starts with a fresh budget.
  assert.equal(budget.take(1_001), 8);
});
