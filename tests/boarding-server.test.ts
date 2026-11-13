// Part B: 3D orders and world-loop behaviour.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  boardingOddsFor,
  chooseCapturedCrew,
  claimPlayerShip,
  createWorld,
  orderBoarding,
  setAutoBoard,
  setTestEnemyCrew,
  setTestFire,
  shipsForOwner,
  spawnTestAbandoned,
  spawnTestEnemyFleet,
  stepWorld,
  transferPlayerCrew,
  visibleStateFor,
} from "@naval/shared/world";

function world() {
  return createWorld("test-boarding");
}

test("crew transfer is limited by range and the 10% donor floor", () => {
  const w = world();
  const first = addPlayer(w, "p");
  spawnTestEnemyFleet(w, "p", "frigate:1");
  const receiver = w.botFleets.get("TEST-ENEMY")![0]!;
  w.botFleets.delete("TEST-ENEMY");
  w.fleets.get("p")!.push(receiver);
  first.crew = 100;
  receiver.crew = 0;
  receiver.x = first.x + 0.1;
  receiver.y = first.y;
  assert.equal(transferPlayerCrew(w, "p", first.id, receiver.id, 70), true);
  assert.equal(first.crew, 30);
  assert.equal(receiver.crew, 70);
  assert.equal(transferPlayerCrew(w, "p", first.id, receiver.id, 2), false);
  receiver.x = first.x + 1;
  assert.equal(transferPlayerCrew(w, "p", first.id, receiver.id, 2), false);
});

test("a ship that falls below minimum crew becomes abandoned and decays", () => {
  const w = world();
  const ship = addPlayer(w, "p");
  ship.crew = 1;
  ship.damage.crew = 1;
  stepWorld(w, 14.4);
  assert.equal(ship.abandoned, true);
  assert.equal(shipsForOwner(w, "p").some((candidate) => candidate.id === ship.id), false);
  assert.ok(w.abandonedShips.some((candidate) => candidate.id === ship.id));
  assert.equal(w.playerRecords.get("p")?.eliminated?.reason, "abandoned");
  assert.ok((w.notices.get("p") ?? []).some((line) => /flagship .* was abandoned/.test(line)));
  const before = ship.damage.hull;
  stepWorld(w, 144);
  assert.ok(ship.damage.hull < before);
});

test("a never-crewed ship stays owned with needs crew and is not abandoned", () => {
  const w = world();
  const ship = addPlayer(w, "p");
  ship.crew = 0;
  ship.hadMinimumCrew = false;
  ship.damage.crew = 0;
  stepWorld(w, 14.4);
  assert.equal(ship.abandoned, undefined);
  assert.ok(shipsForOwner(w, "p").some((candidate) => candidate.id === ship.id));
});

test("claim needs range, keeps damage and moves colours even over 30 ships", () => {
  const w = world();
  const donor = addPlayer(w, "p");
  assert.equal(spawnTestAbandoned(w, "p", "frigate:1"), 1);
  const prize = w.abandonedShips[0]!;
  prize.x = donor.x + 0.1;
  prize.y = donor.y;
  donor.crew = 100;
  const hull = prize.damage.hull;
  assert.equal(claimPlayerShip(w, "p", prize.id, donor.id), true);
  assert.equal(prize.navy, donor.navy);
  assert.equal(prize.damage.hull, hull);
  assert.equal(prize.crew, Math.max(1, Math.ceil(prize.fullCrew * settings.ships.minimumCrewShare)));
  assert.ok(shipsForOwner(w, "p").some((ship) => ship.id === prize.id));
  assert.equal(w.abandonedShips.some((ship) => ship.id === prize.id), false);
  // Claiming is allowed over 30 ships; only buying is capped.
  while (shipsForOwner(w, "p").length < settings.ships.maxShipsPerPlayer) {
    shipsForOwner(w, "p").push({ ...donor, id: `extra-${shipsForOwner(w, "p").length}` } as typeof donor);
  }
  const secondPrize = { ...prize, id: "prize-2", crew: 0, abandoned: true } as typeof prize;
  w.abandonedShips.push(secondPrize);
  assert.equal(claimPlayerShip(w, "p", secondPrize.id, donor.id), true);
  assert.equal(shipsForOwner(w, "p").length, settings.ships.maxShipsPerPlayer + 1);
});

