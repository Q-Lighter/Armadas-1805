// The chart is a pure view of stored discovery data. These tests never create
// a Pixi object or a browser: they replay server chart messages, cull live
// graphics, reset the display cache and prove the remembered chart is intact.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CHART_BLOCKS } from "@naval/shared/chart-blocks";
import {
  applyChartUpdate,
  buildChartRenderPlan,
  chartContent,
  createChartMemory,
  nextChartRepaint,
} from "@naval/shared/chart-memory";
import { orderedChartBlocks } from "@naval/shared/chart-draw";
import {
  blockIdForCell,
  chartColumns,
  chartRows,
  decodeChartRuns,
  encodeChartRuns,
} from "@naval/shared/fog";
import { buildShipRenderPlan } from "@naval/shared/render-plan";
import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyOrder,
  createWorld,
  requestChartResume,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

function testVoyage(steps = 80): {
  world: ReturnType<typeof createWorld>;
  memory: ReturnType<typeof createChartMemory>;
  ship: ReturnType<typeof addPlayer>;
} {
  const world = createWorld("test-chart-memory");
  const ship = addPlayer(world, "chart-player");
  const memory = createChartMemory();
  applyChartUpdate(memory, visibleStateFor(world, "chart-player", CHART_BLOCKS).chart);
  applyOrder(world, "chart-player", ship.x + 280, ship.y - 80, ship.id);

  for (let step = 0; step < steps; step += 1) {
    stepWorld(world, 120);
    applyChartUpdate(memory, visibleStateFor(world, "chart-player", CHART_BLOCKS).chart);
  }
  return { world, memory, ship };
}

test("a long voyage only grows the remembered chart", () => {
  const world = createWorld("test-chart-growth");
  const ship = addPlayer(world, "chart-player");
  const memory = createChartMemory();
  const start = visibleStateFor(world, "chart-player", CHART_BLOCKS);
  applyChartUpdate(memory, start.chart);
  const startCells = memory.discovered.size;
  applyOrder(world, "chart-player", ship.x + 280, ship.y - 80, ship.id);

  let previousCells = startCells;
  let previousBlocks = memory.blocks.size;
  for (let step = 0; step < 100; step += 1) {
    stepWorld(world, 120);
    const state = visibleStateFor(world, "chart-player", CHART_BLOCKS);
    applyChartUpdate(memory, state.chart);
    assert.ok(memory.discovered.size >= previousCells, "discovered ground shrank");
    assert.ok(memory.blocks.size >= previousBlocks, "chart blocks shrank");
    previousCells = memory.discovered.size;
    previousBlocks = memory.blocks.size;
  }

  const content = chartContent(memory);
  assert.ok(content.cells.length > startCells, "the voyage discovered no new cells");
  assert.ok(content.blocks.length > 0, "the nearest coast geometry never arrived");
  assert.ok(previousCells > startCells);
});

test("culling live ship-view graphics and the graphics cap cannot change the chart", () => {
  const { world, memory, ship } = testVoyage();
  const before = chartContent(memory);

  const manyBlocks = Array.from(
    { length: settings.view.maxLiveBlockGraphics + 70 },
    (_, index) => ({
      id: `fake-${String(index).padStart(3, "0")}`,
      x: index * 2,
      y: 0,
      km: 1,
      fill: [[index * 2, 0, index * 2 + 1, 0, index * 2, 1]],
      coast: [[index * 2, 0, index * 2 + 1, 1]],
    }),
  );
  const plan = buildShipRenderPlan({
    width: 4_000,
    height: 1_000,
    view: { x: 350, y: 0, kmAcross: 1_000 },
    blocks: manyBlocks,
    all: false,
    discovered: memory.discovered,
    sight: [{ x: ship.x, y: ship.y, radiusKm: settings.fog.sightRangeKm }],
    ships: [{ x: ship.x, y: ship.y }],
  });
  assert.equal(plan.activeBlocks, settings.view.maxLiveBlockGraphics);
  assert.deepEqual(chartContent(memory), before);

  // Destroying the live display is represented by throwing the old plan away.
  const resetPlan = buildShipRenderPlan({
    width: 4_000,
    height: 1_000,
    view: { x: 350, y: 0, kmAcross: 1_000 },
    blocks: [],
    all: false,
    discovered: memory.discovered,
    sight: [],
    ships: [],
  });
  assert.equal(resetPlan.activeBlocks, 0);
  assert.deepEqual(chartContent(memory), before);
  assert.ok(world.charts.get("chart-player")!.bits.length > 0);
});

