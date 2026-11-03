// The ship view must keep every painted layer visible and in order. This test
// describes the layers from the real start positions and real chart blocks, so
// a missing sea or a mask-regression fails without a browser.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CHART_BLOCKS } from "@naval/shared/chart-blocks";
import { addPlayer, createWorld, visibleStateFor } from "@naval/shared/world";
import { settings } from "@naval/shared/settings";
import {
  buildShipRenderPlan,
  type RenderLayerName,
} from "@naval/shared/render-plan";

const PLAYER = "render-plan-player";

function testRoomPlan(): ReturnType<typeof buildShipRenderPlan> {
  const world = createWorld("test-render");
  const ship = addPlayer(world, PLAYER);
  const blocks = [];
  let discovered = new Set<number>();
  let all = false;

  // Collect the normal small chart batches the server sends at the start.
  for (let batch = 0; batch < 12; batch += 1) {
    const state = visibleStateFor(world, PLAYER, CHART_BLOCKS);
    all = state.chart.all;
    for (const cell of state.chart.cells) discovered.add(cell);
    blocks.push(...state.chart.blocks);
    if (state.chart.blocks.length === 0) break;
  }

  return buildShipRenderPlan({
    width: 900,
    height: 1_200,
    view: { x: ship.x, y: ship.y, kmAcross: 60 },
    blocks,
    all,
    discovered,
    sight: [{ x: ship.x, y: ship.y, radiusKm: settings.fog.sightRangeKm }],
    ships: [{ x: ship.x, y: ship.y }],
  });
}

function devRoomPlan(): ReturnType<typeof buildShipRenderPlan> {
  const world = createWorld("dev-render");
  const ship = addPlayer(world, PLAYER);
  const state = visibleStateFor(world, PLAYER, CHART_BLOCKS);

  return buildShipRenderPlan({
    width: 1_200,
    height: 800,
    view: { x: ship.x, y: ship.y, kmAcross: 65 },
    blocks: [...CHART_BLOCKS.values()],
    all: state.chart.all,
    discovered: new Set(state.chart.cells),
    sight: [{ x: ship.x, y: ship.y, radiusKm: settings.fog.sightRangeKm }],
    ships: [{ x: ship.x, y: ship.y }],
  });
}

function layerOrder(plan: ReturnType<typeof buildShipRenderPlan>, ...names: RenderLayerName[]): number[] {
  return names.map((name) => {
    const index = plan.layers.findIndex((layer) => layer.name === name);
    assert.notEqual(index, -1, `${name} must be in the plan`);
    return index;
  });
}

function checkPlan(
  label: string,
  plan: ReturnType<typeof buildShipRenderPlan>,
  requireLand: boolean,
): void {
  console.log(`${label} draw plan:\n${JSON.stringify(plan.layers, null, 2)}`);

  const names = ["paper", "dimSea", "dimLand", "dimWater", "dimCoast"]
    .concat(["liveSea", "liveLand", "liveWater", "liveCoast"])
    .concat(["ships", "weather"]);
  for (const name of names) {
    const layer = plan.layers.find((candidate) => candidate.name === name);
    assert.ok(layer, `${label}: ${name} layer is missing`);
    assert.equal(layer.alpha, 1, `${label}: ${name} must be opaque at layer level`);
  }

  // The dev start is open sea, so it has no land in view; the test-room start
  // is 30 km offshore and does show the nearby coast. A sea layer must be
  // non-empty in both.
  const required = ["dimSea", "liveSea", "ships", "weather"];
  if (requireLand) required.push("dimLand", "dimWater", "dimCoast");
  for (const name of required) {
    const layer = plan.layers.find((candidate) => candidate.name === name)!;
    assert.equal(layer.visible, true, `${label}: ${name} must be visible`);
    assert.ok(layer.bounds, `${label}: ${name} must have bounds`);
    assert.ok(
      layer.bounds.width > 0 && layer.bounds.height > 0,
      `${label}: ${name} must be non-empty`,
    );
  }

  const dimSea = plan.layers.find((layer) => layer.name === "dimSea")!;
  const liveSea = plan.layers.find((layer) => layer.name === "liveSea")!;
  assert.equal(dimSea.mask, null, `${label}: dim sea must not need a mask`);
  assert.ok(liveSea.mask, `${label}: live sea needs a sight mask`);
  assert.ok(
    liveSea.mask.width > 0 && liveSea.mask.height > 0,
    `${label}: live mask must have extent`,
  );

  const order = layerOrder(
    plan,
    "dimSea",
    "dimLand",
    "dimWater",
    "dimCoast",
    "liveSea",
    "liveLand",
    "liveWater",
    "liveCoast",
    "ships",
    "weather",
  );
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `${label}: layers out of order`);
}

test("the sea and ink layers are visible and in order in a test-room start", () => {
  checkPlan("test room", testRoomPlan(), true);
});

test("a dev room has a fully explored dim sea under the live layers", () => {
  const plan = devRoomPlan();
  checkPlan("dev room", plan, false);
  const dimSea = plan.layers.find((layer) => layer.name === "dimSea")!;
  assert.deepEqual(dimSea.bounds, { x: 0, y: 0, width: 1_200, height: 800 });
});

test("the live block graphics budget keeps only the nearest blocks", () => {
  const blocks = Array.from({ length: settings.view.maxLiveBlockGraphics + 50 }, (_, index) => ({
    id: `block-${String(index).padStart(3, "0")}`,
    x: index * 2,
    y: 0,
    km: 1,
    fill: [] as number[][],
    coast: [] as number[][],
  }));

  const plan = buildShipRenderPlan({
    width: 4_000,
    height: 1_000,
    view: { x: 350, y: 0, kmAcross: 1_000 },
    blocks,
    all: false,
    discovered: new Set(),
    sight: [],
    ships: [],
  });

  assert.equal(plan.activeBlocks, settings.view.maxLiveBlockGraphics);
});
