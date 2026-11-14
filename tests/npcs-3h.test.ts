// 3H c: neutral traffic, privateer contracts, looting and replacement.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { buildStateDelta, decodeStateDelta, encodeStateDelta } from "@naval/shared/state-delta";
import {
  addPlayer,
  boardingOddsFor,
  createWorld,
  hirePrivateer,
  lootNpcShip,
  npcSummary,
  setPrivateerMode,
  stepWorld,
  updateNpcs,
  visibleStateFor,
} from "@naval/shared/world";

function room() {
  return createWorld("test", { npcs: true });
}

function moveTo(ship: { x: number; y: number }, x: number, y: number): void {
  ship.x = x;
  ship.y = y;
}

test("neutral traffic has 12 merchants, two whaling groups and three privateers", () => {
  const world = room();
  assert.equal(world.npcEnabled, true);
  assert.equal(world.npcShips.length,
    settings.npcs.merchantCount +
    settings.npcs.whalerGroupSizes.reduce((sum, size) => sum + size, 0) +
    settings.npcs.privateerCount);

  const merchants = world.npcShips.filter((ship) => ship.npcKind === "merchant");
  const whalers = world.npcShips.filter((ship) => ship.npcKind === "whaler");
  const privateers = world.npcShips.filter((ship) => ship.npcKind === "privateer");
  assert.equal(merchants.length, 12);
  assert.equal(privateers.length, 3);
  assert.equal(whalers.length, 5);

  const groups = new Map<string, number>();
  for (const whaler of whalers) groups.set(whaler.npcGroupId ?? "", (groups.get(whaler.npcGroupId ?? "") ?? 0) + 1);
  assert.deepEqual([...groups.values()].sort(), [2, 3]);
  for (const merchant of merchants) {
    assert.ok(merchant.stores.cargo.hides + merchant.stores.cargo.sugar +
      merchant.stores.cargo.tobacco + merchant.stores.cargo.coffee +
      merchant.stores.cargo.rum + merchant.stores.cargo.silver +
      merchant.stores.cargo.whaleOil > 0);
  }
  for (const whaler of whalers) assert.ok((whaler.stores.cargo.whaleOil ?? 0) > 0);
  assert.deepEqual(
    world.npcShips.map((ship) => ship.navy),
    Array(world.npcShips.length).fill("British"),
  );
});

test("&npc=0 creates no neutral traffic and the layer stays empty", () => {
  const world = createWorld("test", { npcs: false });
  assert.equal(world.npcEnabled, false);
  assert.equal(world.npcShips.length, 0);
  const player = addPlayer(world, "alpha");
  for (let tick = 0; tick < 40; tick += 1) stepWorld(world, 2);
  assert.equal(world.npcShips.length, 0);
  assert.equal(player.damage.hull > 0, true);
});

test("the 2 Hz brain gives neutral hulls a route and a privateer contract can be hired", () => {
  const world = room();
  const player = addPlayer(world, "alpha");
  world.owners.get("alpha")!.money = 5_000;
  const merchant = world.npcShips.find((ship) => ship.npcKind === "merchant")!;
  const privateer = world.npcShips.find((ship) => ship.npcKind === "privateer")!;
  moveTo(privateer, player.x + 0.3, player.y + 0.2);
  privateer.damage.hull = 100;

  assert.equal(hirePrivateer(world, "alpha", privateer.id, "escort", player.id), true);
  assert.equal(privateer.npcHiredBy, "alpha");
  assert.equal(privateer.npcMode, "escort");
  assert.equal(world.owners.get("alpha")!.money, 5_000 - settings.npcs.escortFee);
  assert.equal(privateer.npcContractUntilGameMs,
    world.gameMs + settings.npcs.contractGameDays * settings.time.hoursPerDay * 3600 * 1000);

  assert.equal(setPrivateerMode(world, "alpha", privateer.id, "raid"), true);
  assert.equal(privateer.npcMode, "raid");

  for (let tick = 0; tick < 120; tick += 1) stepWorld(world, 1);
  assert.ok(merchant.route || merchant.order, "merchant should receive a course from the neutral brain");
  assert.ok(privateer.npcContractUntilGameMs! > world.gameMs);
});

test("a privateer contract expires and its hull returns to patrol", () => {
  const world = room();
  const player = addPlayer(world, "alpha");
  world.owners.get("alpha")!.money = 5_000;
  const privateer = world.npcShips.find((ship) => ship.npcKind === "privateer")!;
  moveTo(privateer, player.x + 0.2, player.y);
  assert.equal(hirePrivateer(world, "alpha", privateer.id, "raid"), true);
  world.gameMs = privateer.npcContractUntilGameMs!;
  world.npcLastBrainGameMs = 0;
  updateNpcs(world);
  assert.equal(privateer.npcHiredBy, null);
  assert.equal(privateer.npcMode, "patrol");
  assert.equal(world.owners.get("alpha")!.money, 5_000 - settings.npcs.privateerFee);
});

