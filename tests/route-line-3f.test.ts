// 3F Part A: full route dots, active-ship-only lines, route setting and the
// discovered-chart hole fix.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  chartCellKm,
  chartColumns,
  chartRows,
  createChart,
  isCellDiscovered,
  revealCircle,
} from "@naval/shared/fog";
import { addPlayer, applyOrder, createWorld, stepWorld, visibleStateFor } from "@naval/shared/world";
import { predictRoutePath } from "@naval/shared/prediction";

const TICK = 1 / settings.server.tickHz;
const DT = settings.time.sailingTimeScale * TICK;
const BASE = { x: 1_693.8, y: 442.4 };

function openWorld(name: string): ReturnType<typeof createWorld> {
  const world = createWorld(name);
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  world.charts.get("alpha")!.bits.fill(0xff);
  return world;
}

test("a full predicted route reaches a far goal without the old 60 minute cap", () => {
  const world = openWorld("3f-full-route");
  const ship = world.players.get("alpha")!;
  ship.x = BASE.x;
  ship.y = BASE.y;
  ship.headingRad = 180 * Math.PI / 180;
  ship.fleetId = null;
  const target = { x: BASE.x, y: BASE.y + 35 };
  assert.equal(applyOrder(world, "alpha", target.x, target.y), true);
  const predicted = predictRoutePath(ship, ship.route!, world.windFromDeg);
  assert.equal(predicted.reached, true);
  assert.ok(predicted.simulatedSeconds > 60 * 60, `only ${predicted.simulatedSeconds}s simulated`);
  assert.ok(predicted.points.length <= settings.route.predictionMaxPoints);
  const end = predicted.points[predicted.points.length - 1]!;
  assert.ok(Math.hypot(end.x - target.x, end.y - target.y) < 20, "line stops short of the goal");
});

test("the route line is drawn and sent only for the selected ship", () => {
  const world = openWorld("3f-active-route");
  const alpha = world.players.get("alpha")!;
  alpha.x = BASE.x;
  alpha.y = BASE.y;
  alpha.fleetId = null;
  assert.equal(applyOrder(world, "alpha", BASE.x + 8, BASE.y + 8), true);
  const beta = addPlayer(world, "beta", "frigate", 50_000, "French");
  beta.x = BASE.x + 4;
  beta.y = BASE.y - 2;
  beta.fleetId = null;
  assert.equal(applyOrder(world, "beta", BASE.x + 14, BASE.y + 1), true);
  for (let index = 0; index < 8; index += 1) stepWorld(world, DT);
  const alphaRow = visibleStateFor(world, "alpha").fleet.find((row) => row.id === alpha.id)!;
  const betaRow = visibleStateFor(world, "beta").fleet.find((row) => row.id === beta.id)!;
  assert.ok(alphaRow.predictedPath && alphaRow.predictedPath.length > 1);
  assert.ok(betaRow.predictedPath && betaRow.predictedPath.length > 1);
  assert.equal(world.routePredictions.has(beta.id), true);
  // An unselected second ship of the same player gets no line.
  const spare = { ...alpha, id: "alpha-spare", fleetId: null };
  spare.route = alpha.route ? { ...alpha.route } : null;
  world.fleets.get("alpha")!.push(spare);
  stepWorld(world, DT);
  assert.equal(world.routePredictions.has("alpha-spare"), false, "an unselected ship got a line");
});

test("turning Show route line off stops prediction and sending", () => {
  const world = openWorld("3f-route-off");
  const ship = world.players.get("alpha")!;
  ship.x = BASE.x;
  ship.y = BASE.y;
  ship.fleetId = null;
  assert.equal(applyOrder(world, "alpha", BASE.x + 8, BASE.y + 8), true);
  for (let index = 0; index < 4; index += 1) stepWorld(world, DT);
  assert.ok(world.routePredictions.size > 0);
  world.owners.get("alpha")!.routeLineEnabled = false;
  stepWorld(world, DT);
  assert.equal(world.routePredictions.size, 0);
  const row = visibleStateFor(world, "alpha").fleet.find((entry) => entry.id === ship.id)!;
  assert.equal(row.predictedPath, null);
});

test("a 10 degree wind shift invalidates the cached route line", () => {
  const world = openWorld("3f-wind-shift");
  const ship = world.players.get("alpha")!;
  ship.x = BASE.x;
  ship.y = BASE.y;
  ship.fleetId = null;
  assert.equal(applyOrder(world, "alpha", BASE.x + 20, BASE.y + 2), true);
  for (let index = 0; index < 20; index += 1) stepWorld(world, DT);
  const before = world.routePredictions.get(ship.id)!;
  const oldWind = before.windFromDeg;
  world.windFromDeg = (world.windFromDeg + 10) % 360;
  stepWorld(world, DT);
  const after = world.routePredictions.get(ship.id)!;
  assert.equal(after.job?.windFromDeg ?? after.windFromDeg, world.windFromDeg);
});

test("diagonal sight paths leave no undiscovered cells inside explored sea", () => {
  for (const speed of [1, 144]) {
    for (let heading = 0; heading < 360; heading += 5) {
      const chart = createChart("normal");
      const angle = heading * Math.PI / 180;
      const stepKm = 0.4 * speed;
      for (let distance = 0; distance <= 120; distance += stepKm) {
        const x = 500 + Math.sin(angle) * distance;
        const y = 700 - Math.cos(angle) * distance;
        revealCircle(chart, x, y);
      }
      const cellKm = chartCellKm;
      for (let row = 0; row < chartRows; row += 1) {
        for (let column = 0; column < chartColumns; column += 1) {
          if (isCellDiscovered(chart, (column + 0.5) * cellKm, (row + 0.5) * cellKm)) continue;
          const neighbours = [
            [column - 1, row], [column + 1, row],
            [column, row - 1], [column, row + 1],
          ];
          const all = neighbours.every(([c, r]) =>
            c! >= 0 && c! < chartColumns && r! >= 0 && r! < chartRows &&
            isCellDiscovered(chart, (c! + 0.5) * cellKm, (r! + 0.5) * cellKm));
          assert.equal(all, false, `heading ${heading}, speed x${speed}: hole at ${column},${row}`);
        }
      }
      // Every sampled path point is inside a discovered cell, not paper.
      const point = { x: 500 + Math.sin(angle) * 60, y: 700 - Math.cos(angle) * 60 };
      const column = Math.floor(point.x / cellKm);
      const row = Math.floor(point.y / cellKm);
      assert.equal(
        isCellDiscovered(chart, (column + 0.5) * chartCellKm, (row + 0.5) * chartCellKm),
        true,
        `heading ${heading}: path in paper`,
      );
    }
  }
});
