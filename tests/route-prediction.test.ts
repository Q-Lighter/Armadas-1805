// Real-steering prediction: the ghost line must match the live helm, and the
// displayed path must stay compact and private.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { addPlayer, applyOrder, createWorld, stepWorld, visibleStateFor } from "@naval/shared/world";
import { predictRoutePath } from "@naval/shared/prediction";
import { routeLookAheadPoint } from "@naval/shared/route";
import { shipSpecFor, type ShipRoute } from "@naval/shared/sailing";

const WIND = 315;
const BASE = { x: 1_693.8, y: 442.4 };
const TICK = 1 / settings.server.tickHz;
const DT = settings.time.sailingTimeScale * TICK;

function point(bearingDeg: number, km: number): { x: number; y: number } {
  const a = bearingDeg * Math.PI / 180;
  return { x: BASE.x + Math.sin(a) * km, y: BASE.y - Math.cos(a) * km };
}

function distanceToPath(point: { x: number; y: number }, path: Array<{ x: number; y: number }>): number {
  let best = Infinity;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index]!;
    const b = path[index + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length > 1e-12
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
      : 0;
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)));
  }
  return best;
}

function scenario(bearing: number): { world: ReturnType<typeof createWorld>; ship: ReturnType<typeof addPlayer>; route: ShipRoute } {
  const world = createWorld(`test-prediction-${bearing}`);
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  world.charts.get("alpha")!.bits.fill(0xff);
  ship.x = BASE.x;
  ship.y = BASE.y;
  ship.headingRad = 315 * Math.PI / 180;
  ship.speedKnots = 0;
  ship.order = null;
  ship.route = null;
  ship.fleetId = null;
  const target = point(bearing, 5);
  assert.equal(applyOrder(world, "alpha", target.x, target.y), true);
  assert.ok(ship.route);
  return { world, ship, route: ship.route as ShipRoute };
}

function compare(route: ShipRoute, ship: ReturnType<typeof addPlayer>, predict: ReturnType<typeof predictRoutePath>, world: ReturnType<typeof createWorld>): number {
  let worst = 0;
  let elapsed = 0;
  while (ship.route && elapsed < predict.simulatedSeconds) {
    stepWorld(world, DT, WIND);
    elapsed += DT;
    worst = Math.max(worst, distanceToPath({ x: ship.x, y: ship.y }, predict.points));
  }
  return worst;
}

test("predicted path follows a 5 km reaching leg within 50 m", () => {
  const { world, ship, route } = scenario(45);
  const predicted = predictRoutePath(ship, route, WIND);
  const worst = compare(route, ship, predicted, world);
  console.log(`PREDICTED VS ACTUAL reaching: ${(worst * 1000).toFixed(1)} m, ${predicted.points.length} points`);
  assert.ok(worst < 0.05, `worst prediction gap ${(worst * 1000).toFixed(1)} m`);
  assert.ok(predicted.points.length <= settings.route.predictionMaxPoints);
});

test("predicted path follows a tacking leg within 150 m", () => {
  const { world, ship, route } = scenario(315);
  const predicted = predictRoutePath(ship, route, WIND);
  const worst = compare(route, ship, predicted, world);
  console.log(`PREDICTED VS ACTUAL tacking: ${(worst * 1000).toFixed(1)} m, ${predicted.points.length} points`);
  assert.ok(worst < 0.15, `worst tacking prediction gap ${(worst * 1000).toFixed(1)} m`);
  assert.ok(predicted.points.length <= settings.route.predictionMaxPoints);
});

test("the predicted path is private to the owner and reaches the state", () => {
  const { world, ship } = scenario(45);
  addPlayer(world, "beta", "frigate", 50_000, "French");
  stepWorld(world, DT, WIND);
  const own = visibleStateFor(world, "alpha").fleet.find((row) => row.id === ship.id)!;
  assert.ok(own.predictedPath && own.predictedPath.length > 1);
  assert.ok(own.predictedPath.length <= settings.route.predictionMaxPoints);
  const other = visibleStateFor(world, "beta").fleet.find((row) => row.id === ship.id);
  assert.equal(other, undefined);
  assert.equal(world.routePredictions.has(ship.id), true);
});

test("a predicted path's corners are no sharper than the ship's turn radius", () => {
  const { ship, route } = scenario(315);
  const predicted = predictRoutePath(ship, route, WIND);
  const spec = shipSpecFor(ship);
  const cruiseKmPerSecond = spec.cruiseKnots * 1.852 / 3600;
  const normalTurnRad = (90 / (spec.turn90GameMinutes * 60)) * Math.PI / 180;
  const tackTurnRad = settings.sailing.tackTurnDegPerGameSecond * Math.PI / 180;
  const minimumRadius = Math.min(cruiseKmPerSecond / normalTurnRad, cruiseKmPerSecond / tackTurnRad) * 0.5;
  let sharpest = Infinity;
  for (let index = 1; index + 1 < predicted.points.length; index += 1) {
    const a = predicted.points[index - 1]!;
    const b = predicted.points[index]!;
    const c = predicted.points[index + 1]!;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area2 < 1e-9) continue;
    const radius = (ab * bc * ca) / (2 * area2);
    sharpest = Math.min(sharpest, radius);
  }
  assert.ok(sharpest >= minimumRadius * 0.5, `sharpest corner ${(sharpest * 1000).toFixed(0)} m`);
});

test("one ghost prediction fits the per-tick budget", () => {
  const { ship, route } = scenario(315);
  predictRoutePath(ship, route, WIND);
  const start = performance.now();
  const result = predictRoutePath(ship, route, WIND);
  const elapsed = performance.now() - start;
  console.log(`PREDICTION BUDGET ${elapsed.toFixed(2)} ms, ${result.points.length} points, ${result.simulatedSeconds.toFixed(0)} game s, ${result.steps} steps`);
  assert.ok(elapsed < 2, `prediction took ${elapsed.toFixed(2)} ms`);
});

test("look-ahead rounds a corner instead of aiming at its vertex", () => {
  const path = [
    { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 },
  ];
  const aim = routeLookAheadPoint(path, { x: 0, y: 9 }, 6)!;
  assert.ok(aim.y < 10.01);
  assert.ok(aim.x > 0.5, "the aim point is already along the next leg");
});
