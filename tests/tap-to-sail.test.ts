// Tap-to-sail preference and one-shot tap decisions. Browser storage is
// represented by the same small interface the client passes in.

import assert from "node:assert/strict";
import { test } from "node:test";

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

test("tap-to-sail off sends no order and opens the palette instead", () => {
  assert.deepEqual(
    resolveTap({ tapToSail: false, moveArmed: false }),
    { sendOrder: false, moveArmed: false },
  );
});

test("there is no hold path: holding adds no order", () => {
  // The client never passes a duration. The resolver only sees the tap and
  // cannot turn a long press into an order.
  assert.deepEqual(
    resolveTap({ tapToSail: false, moveArmed: false }),
    { sendOrder: false, moveArmed: false },
  );
});

test("the Move button arms exactly one order", () => {
  const first = resolveTap({ tapToSail: false, moveArmed: true });
  assert.deepEqual(first, { sendOrder: true, moveArmed: false });
  assert.deepEqual(
    resolveTap({ tapToSail: false, moveArmed: first.moveArmed }),
    { sendOrder: false, moveArmed: false },
  );
});

test("tap-to-sail on keeps the ordinary quick tap", () => {
  assert.deepEqual(
    resolveTap({ tapToSail: true, moveArmed: false }),
    { sendOrder: true, moveArmed: false },
  );
});
