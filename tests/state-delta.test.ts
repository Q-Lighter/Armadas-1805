import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyStateDelta,
  buildStateDelta,
  decodeStateDelta,
  encodeStateDelta,
  mergeChartUpdates,
  newestStateWithEvents,
} from "@naval/shared/state-delta";
import { addPlayer, createWorld, giveSpareShips, stepWorld, visibleStateFor } from "@naval/shared/world";
import type { StateMessage } from "@naval/shared/world";
import { settings } from "@naval/shared/settings";

function statePair(): { before: StateMessage; after: StateMessage } {
  const world = createWorld("test-delta");
  addPlayer(world, "own", "frigate", 50_000, "British");
  giveSpareShips(world, "own", 2);
  addPlayer(world, "enemy", "frigate", 50_000, "French");
  const before = visibleStateFor(world, "own");
  for (let index = 0; index < 4; index += 1) stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
  const after = visibleStateFor(world, "own");
  return { before, after };
}

test("a binary delta reconstructs the same state as a full update", () => {
  const { before, after } = statePair();
  const delta = buildStateDelta({ ...before, seq: 1 }, after, 2, true);
  const decoded = decodeStateDelta(encodeStateDelta(delta));
  const applied = applyStateDelta({ ...before, seq: 1 }, decoded);
  const key = (state: StateMessage): string => JSON.stringify({
    ...state,
    seq: undefined,
    ships: [...state.ships].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
  assert.equal(key(applied), key({ ...after, seq: undefined }));
});

test("position and heading quantisation stay under one metre and 0.1 degree", () => {
  const { before, after } = statePair();
  const delta = buildStateDelta({ ...before, seq: 1 }, after, 2, true);
  const decoded = decodeStateDelta(encodeStateDelta(delta));
  const base = new Map(before.ships.map((ship) => [ship[0], ship]));
  for (const ship of decoded.ships) {
    const original = after.ships.find((candidate) => candidate[0] === ship[0]);
    assert.ok(original);
    const old = base.get(ship[0]) ?? original;
    assert.ok(Math.abs(ship[2] - original[2]) <= 0.001, `${ship[0]} x error`);
    assert.ok(Math.abs(ship[3] - original[3]) <= 0.001, `${ship[0]} y error`);
    assert.ok(Math.abs(ship[4] - original[4]) <= 0.1, `${ship[0]} heading error`);
    assert.ok(Math.abs(ship[5] - original[5]) <= 0.1, `${ship[0]} speed error`);
    assert.ok(old);
  }
});

test("a slow client keeps only the newest snapshot and every event", () => {
  const { before, after } = statePair();
  const first: StateMessage = {
    ...before,
    events: [{ id: 1, kind: "hit", x: 1, y: 2 }],
  };
  const second: StateMessage = {
    ...after,
    events: [{ id: 2, kind: "miss", x: 2, y: 3 }],
  };
  const merged = newestStateWithEvents([first, second]);
  assert.ok(merged);
  assert.equal(merged.tick, second.tick);
  assert.deepEqual(merged.events?.map((event) => event.id), [1, 2]);
});


test("coalescing states keeps every chart cell and private block", () => {
  const { before, after } = statePair();
  const first: StateMessage = {
    ...before,
    chart: {
      ...before.chart,
      cells: [1, 2, 3],
      blocks: [{ id: "1_1", x: 25, y: 25, km: 25, fill: [], coast: [] }],
      serverCells: 3,
      remaining: 1,
    },
  };
  const second: StateMessage = {
    ...after,
    chart: {
      ...after.chart,
      cells: [4, 5],
      blocks: [{ id: "2_1", x: 50, y: 25, km: 25, fill: [], coast: [] }],
      serverCells: 5,
      remaining: 0,
    },
  };
  const merged = newestStateWithEvents([first, second]);
  assert.ok(merged);
  assert.deepEqual(merged.chart.cells, [1, 2, 3, 4, 5]);
  assert.deepEqual(merged.chart.blocks.map((block) => block.id), ["1_1", "2_1"]);
  assert.equal(merged.chart.serverCells, 5);
  assert.equal(merged.chart.remaining, 0);
  assert.deepEqual(mergeChartUpdates([first, second])?.cells, [1, 2, 3, 4, 5]);
});
