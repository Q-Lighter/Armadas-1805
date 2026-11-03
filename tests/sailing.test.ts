// Tests for the sailing rules. They run with `npm test` on plain Node.
//
// Each test sails a real ship through the shared step function, using the same
// code the server will run.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { shipTypeFor } from "@naval/shared/ships";
import {
  angleOffWindDeg,
  createShip,
  sailTo,
  shortestTurnDegrees,
  speedForHeading,
  stepShip,
  turnRateDegPerSecond,
  type Ship,
  type ShipClassId,
} from "@naval/shared/sailing";

const CLASSES: ShipClassId[] = ["flagship", "frigate", "raider"];
const WIND_FROM = settings.weather.windFromDeg;
const RAD = Math.PI / 180;

type Point = { x: number; y: number };

function pointAt(bearingDeg: number, distanceKm: number): Point {
  const rad = bearingDeg * RAD;
  // The world's y grows south, so a compass bearing points along
  // (sin bearing, -cos bearing).
  return { x: Math.sin(rad) * distanceKm, y: -Math.cos(rad) * distanceKm };
}

/** Sail until the order is finished, and report how many steps it took. */
function sailUntilArrived(ship: Ship, target: Point, dt: number, maxSteps = 200_000): number {
  assert.equal(sailTo(ship, target.x, target.y), true, "order should be accepted");
  let steps = 0;
  while (ship.order && steps < maxSteps) {
    stepShip(ship, dt);
    steps += 1;
  }
  return steps;
}

test("a ship cannot sail inside its no-sail angle", () => {
  for (const classId of CLASSES) {
    const spec = shipTypeFor("British", classId);
    const justInside = spec.closestAngleDeg - 0.5;
    const justOutside = spec.closestAngleDeg + 0.5;

    // Headings are measured from north, so add the wind direction.
    assert.equal(speedForHeading(spec, (WIND_FROM + justInside) * RAD, WIND_FROM), 0, classId);
    assert.ok(speedForHeading(spec, (WIND_FROM + justOutside) * RAD, WIND_FROM) > 0, classId);
    assert.equal(speedForHeading(spec, (WIND_FROM + 180) * RAD, WIND_FROM) > 0, true, classId);
  }
});

test("turning takes the time in the settings for every ship", () => {
  for (const classId of CLASSES) {
    const spec = shipTypeFor("British", classId);
    const expectedRate = 90 / (spec.turn90GameMinutes * 60);

    assert.equal(turnRateDegPerSecond(spec), expectedRate);

    // Start facing north and order due east, so the ship must turn 90 degrees.
    const ship = createShip("turn-test", classId, 0, 0, 0);
    sailTo(ship, 200, 0);

    let seconds = 0;
    while (Math.abs(shortestTurnDegrees(ship.headingRad, 90 * RAD)) > 0.01 && seconds < 5000) {
      stepShip(ship, 1);
      seconds += 1;
    }

    const expectedSeconds = spec.turn90GameMinutes * 60;
    assert.ok(
      Math.abs(seconds - expectedSeconds) <= 2,
      `${classId}: 90 degree turn took ${seconds}s, expected about ${expectedSeconds}s`,
    );
  }
});

test("a downwind trip arrives and stops", () => {
  for (const classId of CLASSES) {
    // Directly downwind of the wind: south-east.
    const target = pointAt(WIND_FROM + 180, 30);
    const ship = createShip(`downwind-${classId}`, classId, 0, 0, (WIND_FROM + 180) * RAD);
    sailUntilArrived(ship, target, 5);

    assert.equal(ship.order, null, classId);
    assert.equal(ship.speedKnots, 0, classId);
    assert.equal(ship.arrived, true, classId);
    assert.ok(
      Math.hypot(ship.x - target.x, ship.y - target.y) <= settings.sailing.arrivalRadiusKm + 0.01,
      classId,
    );
  }
});

test("an upwind trip tacks, arrives and stops for every ship", () => {
  for (const classId of CLASSES) {
    const target = pointAt(WIND_FROM, 25);
    const ship = createShip(`upwind-${classId}`, classId, 0, 0, (WIND_FROM + 90) * RAD);

    // Remember which side of the wind the ship sailed on, to prove it tacked.
    const sides = new Set<number>();
    assert.equal(sailTo(ship, target.x, target.y), true);
    let steps = 0;
    while (ship.order && steps < 200_000) {
      stepShip(ship, 5);
      if (steps % 20 === 0) {
        sides.add(Math.sign(shortestTurnDegrees(WIND_FROM * RAD, ship.headingRad)));
      }
      steps += 1;
    }

    assert.equal(ship.order, null, `${classId} should have finished`);
    assert.equal(ship.speedKnots, 0, `${classId} should be stopped`);
    assert.equal(ship.arrived, true, classId);
    assert.ok(
      Math.hypot(ship.x - target.x, ship.y - target.y) <= settings.sailing.arrivalRadiusKm + 0.5,
      `${classId} ended too far from the target`,
    );
    assert.ok(sides.has(1) && sides.has(-1), `${classId} should have tacked both ways`);
    assert.ok(steps > 10, `${classId} trip should be simulated, not instant`);
  }
});

test("an upwind trip also works at the server tick length", () => {
  // The server steps the world in 14.4 game-second ticks at 10 Hz.
  const dt = settings.time.sailingTimeScale / settings.server.tickHz;

  for (const classId of CLASSES) {
    const target = pointAt(WIND_FROM, 25);
    const ship = createShip(`server-upwind-${classId}`, classId, 0, 0, 0);
    sailUntilArrived(ship, target, dt, 40_000);

    assert.equal(ship.order, null, `${classId} should have arrived`);
    assert.equal(ship.speedKnots, 0, classId);
    assert.ok(
      Math.hypot(ship.x - target.x, ship.y - target.y) <= settings.sailing.arrivalRadiusKm + 0.5,
      `${classId} ended too far from the target`,
    );
  }
});

test("the same inputs always give the same results", () => {
  const target = pointAt(WIND_FROM, 20);

  const first = createShip("same", "frigate", 0, 0, 0);
  const second = createShip("same", "frigate", 0, 0, 0);
  sailTo(first, target.x, target.y);
  sailTo(second, target.x, target.y);

  for (let i = 0; i < 5000; i += 1) {
    stepShip(first, 4);
    stepShip(second, 4);
    assert.deepEqual({ ...first }, { ...second });
  }
  assert.equal(first.order, null);
  assert.equal(second.order, null);
});

test("orders outside the allowed range are refused", () => {
  const ship = createShip("range", "raider", 0, 0, 0);
  assert.equal(sailTo(ship, Number.NaN, 0), false);
  assert.equal(sailTo(ship, settings.sailing.maxOrderDistanceKm + 1, 0), false);
  assert.equal(sailTo(ship, 0.01, 0), false);
  assert.equal(sailTo(ship, 10, 0), true);
  assert.equal(angleOffWindDeg(0, 0), 0);
});