test("boarding changes ownership, captures survivors and defaults to join", () => {
  const w = world();
  const attacker = addPlayer(w, "p");
  const target = addPlayer(w, "q", "frigate", 0, "French");
  target.x = attacker.x + 0.05;
  target.y = attacker.y;
  target.headingRad = attacker.headingRad;
  target.speedKnots = 0;
  attacker.speedKnots = 0;
  w.combatRandom = () => 0;
  assert.ok(boardingOddsFor(w, "p", attacker.id, target.id) !== null);
  assert.equal(orderBoarding(w, "p", attacker.id, target.id), true);
  for (let i = 0; i < 8; i += 1) stepWorld(w, 144 * 30);
  assert.ok(shipsForOwner(w, "p").some((ship) => ship.id === target.id));
  // The attacker wins at these odds; after 120 seconds the captured crew join.
  assert.equal(target.navy, attacker.navy);
  assert.ok(target.crew > 0);
  assert.equal(target.capturedCrew, 0);
  assert.equal(w.playerRecords.get("q")?.eliminated?.reason, "captured");
});

test("captured crew choices join, kill or take prisoners with a limit", () => {
  const w = world();
  const ship = addPlayer(w, "p");
  ship.capturedCrew = 100;
  ship.crew = 0;
  ship.hadMinimumCrew = false;
  assert.equal(chooseCapturedCrew(w, "p", ship.id, "join"), true);
  assert.equal(ship.crew, 100);
  assert.equal(ship.capturedCrew, 0);

  ship.capturedCrew = 100;
  ship.crew = 0;
  assert.equal(chooseCapturedCrew(w, "p", ship.id, "kill"), true);
  assert.equal(ship.crew, 0);
  assert.equal(ship.hadMinimumCrew, false);

  ship.capturedCrew = 100;
  ship.crew = 0;
  assert.equal(chooseCapturedCrew(w, "p", ship.id, "prisoners", 100), true);
  assert.equal(ship.prisoners, Math.floor(ship.fullCrew * settings.combat.capturedPrisonerMaxShare));
  assert.equal(ship.crew, 100 - ship.prisoners);
});

test("fire burns, damages, uses materials and is visible publicly as a flag only", () => {
  const w = world();
  const ship = addPlayer(w, "p");
  const watcher = addPlayer(w, "q");
  watcher.x = ship.x + 0.2;
  watcher.y = ship.y;
  assert.equal(setTestFire(w, "p", ship.id), true);
  const hull = ship.damage.hull;
  stepWorld(w, 144);
  assert.equal(ship.fire?.burning, true);
  assert.ok(ship.damage.hull < hull);
  const publicState = visibleStateFor(w, "q");
  assert.ok(publicState.burning?.includes(ship.id));
  assert.equal(publicState.fleet.some((entry) => entry.id === ship.id), false);
  const own = visibleStateFor(w, "p").fleet.find((entry) => entry.id === ship.id)!;
  assert.equal(typeof own.fireStrength, "number");
});

test("test helpers do not work in normal rooms", () => {
  const w = createWorld("main");
  const ship = addPlayer(w, "p");
  assert.equal(spawnTestAbandoned(w, "p", "frigate:1"), 0);
  assert.equal(setTestEnemyCrew(w, 20), 0);
  assert.equal(setTestFire(w, "p", ship.id), false);
  assert.equal(setAutoBoard(w, "p", ship.id, false), true);
  assert.equal(ship.autoBoard, false);
});
