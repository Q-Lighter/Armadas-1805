// Pure route-planning tests around the real Caribbean land lookup. No browser
// or server socket is needed: these call the same planner the server uses.

import assert from "node:assert/strict";
import { test } from "node:test";

import { isLandAt } from "@naval/shared/land";
import { isInsideMapFrame, lonLatToMap, type MapPoint } from "@naval/shared/map";
import {
  ROUTE_LAND,
  ROUTE_NO_KNOWN,
  planRoute,
} from "@naval/shared/route";
import { settings } from "@naval/shared/settings";
import { addPlayer, createWorld, visibleStateFor } from "@naval/shared/world";
import { isCellDiscovered } from "@naval/shared/fog";

const KINGSTON = { x: 1228.266, y: 336.491 };
const MONTEGO_BAY = { x: 1164.681, y: 304.31 };
const PORT_AU_PRINCE = { x: 1461.271, y: 298.366 };
const BELIZE = { x: 624.712, y: 362.493 };

function knownAll(x: number, y: number): boolean {
  return isLandAt(x, y);
}

function assertPointsAtSea(
  points: readonly MapPoint[],
  knownLand = isLandAt,
): void {
  for (const point of points) {
    assert.equal(knownLand(point.x, point.y), false, `waypoint on land: ${point.x},${point.y}`);
  }
}

