// 3E server rules: flagship loss, credit, inheritance, resign and victory.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptShipSurrender,
  addPlayer,
  applyOrder,
  createWorld,
  giveSpareShips,
  playerName,
  removePlayer,
  resignPlayer,
  setPlayerName,
  shipsForOwner,
  sinkPlayerFlagship,
  spawnTestEnemyFleet,
  startShipSurrender,
  stepWorld,
  visibleStateFor,
  type World,
} from "@naval/shared/world";

function world(): World {
  return createWorld("test-elimination");
}

function player(w: World, id: string, navy: "British" | "French" = "British") {
  return addPlayer(w, id, "frigate", 50_000, navy);
}

test("sinking a flagship credits the last enemy damage and hands over the fleet", () => {
  const w = world();
  const a = player(w, "a");
  player(w, "b", "French");
  giveSpareShips(w, "a", 2);
  w.owners.get("a")!.money = 1_000;
  w.damageCredits.set(a.id, [{ playerId: "b", navy: "French", atRealMs: 10 }]);
  assert.equal(sinkPlayerFlagship(w, "a"), true);
  stepWorld(w, 14.4);
  const gone = w.playerRecords.get("a")!;
  assert.equal(gone.eliminated?.reason, "sunk");
  assert.deepEqual(gone.eliminated?.byIds, ["b"]);
  assert.deepEqual(gone.eliminated?.heirIds, ["b"]);
  assert.equal(shipsForOwner(w, "a").length, 0);
  assert.equal(shipsForOwner(w, "b").length, 3);
  assert.equal(w.owners.get("b")!.money, 51_000);
  assert.equal(w.gameOver?.navy, "French");
  assert.equal(w.gameOver?.winnerIds.includes("b"), true);
});

test("friendly fire is never credited", () => {
  const w = world();
  const a = player(w, "a");
  player(w, "b");
  w.damageCredits.set(a.id, [{ playerId: "b", navy: "British", atRealMs: 10 }]);
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.deepEqual(w.playerRecords.get("a")!.eliminated?.byIds, []);
  assert.equal(w.playerRecords.get("a")!.eliminated?.shipsGiven, 0);
});

test("a teammate inherits before anyone else, even over 30 ships", () => {
  const w = world();
  const a = player(w, "a");
  player(w, "mate");
  giveSpareShips(w, "a", 10);
  const template = shipsForOwner(w, "a")[1]!;
  for (let index = 0; index < 21; index += 1) {
    shipsForOwner(w, "a").push({ ...template, id: `${template.id}-copy-${index}` } as typeof template);
  }
  assert.equal(shipsForOwner(w, "a").length, 32);
  w.owners.get("a")!.money = 500;
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.deepEqual(w.playerRecords.get("a")!.eliminated?.heirIds, ["mate"]);
  assert.equal(shipsForOwner(w, "mate").length, 32);
  assert.equal(w.owners.get("mate")!.money, 50_500);
  assert.equal(w.gameOver, null, "one navy never wins");
});

test("with no teammate and no victor, ships are abandoned and money is lost", () => {
  const w = world();
  const a = player(w, "a");
  giveSpareShips(w, "a", 2);
  w.owners.get("a")!.money = 500;
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.equal(w.abandonedShips.length, 2);
  assert.ok(w.abandonedShips.every((ship) => ship.crew === 0 && !ship.isFlagship));
  assert.equal(w.owners.get("a")!.money, 0);
  assert.equal(w.playerRecords.get("a")!.eliminated?.shipsGiven, 0);
  assert.equal(w.gameOver, null);
});

test("a lone victor receives everything with no teammate", () => {
  const w = world();
  player(w, "a");
  player(w, "b", "French");
  giveSpareShips(w, "a", 2);
  w.damageCredits.set(w.playerRecords.get("a")!.flagshipId!, [
    { playerId: "b", navy: "French", atRealMs: 10 },
  ]);
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.equal(shipsForOwner(w, "b").length, 3);
  assert.deepEqual(w.playerRecords.get("a")!.eliminated?.heirIds, ["b"]);
});

