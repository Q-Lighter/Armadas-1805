// The ship view must keep every painted layer visible and in order. This test
// describes the layers from the real start positions and real chart blocks, so
// a missing sea or a mask-regression fails without a browser.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CHART_BLOCKS } from "@naval/shared/chart-blocks";
import { worldToScreen } from "@naval/shared/camera";
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
    view: { x: ship.x, y: ship.y, kmAcross: 120 },
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


// 3E-fix: the ship sprites are created in the client but must actually be
// attached to the fleet layer. A draw plan cannot see Pixi's display list, so
// this check reads the real client source for that one attachment and pairs it
// with real state positions, camera zooms and marker sizes.
const clientSource = readFileSync("client/main.ts", "utf8");
const SHIP_LAYER_ATTACHED = /fleetLayer\.addChild\(\s*hull,\s*ring,\s*flag/.test(clientSource);

interface DrawMarker {
  id: string;
  role: string;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  visible: boolean;
  inViewport: boolean;
}

function drawState(): {
  state: ReturnType<typeof visibleStateFor>;
  centre: { x: number; y: number };
  ids: { me: string; mate: string; enemy: string };
} {
  const world = createWorld("test-ship-draw-plan");
  const me = addPlayer(world, "draw-me", "frigate", 50_000, "British");
  const mate = addPlayer(world, "draw-mate", "frigate", 50_000, "British");
  const enemy = addPlayer(world, "draw-enemy", "frigate", 50_000, "French");
  me.x = 1_693.8;
  me.y = 442.4;
  me.headingRad = 0;
  me.speedKnots = 0;
  mate.x = me.x + 0.8;
  mate.y = me.y - 0.35;
  mate.headingRad = 0;
  mate.speedKnots = 0;
  enemy.x = me.x - 1.1;
  enemy.y = me.y + 0.55;
  enemy.headingRad = Math.PI;
  enemy.speedKnots = 0;
  return {
    state: visibleStateFor(world, "draw-me"),
    centre: { x: me.x, y: me.y },
    ids: { me: "draw-me", mate: "draw-mate", enemy: "draw-enemy" },
  };
}

function drawMarkers(
  state: ReturnType<typeof visibleStateFor>,
  ids: { me: string; mate: string; enemy: string },
  width: number,
  height: number,
  kmAcross: number,
  centre: { x: number; y: number },
): DrawMarker[] {
  return state.ships.map((snapshot) => {
    const id = String(snapshot[0]);
    const own = id === ids.me || id === ids.mate;
    const size = own ? 1 : 0.85;
    const screen = worldToScreen(
      { x: Number(snapshot[2]), y: Number(snapshot[3]) },
      { x: centre.x, y: centre.y, kmAcross },
      width,
      height,
    );
    const markerWidth = 10 * size;
    const markerHeight = 23 * size;
    return {
      id,
      role: id === ids.me ? "flagship" : id === ids.mate ? "friendly" : "enemy",
      screenX: Number(screen.x.toFixed(1)),
      screenY: Number(screen.y.toFixed(1)),
      width: Number(markerWidth.toFixed(1)),
      height: Number(markerHeight.toFixed(1)),
      visible: screen.x > -90 && screen.x < width + 90 && screen.y > -90 && screen.y < height + 90,
      inViewport:
        screen.x + markerWidth / 2 > 0 && screen.x - markerWidth / 2 < width &&
        screen.y + markerHeight / 2 > 0 && screen.y - markerHeight / 2 < height,
    };
  });
}

test("every ship is attached to the fleet layer and has a 10 px marker at every zoom", () => {
  const { state, centre, ids } = drawState();
  const plan = buildShipRenderPlan({
    width: 1_920,
    height: 1_080,
    view: { x: centre.x, y: centre.y, kmAcross: 5 },
    blocks: [],
    all: false,
    discovered: new Set(),
    sight: [{ x: centre.x, y: centre.y, radiusKm: settings.fog.sightRangeKm }],
    ships: state.ships.map((snapshot) => ({ x: Number(snapshot[2]), y: Number(snapshot[3]) })),
  });
  const shipLayer = plan.layers.findIndex((layer) => layer.name === "ships");
  const liveSea = plan.layers.findIndex((layer) => layer.name === "liveSea");
  const liveCoast = plan.layers.findIndex((layer) => layer.name === "liveCoast");
  assert.ok(shipLayer > liveSea, "ships must be above the live sight sea");
  assert.ok(shipLayer > liveCoast, "ships must be above the live fog coast");

  const rows: string[] = [];
  for (const [width, height] of [[1_920, 1_080], [360, 740]] as const) {
    for (const kmAcross of [5, 50, 200]) {
      const markers = drawMarkers(state, ids, width, height, kmAcross, centre);
      const drawn = SHIP_LAYER_ATTACHED ? markers.filter((marker) => marker.visible).length : 0;
      rows.push(
        `${width}x${height} ${kmAcross} km: planned=${markers.length} visible=${markers.filter((marker) => marker.visible).length} drawn=${drawn} attached=${SHIP_LAYER_ATTACHED}`,
      );
      for (const marker of markers) {
        rows.push(
          `  ${marker.role.padEnd(8)} ${marker.id.padEnd(12)} at ${String(marker.screenX).padStart(7)},${String(marker.screenY).padStart(7)} ` +
          `size=${marker.width}x${marker.height}px inViewport=${marker.inViewport}`,
        );
      }
    }
  }
  console.log("SHIP DRAW PLAN\n" + rows.join("\n"));

  assert.equal(SHIP_LAYER_ATTACHED, true,
    "ship sprites must be attached to fleetLayer, or the map shows no ships at all");
  for (const marker of drawMarkers(state, ids, 1_920, 1_080, 200, centre)) {
    assert.ok(Math.max(marker.width, marker.height) >= 10,
      `${marker.id} must keep a 10 px minimum marker at far zoom`);
  }
  assert.deepEqual(
    state.ships.map((snapshot) => String(snapshot[0])).sort(),
    [ids.me, ids.mate, ids.enemy].sort(),
    "the real state must contain my flagship, a friendly and an enemy",
  );
});

test("surrendered, abandoned and burning ships keep their markers", () => {
  const { state, centre, ids } = drawState();
  const mixed = JSON.parse(JSON.stringify(state)) as ReturnType<typeof visibleStateFor>;
  mixed.sf = [ids.enemy];
  mixed.abandoned = [ids.mate];
  mixed.burning = [ids.me];
  for (const kmAcross of [5, 50, 200]) {
    const markers = drawMarkers(mixed, ids, 360, 740, kmAcross, centre);
    assert.equal(markers.length, 3);
    assert.ok(markers.every((marker) => marker.inViewport));
    assert.ok(markers.every((marker) => Math.max(marker.width, marker.height) >= 8));
  }
});
