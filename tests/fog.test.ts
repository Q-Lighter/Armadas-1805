// Tests for per-player discovery, last-seen markers and private chart blocks.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { lonLatToMap } from "@naval/shared/map";
import {
  blockIdAt,
  createChart,
  isCellDiscovered,
  revealCircle,
} from "@naval/shared/fog";
import {
  addPlayer,
  createWorld,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";
import type { ChartBlock } from "@naval/shared/fog";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;

function fakeBlock(id: string): ChartBlock {
  return {
    id,
    x: 0,
    y: 0,
    km: settings.fog.chartBlockKm,
    fill: [[0, 0, 10, 0, 10, 10]],
    coast: [[0, 0, 10, 10]],
  };
}

test("a foreign ship is live in a circle, then becomes a last-seen marker", () => {
  const world = createWorld();
  const alpha = addPlayer(world, "alpha");
  const beta = addPlayer(world, "beta");
  beta.x = alpha.x + 10;
  beta.y = alpha.y;

  let state = visibleStateFor(world, "alpha");
  assert.ok(state.ships.some(([id]) => id === "beta"), "beta is inside sight");
  assert.equal(state.l.length, 0);

  beta.x = alpha.x + 100;
  beta.y = alpha.y;
  state = visibleStateFor(world, "alpha");
  assert.ok(!state.ships.some(([id]) => id === "beta"), "beta is not leaked");
  assert.equal(state.l.length, 1);
  assert.equal(state.l[0]?.[0], "flagship");
  assert.equal(state.l[0]?.[1], "British");
  assert.equal(state.l[0]?.[4], 0);

  // Game time advances while the ship is out of sight.
  stepWorld(world, 60);
  state = visibleStateFor(world, "alpha");
  assert.ok((state.l[0]?.[4] ?? 0) >= 60);

  beta.x = alpha.x + 10;
  state = visibleStateFor(world, "alpha");
  assert.ok(state.ships.some(([id]) => id === "beta"));
  assert.equal(state.l.length, 0);
});

test("dev rooms get all ground and all blocks; normal rooms only discover", () => {
  const dev = createWorld("dev-fog");
  addPlayer(dev, "alpha");
  const devState = visibleStateFor(dev, "alpha", new Map([["0_0", fakeBlock("0_0")]]));
  assert.equal(devState.k, "dev");
  assert.equal(devState.chart.all, true);
  assert.equal(devState.chart.blocks.length, 1);

  const normal = createWorld("normal");
  addPlayer(normal, "alpha");
  const normalState = visibleStateFor(normal, "alpha");
  assert.equal(normalState.k, "normal");
  assert.equal(normalState.chart.all, false);
  assert.ok(normalState.chart.cells.length > 0, "the start circle is discovered");
});

test("two players keep independent charts", () => {
  const world = createWorld();
  const alpha = addPlayer(world, "alpha");
  const beta = addPlayer(world, "beta");
  const alphaChart = world.charts.get("alpha")!;
  const betaChart = world.charts.get("beta")!;

  const far = lonLatToMap(-40, 20);
  revealCircle(alphaChart, far.x, far.y);

  assert.equal(isCellDiscovered(alphaChart, far.x, far.y), true);
  assert.equal(isCellDiscovered(betaChart, far.x, far.y), false);
  assert.ok(world.charts.get("alpha") !== world.charts.get("beta"));

  const betaState = visibleStateFor(world, "beta");
  assert.ok(!betaState.chart.cells.some((index) => {
    const column = index % Math.ceil(3810.96 / settings.fog.discoveryCellKm);
    const row = Math.floor(index / Math.ceil(3810.96 / settings.fog.discoveryCellKm));
    return column === Math.floor(far.x / settings.fog.discoveryCellKm) &&
      row === Math.floor(far.y / settings.fog.discoveryCellKm);
  }));
  assert.ok(alpha.x !== beta.x || alpha.y !== beta.y);
});

test("a chart block is released only for discovered ground", () => {
  const world = createWorld();
  const alpha = addPlayer(world, "alpha");
  const ownBlock = blockIdAt(alpha.x, alpha.y);
  const farBlock = blockIdAt(100, 100);
  const blocks = new Map([
    [ownBlock, fakeBlock(ownBlock)],
    [farBlock, fakeBlock(farBlock)],
  ]);

  const state = visibleStateFor(world, "alpha", blocks);
  assert.ok(state.chart.blocks.some((block) => block.id === ownBlock));
  assert.ok(!state.chart.blocks.some((block) => block.id === farBlock));

  // Blocks are not sent twice to the same player.
  const again = visibleStateFor(world, "alpha", blocks);
  assert.ok(!again.chart.blocks.some((block) => block.id === ownBlock));
});

test("test rooms start a frigate offshore and still reveal the local sea", () => {
  const world = createWorld("test-chart");
  const ship = addPlayer(world, "alpha");
  assert.equal(world.kind, "test");
  assert.equal(ship.classId, "frigate");

  const state = visibleStateFor(world, "alpha");
  assert.ok(state.chart.cells.length > 0);
  assert.ok(state.ships.some(([id]) => id === "alpha"));
  assert.equal(createChart("test").all, false);
});
