// Tap-to-sail preference and one-shot tap decisions. Browser storage is
// represented by the same small interface the client passes in.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  readTapToSail,
  resolveTap,
  TAP_TO_SAIL_KEY,
  writeTapToSail,
} from "@naval/shared/tap-to-sail";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

test("tap-to-sail is on for a new player and survives a reload", () => {
  const first = storage();
  assert.equal(readTapToSail(first), true);
  writeTapToSail(first, false);
  assert.equal(first.values.get(TAP_TO_SAIL_KEY), "off");

  // A new read is what a browser reload does: same storage, new client state.
  assert.equal(readTapToSail(first), false);
  writeTapToSail(first, true);
  assert.equal(readTapToSail(first), true);
});

test("a quick sea tap sends no order when tap-to-sail is off", () => {
  assert.deepEqual(
    resolveTap({ tapToSail: false, moveArmed: false, heldMs: 120 }),
    { sendOrder: false, moveArmed: false },
  );
});

test("a half-second hold sends one order when tap-to-sail is off", () => {
  assert.deepEqual(
    resolveTap({
      tapToSail: false,
      moveArmed: false,
      heldMs: settings.client.tapHoldMs,
    }),
    { sendOrder: true, moveArmed: false },
  );
});

test("the Move button arms exactly one order", () => {
  const first = resolveTap({ tapToSail: false, moveArmed: true, heldMs: 0 });
  assert.deepEqual(first, { sendOrder: true, moveArmed: false });
  assert.deepEqual(
    resolveTap({ tapToSail: false, moveArmed: first.moveArmed, heldMs: 0 }),
    { sendOrder: false, moveArmed: false },
  );
});

test("tap-to-sail on keeps the ordinary quick tap", () => {
  assert.deepEqual(
    resolveTap({ tapToSail: true, moveArmed: false, heldMs: 0 }),
    { sendOrder: true, moveArmed: false },
  );
});
