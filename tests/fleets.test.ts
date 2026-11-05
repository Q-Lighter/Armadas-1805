// Pure fleet formation, command and control-group tests.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  addFleetMember,
  assignShipToFleet,
  changeFleetLeader,
  createFleet,
  defaultFleetName,
  detachFleetMember,
  fleetHasShip,
  fleetSpeedKnots,
  formationForLeg,
  formationSlots,
  nextFleetName,
  pointBehindPath,
  rejoinFleetMember,
  removeFleetMember,
  saveControlGroup,
  validateFleet,
  type FleetShipLike,
} from "@naval/shared/fleets";

function ship(id: string, classId: FleetShipLike["classId"] = "frigate", speedKnots = 5): FleetShipLike {
  return { id, classId, speedKnots };
}

function members(count: number): FleetShipLike[] {
  return Array.from({ length: count }, (_, index) => ship(`s${index + 1}`));
}

test("line ahead places each follower one gap behind", () => {
  const ships = members(4);
  const slots = formationSlots({
    formation: "lineAhead",
    members: ships,
    headingRad: 0,
    gapM: 100,
  });
  assert.equal(slots.length, 4);
  assert.deepEqual([slots[0]!.x, slots[0]!.y], [0, 0]);
  for (let index = 1; index < slots.length; index += 1) {
    assert.ok(Math.abs(slots[index]!.x) < 1e-9);
    assert.ok(Math.abs(slots[index]!.y - index * 0.1) < 1e-9);
  }
});

test("line abreast puts the leader in the middle, alternating sides", () => {
  const slots = formationSlots({
    formation: "lineAbreast",
    members: members(5),
    headingRad: 0,
    gapM: 100,
  });
  const offsets = slots.map((slot) => Number(slot.x.toFixed(3)));
  assert.deepEqual(offsets, [0, 0.1, -0.1, 0.2, -0.2]);
  for (const slot of slots) assert.ok(Math.abs(slot.y) < 1e-9);
});

test("wedge alternates behind and out by rank", () => {
  const slots = formationSlots({
    formation: "wedge",
    members: members(5),
    headingRad: 0,
    gapM: 100,
  });
  assert.deepEqual(
    slots.slice(1).map((slot) => [Number(slot.x.toFixed(3)), Number(slot.y.toFixed(3))]),
    [[0.1, 0.1], [-0.1, 0.1], [0.2, 0.2], [-0.2, 0.2]],
  );
});

test("convoy puts trade ships in columns and other ships around them", () => {
  const ships = [
    ship("leader", "frigate"),
    ship("trade1", "trade"),
    ship("trade2", "trade"),
    ship("trade3", "trade"),
    ship("escort1", "escort"),
    ship("escort2", "escort"),
    ship("escort3", "escort"),
  ];
  const slots = formationSlots({
    formation: "convoy",
    members: ships,
    headingRad: 0,
    gapM: 100,
  });
  assert.equal(slots.length, ships.length);
  assert.ok(slots[1]!.y > 0 && slots[2]!.y > 0 && slots[3]!.y > 0);
  assert.equal(slots[1]!.x, slots[3]!.x, "three traders use two columns");
  assert.ok(slots[4]!.y < 0, "first escort is ahead");
  assert.ok(slots[5]!.y > slots[3]!.y, "second escort is at the rear");
  assert.notEqual(slots[6]!.x, 0);
});

test("the gap is clamped to the minimum and every member gets a unique slot", () => {
  const slots = formationSlots({
    formation: "lineAbreast",
    members: members(6),
    headingRad: 0.8,
    gapM: 1,
  });
  const gap = settings.fleets.minimumGapM / 1000;
  for (let first = 0; first < slots.length; first += 1) {
    for (let second = first + 1; second < slots.length; second += 1) {
      const a = slots[first]!;
      const b = slots[second]!;
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= gap - 1e-9);
    }
  }
});

test("line ahead follows the leader's breadcrumbs around a turn", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];
  const behind = pointBehindPath(path, 0.5);
  assert.ok(behind);
  assert.ok(Math.abs(behind!.x - 1) < 1e-9);
  assert.ok(Math.abs(behind!.y - 0.5) < 1e-9);

  const slots = formationSlots({
    formation: "lineAhead",
    members: members(2),
    headingRad: Math.PI / 2,
    gapM: 200,
    leaderPath: path,
  });
  assert.ok(Math.abs(slots[1]!.x - 0) < 1e-9);
  assert.ok(Math.abs(slots[1]!.y + 0.2) < 1e-9);
});

