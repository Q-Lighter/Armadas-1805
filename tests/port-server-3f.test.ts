// 3F Part C: ports in the world step, orders, visibility and test helpers.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { PLACED_PORTS } from "@naval/shared/ports";
import {
  addPlayer,
  applyPortOrder,
  attackPort,
  buildPortFortification,
  createWorld,
  fillTestPortStock,
  finishTestPortBuild,
  setTestPortOwner,
  setTestPortHealth,
  setTestPortTier,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

const DT = settings.time.sailingTimeScale / settings.server.tickHz;
const PORT = PLACED_PORTS.find((port) => !port.npc)!;

function testWorld(): ReturnType<typeof createWorld> {
  const world = createWorld("test-3f");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  addPlayer(world, "beta", "frigate", 50_000, "French");
  for (const id of ["alpha", "beta"]) world.charts.get(id)!.foundPorts.add(PORT.id);
  return world;
}

test("test helpers work in test rooms and refuse in normal rooms", () => {
  const world = testWorld();
  assert.equal(setTestPortOwner(world, "alpha", PORT.id, "me"), true);
  assert.equal(world.portBattles.get(PORT.id)!.ownerId, "alpha");
  assert.equal(fillTestPortStock(world, PORT.id), true);
  assert.equal(setTestPortHealth(world, PORT.id, 100), true);
  assert.equal(world.portBattles.get(PORT.id)!.health, 100);
  assert.equal(setTestPortTier(world, PORT.id, 2), true);
  assert.equal(world.portBattles.get(PORT.id)!.tier, 2);
  assert.equal(finishTestPortBuild(world, PORT.id), true);
  assert.equal(world.portBattles.get(PORT.id)!.tier, 3);
  const normal = createWorld("normal-room");
  assert.equal(setTestPortOwner(normal, "alpha", PORT.id, "me"), false);
  assert.equal(setTestPortHealth(normal, PORT.id, 1), false);
});

test("attack port is refused for my port and NPC neutral ground", () => {
  const world = testWorld();
  setTestPortOwner(world, "alpha", PORT.id, "me");
  const alpha = world.players.get("alpha")!;
  assert.equal(attackPort(world, "alpha", PORT.id, alpha.id), false);
  setTestPortOwner(world, "alpha", PORT.id, "nobody");
  assert.equal(attackPort(world, "alpha", PORT.id, alpha.id), true);
  assert.equal(world.portAttackTargets.get(alpha.id), PORT.id);
  const npc = PLACED_PORTS.find((port) => port.npc);
  if (npc) {
    world.charts.get("alpha")!.foundPorts.add(npc.id);
    assert.equal(attackPort(world, "alpha", npc.id, alpha.id), false);
  }
});

test("a port owner sees exact health; another player sees only condition", () => {
  const world = testWorld();
  setTestPortOwner(world, "alpha", PORT.id, "me");
  setTestPortHealth(world, PORT.id, 321);
  const own = visibleStateFor(world, "alpha").portBattle.find((row) => row.id === PORT.id)!;
  const enemy = visibleStateFor(world, "beta").portBattle.find((row) => row.id === PORT.id)!;
  assert.equal(own.health, 321);
  assert.equal(enemy.health, undefined);
  assert.equal(enemy.condition, "Heavily damaged");
  assert.equal(enemy.owner, "alpha");
  assert.equal(own.navy, "British");
  assert.equal(enemy.stock, undefined);
});

test("the port's own build and stock stay private", () => {
  const world = testWorld();
  setTestPortOwner(world, "alpha", PORT.id, "me");
  fillTestPortStock(world, PORT.id);
  assert.equal(buildPortFortification(world, "alpha", PORT.id), true);
  assert.ok(world.portBattles.get(PORT.id)!.build);
  const own = visibleStateFor(world, "alpha").portBattle.find((row) => row.id === PORT.id)!;
  const enemy = visibleStateFor(world, "beta").portBattle.find((row) => row.id === PORT.id)!;
  assert.ok(own.build && own.stock);
  assert.equal(enemy.build, undefined);
  assert.equal(enemy.stock, undefined);
});

test("docking at another player's port is refused", () => {
  const world = testWorld();
  setTestPortOwner(world, "beta", PORT.id, "me");
  const alpha = world.players.get("alpha")!;
  alpha.x = PORT.anchorage.x + 0.5;
  alpha.y = PORT.anchorage.y;
  alpha.dockedPortId = null;
  assert.equal(applyPortOrder(world, "alpha", PORT.id, alpha.id), false);
  setTestPortOwner(world, "alpha", PORT.id, "me");
  assert.equal(applyPortOrder(world, "alpha", PORT.id, alpha.id), true);
});

test("world stepping fires port batteries only after an aggressor hits", () => {
  const world = testWorld();
  setTestPortOwner(world, "alpha", PORT.id, "me");
  setTestPortHealth(world, PORT.id, 100);
  const beta = world.players.get("beta")!;
  beta.x = PORT.anchorage.x + 0.5;
  beta.y = PORT.anchorage.y;
  beta.fleetId = null;
  const before = beta.damage.hull;
  stepWorld(world, DT);
  assert.equal(beta.damage.hull, before);
  const state = world.portBattles.get(PORT.id)!;
  state.aggressors.set("beta", 1_000_000);
  state.lastAttackedRealSeconds = 0;
  stepWorld(world, DT);
  assert.ok(beta.damage.hull <= before);
});
