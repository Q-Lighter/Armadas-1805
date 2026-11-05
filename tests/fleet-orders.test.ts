// Pure order state and follow/patrol/rendezvous tests.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  advanceOrderProgress,
  followStation,
  formatHeading,
  groupSpreadPoint,
  headingTarget,
  initialOrderProgress,
  orderLabel,
  patrolTarget,
  rendezvousComplete,
  withQueuedOrder,
  type FleetOrder,
} from "@naval/shared/fleet-orders";

test("heading and distance points exactly on the compass bearing", () => {
  const target = headingTarget({ x: 10, y: 10 }, 90, 5);
  assert.ok(Math.abs(target.x - 15) < 1e-9);
  assert.ok(Math.abs(target.y - 10) < 1e-9);
  assert.equal(formatHeading(375), "015°");
});

test("a heading order stops after exactly its distance", () => {
  const order: FleetOrder = { type: "heading", headingDeg: 0, distanceKm: 2 };
  let progress = initialOrderProgress(order);
  progress = advanceOrderProgress(progress, { kind: "moved", distanceKm: 1.25 });
  assert.equal(progress.status, "active");
  assert.ok(Math.abs(progress.remainingKm - 0.75) < 1e-9);
  progress = advanceOrderProgress(progress, { kind: "moved", distanceKm: 0.75 });
  assert.equal(progress.status, "complete");
  assert.equal(progress.remainingKm, 0);
});

test("a heading order stopped by land stops with Land ahead", () => {
  const progress = advanceOrderProgress(
    initialOrderProgress({ type: "heading", headingDeg: 270, distanceKm: 8 }),
    { kind: "landAhead" },
  );
  assert.equal(progress.status, "complete");
  assert.equal(progress.message, "Land ahead.");
});

test("patrol alternates between its two points until changed", () => {
  const order: FleetOrder = {
    type: "patrol",
    a: { x: 1, y: 2 },
    b: { x: 3, y: 4 },
  };
  assert.deepEqual(patrolTarget(order, 0), { x: 1, y: 2 });
  let progress = initialOrderProgress(order);
  progress = advanceOrderProgress(progress, { kind: "arrived" });
  assert.equal(progress.status, "active");
  assert.equal(progress.patrolLeg, 1);
  assert.deepEqual(patrolTarget(order, progress.patrolLeg), { x: 3, y: 4 });
  progress = advanceOrderProgress(progress, { kind: "arrived" });
  assert.equal(progress.status, "active");
  assert.equal(progress.patrolLeg, 0);
});

test("follow and escort stations sit behind and alongside", () => {
  const target = { x: 20, y: -10 };
  const follow = followStation(target, Math.PI / 2, "follow");
  assert.ok(Math.abs(follow.x - (20 - settings.fleets.followDistanceKm)) < 1e-9);
  assert.ok(Math.abs(follow.y + 10) < 1e-9);
  const escort = followStation(target, 0, "escort");
  assert.ok(Math.abs(escort.x - (20 + settings.fleets.escortDistanceKm)) < 1e-9);
  assert.ok(Math.abs(escort.y + 10) < 1e-9);
});

test("a follow order ends when the target docks or is lost for ten game minutes", () => {
  const order: FleetOrder = { type: "follow", shipId: "friend" };
  let progress = initialOrderProgress(order);
  progress = advanceOrderProgress(progress, { kind: "targetDocked" });
  assert.equal(progress.status, "complete");

  progress = initialOrderProgress(order);
  progress = advanceOrderProgress(progress, { kind: "targetLost", gameMs: 1_000 });
  const before = advanceOrderProgress(progress, {
    kind: "tick",
    gameMs: 1_000 + settings.fleets.targetLostGameMinutes * 60 * 1000 - 1,
  });
  assert.equal(before.status, "active");
  const after = advanceOrderProgress(before, {
    kind: "tick",
    gameMs: 1_000 + settings.fleets.targetLostGameMinutes * 60 * 1000,
  });
  assert.equal(after.status, "complete");
});

test("a rendezvous completes only when every listed ship has arrived", () => {
  const order: FleetOrder = {
    type: "rendezvous",
    point: { x: 5, y: 5 },
    memberIds: ["a", "b"],
  };
  let progress = initialOrderProgress(order);
  assert.equal(rendezvousComplete(order, new Set(["a"])), false);
  progress = advanceOrderProgress(progress, { kind: "memberArrived", shipId: "a" });
  assert.equal(progress.status, "active");
  progress = advanceOrderProgress(progress, { kind: "memberArrived", shipId: "b" });
  assert.equal(progress.status, "complete");
});

test("sail-to and return orders complete on arrival while hold does not", () => {
  const arrived = advanceOrderProgress(
    initialOrderProgress({ type: "goTo", x: 1, y: 1 }),
    { kind: "arrived" },
  );
  assert.equal(arrived.status, "complete");
  const held = advanceOrderProgress(initialOrderProgress({ type: "hold" }), { kind: "arrived" });
  assert.equal(held.status, "active");
});

test("queueing appends orders and a non-queue order replaces them", () => {
  const first: FleetOrder = { type: "goTo", x: 1, y: 1 };
  const second: FleetOrder = { type: "hold" };
  assert.deepEqual(withQueuedOrder([], first, false), [first]);
  assert.deepEqual(withQueuedOrder([first], second, true), [first, second]);
  assert.deepEqual(withQueuedOrder([first], second, false), [second]);
  assert.equal(orderLabel(first), "Go to point");
});

test("free chase spreads ships deterministically around the point", () => {
  const point = { x: 10, y: 20 };
  assert.deepEqual(groupSpreadPoint(point, 0, 3), point);
  assert.deepEqual(groupSpreadPoint(point, 1, 3), groupSpreadPoint(point, 1, 3));
  assert.notDeepEqual(groupSpreadPoint(point, 1, 3), point);
});