test("a formation turns into line ahead when the leg faces the wind", () => {
  const wind = 315;
  assert.equal(formationForLeg("lineAbreast", (315 * Math.PI) / 180, wind, 60), "lineAhead");
  assert.equal(formationForLeg("wedge", (90 * Math.PI) / 180, wind, 60), "wedge");
  assert.equal(formationForLeg("freeChase", (315 * Math.PI) / 180, wind, 60), "freeChase");
});

test("fleet speed is the slowest current speed", () => {
  assert.equal(fleetSpeedKnots([ship("a", "frigate", 7), ship("b", "trade", 3.5)]), 3.5);
  assert.equal(fleetSpeedKnots([ship("a", "frigate", 7), ship("b", "trade", 0)]), 0);
  assert.equal(fleetSpeedKnots([]), 0);
});

test("a fleet defaults its name and enforces the twelve-ship limit", () => {
  assert.equal(defaultFleetName(2), "Fleet 2");
  assert.equal(nextFleetName([]), "Fleet 1");
  const twelve = createFleet({ id: "f1", members: members(12).map((entry) => entry.id) });
  assert.equal(twelve.name, "Fleet 1");
  assert.equal(validateFleet(twelve), null);
  assert.throws(() => addFleetMember(twelve, "s13"));
  assert.throws(() =>
    createFleet({ id: "f2", members: Array.from({ length: 13 }, (_, index) => `x${index}`) }),
  );
});

test("a ship belongs to at most one fleet and can change fleets after removal", () => {
  const first = createFleet({ id: "f1", members: ["a", "b"], name: "Fleet 1" });
  const second = createFleet({ id: "f2", members: ["c"], name: "Fleet 2" });
  const fleets = [first, second];
  assert.equal(fleetHasShip(fleets, "a"), first);
  assert.equal(fleetHasShip(fleets, "c"), second);
  assert.equal(fleetHasShip(fleets, "missing"), null);

  const assigned = assignShipToFleet(fleets, "f2", "a");
  assert.equal(assigned, null, "a ship already in Fleet 1 cannot join Fleet 2");
  const moved = assignShipToFleet(fleets, "f1", "d");
  assert.ok(moved);
  assert.equal(fleetHasShip(moved!, "d")?.id, "f1");
});

test("leader removal passes command to the next member", () => {
  const fleet = createFleet({ id: "f1", members: ["a", "b", "c"], leaderId: "a" });
  const next = removeFleetMember(fleet, "a");
  assert.ok(next);
  assert.equal(next!.leaderId, "b");
  assert.deepEqual(next!.members, ["b", "c"]);
  assert.equal(next!.revision, fleet.revision + 1);
  const empty = removeFleetMember(createFleet({ id: "f2", members: ["a"] }), "a");
  assert.equal(empty, null);
});

test("detach and rejoin keep the ship in the fleet but out of formation", () => {
  const fleet = createFleet({ id: "f1", members: ["a", "b", "c"], leaderId: "a" });
  const detached = detachFleetMember(fleet, "a");
  assert.equal(detached.leaderId, "b");
  assert.deepEqual(detached.detached, ["a"]);
  assert.equal(detached.revision, fleet.revision + 1);
  const rejoined = rejoinFleetMember(detached, "a");
  assert.deepEqual(rejoined.detached, []);
  assert.equal(rejoined.revision, detached.revision + 1);
  assert.equal(changeFleetLeader(rejoined, "c").leaderId, "c");
});

test("control groups are numbered one to nine and replace cleanly", () => {
  let groups = saveControlGroup({}, 3, ["a", "b"]);
  assert.deepEqual(groups[3], ["a", "b"]);
  groups = saveControlGroup(groups, 3, []);
  assert.equal(groups[3], undefined);
  assert.throws(() => saveControlGroup({}, 0, ["a"]));
  assert.throws(() => saveControlGroup({}, 10, ["a"]));
  groups = saveControlGroup(groups, 9, ["a", "a"]);
  assert.deepEqual(groups[9], ["a"]);
});
