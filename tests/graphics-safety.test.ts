// Context-loss rules are pure and testable even without a graphics context.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GRAPHICS_RELOAD_NOTICE,
  GRAPHICS_RESET_NOTICE,
  GraphicsRecovery,
} from "@naval/shared/graphics-safety";
import { settings } from "@naval/shared/settings";

test("three graphics losses in one minute ask for a reload", () => {
  const recovery = new GraphicsRecovery();

  const first = recovery.lost(1_000);
  assert.equal(first.message, GRAPHICS_RESET_NOTICE);
  assert.equal(first.reload, false);

  recovery.restored();
  const second = recovery.lost(2_000);
  assert.equal(second.message, GRAPHICS_RESET_NOTICE);
  assert.equal(second.reload, false);
  recovery.restored();

  const third = recovery.lost(3_000);
  assert.equal(third.message, GRAPHICS_RELOAD_NOTICE);
  assert.equal(third.reload, true);
  assert.equal(third.losses, settings.client.graphicsFailureLimit);
  assert.equal(recovery.resetCount, 2);
});

test("an old loss falls out of the one-minute window", () => {
  const recovery = new GraphicsRecovery();
  recovery.lost(0);
  recovery.lost(1_000);
  const later = recovery.lost(settings.client.graphicsFailureWindowMs + 2_000);
  assert.equal(later.message, GRAPHICS_RESET_NOTICE);
  assert.equal(later.reload, false);
  assert.equal(later.losses, 1);
});
