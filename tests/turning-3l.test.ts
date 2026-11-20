// 3L-a: the measured, eased helm. These tests run the same step the server
// runs, at the real 10 Hz tick, and check the feel numbers from the settings.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  createShip,
  sailTo,
  shipSpecFor,
  shortestTurnDegrees,
  stepShip,
} from "@naval/shared/sailing";
import {
  maxTurnRateDegPerGameSecond,
  turnAccelerationDegPerGameSecond2,
} from "@naval/shared/turning";
import type { ShipClassId } from "@naval/shared/ships";

const CLASSES: ShipClassId[] = [
  "raider",
  "escort",
  "trade",
  "frigate",
  "line",
  "flagship",
  "fireShip",
];
const WIND = settings.weather.windFromDeg;
const RAD = Math.PI / 180;
const TICK = 1 / settings.server.tickHz;
const GAME_DT = settings.time.sailingTimeScale * TICK;

function shipFor(classId: ShipClassId) {
  const spec = shipSpecFor(createShip(`turn-${classId}`, classId, 0, 0, 0));
  const start = (WIND + 180) * RAD;
  const target = (WIND + 270) * RAD;
  const ship = createShip(`turn-${classId}`, classId, 0, 0, start);
  ship.speedKnots = spec.cruiseKnots;
  sailTo(ship, Math.sin(target) * 200, -Math.cos(target) * 200);
  return { ship, spec, start, target };
}

test("every class eases through 90 degrees in its Draft real time", () => {
  console.log("\n3L TURNING TABLE (real 10 Hz loop, 90 degrees at cruise)");
  for (const classId of CLASSES) {
    const { ship } = shipFor(classId);
    let ticks = 0;
    let turned = 0;
    let previous = ship.headingRad;
    let largestTickDeg = 0;
    while (Math.abs(turned) < 90 && ticks < 20_000) {
      stepShip(ship, GAME_DT);
      const change = shortestTurnDegrees(previous, ship.headingRad);
      turned += change;
      largestTickDeg = Math.max(largestTickDeg, Math.abs(change));
      previous = ship.headingRad;
      ticks += 1;
    }
    const seconds = ticks * TICK;
    const target = settings.sailing.turn90RealSeconds[classId]!;
    console.log(
      `${classId.padEnd(9)} ${seconds.toFixed(2)} s (target ${target.toFixed(2)}) ` +
      `max ${largestTickDeg.toFixed(2)} deg/tick, ${(largestTickDeg / 6).toFixed(2)} deg/frame`,
    );
    assert.ok(
      Math.abs(seconds - target) <= target * 0.1,
      `${classId}: ${seconds.toFixed(2)} s vs ${target.toFixed(2)} s`,
    );
    const maxTick = maxTurnRateDegPerGameSecond(classId) * GAME_DT;
    assert.ok(largestTickDeg <= maxTick + 1e-9,
      `${classId}: ${largestTickDeg.toFixed(3)} deg in a tick, limit ${maxTick.toFixed(3)}`);
    assert.ok(largestTickDeg / 6 <= maxTick / 6 + 1e-9,
      `${classId}: frame turn exceeds the same rate limit`);
  }
});

test("the heading second difference stays inside the angular acceleration limit", () => {
  for (const classId of CLASSES) {
    const { ship } = shipFor(classId);
    const maxRate = maxTurnRateDegPerGameSecond(classId);
    const accel = turnAccelerationDegPerGameSecond2(maxRate);
    const limit = accel * GAME_DT * GAME_DT + 1e-9;
    let previous = ship.headingRad;
    let previousChange = 0;
    let largestSecondDifference = 0;
    for (let tick = 0; tick < 80; tick += 1) {
      stepShip(ship, GAME_DT);
      const change = shortestTurnDegrees(previous, ship.headingRad);
      largestSecondDifference = Math.max(
        largestSecondDifference,
        Math.abs(change - previousChange),
      );
      previous = ship.headingRad;
      previousChange = change;
    }
    assert.ok(largestSecondDifference <= limit,
      `${classId}: second difference ${largestSecondDifference.toFixed(3)} deg, limit ${limit.toFixed(3)}`);
  }
});

test("speed builds and sheds way without an instant jump", () => {
  for (const classId of CLASSES) {
    const spec = shipSpecFor(createShip(`speed-${classId}`, classId, 0, 0, 0));
    const ship = createShip(`speed-${classId}`, classId, 0, 0, (WIND + 90) * RAD);
    ship.speedKnots = 0;
    sailTo(ship, Math.sin((WIND + 90) * RAD) * 20, -Math.cos((WIND + 90) * RAD) * 20);
    const maxChange = settings.sailing.speedChangeKnotsPerRealSecond * TICK + 1e-9;
    let previous = 0;
    let fastest = 0;
    for (let tick = 0; tick < 800; tick += 1) {
      stepShip(ship, GAME_DT);
      assert.ok(Math.abs(ship.speedKnots - previous) <= maxChange,
        `${classId}: speed jumped ${Math.abs(ship.speedKnots - previous).toFixed(3)} knots`);
      previous = ship.speedKnots;
      fastest = Math.max(fastest, ship.speedKnots);
    }
    assert.ok(fastest > spec.cruiseKnots * 0.5, `${classId}: should get under way`);
  }
});
