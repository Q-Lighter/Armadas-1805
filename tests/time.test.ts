// Tests for the game clock, daylight blend and moon cycle.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  GAME_DAY_MS,
  GAME_HOUR_MS,
  daylightAtHour,
  formatGameClock,
  gameClockAt,
  moonPhase,
} from "@naval/shared/time";
import {
  addPlayer,
  createWorld,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

test("the game starts at Day 1, 08:00 and one day lasts ten real minutes", () => {
  const start = gameClockAt(0);
  assert.equal(start.day, 1);
  assert.equal(start.hour, 8);
  assert.equal(start.minute, 0);
  assert.equal(start.text, "Day 1, 08:00");
  assert.equal(formatGameClock(start), "Day 1, 08:00");

  const nextDay = gameClockAt(GAME_DAY_MS);
  assert.equal(nextDay.day, 2);
  assert.equal(nextDay.hour, 8);
  assert.equal(nextDay.text, "Day 2, 08:00");

  const realMinutes = GAME_DAY_MS / settings.time.sailingTimeScale / 60_000;
  assert.equal(realMinutes, 10);
});

test("daylight is full by day and fades smoothly at dawn and dusk", () => {
  assert.equal(daylightAtHour(0), 0);
  assert.equal(daylightAtHour(12), 1);
  assert.equal(daylightAtHour(6), 0);
  assert.equal(daylightAtHour(7), 1);
  assert.equal(daylightAtHour(17), 1);
  assert.equal(daylightAtHour(18), 0);

  const dawnHalf = daylightAtHour(6.5);
  const duskHalf = daylightAtHour(17.5);
  assert.ok(dawnHalf > 0.4 && dawnHalf < 0.6, `dawn was ${dawnHalf}`);
  assert.ok(duskHalf > 0.4 && duskHalf < 0.6, `dusk was ${duskHalf}`);
  assert.equal(dawnHalf, duskHalf);
});

test("the moon repeats every 29.5 game days", () => {
  const cycleMs = settings.time.moonCycleDays * GAME_DAY_MS;
  const start = moonPhase(0);
  const wrap = moonPhase(cycleMs);
  const half = moonPhase(cycleMs / 2);

  assert.equal(start.phase, 0);
  assert.equal(start.illumination, 0);
  assert.ok(Math.abs(wrap.phase) < 1e-9);
  assert.ok(Math.abs(wrap.illumination) < 1e-9);
  assert.ok(Math.abs(half.phase - 0.5) < 1e-9);
  assert.ok(Math.abs(half.illumination - 1) < 1e-9);
  assert.ok(Math.abs(settings.time.moonCycleDays * GAME_DAY_MS - 29.5 * 86_400_000) < 1);
});

test("the server clock does not drift after 10,000 updates", () => {
  const world = createWorld();
  addPlayer(world, "alpha");
  const dt = settings.time.sailingTimeScale / settings.server.tickHz;

  for (let tick = 0; tick < 10_000; tick += 1) stepWorld(world, dt);

  assert.equal(world.tick, 10_000);
  assert.equal(world.gameMs, Math.round(10_000 * dt * 1000));
  assert.equal(world.gameSeconds, world.gameMs / 1000);
});

test("two clients receive the same game time", () => {
  const world = createWorld();
  addPlayer(world, "alpha");
  addPlayer(world, "beta");
  stepWorld(world, 60);

  const alpha = visibleStateFor(world, "alpha");
  const beta = visibleStateFor(world, "beta");
  assert.equal(alpha.g, beta.g);
  assert.equal(alpha.g, Math.round(world.gameMs));
  assert.ok(gameClockAt(alpha.g).elapsedSeconds > 0);
  assert.ok(GAME_HOUR_MS > 0);
});