function segmentIsClear(
  a: MapPoint,
  b: MapPoint,
  knownLand = isLandAt,
): boolean {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(distance / 1));
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    if (knownLand(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

function assertRouteClear(
  start: MapPoint,
  goal: MapPoint,
  path: readonly MapPoint[],
  knownLand = isLandAt,
): void {
  assertPointsAtSea(path, knownLand);
  let previous = start;
  for (const point of path) {
    assert.equal(segmentIsClear(previous, point, knownLand), true, `route segment crosses land`);
    previous = point;
  }
  assert.equal(Math.hypot(previous.x - goal.x, previous.y - goal.y) < 0.5, true, "route does not reach goal");
}

test("a route runs around Jamaica to a port on the far side", () => {
  const plan = planRoute({
    start: KINGSTON,
    goal: MONTEGO_BAY,
    knownLand: knownAll,
    isInside: isInsideMapFrame,
  });
  assert.equal(plan.status, "ok");
  assert.ok(plan.waypoints.length >= 2);
  assert.ok(plan.waypoints.length <= settings.route.maxWaypoints);
  assertRouteClear(KINGSTON, MONTEGO_BAY, plan.waypoints);
  const direct = Math.hypot(MONTEGO_BAY.x - KINGSTON.x, MONTEGO_BAY.y - KINGSTON.y);
  const routed = plan.waypoints.reduce(
    (sum, point, index) => {
      const previous = index === 0 ? KINGSTON : plan.waypoints[index - 1]!;
      return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
    },
    0,
  );
  assert.ok(routed > direct + 5, "the route should detour around Jamaica");
});

test("a route crosses the Caribbean through the Windward Passage", () => {
  const plan = planRoute({
    start: MONTEGO_BAY,
    goal: PORT_AU_PRINCE,
    knownLand: knownAll,
    isInside: isInsideMapFrame,
  });
  assert.equal(plan.status, "ok");
  assert.ok(plan.waypoints.length > 0);
  assertRouteClear(MONTEGO_BAY, PORT_AU_PRINCE, plan.waypoints);
});

test("a route crosses the open Caribbean to a Central American port", () => {
  const plan = planRoute({
    start: MONTEGO_BAY,
    goal: BELIZE,
    knownLand: knownAll,
    isInside: isInsideMapFrame,
  });
  assert.equal(plan.status, "ok");
  assert.ok(plan.waypoints.length > 0);
  assertRouteClear(MONTEGO_BAY, BELIZE, plan.waypoints);
});

test("a straight open-sea order stays straight", () => {
  const start = { x: 1300, y: 500 };
  const goal = { x: 1800, y: 500 };
  const plan = planRoute({
    start,
    goal,
    knownLand: () => false,
    isInside: isInsideMapFrame,
  });
  assert.equal(plan.status, "ok");
  assert.equal(plan.waypoints.length, 1);
  assert.deepEqual(plan.waypoints[0], goal);
});

test("the planner never uses land in undiscovered cells", () => {
  const world = createWorld("normal");
  const ship = addPlayer(world, "route-player");
  const chart = world.charts.get("route-player")!;
  // addPlayer reveals the immediate area, so clear that starting record for
  // this test: no ground at all has been discovered yet.
  chart.bits.fill(0);
  // Start on Jamaica's west side; with an empty discovery record the direct
  // line across the island must be treated as clear sea.
  const start = lonLatToMap(-79.0, 18.1);
  const goal = lonLatToMap(-76.0, 18.1);
  const knownLand = (x: number, y: number): boolean =>
    isCellDiscovered(chart, x, y) && isLandAt(x, y);
  assert.equal([...chart.bits].every((byte) => byte === 0), true);
  assert.equal(knownLand(goal.x, goal.y), false);

  const plan = planRoute({
    start,
    goal,
    knownLand,
    isInside: isInsideMapFrame,
  });
  assert.equal(plan.status, "ok");
  assert.equal(plan.waypoints.length, 1, "unknown Jamaica must not force a detour");
  assert.deepEqual(plan.waypoints[0], goal);
  assert.equal(ship.x > 0, true);
});

test("newly discovered land makes the route re-plan around it", () => {
  const start = { x: 1200, y: 500 };
  const goal = { x: 1500, y: 500 };
  const land = new Set<string>();
  const knownLand = (x: number, y: number): boolean =>
    land.has(`${Math.floor(x / 4)}_${Math.floor(y / 4)}`);
  const open = planRoute({ start, goal, knownLand, isInside: isInsideMapFrame });
  assert.equal(open.waypoints.length, 1);

  for (let x = 1370; x <= 1430; x += 4) {
    for (let y = 420; y <= 580; y += 4) {
      land.add(`${Math.floor(x / 4)}_${Math.floor(y / 4)}`);
    }
  }
  const replanned = planRoute({ start, goal, knownLand, isInside: isInsideMapFrame });
  assert.equal(replanned.status, "ok");
  assert.ok(replanned.waypoints.length >= 2);
  assertRouteClear(start, goal, replanned.waypoints, knownLand);
});

test("a sealed-off sea reports no known route and does not escape", () => {
  const start = { x: 1400, y: 700 };
  const goal = { x: 1900, y: 700 };
  const ring = 24;
  const knownLand = (x: number, y: number): boolean => {
    const radius = Math.hypot(x - start.x, y - start.y);
    return radius >= ring - 2 && radius <= ring;
  };
  const plan = planRoute({
    start,
    goal,
    knownLand,
    isInside: isInsideMapFrame,
    marginKm: 40,
    maxNodes: 12_000,
  });
  assert.equal(plan.status, "partial");
  assert.equal(plan.message, ROUTE_NO_KNOWN);
  assert.ok(
    plan.waypoints.every((point) => Math.hypot(point.x - start.x, point.y - start.y) < ring),
    "a partial route must stop at the known safe shore",
  );
});

test("a known land destination is refused with That is land", () => {
  const landGoal = lonLatToMap(-77.3, 18.1);
  const plan = planRoute({
    start: { x: KINGSTON.x + 20, y: KINGSTON.y },
    goal: landGoal,
    knownLand: knownAll,
    isInside: isInsideMapFrame,
  });
  assert.equal(plan.status, "land");
  assert.equal(plan.message, ROUTE_LAND);
  assert.deepEqual(plan.waypoints, []);
});

test("waypoints stay at or below fifty and every segment is clear", () => {
  const plan = planRoute({
    start: { x: 1800, y: 500 },
    goal: { x: 1300, y: 500 },
    knownLand: knownAll,
    isInside: isInsideMapFrame,
  });
  assert.ok(plan.waypoints.length <= settings.route.maxWaypoints);
  assertRouteClear({ x: 1800, y: 500 }, { x: 1300, y: 500 }, plan.waypoints);
});

test("a typical 500 km plan is under 15 ms", () => {
  // A 500 km order across known open sea: the common case should take only
  // the direct line-of-sight check. The coastal detour is measured separately
  // in docs/BUILD_LOG.md.
  const start = { x: 1800, y: 500 };
  const goal = { x: 1300, y: 500 };
  const timings: number[] = [];
  let last: ReturnType<typeof planRoute> | null = null;
  for (let run = 0; run < 9; run += 1) {
    const at = performance.now();
    last = planRoute({
      start,
      goal,
      knownLand: knownAll,
      isInside: isInsideMapFrame,
    });
    timings.push(performance.now() - at);
    assert.equal(last.status, "ok");
  }
  assertRouteClear(start, goal, last!.waypoints);
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)]!;
  console.log(`500 km route median ${median.toFixed(2)} ms (all ${timings.map((n) => n.toFixed(2)).join(", ")})`);
  assert.ok(median < 15, `median ${median.toFixed(2)} ms`);
});
