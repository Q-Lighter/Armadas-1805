// TEMP-DEBUG tests for the dev-room computer ships.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { isSeaAt } from "@naval/shared/land";
import {
  addBots,
  botCountForRoom,
  botShipCount,
} from "@naval/shared/bots";
import {
  addPlayer,
  createWorld,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;

/** A small deterministic random source, so the spawn test is repeatable. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function devWorldWithBots(count: number) {
  const world = createWorld("dev-load");
  const human = addPlayer(world, "alpha");
  addBots(world, count, "alpha", seededRandom(1805));
  return { world, human };
}

test("bot counts are strictly limited and ignored outside dev rooms", () => {
  assert.equal(botCountForRoom("dev-load", null), 0);
  assert.equal(botCountForRoom("dev-load", "1"), 1);
  assert.equal(botCountForRoom("dev-load", "300"), 300);
  assert.equal(botCountForRoom("dev-load", "0"), null);
  assert.equal(botCountForRoom("dev-load", "301"), null);
  assert.equal(botCountForRoom("dev-load", "12.5"), null);
  assert.equal(botCountForRoom("dev-load", "many"), null);
  assert.equal(botCountForRoom("test-load", "100"), 0);
  assert.equal(botCountForRoom("normal", "100"), 0);
});

test("bots exist only in dev rooms and are split across eight fake players", () => {
  const normal = createWorld("normal");
  addPlayer(normal, "alpha");
  assert.equal(addBots(normal, 100, "alpha"), 0);
  assert.equal(botShipCount(normal), 0);

  const { world } = devWorldWithBots(100);
  assert.equal(botShipCount(world), 100);
  assert.equal(world.botFleets.size, settings.loadTest.fakePlayers);

  const fleets = [...world.botFleets.values()];
  assert.ok(fleets.every((fleet) => fleet.length >= 12));
  assert.ok(fleets.every((fleet) => fleet.every((ship) => ship.classId === "frigate")));
});

test("bots spawn at sea and choose sea destinations", () => {
  const { world } = devWorldWithBots(100);

  for (const fleet of world.botFleets.values()) {
    for (const ship of fleet) {
      assert.equal(isSeaAt(ship.x, ship.y), true);
      assert.ok(ship.order, "every bot starts with a destination");
      assert.equal(isSeaAt(ship.order!.x, ship.order!.y), true);
      const distance = Math.hypot(ship.order!.x - ship.x, ship.order!.y - ship.y);
      assert.ok(distance <= settings.sailing.maxOrderDistanceKm);
    }
  }
});

test("about a tenth of the bots start within 40 km of the first human", () => {
  const { world, human } = devWorldWithBots(100);
  let nearby = 0;
  for (const fleet of world.botFleets.values()) {
    for (const ship of fleet) {
      if (Math.hypot(ship.x - human.x, ship.y - human.y) <= 40) nearby += 1;
    }
  }
  assert.ok(nearby >= 8 && nearby <= 12, `expected about 10 bots nearby, got ${nearby}`);
});

test("bots pick a new sea destination when their order ends", () => {
  const { world } = devWorldWithBots(12);
  const ship = [...world.botFleets.values()][0]![0]!;

  ship.order = null;
  stepWorld(world, TICK);
  const order = ship.order as unknown as { x: number; y: number } | null;
  assert.ok(order, "a stopped bot gets a new order");
  assert.equal(isSeaAt(order.x, order.y), true);
});

test("bots keep sailing on water and their updates obey sight", () => {
  const { world } = devWorldWithBots(40);

  for (let tick = 0; tick < 40; tick += 1) stepWorld(world, TICK);

  for (const [ownerId, fleet] of world.botFleets) {
    const ownIds = new Set(fleet.map((ship) => ship.id));
    for (const ship of fleet) {
      assert.equal(isSeaAt(ship.x, ship.y), true, `${ship.id} ran aground`);
    }

    const state = visibleStateFor(world, ownerId);
    for (const [id, , x, y] of state.ships) {
      if (ownIds.has(id)) continue;
      assert.ok(
        fleet.some(
          (ship) =>
            (ship.x - x) ** 2 + (ship.y - y) ** 2 <=
            settings.fog.sightRangeKm ** 2,
        ),
        `${id} was leaked outside ${ownerId}'s sight`,
      );
    }

    const chart = world.charts.get(ownerId)!;
    assert.equal(chart.all, false, "fake players do real discovery");
    assert.ok(chart.bits.some((byte) => byte !== 0), "fake players discovered cells");
  }
});