test("surrender of a flagship eliminates its owner and moves the flagship", () => {
  const w = world();
  const a = player(w, "a");
  const b = player(w, "b", "French");
  a.x = b.x + 0.5;
  a.y = b.y;
  assert.equal(w.playerRecords.get("a")!.flagshipId, a.id);
  assert.equal(startShipSurrender(w, "a", a), true);
  assert.equal(acceptShipSurrender(w, "b", a.id), true);
  assert.equal(w.playerRecords.get("a")!.eliminated?.reason, "surrendered");
  assert.equal(shipsForOwner(w, "b").some((ship) => ship.id === a.id), true);
  assert.equal(a.isFlagship, false);
  assert.equal(w.gameOver?.navy, "French");
});

test("resigning sends the flagship and assets to the chosen enemy, or nobody", () => {
  const w = world();
  const a = player(w, "a");
  player(w, "b", "French");
  giveSpareShips(w, "a", 1);
  w.owners.get("a")!.money = 300;
  assert.equal(resignPlayer(w, "a", "b"), true);
  assert.equal(w.playerRecords.get("a")!.eliminated?.reason, "resigned");
  assert.equal(shipsForOwner(w, "b").length, 3);
  assert.equal(w.owners.get("b")!.money, 50_300);
  assert.equal(shipsForOwner(w, "b").filter((ship) => ship.isFlagship).length, 1);

  const other = world();
  player(other, "a");
  giveSpareShips(other, "a", 1);
  assert.equal(resignPlayer(other, "a", null), true);
  assert.equal(other.abandonedShips.length, 2);
  assert.equal(other.playerRecords.get("a")!.eliminated?.heirIds.length, 0);
});

test("a navy is eliminated, the last navy wins, and the world and orders stop", () => {
  const w = world();
  player(w, "a");
  player(w, "b", "French");
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.ok((w.notices.get("b") ?? []).some((line) => /Navy British eliminated/.test(line)));
  assert.equal(w.gameOver?.navy, "French");
  const tick = w.tick;
  const x = w.players.get("b")!.x;
  stepWorld(w, 1_000);
  assert.equal(w.tick, tick);
  assert.equal(w.players.get("b")!.x, x);
  assert.equal(applyOrder(w, "b", 10, 10), false);
});

test("a one-navy room never ends, and absent-player removal is not elimination", () => {
  const w = world();
  player(w, "a");
  player(w, "mate");
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.equal(w.gameOver, null);
  assert.equal(removePlayer(w, "mate"), true);
  assert.equal(w.playerRecords.has("mate"), false);
  assert.equal(w.playerRecords.get("a")!.eliminated?.reason, "sunk");
});

test("dummies never count for elimination or victory", () => {
  const w = world();
  player(w, "a");
  assert.equal(spawnTestEnemyFleet(w, "a", "flagship:1"), 1);
  assert.equal(w.playerRecords.size, 1);
  assert.equal(w.gameOver, null);
  assert.equal(w.players.size, 1);
});

test("the eliminated state is private and no stats leak during play", () => {
  const w = world();
  player(w, "a");
  player(w, "mate");
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  const own = visibleStateFor(w, "a");
  const other = visibleStateFor(w, "mate");
  assert.equal(own.out?.reason, "sunk");
  assert.ok(own.out?.stats);
  assert.equal(other.out, undefined);
  assert.equal(other.go, undefined);
  assert.doesNotMatch(JSON.stringify(other), /flagshipSurvivedRealSeconds/);
});

test("display names reach the elimination notice and the final table", () => {
  const w = world();
  player(w, "a");
  player(w, "b", "French");
  assert.equal(setPlayerName(w, "a", "Avery"), true);
  assert.equal(setPlayerName(w, "b", "Beau"), true);
  assert.equal(playerName(w, "a"), "Avery");
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.ok((w.notices.get("b") ?? []).some((line) => /Avery \(British\) was eliminated/.test(line)));
  assert.equal(w.gameOver?.players.find((entry) => entry.id === "b")?.name, "Beau");
});
