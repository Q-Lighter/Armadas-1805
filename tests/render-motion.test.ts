// Fixed-delay motion tests: 5 Hz and 10 Hz snapshots, jitter, a dropped packet,
// a short-way heading turn and 1/10/40 ships.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { MotionTrack, shortestAngleDelta } from "@naval/shared/render-motion";

const SPEED_M_PER_SECOND = 10;
const FRAME_SECONDS = 1 / 60;
const START = -1_000;
const END = 6_000;

function jitter(index: number): number {
  return ((index * 37) % 5 - 2) * 4;
}

function makeSnapshots(hz: number): Array<{ time: number; x: number; y: number; heading: number }> {
  const interval = 1_000 / hz;
  const snapshots = [];
  for (let index = 0, time = START; time <= END; index += 1) {
    time = index === 0 ? START : Math.round(START + index * interval + jitter(index));
    if (index === 12) continue; // one realistic dropped packet
    const heading = time < 2_000 ? 359 : 1;
    snapshots.push({
      time: time / 1_000,
      x: 100 + SPEED_M_PER_SECOND * (time / 1_000),
      y: 200,
      heading: heading * Math.PI / 180,
    });
  }
  return snapshots;
}

for (const hz of [5, 10]) {
  test(`${hz} Hz snapshots draw 1, 10 and 40 ships at constant speed within 10% per frame`, () => {
    const snapshots = makeSnapshots(hz);
    const delay = settings.client.renderDelayMs / 1_000;
    const tracks = Array.from({ length: 40 }, () =>
      new MotionTrack(12, settings.client.renderExtrapolationMs / 1_000));
    const previous = new Array(tracks.length).fill(null);
    let headingStep = 0;
    let nextSnapshot = 0;
    for (let time = 1_000; time <= END; time += FRAME_SECONDS * 1_000) {
      while (nextSnapshot < snapshots.length && snapshots[nextSnapshot]!.time <= time / 1_000) {
        const sample = snapshots[nextSnapshot]!;
        for (let index = 0; index < tracks.length; index += 1) {
          tracks[index]!.push(sample.time, sample.x, sample.y + index * 20, sample.heading);
        }
        nextSnapshot += 1;
      }
      for (let index = 0; index < tracks.length; index += 1) {
        const motion = tracks[index]!.sample(time / 1_000 - delay);
        assert.ok(motion);
        if (previous[index]) {
          const before = previous[index]!;
          const step = Math.hypot(motion.x - before.x, motion.y - before.y);
          const expected = SPEED_M_PER_SECOND * FRAME_SECONDS;
          assert.ok(
            Math.abs(step - expected) <= expected * 0.1,
            `${hz} Hz ship ${index + 1}: frame step ${step.toFixed(4)} m vs ${expected.toFixed(4)} m`,
          );
          if (index === 0) {
            headingStep = Math.max(headingStep, Math.abs(
              shortestAngleDelta(before.heading, motion.heading),
            ));
          }
        }
        previous[index] = { ...motion };
      }
    }
    assert.ok(headingStep < 0.02, `heading stepped ${(headingStep * 180 / Math.PI).toFixed(2)}° in one frame`);
  });
}

test("the short-way heading turn never spins 359° to 1°", () => {
  const track = new MotionTrack();
  track.push(0, 0, 0, 359 * Math.PI / 180);
  track.push(0.2, 10, 0, 1 * Math.PI / 180);
  const middle = track.sample(0.1);
  assert.ok(middle);
  assert.ok(Math.abs(shortestAngleDelta(middle.heading, 359 * Math.PI / 180)) < 0.05);
  assert.ok(Math.abs(shortestAngleDelta(middle.heading, 1 * Math.PI / 180)) < 0.05);
});