test("the binary delta keeps neutral flags and kind", () => {
  const world = room();
  const player = addPlayer(world, "alpha");
  const merchant = world.npcShips.find((ship) => ship.npcKind === "merchant")!;
  moveTo(merchant, player.x + 0.2, player.y);
  const before = visibleStateFor(world, "alpha");
  merchant.x += 0.5;
  const after = visibleStateFor(world, "alpha");
  const delta = decodeStateDelta(encodeStateDelta(buildStateDelta(before, after, 2)));
  const row = delta.ships.find((ship) => ship[0] === merchant.id);
  assert.ok(row);
  assert.equal(row![9], 1);
  assert.equal(row![10], "merchant");
});

test("neutral cargo is absent from public state and loot only moves after boarding", () => {
  const world = room();
  const player = addPlayer(world, "alpha");
  const merchant = world.npcShips.find((ship) => ship.npcKind === "merchant")!;
  moveTo(merchant, player.x + 0.2, player.y + 0.1);
  const before = merchant.stores.cargo.whaleOil + merchant.stores.cargo.sugar +
    merchant.stores.cargo.hides + merchant.stores.cargo.tobacco +
    merchant.stores.cargo.coffee + merchant.stores.cargo.rum +
    merchant.stores.cargo.silver;
  assert.ok(before > 0);

  const state = visibleStateFor(world, "alpha");
  const contact = state.npcs?.find((entry) => entry.id === merchant.id);
  assert.ok(contact);
  assert.deepEqual(Object.keys(contact!).sort(),
    ["contractRemainingGameSeconds", "fee", "groupId", "hiredBy", "homePortId", "id", "kind", "mode"]);
  assert.equal(JSON.stringify(contact).includes("cargo"), false);
  const row = state.ships.find((entry) => entry[0] === merchant.id);
  assert.equal(row?.[9], 1);
  assert.equal(row?.[10], "merchant");

  assert.equal(lootNpcShip(world, "alpha", merchant.id, player.id), false);
  merchant.abandoned = true;
  world.abandonedShips.push(merchant);
  assert.equal(lootNpcShip(world, "alpha", merchant.id, player.id), true);
  const after = merchant.stores.cargo.whaleOil + merchant.stores.cargo.sugar +
    merchant.stores.cargo.hides + merchant.stores.cargo.tobacco +
    merchant.stores.cargo.coffee + merchant.stores.cargo.rum +
    merchant.stores.cargo.silver;
  assert.ok(after < before);
  assert.equal(merchant.npcLooted, true);
  assert.ok(world.npcShips.some((ship) => ship.id === merchant.id), "loot and leave keeps the hull afloat");
  assert.equal(lootNpcShip(world, "alpha", merchant.id, player.id), false);
});

test("a neutral merchant can be boarded despite sharing the player's navy", () => {
  const world = room();
  const player = addPlayer(world, "alpha");
  const merchant = world.npcShips.find((ship) => ship.npcKind === "merchant")!;
  moveTo(merchant, player.x + 1, player.y);
  assert.equal(merchant.navy, player.navy);
  assert.notEqual(boardingOddsFor(world, "alpha", player.id, merchant.id), null);
});

test("a lost neutral hull is replaced after thirty real minutes", () => {
  const world = room();
  addPlayer(world, "alpha");
  const merchant = world.npcShips.find((ship) => ship.npcKind === "merchant")!;
  const originalCount = world.npcShips.length;
  merchant.damage.hull = 0;
  world.gameMs += settings.time.sailingTimeScale * 1000;
  world.npcLastBrainGameMs = 0;
  updateNpcs(world);
  assert.equal(world.npcShips.length, originalCount - 1);
  assert.equal(world.npcReplacements.length, 1);
  assert.equal(world.npcReplacements[0]!.dueGameMs,
    world.gameMs + settings.npcs.replacementRealMinutes * 60 * 1000 * settings.time.sailingTimeScale);

  world.gameMs = world.npcReplacements[0]!.dueGameMs;
  world.npcLastBrainGameMs = 0;
  updateNpcs(world);
  assert.equal(world.npcShips.length, originalCount);
  assert.equal(world.npcReplacements.length, 0);
  assert.equal(npcSummary(world).length, originalCount);
});
