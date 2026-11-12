// Part 3C-a: the exact two-device test room and its enemy helper.

import assert from "node:assert/strict";
import { test } from "node:test";

import { findPortByName } from "@naval/shared/ports";
import {
  addPlayer,
  applyShipSpecialOrder,
  createWorld,
  spawnTestEnemyFleet,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";
import { isLandAt } from "@naval/shared/land";

test("the exact address spawns visible enemies of another navy", () => {
  const port = findPortByName("Kingston");
  assert.ok(port);
  const world = createWorld("test-13", { startPort: port, shipClass: "frigate" });
  const own = addPlayer(world, "chromebook", "frigate", 50_000, "British");
  assert.equal(spawnTestEnemyFleet(world, "chromebook", "frigate:2"), 2);
  // A page refresh calls the helper again with the same player id.
  assert.equal(spawnTestEnemyFleet(world, "chromebook", "frigate:2"), 0);
  const enemies = world.botFleets.get("TEST-ENEMY")!;
  assert.equal(enemies.length, 2);
  assert.ok(enemies.every((ship) => ship.navy !== own.navy));
  assert.ok(enemies.every((ship) => !isLandAt(ship.x, ship.y)));
  const state = visibleStateFor(world, "chromebook");
  assert.equal(state.ships.length, 3);
  assert.ok(state.ships.some((ship) => ship[0] === enemies[0]!.id));
  assert.ok((world.notices.get("chromebook") ?? []).some((text) =>
    text.startsWith("Spawned 2 enemy frigates, about 3 km east"),
  ));
});

test("a second test player starts 2-4 km away, sees the first and can be sunk", () => {
  const port = findPortByName("Kingston");
  assert.ok(port);
  const world = createWorld("test-13", { startPort: port, shipClass: "frigate" });
  const one = addPlayer(world, "chromebook", "frigate", 50_000, "British");
  const two = addPlayer(world, "phone", "frigate", 50_000, "French");
  const distance = Math.hypot(one.x - two.x, one.y - two.y);
  assert.ok(distance >= 2 && distance <= 4, `distance ${distance}`);
  assert.equal(two.navy, "French");
  assert.ok(visibleStateFor(world, "chromebook").ships.some((ship) => ship[0] === two.id));
  assert.ok(visibleStateFor(world, "phone").ships.some((ship) => ship[0] === one.id));

  two.x = one.x + 0.45;
  two.y = one.y;
  one.headingRad = 0;
  two.headingRad = 0;
  const hull = two.damage.hull;
  assert.equal(
    applyShipSpecialOrder(world, "chromebook", one.id, {
      type: "engage",
      shipId: two.id,
      objective: "sink",
    }),
    true,
  );
  for (let index = 0; index < 120; index += 1) stepWorld(world, 14.4);
  assert.ok(two.damage.hull < hull, "the other player took damage");
});
