// Tests for the coast and the edge of the chart. They sail real ships through
// the shared world step, using the same land lookup the server uses.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { lonLatToMap } from "@naval/shared/map";
import { isLandAt, isSeaAt } from "@naval/shared/land";
import { createShip, type Ship } from "@naval/shared/sailing";
import {
  COAST_NOTICE,
  EDGE_NOTICE,
  addPlayer,
  applyOrder,
  createWorld,
  shipClassForRoom,
  stepWorld,
  takeNotice,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const RAD = Math.PI / 180;

interface Position {
  x: number;
  y: number;
}

function place(ship: Ship, lonDeg: number, latDeg: number, headingDeg: number): void {
  const point = lonLatToMap(lonDeg, latDeg);
  ship.x = point.x;
  ship.y = point.y;
  ship.headingRad = headingDeg * RAD;
  ship.speedKnots = 0;
  ship.order = null;
  ship.arrived = false;
}

/** Sail until the order ends, with a tick budget so a bug cannot hang. */
function sailUntilStopped(world: ReturnType<typeof createWorld>, ship: Ship, maxTicks: number): number {
  let ticks = 0;
  while (ship.order && ticks < maxTicks) {
    stepWorld(world, TICK);
    ticks += 1;
  }
  return ticks;
}

function distanceTo(ship: Ship, target: Position): number {
  return Math.hypot(ship.x - target.x, ship.y - target.y);
}

test("an order straight into Jamaica stops at the coast", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");

  place(ship, -79.0, 18.1, 90);
  assert.equal(isSeaAt(ship.x, ship.y), true, "start is at sea");
  assert.equal(isLandAt(lonLatToMap(-77.3, 18.1).x, lonLatToMap(-77.3, 18.1).y), true);

  const target = lonLatToMap(-76.0, 18.1);
  assert.equal(applyOrder(world, "alpha", target.x, target.y), true);

  const ticks = sailUntilStopped(world, ship, 3_000);
  assert.ok(ticks > 0 && ticks < 3_000, "the ship should stop without hitting the budget");

  assert.equal(ship.order, null);
  assert.equal(ship.speedKnots, 0);
  assert.equal(ship.arrived, false);
  assert.equal(takeNotice(world, "alpha"), COAST_NOTICE);

  // It stopped on the west side of the island, in water just before the coast.
  assert.ok(ship.x < lonLatToMap(-77.3, 18.1).x, "stopped west of central Jamaica");
  assert.ok(ship.x > lonLatToMap(-79.0, 18.1).x, "moved east from the start");
  assert.equal(isLandAt(ship.x, ship.y), false);
  assert.ok(isLandAt(ship.x + 4, ship.y), "land lies close ahead");
});

test("a very large step cannot jump over Jamaica", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");

  place(ship, -79.2, 18.1, 90);
  const target = lonLatToMap(-76.0, 18.1);
  assert.equal(applyOrder(world, "alpha", target.x, target.y), true);

  // One enormous game step would carry the ship right across the island.
  stepWorld(world, 150_000);

  assert.equal(ship.order, null);
  assert.equal(ship.speedKnots, 0);
  assert.equal(takeNotice(world, "alpha"), COAST_NOTICE);
  assert.ok(ship.x < lonLatToMap(-77.0, 18.1).x, "the path check kept it on the west coast");
  assert.equal(isLandAt(ship.x, ship.y), false);
});

test("an order past the chart edge stops at the edge", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");

  const start = { x: 5, y: 1_000 };
  ship.x = start.x;
  ship.y = start.y;
  ship.headingRad = 270 * RAD;
  ship.speedKnots = 0;
  ship.order = null;
  assert.equal(isSeaAt(ship.x, ship.y), true, "the start is open Pacific water");

  assert.equal(applyOrder(world, "alpha", -100, start.y), true);
  const ticks = sailUntilStopped(world, ship, 2_000);

  assert.ok(ticks > 0 && ticks < 2_000);
  assert.equal(ship.order, null);
  assert.equal(ship.speedKnots, 0);
  assert.equal(takeNotice(world, "alpha"), EDGE_NOTICE);
  assert.ok(ship.x >= 0, "still on the chart");
  assert.ok(ship.x <= settings.coast.stopMarginKm + 0.01, "stopped at the edge");
  assert.ok(ship.y > 0 && ship.y < 5_000, "still on the chart north-south");
});

