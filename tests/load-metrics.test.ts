// TEMP-DEBUG tests for the dev-room loop measurements.

import assert from "node:assert/strict";
import { test } from "node:test";

import { LoadMetrics } from "@naval/shared/load-metrics";

test("load metrics report timer gaps and per-player bytes", () => {
  const metrics = new LoadMetrics();
  metrics.reset(1_000);

  for (let tick = 0; tick <= 100; tick += 1) {
    metrics.noteTick(1_000 + tick * 100);
  }
  // Ten seconds at the real 5 Hz fake-player update rate.
  for (let second = 0; second < 10; second += 1) {
    for (let update = 0; update < 5; update += 1) {
      for (const owner of ["bot-0", "bot-1"]) {
        metrics.notePlayerUpdate(owner, 1_000, 2_000 + second * 1_000 + update * 200);
      }
    }
  }

  const [ships, bots, hz, averageGap, worstGap, bytesAverage, bytesWorst] =
    metrics.snapshot(50, 30, 11_000);

  assert.equal(ships, 50);
  assert.equal(bots, 30);
  assert.ok(hz >= 9 && hz <= 10.1, `expected about 10 updates/s, got ${hz}`);
  assert.ok(averageGap >= 99 && averageGap <= 101);
  assert.equal(worstGap, 100);
  assert.equal(bytesAverage, 5_000);
  assert.equal(bytesWorst, 5_000);
});

test("resetting metrics does not carry an idle gap into a new session", () => {
  const metrics = new LoadMetrics();
  metrics.reset(1_000);
  metrics.noteTick(1_000);
  metrics.noteTick(60_000);
  metrics.reset(120_000);
  metrics.noteTick(120_000);
  metrics.noteTick(120_100);

  const [, , hz, averageGap, worstGap] = metrics.snapshot(1, 0, 120_100);
  assert.ok(hz > 9);
  assert.equal(averageGap, 100);
  assert.equal(worstGap, 100);
});
