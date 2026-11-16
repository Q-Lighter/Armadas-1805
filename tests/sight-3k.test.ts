import assert from "node:assert/strict";
import test from "node:test";

import {
  LIT_SHIP_VISIBLE_KM,
  MOON_SIGHT_MULTIPLIERS,
  NIGHT_SIGHT_FRACTION,
  moonPhaseName,
  sightRangeKm,
  targetInSight,
} from "@naval/shared/sight";

const DAY = 25;

test("3K night sight is sixteen percent of a twenty-five km day", () => {
  assert.equal(NIGHT_SIGHT_FRACTION, 0.16);
  assert.equal(sightRangeKm({}, 1, 0.25, false), DAY);
  assert.equal(sightRangeKm({}, 0, 0.25, false), 4);
});

test("3K moon phase scales night sight from the agreed table", () => {
  assert.equal(MOON_SIGHT_MULTIPLIERS.new, 0.375);
  assert.equal(MOON_SIGHT_MULTIPLIERS.crescent, 0.675);
  assert.equal(MOON_SIGHT_MULTIPLIERS.quarter, 1);
  assert.equal(MOON_SIGHT_MULTIPLIERS.gibbous, 1.2);
  assert.equal(MOON_SIGHT_MULTIPLIERS.full, 1.375);
  assert.equal(sightRangeKm({}, 0, 0, false), 1.5);
  assert.equal(sightRangeKm({}, 0, 0.25, false), 4);
  assert.equal(sightRangeKm({}, 0, 0.5, false), 5.5);
});

test("3K maps a continuous phase to the five design phases", () => {
  assert.equal(moonPhaseName(0), "new");
  assert.equal(moonPhaseName(0.12), "crescent");
  assert.equal(moonPhaseName(0.25), "quarter");
  assert.equal(moonPhaseName(0.38), "gibbous");
  assert.equal(moonPhaseName(0.5), "full");
  assert.equal(moonPhaseName(0.75), "quarter");
});

test("3K a lit ship is seen from ten km at night", () => {
  assert.equal(sightRangeKm({}, 0, 0, true), LIT_SHIP_VISIBLE_KM);
  assert.equal(sightRangeKm({}, 0, 0.5, true), LIT_SHIP_VISIBLE_KM);
  assert.equal(sightRangeKm({}, 1, 0, true), DAY);
});

test("3K blends day and night over the clock's twilight", () => {
  assert.equal(sightRangeKm({}, 0.5, 0.25, false), DAY * 0.5 + 4 * 0.5);
  assert.equal(sightRangeKm({ daySightKm: 20 }, 0, 0.25, false), 3.2);
});

test("3K a target is visible inside the observer's night sight or its own lit range", () => {
  const observer = { x: 0, y: 0 };
  assert.equal(targetInSight(observer, { x: 3.9, y: 0, lightsOn: false }, 0, 0.25), true);
  assert.equal(targetInSight(observer, { x: 4.1, y: 0, lightsOn: false }, 0, 0.25), false);
  assert.equal(targetInSight(observer, { x: 9.9, y: 0, lightsOn: true }, 0, 0.25), true);
  assert.equal(targetInSight(observer, { x: 10.1, y: 0, lightsOn: true }, 0, 0.25), false);
});
