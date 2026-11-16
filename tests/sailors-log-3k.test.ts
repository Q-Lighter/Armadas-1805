// 3K-c: Sailor's Log queue mutation and formation slot order.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addPlayer,
  applyFleetOrder,
  createPlayerFleet,
  createWorld,
  movePlayerFleetMember,
  shipsForOwner,
  spawnTestFleet,
  updateFleetQueue,
} from "@naval/shared/world";

function fleetWorld() {
  const world = createWorld("test-sailors-log");
  const leader = addPlayer(world, "one", "frigate", 50_000, "British");
  spawnTestFleet(world, "one", "frigate:2");
  const ships = shipsForOwner(world, "one").filter((ship) => !ship.deliveryPortId);
  const fleet = createPlayerFleet(world, "one", ships.map((ship) => ship.id))!;
  assert.ok(fleet);
  return { world, fleet, ships, leader };
}

test("queued fleet orders can be reordered and removed", () => {
  const { world, fleet, leader } = fleetWorld();
  const target = { x: leader.x + 10, y: leader.y + 10 };
  assert.equal(applyFleetOrder(world, "one", fleet.id, { type: "goTo", ...target }), true);
  assert.equal(
    applyFleetOrder(world, "one", fleet.id, { type: "goTo", x: target.x + 4, y: target.y }, true),
    true,
  );
  assert.equal(
    applyFleetOrder(world, "one", fleet.id, { type: "goTo", x: target.x + 8, y: target.y }, true),
    true,
  );
  const command = world.fleetCommands.get(fleet.id)!;
  assert.equal(command.queue.length, 2);
  const firstX = command.queue[0]!.type === "goTo" ? command.queue[0]!.x : 0;
  const secondX = command.queue[1]!.type === "goTo" ? command.queue[1]!.x : 0;

  assert.equal(updateFleetQueue(world, "one", fleet.id, "move", 0, 1), true);
  assert.equal(command.queue[0]!.type === "goTo" ? command.queue[0]!.x : 0, secondX);
  assert.equal(command.queue[1]!.type === "goTo" ? command.queue[1]!.x : 0, firstX);

  assert.equal(updateFleetQueue(world, "one", fleet.id, "remove", 0, undefined), true);
  assert.equal(command.queue.length, 1);
  assert.equal(command.queue[0]!.type === "goTo" ? command.queue[0]!.x : 0, firstX);
  assert.equal(updateFleetQueue(world, "one", fleet.id, "remove", 9, undefined), false);
  assert.equal(updateFleetQueue(world, "other", fleet.id, "remove", 0, undefined), false);
});

test("a follower can swap formation slots but the leader cannot", () => {
  const { world, fleet } = fleetWorld();
  assert.ok(fleet.members.length >= 3);
  const [leaderId, firstFollower, secondFollower] = fleet.members;
  assert.equal(movePlayerFleetMember(world, "one", fleet.id, leaderId, 1), false);
  assert.equal(movePlayerFleetMember(world, "one", fleet.id, firstFollower, 1), true);
  const moved = world.fleetModels.get("one")!.get(fleet.id)!;
  assert.deepEqual(moved.members.slice(0, 3), [leaderId, secondFollower, firstFollower]);
  assert.equal(movePlayerFleetMember(world, "other", fleet.id, firstFollower, 1), false);
});
