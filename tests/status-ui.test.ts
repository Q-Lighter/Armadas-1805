// 3E-c: end-screen fitting, resign choices, stats and flagship markers.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  eliminatedAssetsText,
  eliminatedByText,
  eliminatedTitle,
  endScreenLayout,
  resignRecipients,
  statsRows,
  victoryRows,
} from "@naval/shared/status-ui";
import { buildFleetRow } from "@naval/shared/fleet-view";
import {
  addPlayer,
  createWorld,
  giveSpareShips,
  setPlayerName,
  sinkPlayerFlagship,
  stepWorld,
  visibleStateFor,
  type World,
} from "@naval/shared/world";

const VIEWPORTS = [
  [360, 740],
  [412, 915],
  [740, 360],
  [768, 1024],
  [1280, 800],
] as const;

function world(): World {
  return createWorld("test-status-ui");
}

function player(w: World, id: string, navy: "British" | "French" = "British") {
  setPlayerName(w, id, id === "a" ? "Captain A" : "Captain B");
  return addPlayer(w, id, "frigate", 10_000, navy);
}

test("all three end screens fit and scroll at every review viewport", () => {
  for (const [width, height] of VIEWPORTS) {
    const layout = endScreenLayout(width, height);
    assert.equal(layout.minTargetPx, 44);
    assert.equal(layout.scrolls, true);
    assert.ok(layout.contentWidth <= width, `${width}x${height} width`);
    assert.ok(layout.maxHeight <= height, `${width}x${height} height`);
    assert.ok(layout.maxHeight >= 300, `${width}x${height} needs usable height`);
    if (width <= 640) assert.equal(layout.compact, true);
  }
});

test("resign choices put the teammate first and never include yourself", () => {
  const { choices, nobodyLabel } = resignRecipients([
    { id: "me", name: "Me", navy: "British" },
    { id: "enemy", name: "Enemy", navy: "French" },
    { id: "mate", name: "Mate", navy: "British" },
  ], "me", "mate");
  assert.deepEqual(choices.map((choice) => choice.id), ["mate", "enemy"]);
  assert.equal(choices[0]!.isTeammate, true);
  assert.equal(nobodyLabel, "Nobody");
});

test("eliminated and asset lines are clear and whole", () => {
  assert.equal(
    eliminatedTitle("Dreadnought", "sunk"),
    "Your flagship Dreadnought was sunk. You are out of the game.",
  );
  assert.equal(eliminatedTitle(null, "captured"),
    "Your flagship was captured. You are out of the game.");
  assert.equal(eliminatedByText(["B (French)"]), "Defeated by B (French).");
  assert.equal(eliminatedByText([]), "No one defeated you.");
  assert.match(eliminatedAssetsText(["B"], 4, 12_000), /4 remaining ships/);
  assert.match(eliminatedAssetsText([], 2, 0), /abandoned/);
});

test("stats rows round awkward floats and never print decimals", () => {
  const rows = statsRows({
    shipsSunk: 3.6, shipsCaptured: 1.2, shipsLost: 2.8,
    flagshipsDestroyed: 1.1, shotsFired: 1234.7, shotsHit: 456.2,
    damageDealtPounds: 98765.4, crewKilled: 262.8, prisonersTaken: 42.9,
    shipsBought: 2.4, moneyEarned: 12345.6, moneySpent: 6789.1,
    distanceSailedKm: 543.6, gameDaysPlayed: 12.34,
    flagshipSurvivedRealSeconds: 185.4,
  });
  const values = new Map(rows.map((row) => [row.label, row.value]));
  assert.equal(values.get("Ships sunk"), "4");
  assert.equal(values.get("Shots fired"), "1,235");
  assert.equal(values.get("Damage dealt"), "98,765 lb");
  assert.equal(values.get("Money earned"), "12,346");
  assert.equal(values.get("Distance sailed"), "544 km");
  assert.equal(values.get("Game days"), "12.3");
  assert.equal(values.get("Flagship survived"), "3.1 min");
  assert.ok(rows.every((row) => !/\d\.\d{3,}/.test(row.value)));
});

test("victory rows keep every player's flagship, exit and stats", () => {
  const rows = victoryRows([
    {
      id: "a", name: "A", navy: "British", flagshipName: "Dreadnought",
      left: "won", winner: true,
      stats: {
        shipsSunk: 1, shipsCaptured: 0, shipsLost: 0, flagshipsDestroyed: 0,
        shotsFired: 2, shotsHit: 1, damageDealtPounds: 20, crewKilled: 3,
        prisonersTaken: 0, shipsBought: 1, moneyEarned: 10, moneySpent: 5,
        distanceSailedKm: 12, gameDaysPlayed: 1, flagshipSurvivedRealSeconds: 60,
      },
    },
    {
      id: "b", name: "B", navy: "French", flagshipName: null,
      left: "sunk", winner: false,
      stats: {
        shipsSunk: 0, shipsCaptured: 0, shipsLost: 1, flagshipsDestroyed: 0,
        shotsFired: 1, shotsHit: 0, damageDealtPounds: 0, crewKilled: 0,
        prisonersTaken: 0, shipsBought: 0, moneyEarned: 0, moneySpent: 0,
        distanceSailedKm: 3, gameDaysPlayed: 1, flagshipSurvivedRealSeconds: 30,
      },
    },
  ]);
  assert.equal(rows[0]!.winner, true);
  assert.equal(rows[1]!.flagshipName, "—");
  assert.equal(rows[1]!.left, "sunk");
  assert.ok(rows.every((row) => row.stats.length === 15));
});

test("the flagship flag is only on the player's own flagship", () => {
  const w = world();
  const a = player(w, "a");
  giveSpareShips(w, "a", 1);
  const state = visibleStateFor(w, "a");
  const rows = state.fleet.map((ship) => buildFleetRow(ship, null));
  assert.equal(rows.filter((row) => row.isFlagship).length, 1);
  assert.equal(rows.find((row) => row.isFlagship)!.id, a.id);
  assert.equal(rows.filter((row) => !row.isFlagship).length, 1);
});

test("stats and victory state never leak during play, only after elimination", () => {
  const w = world();
  const a = player(w, "a");
  const b = player(w, "b", "French");
  const before = JSON.stringify(visibleStateFor(w, "b"));
  assert.ok(!before.includes('"out"'));
  assert.ok(!before.includes('"go"'));
  assert.ok(!before.includes('"stats"'));
  assert.ok(!before.includes('"flagshipName"'));

  w.damageCredits.set(a.id, [{ playerId: "b", navy: "French", atRealMs: 10 }]);
  sinkPlayerFlagship(w, "a");
  stepWorld(w, 14.4);
  assert.ok(w.gameOver, "two navies and one flagship left must end the game");
  const aState = visibleStateFor(w, "a");
  const bState = visibleStateFor(w, "b");
  assert.equal(aState.out?.reason, "sunk");
  assert.equal(aState.out?.flagshipName, a.name);
  assert.equal(bState.out, undefined, "B must not receive A's private ending");
  assert.equal(bState.go?.navy, "French");
  assert.ok(!JSON.stringify(bState).includes('"out"'));
  assert.equal(bState.roster?.some((entry) => entry.id === "a"), false);
  assert.ok(bState.go?.players.every((entry) => typeof entry.stats.shipsSunk === "number"));
});
