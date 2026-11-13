// Pure 3E elimination, credit, inheritance and victory rules.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  damageCredit, directCredit, distributeByValue, naviesWithFlagships,
  reasonText, splitMoney, survivingTeammate, victoryFor,
} from "@naval/shared/elimination";

test("damage credit uses the last enemy damage inside the window", () => {
  const credits = [
    { playerId: "old", navy: "Spanish" as const, atRealMs: 100_000 },
    { playerId: "friend", navy: "British" as const, atRealMs: 690_000 },
    { playerId: "enemy", navy: "French" as const, atRealMs: 700_000 },
  ];
  assert.deepEqual(damageCredit({
    ownerId: "owner", ownerNavy: "British", credits, nowRealMs: 705_000,
  }), ["enemy"]);
  assert.deepEqual(damageCredit({
    ownerId: "owner", ownerNavy: "British",
    credits: [{ playerId: "friend", navy: "British", atRealMs: 700_000 }],
    nowRealMs: 705_000,
  }), []);
  assert.deepEqual(damageCredit({
    ownerId: "owner", ownerNavy: "British", credits, nowRealMs: 1_500_000,
  }), []);
  assert.deepEqual(directCredit("q"), ["q"]);
  assert.deepEqual(directCredit(null), []);
});

test("allies widen one credited player into the whole alliance", () => {
  assert.deepEqual(damageCredit({
    ownerId: "owner",
    ownerNavy: "British",
    credits: [{ playerId: "q", navy: "French", atRealMs: 1000 }],
    nowRealMs: 1001,
    alliesOf: (id) => id === "q" ? ["q", "ally"] : [],
  }), ["q", "ally"]);
});

test("inheritance splits odd ships by value across 2, 3 and 4 recipients", () => {
  const units = [900, 700, 500, 300, 100].map((value, index) => ({
    id: `s${index}`, value,
  }));
  const two = distributeByValue(units, ["a", "b"]);
  assert.equal(two.get("a")!.length + two.get("b")!.length, 5);
  assert.ok(Math.abs(two.get("a")!.length - two.get("b")!.length) <= 1);
  const three = distributeByValue(units, ["a", "b", "c"]);
  assert.equal([...three.values()].flat().length, 5);
  const four = distributeByValue(units, ["a", "b", "c", "d"]);
  assert.equal([...four.values()].flat().length, 5);
  // The largest unit goes to the first recipient, the next to the second.
  assert.deepEqual(two.get("a"), ["s0", "s3", "s4"]);
  assert.deepEqual(two.get("b"), ["s1", "s2"]);
  assert.deepEqual(splitMoney(100, ["a", "b", "c"]), new Map([
    ["a", 34], ["b", 33], ["c", 33],
  ]));
});

test("teammates inherit before the victor, and navies with flagships are counted", () => {
  const standings = [
    { id: "owner", navy: "British" as const, hasFlagship: true },
    { id: "mate", navy: "British" as const, hasFlagship: true },
    { id: "enemy", navy: "French" as const, hasFlagship: true },
  ];
  assert.equal(survivingTeammate("owner", "British", standings), "mate");
  assert.deepEqual(naviesWithFlagships(standings), ["British", "French"]);
  assert.equal(victoryFor(standings, 1), null);
  assert.deepEqual(victoryFor([
    { id: "owner", navy: "British" as const, hasFlagship: true },
    { id: "mate", navy: "British" as const, hasFlagship: true },
  ], 2), { navy: "British", playerIds: ["owner", "mate"] });
  assert.deepEqual(victoryFor([
    { id: "a", navy: "British" as const, hasFlagship: false },
    { id: "b", navy: "French" as const, hasFlagship: true },
  ], 2), { navy: "French", playerIds: ["b"] });
  assert.match(reasonText("blewUp"), /blown up/);
});
