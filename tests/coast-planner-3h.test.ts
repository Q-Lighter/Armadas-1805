// 3H b2: coast safety, recovery and the kinematic route planner.
//
// The planner tests use the same pure land lookup and route module as the
// server. The world tests use the real fixed-step movement path.

import assert from "node:assert/strict";
import { test } from "node:test";

import { formationSlots } from "@naval/shared/fleets";
import { isLandAt } from "@naval/shared/land";
import { isInsideMapFrame, lonLatToMap, type MapPoint } from "@naval/shared/map";
import {
  planRoute,
  routeWithinCorridor,
  smoothRoute,
  sampleRouteCurve,
} from "@naval/shared/route";
import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyOrder,
  createWorld,
  stepWorld,
  takeNotice,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const RAD = Math.PI / 180;

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentClear(a: MapPoint, b: MapPoint, land = isLandAt): boolean {
  const steps = Math.max(1, Math.ceil(distance(a, b) / 1));
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    if (land(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

function routeClear(
  start: MapPoint,
  goal: MapPoint | null,
  path: readonly MapPoint[],
  land = isLandAt,
): void {
  let previous = start;
  for (const point of path) {
    assert.equal(land(point.x, point.y), false, `waypoint on land at ${point.x},${point.y}`);
    assert.equal(segmentClear(previous, point, land), true, "route segment crosses land");
    previous = point;
  }
  if (goal && path.length > 0) {
    assert.ok(distance(path[path.length - 1]!, goal) < 1, "route does not reach its goal");
  }
}

/** A U-shaped bay open to the south: leaving it needs a full turn-around. */
function bayLand(x: number, y: number): boolean {
  const top = y >= 145 && y <= 155 && x >= 55 && x <= 145;
  const leftWall = x >= 55 && x <= 65 && y >= 100 && y <= 155;
  const rightWall = x >= 135 && x <= 145 && y >= 100 && y <= 155;
  return top || leftWall || rightWall;
}

/** A long peninsula from the north, with goal on its far side. */
function peninsulaLand(x: number, y: number): boolean {
  return x >= 55 && x <= 85 && y >= 50 && y <= 150;
}

test("200 deterministic route scenarios stay clear and inside the plan budget", () => {
  const random = seeded(0x3_48b2);
  const scenarios: Array<{ start: MapPoint; goal: MapPoint }> = [];
  while (scenarios.length < 200) {
    const start = { x: 1250 + random() * 900, y: 420 + random() * 650 };
    const goal = { x: 1250 + random() * 900, y: 420 + random() * 650 };
    if (isLandAt(start.x, start.y) || isLandAt(goal.x, goal.y)) continue;
    if (distance(start, goal) < 3) continue;
    scenarios.push({ start, goal });
  }

  const timings: number[] = [];
  let ok = 0;
  let partial = 0;
  for (const scenario of scenarios) {
    const at = performance.now();
    const plan = planRoute({
      start: scenario.start,
      goal: scenario.goal,
      knownLand: isLandAt,
      isInside: isInsideMapFrame,
    });
    timings.push(performance.now() - at);
    assert.ok(plan.waypoints.length <= settings.route.maxWaypoints);
    if (plan.status === "ok") {
      ok += 1;
      routeClear(scenario.start, scenario.goal, plan.waypoints);
    } else {
      partial += 1;
      assert.equal(plan.status, "partial", `unexpected status ${plan.status}`);
      routeClear(scenario.start, null, plan.waypoints);
    }
  }
  assert.ok(ok >= 180, `only ${ok} scenarios reached their destination`);
  assert.ok(partial <= 20, `${partial} scenarios stopped short`);
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)]!;
  const p95 = timings[Math.floor(timings.length * 0.95)]!;
  console.log(`B2 200 route scenarios: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
  assert.ok(median < settings.route.kinematicBudgetMs, `median ${median.toFixed(2)} ms`);
});

test("the kinematic route turns around a bay and rounds a peninsula", () => {
  const bayStart = { x: 100, y: 120 };
  const bayGoal = { x: 100, y: 200 };
  assert.equal(bayLand(bayStart.x, bayStart.y), false);
  assert.equal(bayLand(bayGoal.x, bayGoal.y), false);
  const bay = planRoute({
    start: bayStart,
    goal: bayGoal,
    knownLand: bayLand,
    isInside: () => true,
  });
  assert.equal(bay.status, "ok");
  routeClear(bayStart, bayGoal, bay.waypoints, bayLand);
  assert.ok(
    bay.waypoints.some((point) => point.y < bayStart.y),
    "the route must first leave the bay southwards",
  );

  const peninsulaStart = { x: 110, y: 100 };
  const peninsulaGoal = { x: 40, y: 100 };
  assert.equal(peninsulaLand(peninsulaStart.x, peninsulaStart.y), false);
  assert.equal(peninsulaLand(peninsulaGoal.x, peninsulaGoal.y), false);
  const peninsula = planRoute({
    start: peninsulaStart,
    goal: peninsulaGoal,
    knownLand: peninsulaLand,
    isInside: () => true,
  });
  assert.equal(peninsula.status, "ok");
  routeClear(peninsulaStart, peninsulaGoal, peninsula.waypoints, peninsulaLand);
  const direct = distance(peninsulaStart, peninsulaGoal);
  const routed = peninsula.waypoints.reduce((sum, point, index) => {
    const previous = index === 0 ? peninsulaStart : peninsula.waypoints[index - 1]!;
    return sum + distance(previous, point);
  }, 0);
  assert.ok(routed > direct * 1.3, "the route did not round the peninsula");

  // The five-kilometre corridor is a hard property of the smoothed curve.
  const raw = [{ ...bayStart }, ...bay.waypoints];
  const smoothed = smoothRoute(bayStart, bay.waypoints, bayLand, 2);
  const curve = sampleRouteCurve(smoothed, settings.route.curveSampleKm, 200);
  assert.equal(
    routeWithinCorridor(curve, raw, settings.route.kinematicCorridorKm),
    true,
  );
});

test("an idle ship auto-anchors after twenty game minutes and wakes on an order", () => {
  const world = createWorld("test-3h-idle-anchor");
  const ship = addPlayer(world, "idle", "frigate");
  ship.x = 1_800;
  ship.y = 620;
  ship.order = null;
  ship.route = null;
  ship.speedKnots = 0;
  ship.autoAnchor = true;
  for (let tick = 0; tick < 120; tick += 1) stepWorld(world, TICK);
  assert.equal(ship.anchored, true, "the idle ship did not anchor");
  assert.equal(ship.autoAnchor, true);
  const notices: string[] = [];
  for (let notice = takeNotice(world, "idle"); notice; notice = takeNotice(world, "idle")) {
    notices.push(notice);
  }
  assert.ok(notices.some((line) => /anchored after lying idle/.test(line)));

  const target = { x: ship.x - 10, y: ship.y };
  assert.equal(applyOrder(world, "idle", target.x, target.y), true);
  assert.equal(ship.anchored, false, "a new order did not wake the automatic anchor");
  assert.ok(ship.order);
});

test("coast safety anchors an idle hull close to a lee shore", () => {
  const world = createWorld("test-3h-coast-safety");
  const ship = addPlayer(world, "coast-safe", "frigate");
  ship.x = 1_162;
  ship.y = 326.3;
  ship.headingRad = 90 * RAD; // pointing at Jamaica
  ship.order = null;
  ship.route = null;
  ship.speedKnots = 2;
  ship.autoAnchor = true;
  for (let tick = 0; tick < 30; tick += 1) stepWorld(world, TICK);
  assert.equal(ship.anchored, true, "the closing coast did not anchor the idle ship");
  assert.equal(ship.speedKnots, 0);
});

test("a stuck order warns once, then clears and anchors", () => {
  const world = createWorld("test-3h-stuck");
  const ship = addPlayer(world, "stuck", "frigate");
  ship.x = 1_800;
  ship.y = 620;
  ship.order = null;
  ship.route = null;
  assert.equal(applyOrder(world, "stuck", 1_800, 560), true);
  // No crew means no way on; the route is still installed, so the recovery
  // timer can see that the destination is not getting closer.
  ship.hoveTo = true;
  ship.speedKnots = 0;
  const notices: string[] = [];
  for (
    let tick = 0;
    tick < settings.manoeuvres.stuckClearGameMinutes * 60 / TICK + 30;
    tick += 1
  ) {
    stepWorld(world, TICK);
    for (let notice = takeNotice(world, "stuck"); notice; notice = takeNotice(world, "stuck")) {
      notices.push(notice);
    }
  }
  assert.ok(notices.some((line) => /no progress; trying a new tack/.test(line)));
  assert.ok(notices.some((line) => /no progress; order cleared/.test(line)));
  assert.equal(ship.route, null);
  assert.equal(ship.order, null);
  assert.equal(ship.anchored, true);
});

test("eight ships in line ahead keep their order and spacing around a turn", () => {
  const members = Array.from({ length: 8 }, (_, index) => ({
    id: `ship-${index}`,
    classId: index === 0 ? "frigate" as const : "trade" as const,
    speedKnots: 5,
  }));
  const leaderPath = [
    { x: 0, y: 0 },
    { x: 0, y: 5 },
    { x: 2, y: 8 },
    { x: 6, y: 10 },
    { x: 12, y: 10 },
  ];
  const slots = formationSlots({
    formation: "lineAhead",
    members,
    headingRad: 0,
    gapM: settings.fleets.defaultGapM,
    lookAheadM: settings.fleets.stationLookAheadM,
    leaderPath,
  });
  assert.equal(slots.length, 8);
  assert.deepEqual([slots[0]!.x, slots[0]!.y], [0, 0]);
  for (let index = 1; index < slots.length; index += 1) {
    const spacing = Math.hypot(
      slots[index]!.x - slots[index - 1]!.x,
      slots[index]!.y - slots[index - 1]!.y,
    );
    assert.ok(
      spacing > settings.fleets.defaultGapM / 1000 * 0.9,
      `ships ${index - 1} and ${index} are only ${(spacing * 1000).toFixed(0)} m apart`,
    );
  }
});

test("a short local route still uses the fine grid and a hundred turns stay cheap", () => {
  const random = seeded(0x3_a11);
  const start = lonLatToMap(-77.6, 17.4);
  const timings: number[] = [];
  for (let run = 0; run < 100; run += 1) {
    const target = {
      x: start.x + (random() - 0.5) * 20,
      y: start.y + (random() - 0.5) * 20,
    };
    if (isLandAt(target.x, target.y)) continue;
    const at = performance.now();
    const plan = planRoute({
      start,
      goal: target,
      knownLand: isLandAt,
      isInside: isInsideMapFrame,
    });
    timings.push(performance.now() - at);
    assert.notEqual(plan.status, "land");
    assert.notEqual(plan.status, "none");
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)]!;
  console.log(`B2 100 local routes: median ${median.toFixed(2)} ms`);
  assert.ok(median < settings.route.kinematicBudgetMs, `local median ${median.toFixed(2)} ms`);
});
