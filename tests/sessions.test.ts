// Tests for socket takeover and test/dev-only ghost cleanup.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GhostCleanup,
  PlayerSessions,
  TAKEN_OVER_CLOSE_CODE,
  type CleanupTimers,
} from "@naval/shared/player-sessions";
import type { RoomKind } from "@naval/shared/fog";
import { addPlayer, createWorld, removePlayer } from "@naval/shared/world";

class FakeSocket {
  closed: Array<{ code?: number; reason?: string }> = [];

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }
}

function fakeTimers() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const timers: CleanupTimers & {
    fire(): void;
    count(): number;
    cancelled(): number;
  } = {
    schedule(callback) {
      callbacks.set(nextHandle, callback);
      return nextHandle++;
    },
    cancel(handle) {
      callbacks.delete(handle as number);
    },
    fire() {
      for (const [handle, callback] of [...callbacks]) {
        callbacks.delete(handle);
        callback();
      }
    },
    count() {
      return callbacks.size;
    },
    cancelled() {
      return 0;
    },
  };
  return timers;
}

test("a second connection takes over and the old socket cannot remove it", () => {
  const sessions = new PlayerSessions<FakeSocket>();
  const first = new FakeSocket();
  const second = new FakeSocket();

  sessions.add("alpha", first);
  const previous = sessions.add("alpha", second);

  assert.equal(previous, first);
  assert.deepEqual(first.closed, [{ code: TAKEN_OVER_CLOSE_CODE, reason: "another tab" }]);
  assert.equal(sessions.get("alpha"), second);
  assert.equal(sessions.remove("alpha", first), false);
  assert.equal(sessions.get("alpha"), second);
  assert.equal(sessions.remove("alpha", second), true);
  assert.equal(sessions.size, 0);
});

test("ghost cleanup removes the ship and chart, but normal rooms keep both", () => {
  const testWorld = createWorld("test-1");
  addPlayer(testWorld, "alpha");
  const timers = fakeTimers();
  const cleanup = new GhostCleanup(
    () => testWorld.kind,
    () => 120_000,
    (id) => void removePlayer(testWorld, id),
    timers,
  );

  cleanup.disconnected("alpha");
  timers.fire();
  assert.equal(testWorld.players.has("alpha"), false);
  assert.equal(testWorld.charts.has("alpha"), false);

  const normal = createWorld("main");
  addPlayer(normal, "alpha");
  const normalTimers = fakeTimers();
  const normalCleanup = new GhostCleanup(
    () => normal.kind,
    () => 120_000,
    (id) => void removePlayer(normal, id),
    normalTimers,
  );
  normalCleanup.disconnected("alpha");
  normalTimers.fire();
  assert.equal(normal.players.has("alpha"), true);
  assert.equal(normal.charts.has("alpha"), true);
});

test("ghost cleanup removes a disconnected player only after 120 seconds in test and dev", () => {
  const timers = fakeTimers();
  let kind: RoomKind = "test";
  const removed: string[] = [];
  const cleanup = new GhostCleanup(
    () => kind,
    () => 120_000,
    (id) => removed.push(id),
    timers,
  );

  cleanup.disconnected("alpha");
  assert.equal(timers.count(), 1);
  timers.fire();
  assert.deepEqual(removed, ["alpha"]);

  cleanup.disconnected("beta");
  cleanup.reconnected("beta");
  assert.equal(timers.count(), 0);
  timers.fire();
  assert.deepEqual(removed, ["alpha"]);

  kind = "dev";
  cleanup.disconnected("gamma");
  assert.equal(timers.count(), 1);

  kind = "normal";
  cleanup.disconnected("delta");
  assert.equal(timers.count(), 1, "normal rooms never schedule a removal");
  timers.fire();
  assert.deepEqual(removed, ["alpha", "gamma"]);
});
