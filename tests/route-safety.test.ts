// Route clearance, reversal, curve and tack-side checks. These use the real
// island lookup and the same pure planner the server calls.

import assert from "node:assert/strict";
import { test } from "node:test";

import { isLandAt } from "@naval/shared/land";
import { isInsideMapFrame, type MapPoint } from "@naval/shared/map";
import {
  hasRouteClearance,
  planRoute,
  routeHasReversal,
  smoothRoute,
} from "@naval/shared/route";
import { settings } from "@naval/shared/settings";
import {
  chooseTackSide,
  createShip,
} from "@naval/shared/sailing";
import { shipTypeFor } from "@naval/shared/ships";

const KINGSTON = { x: 1228.266, y: 336.491 };
const MONTEGO_BAY = { x: 1164.681, y: 304.31 };
const PORT_AU_PRINCE = { x: 1461.271, y: 298.366 };
const OPEN_START = { x: 1800, y: 500 };
const OPEN_GOAL = { x: 1300, y: 500 };

function distanceToLand(point: MapPoint, radiusKm = 18): number {
  for (let distance = 1; distance <= radiusKm; distance += 1) {
    for (let direction = 0; direction < 16; direction += 1) {
      const angle = (direction / 16) * Math.PI * 2;
      if (isLandAt(point.x + Math.cos(angle) * distance, point.y + Math.sin(angle) * distance)) {
        return distance;
      }
    }
  }
  return radiusKm;
}

function clearanceOffenders(
  start: MapPoint,
  goal: MapPoint,
  path: readonly MapPoint[],
): number {
  let offenders = 0;
  let previous = start;
  for (const point of path) {
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    const samples = Math.max(1, Math.ceil(length / 1));
    for (let sample = 0; sample <= samples; sample += 1) {
      if (sample === 0 && previous === start) continue;
      const t = sample / samples;
      const x = previous.x + (point.x - previous.x) * t;
      const y = previous.y + (point.y - previous.y) * t;
      const fromStart = Math.hypot(x - start.x, y - start.y);
      const fromGoal = Math.hypot(x - goal.x, y - goal.y);
      if (fromStart <= settings.route.terminalClearanceKm) continue;
      if (fromGoal <= settings.route.terminalClearanceKm) continue;
      if (distanceToLand({ x, y }, 4) < 4) offenders += 1;
    }
    previous = point;
  }
  return offenders;
}

test("planned routes keep four kilometres from known land except at the ends", () => {
  const cases = [
    ["Kingston to Montego Bay", KINGSTON, MONTEGO_BAY],
    ["Montego Bay to Port-au-Prince", MONTEGO_BAY, PORT_AU_PRINCE],
    ["open Caribbean", OPEN_START, OPEN_GOAL],
  ] as const;
  for (const [name, start, goal] of cases) {
    const plan = planRoute({
      start,
      goal,
      knownLand: isLandAt,
      isInside: isInsideMapFrame,
    });
    assert.equal(plan.status, "ok", name);
    assert.ok(
      clearanceOffenders(start, goal, plan.waypoints) === 0,
      `${name}: route came within 4 km of known land`,
    );
    assert.equal(routeHasReversal(start, plan.waypoints), false, `${name}: reversal`);
  }
});

test("a route around Jamaica is still reachable at the new clearance", () => {
  const plan = planRoute({
    start: KINGSTON,
    goal: MONTEGO_BAY,
    knownLand: isLandAt,
    isInside: isInsideMapFrame,
  });
  assert.equal(plan.status, "ok");
  assert.equal(
    plan.waypoints
      .slice(0, -1)
      .every((point) => hasRouteClearance(point, isLandAt, settings.route.minimumClearanceKm)),
    true,
  );
});

test("a rounded route has the requested minimum radius and stays clear of land", () => {
  const start = { x: 1800, y: 500 };
  const waypoints = [
    { x: 1800, y: 540 },
    { x: 1840, y: 540 },
  ];
  const curve = smoothRoute(start, waypoints, isLandAt, 4);
  assert.ok(curve.length > 4);
  let minimum = Infinity;
  for (let index = 0; index + 2 < curve.length; index += 1) {
    const a = curve[index]!;
    const b = curve[index + 1]!;
    const c = curve[index + 2]!;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    if (area < 1e-6) continue;
    minimum = Math.min(minimum, (ab * bc * ca) / (4 * area));
  }
  assert.ok(minimum >= 3.9, `minimum curve radius ${minimum}`);
  assert.equal(curve.some((point) => isLandAt(point.x, point.y)), false);
});

test("the tack chosen first points into the larger pocket of free water", () => {
  const ship = createShip("tack", "frigate", 0, 0, 0);
  const spec = shipTypeFor("British", "frigate");
  const landToTheWest = (x: number): boolean => x < -5;
  const side = chooseTackSide(
    ship,
    spec,
    { x: 0, y: 100 },
    settings.weather.windFromDeg,
    landToTheWest,
    2,
  );
  assert.equal(side, 1, "the ship should take the eastern, away-from-land tack");
});
