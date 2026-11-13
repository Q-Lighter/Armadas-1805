import assert from "node:assert/strict";
import { test } from "node:test";

import { DomThrottle } from "@naval/shared/dom-throttle";
import { selectVisibleEffects } from "@naval/shared/effect-budget";
import { groupFleetMarkers } from "@naval/shared/fleet-markers";
import {
  qualityFeatures,
  QualityGovernor,
  qualityLevelForPreference,
} from "@naval/shared/quality";
import { settings } from "@naval/shared/settings";

test("the quality governor steps down in the required order and back up", () => {
  const governor = new QualityGovernor();
  let now = 0;
  // A one-off slow frame does not change quality.
  governor.sample(80, now);
  now += 10_000;
  assert.equal(governor.sample(10, now), 0);

  // Slow for 3 s: smoke/splash goes first.
  now = 20_000;
  assert.equal(governor.sample(50, now), 0);
  assert.equal(governor.sample(50, now + 2_999), 0);
  assert.equal(governor.sample(50, now + 3_000), 1);
  assert.equal(qualityFeatures(1).smoke, false);
  assert.equal(qualityFeatures(1).wind, true);

  assert.equal(governor.sample(50, now + 6_000), 2);
  assert.equal(qualityFeatures(2).wind, false);
  assert.equal(qualityFeatures(2).routeDetail, true);
  assert.equal(governor.sample(50, now + 9_000), 3);
  assert.equal(qualityFeatures(3).routeDetail, false);
  assert.equal(qualityFeatures(3).fireGlow, true);
  assert.equal(governor.sample(50, now + 12_000), 4);
  assert.equal(qualityFeatures(4).fireGlow, false);
  assert.equal(qualityFeatures(4).fullResolution, true);
  assert.equal(governor.sample(50, now + 15_000), 5);
  assert.equal(qualityFeatures(5).fullResolution, false);

  // Ten seconds of good frames restores the last step first.
  let good = now + 20_000;
  assert.equal(governor.sample(10, good), 5);
  assert.equal(governor.sample(10, good + 9_999), 5);
  assert.equal(governor.sample(10, good + 10_000), 4);
  assert.equal(qualityLevelForPreference("high", 5), 0);
  assert.equal(qualityLevelForPreference("low", 0), 5);
});

test("same-fleet ships group at far zoom and separate when zoomed in", () => {
  const ships = Array.from({ length: 10 }, (_, index) => ({
    id: `ship-${index}`,
    fleetId: "fleet-a",
    x: 10 + index * 0.1,
    y: 20,
  }));
  const far = groupFleetMarkers(ships, 1, settings.client.fleetGroupPx);
  assert.equal(far.groups.length, 1);
  assert.equal(far.groups[0]?.count, 10);
  assert.equal(far.groupedIds.size, 10);

  const near = groupFleetMarkers(ships, 1_000, settings.client.fleetGroupPx);
  assert.equal(near.groups.length, 0);
  assert.equal(near.groupedIds.size, 0);
});

test("different fleets never merge into one marker", () => {
  const plan = groupFleetMarkers([
    { id: "a", fleetId: "red", x: 0, y: 0 },
    { id: "b", fleetId: "blue", x: 0.01, y: 0 },
    { id: "c", fleetId: null, x: 0.01, y: 0.01 },
  ], 10);
  assert.equal(plan.groups.length, 0);
});

test("effects are capped and off-screen effects are dropped", () => {
  const effects = Array.from({ length: 200 }, (_, index) => ({
    id: index,
    onScreen: index >= 40,
  }));
  const kept = selectVisibleEffects(effects, (effect) => effect.onScreen, settings.client.maxLiveEffects);
  assert.equal(kept.length, 150);
  assert.equal(kept[0]?.id, 50);
  assert.equal(kept.at(-1)?.id, 199);
});

test("DOM readouts are throttled independently", () => {
  const throttle = new DomThrottle();
  assert.equal(throttle.due("hud", 0, 2), true);
  assert.equal(throttle.due("hud", 499, 2), false);
  assert.equal(throttle.due("hud", 500, 2), true);
  assert.equal(throttle.due("fleet", 500, 4), true);
  assert.equal(throttle.due("log", 500, 4), true);
  assert.equal(throttle.due("fleet", 749, 4), false);
  assert.equal(throttle.due("fleet", 750, 4), true);
});
