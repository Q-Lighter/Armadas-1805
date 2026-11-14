// Part C: fire ship card, target mode and five-viewport layout rules.

import assert from "node:assert/strict";
import { test } from "node:test";

import { shipyardCards } from "@naval/shared/fleet-view";
import {
  fireShipCardActions,
  fireShipLayoutPlan,
  fireShipStatusText,
} from "@naval/shared/fire-ship-ui";
import {
  addPlayer,
  createWorld,
  spawnTestFireShips,
  visibleStateFor,
  type OwnShipSnapshot,
} from "@naval/shared/world";

const VIEWPORTS = [
  [360, 740],
  [412, 915],
  [740, 360],
  [768, 1024],
  [1_280, 800],
] as const;

function row(overrides: Partial<OwnShipSnapshot> = {}): OwnShipSnapshot {
  return {
    id: "ship-1",
    name: "Brand",
    classId: "fireShip",
    navy: "British",
    crew: 4,
    fullCrew: 4,
    status: "sailing",
    portId: null,
    deliveryLeftMs: 0,
    x: 0,
    y: 0,
    stores: {} as OwnShipSnapshot["stores"],
    capacities: {} as OwnShipSnapshot["capacities"],
    cargoUsed: 0,
    provisionsDays: 10,
    starving: false,
    lightsOn: true,
    ...overrides,
  };
}

test("3G fire ship card offers ignite, contact, cancel, tow, cast off and lights", () => {
  const idle = fireShipCardActions(row(), true);
  assert.deepEqual(idle.map((action) => action.id), [
    "igniteNow", "igniteContact", "lightsOff",
  ]);
  assert.equal(idle[0]!.confirm, true);

  const contact = fireShipCardActions(row({ fireShipMode: "contact", fireShipTargetId: "enemy" }));
  assert.deepEqual(contact.map((action) => action.id), [
    "igniteNow", "igniteContact", "cancelContact", "lightsOff",
  ]);

  const towed = fireShipCardActions(row({ towedBy: "tower" }));
  assert.deepEqual(towed.map((action) => action.id), [
    "igniteNow", "igniteContact", "castOff", "lightsOff",
  ]);
  assert.equal(towed[0]!.disabled, true);
  assert.equal(towed[0]!.reason, "Cast off first");
  assert.notEqual(towed[2]!.disabled, true);
  assert.equal(fireShipStatusText(row({ towedBy: "tower" })),
    "In tow · only Cast off is accepted · Lights: On");

  const tower = fireShipCardActions(row({ classId: "frigate", towingId: "fire" }));
  assert.deepEqual(tower.map((action) => action.id), ["tow", "castOff", "lightsOff"]);
  assert.equal(tower[0]!.disabled, true);
  assert.equal(tower[0]!.reason, "Already towing a fire ship");
  assert.equal(fireShipStatusText(row({ classId: "frigate", towingId: "fire" }), "Brand"),
    "Towing Brand · Lights: On");

  const noTow = fireShipCardActions(row({ classId: "line" }), false);
  const noTowButton = noTow.find((action) => action.id === "tow");
  assert.ok(noTowButton);
  assert.equal(noTowButton.disabled, true);
  assert.equal(noTowButton.reason, "No unlit fire ship within 300 m");
  const lightsOff = fireShipCardActions(row({ classId: "flagship", lightsOn: false }));
  assert.equal(lightsOff.some((action) => action.id === "lightsOn"), true);
});

test("3G buy list shows Fire ship, 500 and locks it only outside test and dev", () => {
  const testCards = shipyardCards("test", "small", "British");
  const testFire = testCards.find((card) => card.classId === "fireShip")!;
  assert.equal(testFire.name, "Fire ship");
  assert.equal(testFire.price, 500);
  assert.equal(testFire.locked, false);

  const normal = shipyardCards("normal", "small", "British")
    .find((card) => card.classId === "fireShip")!;
  assert.equal(normal.price, 500);
  assert.equal(normal.locked, true);

  const large = shipyardCards("normal", "large", "French")
    .find((card) => card.classId === "fireShip")!;
  assert.equal(large.locked, true);
});

test("3G card, target sheet and test tools fit and scroll at five viewports", () => {
  for (const [width, height] of VIEWPORTS) {
    const plan = fireShipLayoutPlan(width, height);
    assert.equal(plan.scroll, true);
    assert.equal(plan.buttonMinHeightPx, 44);
    assert.ok(plan.columns === 1 || plan.columns === 2);
    assert.ok(plan.maxHeightShare > 0 && plan.maxHeightShare <= 1);
    assert.ok(plan.buttonMinHeightPx <= Math.min(width, height));
  }
  assert.equal(fireShipLayoutPlan(360, 740).band, "phone");
  assert.equal(fireShipLayoutPlan(740, 360).band, "phone");
  assert.equal(fireShipLayoutPlan(768, 1024).band, "tablet");
  assert.equal(fireShipLayoutPlan(1_280, 800).band, "desk");
  assert.equal(fireShipLayoutPlan(1_280, 800).columns, 2);
});

test("3G the action model has a cancel path in both target modes", () => {
  const idle = fireShipCardActions(row());
  assert.equal(idle.some((action) => action.id === "igniteContact"), true);
  const active = fireShipCardActions(row({ fireShipMode: "contact", fireShipTargetId: "e" }));
  assert.equal(active.some((action) => action.id === "cancelContact"), true);
  assert.equal(fireShipStatusText(row({ fireShipMode: "contact" })), "Contact attack · steering for the target · Lights: On");
});

test("3G another player sees only navy and class for my fire ship", () => {
  const world = createWorld("test-fire-privacy");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  addPlayer(world, "beta", "frigate", 50_000, "French");
  spawnTestFireShips(world, "alpha", 1);
  const alphaFire = world.fleets.get("alpha")!
    .find((ship) => ship.classId === "fireShip");
  assert.ok(alphaFire);
  const seen = visibleStateFor(world, "beta").ships
    .find((ship) => ship[0] === alphaFire.id);
  assert.ok(seen);
  assert.equal(seen.length, 11);
  assert.equal(seen[1], "fireShip");
  assert.equal(seen[6], "British");
  const ownView = visibleStateFor(world, "alpha").fleet
    .find((ship) => ship.id === alphaFire.id)!;
  assert.equal(ownView.name, alphaFire.name);
  assert.equal(ownView.fireShipIgnited, false);
});
