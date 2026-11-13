import assert from "node:assert/strict";
import { test } from "node:test";

import { isLandAt } from "@naval/shared/land";
import { catmullRomPath, dotsAlongPath } from "@naval/shared/route-ink";
import {
  planRoute,
  remainingRouteCurve,
  sampleRouteCurve,
  smoothRoute,
} from "@naval/shared/route";

test("route dot count follows on-screen length, not map distance", () => {
  const short = dotsAlongPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
  const long = dotsAlongPath([{ x: 0, y: 0 }, { x: 200, y: 0 }], 10);
  assert.equal(short.length, 10);
  assert.equal(long.length, 20);
  assert.equal(long.length, short.length * 2);
});

test("dots are spaced ten screen pixels and follow bends", () => {
  const dots = dotsAlongPath(
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    10,
  );
  assert.equal(dots.length, 20);
  for (let index = 1; index < 10; index += 1) {
    assert.ok(Math.abs(dots[index]!.x - dots[index - 1]!.x - 10) < 1e-9);
    assert.equal(dots[index]!.y, 0);
  }
  assert.equal(dots[10]!.x, 100);
  assert.ok(dots[11]!.y > 0);
});

test("sampled route curves are at most 1.5 km apart or capped at 200 points", () => {
  const curve = sampleRouteCurve(
    [{ x: 100, y: 100 }, { x: 400, y: 140 }],
    1.5,
    200,
  );
  assert.ok(curve.length > 2);
  assert.ok(curve.length <= 200);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(
      Math.hypot(
        curve[index]!.x - curve[index - 1]!.x,
        curve[index]!.y - curve[index - 1]!.y,
      ) <= 1.55,
    );
  }
});

test("a route around Jamaica keeps a visible bend in its sampled curve", () => {
  const start = { x: 1228.266, y: 336.491 };
  const goal = { x: 1164.681, y: 304.31 };
  const plan = planRoute({ start, goal, knownLand: isLandAt });
  assert.equal(plan.status, "ok");
  const curve = sampleRouteCurve(
    smoothRoute(start, plan.waypoints, isLandAt, 1),
    1.5,
    200,
  );
  let greatestDeviation = 0;
  for (const point of curve) {
    const cross = Math.abs(
      (goal.x - start.x) * (point.y - start.y) -
        (goal.y - start.y) * (point.x - start.x),
    );
    greatestDeviation = Math.max(
      greatestDeviation,
      cross / Math.hypot(goal.x - start.x, goal.y - start.y),
    );
  }
  assert.ok(greatestDeviation > 1, "the track bends around the island");
});

test("the remaining route starts at the ship-side end", () => {
  const curve = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ];
  assert.deepEqual(
    remainingRouteCurve(curve, { x: 16, y: 1 }).map((point) => point.x),
    [20, 30],
  );
});

test("a Catmull-Rom route has rounded bends and keeps its ends", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 0, y: 50 },
  ];
  const curve = catmullRomPath(points, 8);
  assert.deepEqual(curve[0], points[0]);
  assert.deepEqual(curve[curve.length - 1], points[points.length - 1]);
  assert.ok(curve.length > points.length * 4);
  let sharpest = Infinity;
  for (let index = 1; index + 1 < curve.length; index += 1) {
    const a = curve[index - 1]!;
    const b = curve[index]!;
    const c = curve[index + 1]!;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area2 > 1e-9) sharpest = Math.min(sharpest, (ab * bc * ca) / (2 * area2));
  }
  assert.ok(sharpest > 5, `spline has a sharp corner of radius ${sharpest}`);
});