test("an upwind order along the Jamaican coast tacks, arrives and stops", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");

  place(ship, -78.8, 17.4, 340);
  assert.equal(isSeaAt(ship.x, ship.y), true, "start is at sea");

  const target = lonLatToMap(-79.1, 18.3);
  assert.equal(isSeaAt(target.x, target.y), true, "target is at sea");
  assert.equal(applyOrder(world, "alpha", target.x, target.y), true);

  const ticks = sailUntilStopped(world, ship, 6_000);
  assert.ok(ticks > 0 && ticks < 6_000, "the ship should arrive without the budget");

  assert.equal(ship.order, null);
  assert.equal(ship.arrived, true);
  assert.equal(ship.speedKnots, 0);
  assert.equal(takeNotice(world, "alpha"), null, "no coast or edge message");
  assert.ok(
    distanceTo(ship, target) <= settings.sailing.arrivalRadiusKm + 0.01,
    "arrived inside the arrival radius",
  );
});

test("a new second player starts a few kilometres away", () => {
  const world = createWorld();
  const alpha = addPlayer(world, "alpha");
  const beta = addPlayer(world, "beta");

  const separation = distanceTo(alpha, beta);
  assert.ok(
    separation >= settings.world.startArea.minimumSeparationKm,
    `starts only ${separation.toFixed(2)} km apart`,
  );
  assert.ok(separation <= settings.world.startArea.radiusKm * 2 + 0.01);
});

test("test and dev rooms get a frigate; other rooms keep the flagship", () => {
  assert.equal(shipClassForRoom("test"), "frigate");
  assert.equal(shipClassForRoom("test-room"), "frigate");
  assert.equal(shipClassForRoom("dev-fog"), "frigate");
  assert.equal(shipClassForRoom("main"), "flagship");
  assert.equal(shipClassForRoom("tester"), "frigate");

  const testWorld = createWorld();
  const testShip = addPlayer(testWorld, "alpha", shipClassForRoom("test"));
  assert.equal(testShip.classId, "frigate");

  const realWorld = createWorld();
  const realShip = addPlayer(realWorld, "alpha", shipClassForRoom("main"));
  assert.equal(realShip.classId, "flagship");
});

test("a ship stopped on a coast can turn and sail away in any wind", () => {
  // Put a ship against the west side of Jamaica, then order it back out to sea
  // while it is still facing the shore.
  const approach = createWorld();
  const approachShip = addPlayer(approach, "alpha");
  place(approachShip, -79.0, 18.1, 90);
  const intoLand = lonLatToMap(-76.0, 18.1);
  assert.equal(applyOrder(approach, "alpha", intoLand.x, intoLand.y), true);
  const approachTicks = sailUntilStopped(approach, approachShip, 3_000);
  assert.ok(approachTicks > 0 && approachTicks < 3_000);

  const start = { x: approachShip.x, y: approachShip.y };
  for (const wind of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const world = createWorld();
    const ship = addPlayer(world, "alpha");
    ship.x = start.x;
    ship.y = start.y;
    ship.headingRad = 90 * RAD; // still pointing at the shore
    ship.speedKnots = 0;
    ship.order = null;
    ship.arrived = false;
    ship.coastEscapeHeadingRad = null;

    const seaward = { x: start.x - 10, y: start.y };
    assert.equal(isSeaAt(seaward.x, seaward.y), true, `${wind}: target is sea`);
    assert.equal(applyOrder(world, "alpha", seaward.x, seaward.y), true);

    for (let tick = 0; tick < 2_500; tick += 1) {
      stepWorld(world, TICK, wind);
      if (!ship.order) break;
    }

    assert.equal(isLandAt(ship.x, ship.y), false, `${wind}: not aground`);
    assert.ok(
      Math.hypot(ship.x - start.x, ship.y - start.y) > 1,
      `${wind}: the seaward order moved the ship clear`,
    );
    assert.ok(
      ship.arrived || ship.order !== null,
      `${wind}: a coast collision did not cancel the seaward order`,
    );
  }
});

test("a ship with no order does not drift", () => {
  const world = createWorld();
  const ship = addPlayer(world, "alpha");
  const x = ship.x;
  const y = ship.y;

  stepWorld(world, TICK);
  assert.equal(ship.x, x);
  assert.equal(ship.y, y);
  assert.equal(ship.speedKnots, 0);
});
