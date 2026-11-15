// 3J-fix-a: measured movement thresholds. This covers heading rate, the
// smooth speed response at sail-shortening transitions and open-sea speed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { shipPerformance } from "@naval/shared/combat";
import {
  shipSpecFor,
  speedForHeading,
  stepShip,
  type Ship,
} from "@naval/shared/sailing";
import { addPlayer, createWorld } from "@naval/shared/world";

const WIND = settings.weather.windFromDeg;
const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const CLASSES = ["flagship", "line", "frigate", "escort", "raider", "trade", "fireShip"] as const;

function shipFor(classId: (typeof CLASSES)[number]): Ship {
  const world = createWorld("dev-movement-fix");
  const ship = addPlayer(world, "alpha", classId, 50_000, "British");
  ship.x = 1_693.8;
  ship.y = 442.4;
  ship.order = null;
  ship.route = null;
  ship.speedKnots = 0;
  return ship;
}

test("open-sea speed matches the settings table for every class", () => {
  for (const classId of CLASSES) {
    const ship = shipFor(classId);
    const spec = shipSpecFor(ship);
    const heading = (WIND + 110) * Math.PI / 180;
    ship.headingRad = heading;
    ship.order = {
      type: "sailTo",
      x: ship.x + Math.sin(heading) * 20,
      y: ship.y - Math.cos(heading) * 20,
    };
    for (let tick = 0; tick < 40; tick += 1) stepShip(ship, TICK, WIND);
    const expected = speedForHeading(spec, heading, WIND);
    assert.ok(Math.abs(ship.speedKnots - expected) <= expected * 0.03,
      `${classId}: ${ship.speedKnots.toFixed(2)} knots vs ${expected.toFixed(2)} expected`);
  }
});

test("a 90 degree turn never exceeds the ship's turn rate in one step", () => {
  for (const classId of ["frigate", "line"] as const) {
    const ship = shipFor(classId);
    const spec = shipSpecFor(ship);
    const performance = shipPerformance(spec, ship.damage, WIND);
    ship.headingRad = Math.PI / 2;
    ship.speedKnots = spec.cruiseKnots;
    ship.order = { type: "sailTo", x: ship.x, y: ship.y + 20 };
    const limit = performance.turnRateDegPerSecond * TICK * 1.0001;
    let worst = 0;
    for (let tick = 0; tick < 80; tick += 1) {
      const before = ship.headingRad;
      stepShip(ship, TICK, WIND);
      let change = (ship.headingRad - before) * 180 / Math.PI;
      change = ((change + 540) % 360 + 360) % 360 - 180;
      worst = Math.max(worst, Math.abs(change));
    }
    assert.ok(worst <= limit,
      `${classId}: ${worst.toFixed(2)} deg in one step, limit ${limit.toFixed(2)} deg`);
  }
});

test("shortening sail never changes speed by an instant jump", () => {
  for (const classId of ["frigate", "line"] as const) {
    const ship = shipFor(classId);
    ship.headingRad = (WIND + 110) * Math.PI / 180;
    ship.speedKnots = shipSpecFor(ship).cruiseKnots;
    ship.order = {
      type: "sailTo",
      x: ship.x + Math.sin(ship.headingRad) * 20,
      y: ship.y - Math.cos(ship.headingRad) * 20,
    };
    stepShip(ship, TICK, WIND);
    const before = ship.speedKnots;
    stepShip(ship, TICK, WIND, undefined, undefined, undefined, undefined, false, undefined, {
      nearCoast: true,
    });
    const change = Math.abs(ship.speedKnots - before);
    const limit = settings.sailing.speedChangeKnotsPerGameSecond * TICK + 1e-9;
    assert.ok(change <= limit,
      `${classId}: ${change.toFixed(2)} knot jump, limit ${limit.toFixed(2)}`);
    assert.ok(ship.speedKnots > 0 && ship.speedKnots < before, "sail shortening should reduce speed");
  }
});
