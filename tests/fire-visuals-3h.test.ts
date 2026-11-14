import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EFFECT_GALLERY,
  brightFireShapes,
  fireVisualPlan,
  galleryFrame,
  lightsRingPlan,
} from "@naval/shared/fire-visuals";
import { buildShipRenderPlan } from "@naval/shared/render-plan";
import { settings } from "@naval/shared/settings";
import { addPlayer, createWorld, setTestTimeOfDay, visibleStateFor } from "@naval/shared/world";

const WIDTH = 900;
const HEIGHT = 600;

function centrePlan(kmAcross: number, strength = 100, timeMs = 1_000) {
  return fireVisualPlan({
    screenX: WIDTH / 2,
    screenY: HEIGHT / 2,
    viewportPx: Math.min(WIDTH, HEIGHT),
    kmAcross,
    strength,
    headingRad: 0.4,
    windFromDeg: 315,
    timeMs,
    seed: "burning-ship",
  });
}

function insideViewport(shape: ReturnType<typeof centrePlan>["shapes"][number]): boolean {
  if (shape.points && shape.points.length >= 2) {
    for (let index = 0; index < shape.points.length; index += 2) {
      const x = shape.points[index]!;
      const y = shape.points[index + 1]!;
      if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) return false;
    }
    return true;
  }
  return shape.x - shape.radius >= 0 && shape.x + shape.radius <= WIDTH &&
    shape.y - shape.radius >= 0 && shape.y + shape.radius <= HEIGHT;
}

test("fire has a readable shape and alpha at 1, 5, 50 and 200 km views", () => {
  const bands = new Map<number, string>();
  for (const kmAcross of [1, 5, 50, 200]) {
    const plan = centrePlan(kmAcross);
    bands.set(kmAcross, plan.band);
    assert.equal(plan.layer, "shipEffects");
    assert.ok(plan.shapes.length >= 2, `${kmAcross} km has fire shapes`);
    const bright = brightFireShapes(plan);
    assert.ok(bright.length >= 1);
    assert.ok(bright.every((shape) => shape.alpha > 0.5), `${kmAcross} km bright alpha`);
    assert.ok(plan.shapes.every(insideViewport), `${kmAcross} km shapes stay in the viewport`);
    if (kmAcross >= 50) {
      const dot = plan.shapes.find((shape) => shape.kind === "dot");
      assert.ok(dot, "far zoom has a pulsing dot");
      assert.ok(dot!.radius * 2 >= 10, "far dot is at least 10 px across");
    }
  }
  assert.deepEqual([...bands.values()], ["close", "mid", "far", "far"]);
});

test("close fire uses 3-5 flames and scales with strength", () => {
  const low = centrePlan(1, 20);
  const high = centrePlan(1, 100);
  const lowFlames = low.shapes.filter((shape) => shape.kind === "flame").length;
  const highFlames = high.shapes.filter((shape) => shape.kind === "flame").length;
  assert.ok(lowFlames >= 3 && lowFlames <= 5);
  assert.ok(highFlames >= lowFlames && highFlames <= 5);
  const maxRadius = (plan: typeof low): number => Math.max(
    ...plan.shapes.filter((shape) => shape.kind === "flame").map((shape) => shape.radius),
  );
  assert.ok(maxRadius(high) > maxRadius(low));
});

test("fire is above ships and below labels in the real layer plan", () => {
  for (const kmAcross of [1, 5, 50, 200]) {
    const plan = buildShipRenderPlan({
      width: WIDTH,
      height: HEIGHT,
      view: { x: 10, y: 20, kmAcross },
      blocks: [],
      all: false,
      discovered: new Set(),
      sight: [],
      ships: [{ x: 10, y: 20 }],
      fires: [{ id: "hulk", x: 10, y: 20, headingRad: 0.2, strength: 100 }],
      timeMs: 2_345,
    });
    const shipIndex = plan.layers.findIndex((layer) => layer.name === "ships");
    const effectIndex = plan.layers.findIndex((layer) => layer.name === "shipEffects");
    const weatherIndex = plan.layers.findIndex((layer) => layer.name === "weather");
    assert.ok(shipIndex >= 0 && effectIndex > shipIndex && weatherIndex > effectIndex);
    assert.equal(plan.layers[effectIndex]!.visible, true);
    assert.ok(plan.fires.length > 0);
    assert.ok(plan.fires.some((shape) => shape.alpha > 0.5));
  }
});

test("lights-off ring appears only at night with the lights off", () => {
  assert.deepEqual(lightsRingPlan(false, true), {
    shown: false,
    radiusKm: settings.ships.fireShips.nightLightsOffSpotRangeKm,
    label: "Seen within 5 km",
  });
  assert.equal(lightsRingPlan(true, true).shown, false);
  const night = lightsRingPlan(true, false);
  assert.equal(night.shown, true);
  assert.equal(night.radiusKm, 5);
  assert.equal(night.label, "Seen within 5 km");

  const world = createWorld("test-night-ring-state");
  const own = addPlayer(world, "alpha");
  addPlayer(world, "beta", "frigate", 50_000, "French");
  const beta = [...world.fleets.entries()].find(([id]) => id === "beta")![1][0]!;
  beta.x = own.x + 4;
  beta.y = own.y;
  beta.lightsOff = false;
  setTestTimeOfDay(world, 23);
  let state = visibleStateFor(world, "alpha");
  assert.equal(state.nightLightsOff?.includes(beta.id) ?? false, false);
  beta.lightsOff = true;
  state = visibleStateFor(world, "alpha");
  assert.equal(state.nightLightsOff?.includes(beta.id), true);
});

test("a burning ship publishes fire strength and the gallery names every effect", () => {
  const world = createWorld("test-fire-strength-state");
  const ship = addPlayer(world, "alpha");
  ship.fire = { burning: true, strength: 73 };
  const state = visibleStateFor(world, "alpha");
  assert.equal(state.burningStrength?.[ship.id], 73);

  assert.equal(EFFECT_GALLERY.length, 12);
  assert.deepEqual(
    EFFECT_GALLERY.filter((effect) => effect.id.startsWith("fire")).map((effect) => effect.strength),
    [100, 60, 30],
  );
  assert.equal(new Set(EFFECT_GALLERY.map((effect) => effect.id)).size, EFFECT_GALLERY.length);
  const atStart = galleryFrame(0);
  const atFive = galleryFrame(5_999);
  const atSix = galleryFrame(6_000);
  assert.equal(atStart.effect.id, "fire-full");
  assert.equal(atFive.effect.id, "fire-full");
  assert.equal(atSix.effect.id, "fire-mid");
  assert.ok(atSix.remainingMs === 6_000 || atSix.remainingMs === 5_999);
});