test("a reconnect resends the whole discovered record and rebuilds an identical chart", () => {
  const { world, memory } = testVoyage();
  const original = chartContent(memory);
  const chart = world.charts.get("chart-player")!;
  const runs = encodeChartRuns(chart);
  assert.deepEqual(
    [...decodeChartRuns(runs, chartColumns * chartRows)].sort((a, b) => a - b),
    [...memory.discovered].sort((a, b) => a - b),
  );

  requestChartResume(world, "chart-player");
  const rebuilt = createChartMemory();
  let first = true;
  let guard = 0;
  for (;;) {
    guard += 1;
    assert.ok(guard < 1_000, "resume did not finish");
    const state = visibleStateFor(world, "chart-player", CHART_BLOCKS, 3);
    if (first) {
      assert.ok(state.chart.snapshotRuns && state.chart.snapshotRuns.length > 0);
      assert.equal(state.chart.cells.length, 0);
      first = false;
    }
    applyChartUpdate(rebuilt, state.chart);
    if (state.chart.remaining === 0) break;
  }

  assert.deepEqual(chartContent(rebuilt), original);
  assert.deepEqual(buildChartRenderPlan(rebuilt), buildChartRenderPlan(memory));

  // A second interruption is sent again from the server, and still converges.
  requestChartResume(world, "chart-player");
  const interrupted = createChartMemory();
  applyChartUpdate(interrupted, visibleStateFor(world, "chart-player", CHART_BLOCKS, 2).chart);
  requestChartResume(world, "chart-player");
  for (let index = 0; index < 2_000; index += 1) {
    const state = visibleStateFor(world, "chart-player", CHART_BLOCKS, 3);
    applyChartUpdate(interrupted, state.chart);
    if (state.chart.remaining === 0) break;
  }
  assert.deepEqual(chartContent(interrupted), original);
});

test("chart contents are a pure function of cells and blocks in any arrival order", () => {
  const { memory } = testVoyage(20);
  const content = chartContent(memory);
  const cells = content.cells.slice(0, 12);
  const blocks = orderedChartBlocks(memory.blocks).slice(0, 3);
  assert.ok(cells.length > 0);
  assert.ok(blocks.length > 0);

  const forward = createChartMemory();
  const backward = createChartMemory();
  const first = {
    cells: cells.slice(0, 5),
    blocks: blocks.slice(0, 1),
    all: false,
    remaining: 1,
  };
  const second = {
    cells: cells.slice(5),
    blocks: blocks.slice(1),
    all: false,
    remaining: 0,
  };

  applyChartUpdate(forward, first);
  applyChartUpdate(forward, second);
  applyChartUpdate(forward, first);

  applyChartUpdate(backward, second);
  applyChartUpdate(backward, first);
  applyChartUpdate(backward, second);
  assert.deepEqual(chartContent(forward), chartContent(backward));
});

test("chart render plan paints discovered sea, land and coast", () => {
  const { memory } = testVoyage(20);
  const plan = buildChartRenderPlan(memory);
  assert.equal(plan.charting, false);
  assert.equal(buildChartRenderPlan(memory, 1).charting, true);
  const sea = plan.layers.find((layer) => layer.name === "sea");
  const land = plan.layers.find((layer) => layer.name === "land");
  const water = plan.layers.find((layer) => layer.name === "water");
  const coast = plan.layers.find((layer) => layer.name === "coast");

  assert.ok(plan.seaCells > 0, "discovered cells must produce a sea wash");
  assert.ok(sea?.visible);
  assert.ok((sea?.items ?? 0) > 0);
  assert.ok(land?.visible);
  assert.ok((land?.items ?? 0) > 0);
  assert.ok(water?.visible);
  assert.ok(coast?.visible);
  assert.ok(plan.landBlocks.length > 0);
  assert.ok(plan.coastBlocks.length > 0);

  const all = createChartMemory();
  all.all = true;
  const allPlan = buildChartRenderPlan(all);
  assert.equal(allPlan.seaCells, chartColumns * chartRows);
  assert.equal(allPlan.layers.find((layer) => layer.name === "sea")?.visible, true);
});

test("a throttled chart repaint is kept for a later frame", () => {
  const dirty = ["b", "a"];
  assert.deepEqual(nextChartRepaint({
    initialized: false,
    dirtyBlockIds: dirty,
    now: 0,
    lastPaintAt: 0,
    throttleMs: 1_000,
  }), { paint: true, base: true, blockIds: ["a", "b"] });

  assert.deepEqual(nextChartRepaint({
    initialized: true,
    dirtyBlockIds: dirty,
    now: 250,
    lastPaintAt: 0,
    throttleMs: 1_000,
  }), { paint: false, base: false, blockIds: [] });

  assert.deepEqual(nextChartRepaint({
    initialized: true,
    dirtyBlockIds: dirty,
    now: 1_000,
    lastPaintAt: 0,
    throttleMs: 1_000,
  }), { paint: true, base: false, blockIds: ["a", "b"] });
});

test("every discovered cell maps to a real chart block", () => {
  const { memory } = testVoyage(20);
  for (const cell of memory.discovered) {
    const id = blockIdForCell(cell);
    assert.ok(Number.isInteger(cell));
    assert.ok(id.includes("_"));
  }
  for (const block of memory.blocks.values()) {
    assert.ok(Array.isArray(block.fill));
    assert.ok(Array.isArray(block.coast));
  }
});
