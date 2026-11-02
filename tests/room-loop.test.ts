// Tests for the room timer's start/stop behaviour.

import assert from "node:assert/strict";
import { test } from "node:test";

import { RoomLoop, type TimerApi } from "@naval/shared/room-loop";
import { settings } from "@naval/shared/settings";
import { addPlayer, createWorld, stepWorld } from "@naval/shared/world";

function fakeTimers(): TimerApi & {
  count(): number;
  fire(): void;
  cancelled(): number;
} {
  const callbacks = new Set<() => void>();
  let cancelledCount = 0;

  return {
    every(callback) {
      callbacks.add(callback);
      return callback;
    },
    cancel(handle) {
      cancelledCount += 1;
      callbacks.delete(handle as () => void);
    },
    count() {
      return callbacks.size;
    },
    fire() {
      for (const callback of [...callbacks]) callback();
    },
    cancelled() {
      return cancelledCount;
    },
  };
}

test("the loop starts once and stops only after the last connection", () => {
  const timers = fakeTimers();
  const loop = new RoomLoop(() => {}, 100, timers);

  loop.start();
  loop.start();
  loop.start();
  assert.equal(loop.running, true);
  assert.equal(timers.count(), 1);

  loop.stop();
  loop.stop();
  assert.equal(loop.running, false);
  assert.equal(timers.count(), 0);
  assert.equal(timers.cancelled(), 1);
});

test("game time freezes while empty and resumes without a jump", () => {
  const timers = fakeTimers();
  const world = createWorld();
  addPlayer(world, "alpha");
  const tickGameSeconds = settings.time.sailingTimeScale / settings.server.tickHz;
  const loop = new RoomLoop(() => stepWorld(world, tickGameSeconds), 100, timers);

  loop.start();
  for (let tick = 0; tick < 5; tick += 1) timers.fire();
  const beforeEmpty = world.gameSeconds;
  assert.ok(beforeEmpty > 0);

  loop.stop();
  timers.fire();
  assert.equal(world.gameSeconds, beforeEmpty, "an empty room must not advance");

  loop.start();
  timers.fire();
  assert.equal(
    world.gameSeconds,
    beforeEmpty + tickGameSeconds,
    "play resumes from the frozen time, not wall time",
  );
});
