import assert from "node:assert/strict";
import test from "node:test";

import {
  auditMeasuredSlots,
  fixedGameSlots,
  resolveGameMode,
  type MeasuredSlot,
} from "@naval/shared/screen-3k";

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 412, height: 915 },
  { width: 740, height: 360 },
];

test("3K slots sit inside every review viewport", () => {
  for (const size of SIZES) {
    const plan = fixedGameSlots(size.width, size.height);
    for (const slot of plan.slots) {
      assert.ok(slot.rect.left >= 0, `${size.width}: ${slot.id} left`);
      assert.ok(slot.rect.top >= 0, `${size.width}: ${slot.id} top`);
      assert.ok(slot.rect.left + slot.rect.width <= size.width, `${size.width}: ${slot.id} right`);
      assert.ok(slot.rect.top + slot.rect.height <= size.height, `${size.width}: ${slot.id} bottom`);
    }
    assert.deepEqual(plan.mapArea, { left: 0, top: 0, width: size.width, height: size.height });
  }
});

test("3K fixed slots do not overlap", () => {
  for (const size of SIZES) {
    const plan = fixedGameSlots(size.width, size.height);
    const measured: MeasuredSlot[] = plan.slots.map((slot) => ({
      id: slot.id,
      rect: {
        left: slot.rect.left,
        top: slot.rect.top,
        right: slot.rect.left + slot.rect.width,
        bottom: slot.rect.top + slot.rect.height,
      },
      interactive: false,
      contentHeight: 0,
      clientHeight: 56,
      scrollable: true,
    }));
    assert.deepEqual(auditMeasuredSlots(measured, size), [], `${size.width}x${size.height}`);
  }
});

test("3K chooses the phone and desktop modes from the viewport", () => {
  assert.equal(resolveGameMode(1366, 768), "desktop");
  assert.equal(resolveGameMode(1280, 800), "desktop");
  assert.equal(resolveGameMode(412, 915), "phonePortrait");
  assert.equal(resolveGameMode(740, 360), "phoneLandscape");
});

test("3K keeps the top-right, ship, bottom-left and title slots in place", () => {
  for (const size of SIZES) {
    const plan = fixedGameSlots(size.width, size.height);
    const byId = new Map(plan.slots.map((slot) => [slot.id, slot.rect]));
    assert.ok(byId.get("top-right-slot")!.left > size.width * 0.5, "top-right is on the right");
    assert.equal(byId.get("ship-slot")!.left, plan.mode === "desktop" ? 12 : 8);
    assert.equal(byId.get("ship-slot")!.top, plan.mode === "desktop" ? 12 : 8);
    assert.ok(byId.get("bottom-left-slot")!.top > size.height * 0.5, "bottom-left is low");
    assert.ok(byId.get("wordmark")!.left > size.width * 0.5, "title mark is bottom-right");
  }
});

test("3K slot audit reports an overlap, a small target and a clip", () => {
  const base = (id: string, left: number, top: number, width: number, height: number): MeasuredSlot => ({
    id,
    rect: { left, top, right: left + width, bottom: top + height },
    interactive: false,
    contentHeight: height,
    clientHeight: height,
    scrollable: true,
  });
  const issues = auditMeasuredSlots([
    base("a", 0, 0, 100, 100),
    base("b", 50, 50, 100, 100),
    { ...base("small", 300, 0, 20, 20), interactive: true },
    { ...base("clip", 0, 300, 100, 100), contentHeight: 180, clientHeight: 100, scrollable: false },
  ], { width: 400, height: 400 });
  assert.ok(issues.some((issue) => issue.kind === "overlap"));
  assert.ok(issues.some((issue) => issue.kind === "small-target"));
  assert.ok(issues.some((issue) => issue.kind === "clipped"));
});
