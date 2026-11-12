// Part A: pure 3D boarding, crew, abandonment, fire and friendly-fire rules.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createSeededRandom } from "@naval/shared/combat";
import {
  abandonedHullAfter,
  autoBoardingAllowed,
  boardingCasualties,
  boardingDurationSeconds,
  boardingOdds,
  boardingProblem,
  boardingStrength,
  canActWhileSinking,
  capturedChoiceAfterTimeout,
  capturedCrewPlan,
  claimAbandoned,
  claimCrewNeeded,
  explosionBlast,
  explosionChance,
  fightFire,
  fireDamage,
  fireSpreadChance,
  friendlyFireTarget,
  growFire,
  igniteFire,
  isFriendly,
  minimumCrewFor,
  outnumberedBoarding,
  prisonerBounty,
  prisonerLimit,
  provisionCrewEquivalent,
  roundedBoardingOdds,
  shouldAbandon,
  sinkingComplete,
  startSinking,
  transferCrew,
} from "@naval/shared/boarding";
import { settings } from "@naval/shared/settings";

const frigate = { crew: 230, fullCrew: 230 };

test("crew transfer keeps 10% on the donor and never exceeds full crew", () => {
  const donor = { crew: 100, fullCrew: 100 };
  const receiver = { crew: 0, fullCrew: 230 };
  assert.equal(minimumCrewFor(donor.fullCrew), 10);
  let result = transferCrew(donor, receiver, 90);
  assert.equal(result.ok, true);
  assert.equal(result.donorCrew, 10);
  assert.equal(result.receiverCrew, 90);
  assert.equal(transferCrew(donor, receiver, 91).problem, "donor keeps at least 10% crew");
  assert.equal(
    transferCrew({ crew: 230, fullCrew: 230 }, { crew: 0, fullCrew: 50 }, 60).problem,
    "receiver would exceed full crew",
  );
  assert.equal(transferCrew(donor, receiver, 0).problem, "amount must be a whole sailor count");
});

test("only a ship that once had minimum crew can become abandoned", () => {
  const old = { crew: 5, fullCrew: 230, hadMinimumCrew: true, abandoned: false };
  const newShip = { crew: 0, fullCrew: 230, hadMinimumCrew: false, abandoned: false };
  assert.equal(shouldAbandon(old), true);
  assert.equal(shouldAbandon(newShip), false, "a brand-new or uncrewed prize stays owned");
  assert.equal(shouldAbandon({ ...old, crew: 23 }), false);
});

test("abandoned decay is 1.5% of hull per game hour and stops at zero", () => {
  assert.ok(Math.abs(abandonedHullAfter(1000, 1000, 1) - 985) < 1e-9);
  assert.equal(abandonedHullAfter(10, 1000, 100), 0);
});

test("a first claim wins, refusal at 30 ships, and the donor keeps 10%", () => {
  const prize = { crew: 0, fullCrew: 230 };
  assert.equal(claimCrewNeeded(prize), 23);
  const base = {
    abandoned: true,
    fleetCount: 2,
    inRange: true,
    donor: { crew: 100, fullCrew: 100 },
    prize,
  };
  const claim = claimAbandoned(base);
  assert.equal(claim.ok, true);
  assert.equal(claim.donorCrew, 77);
  assert.equal(claim.prizeCrew, 23);
  assert.equal(claimAbandoned({ ...base, fleetCount: 30 }).problem, "fleet full (30 ships)");
  assert.equal(claimAbandoned({ ...base, inRange: false }).problem, "out of range");
  assert.equal(
    claimAbandoned({ ...base, donor: { crew: 25, fullCrew: 100 } }).problem,
    "donor keeps at least 10% crew",
  );
});

test("boarding odds use the squared strength ratio and round to 5%", () => {
  assert.equal(boardingOdds(100, 100), 0.5);
  assert.ok(Math.abs(boardingOdds(60, 40) - 0.6923076923) < 1e-6);
  assert.equal(boardingOdds(0, 100), 0);
  assert.equal(boardingOdds(100, 0), 1);
  assert.equal(roundedBoardingOdds(0.62), 60);
  assert.equal(boardingStrength(100), 100);
});

test("boarding requires range, speed match and a legal target", () => {
  const base = {
    distanceM: 50,
    speedDifferenceKnots: 1,
    attackerCrew: 200,
    attackerFullCrew: 230,
  };
  assert.equal(boardingProblem(base), null);
  assert.equal(boardingProblem({ ...base, distanceM: 61 }), "out of range");
  assert.equal(boardingProblem({ ...base, speedDifferenceKnots: 4 }), "speed must match within 3 knots");
  assert.equal(boardingProblem({ ...base, targetSurrendered: true }), "target surrendered");
  assert.equal(boardingProblem({ ...base, targetAbandoned: true }), "target abandoned");
  assert.equal(boardingProblem({ ...base, seaState: 6 }), "rough seas");
});

test("the fight lasts 60 to 120 seconds and an outnumbered side yields early", () => {
  assert.equal(boardingDurationSeconds(() => 0), settings.combat.boardingMinSeconds);
  assert.equal(boardingDurationSeconds(() => 1), settings.combat.boardingMaxSeconds);
  assert.equal(outnumberedBoarding(300, 99), "attacker");
  assert.equal(outnumberedBoarding(99, 300), "defender");
  assert.equal(outnumberedBoarding(100, 100), null);
});

test("boarding casualties use 80% loser loss and a closeness-scaled winner loss", () => {
  const win = boardingCasualties({
    attackerCrew: 200,
    defenderCrew: 100,
    attackerStrength: 200,
    defenderStrength: 100,
    random: () => 0,
  });
  assert.equal(win.winner, "attacker");
  assert.equal(win.defenderLost, 80);
  assert.equal(win.capturedCrew, 20);
  assert.equal(win.attackerLost, 40, "winner loses 40% x 0.5 closeness");

  const loss = boardingCasualties({
    attackerCrew: 200,
    defenderCrew: 100,
    attackerStrength: 100,
    defenderStrength: 200,
    random: () => 0.99,
  });
  assert.equal(loss.winner, "defender");
  assert.equal(loss.attackerLost, 160);
  assert.equal(loss.capturedCrew, 0);
});

test("auto-boarding needs Capture, 50% odds, a weakened target and the toggle on", () => {
  const base = {
    objective: "capture",
    odds: 0.6,
    targetCrewShare: 0.4,
    targetSailsShare: 0.8,
    targetMastsShare: 0.8,
    autoBoard: true,
  };
  assert.equal(autoBoardingAllowed(base), true);
  assert.equal(autoBoardingAllowed({ ...base, objective: "sink" }), false);
  assert.equal(autoBoardingAllowed({ ...base, odds: 0.45 }), false);
  assert.equal(autoBoardingAllowed({ ...base, autoBoard: false }), false);
  assert.equal(autoBoardingAllowed({ ...base, targetCrewShare: 0.9 }), false);
  assert.equal(autoBoardingAllowed({
    ...base,
    targetCrewShare: 0.9,
    targetSailsShare: 0.1,
    targetMastsShare: 0.1,
  }), true);
});

test("captured crew choices default to join after 120 seconds", () => {
  assert.equal(capturedChoiceAfterTimeout(null), "join");
  assert.equal(capturedChoiceAfterTimeout("kill"), "kill");
  const join = capturedCrewPlan(30, 230, "join");
  assert.equal(join.crew, 30);
  assert.equal(join.kill, 0);
  const kill = capturedCrewPlan(30, 230, "kill");
  assert.equal(kill.crew, 0);
  assert.equal(kill.kill, 30);
  const prisoners = capturedCrewPlan(100, 230, "prisoners", 100);
  assert.equal(prisoners.prisoners, 46);
  assert.equal(prisoners.crew, 54, "overflow joins");
  assert.ok(prisoners.problem);
  assert.equal(prisonerLimit(230), 46);
});

test("prisoners use half provisions and pay 20 pieces each", () => {
  assert.equal(provisionCrewEquivalent(100, 40), 120);
  assert.equal(prisonerBounty(40), 800);
});

test("fire starts at 20, grows, damages, and fighting uses materials", () => {
  const random = createSeededRandom(4);
  const started = igniteFire({ burning: false, strength: 0 }, () => 0);
  assert.equal(started.burning, true);
  assert.equal(started.strength, 20);
  const added = igniteFire(started, random);
  assert.equal(added.strength, 30);
  assert.equal(igniteFire(started, () => 0.99).strength, 30, "already burning adds 10");
  assert.equal(growFire(started, 10).strength, 25);

  const damage = fireDamage(100, 10_000, 200, 10);
  assert.ok(Math.abs(damage.hullLoss - 35) < 1e-9);
  assert.ok(Math.abs(damage.crewLoss - 0.5) < 1e-9);

  const fought = fightFire({ burning: true, strength: 50 }, 100, 10, 10);
  assert.equal(fought.materialsUsed, 0.1);
  assert.equal(fought.strength, 35);
  const noMats = fightFire({ burning: true, strength: 50 }, 100, 0, 10);
  assert.equal(noMats.strength, 45.5, "no materials gives 30%");
  const out = fightFire({ burning: true, strength: 1 }, 100, 10, 10);
  assert.equal(out.out, true);
});

test("fire spreads more easily downwind than upwind, and not to a burning ship", () => {
  const windFromDeg = 315;
  const downwind = 135 * Math.PI / 180;
  const upwind = downwind + Math.PI;
  const low = fireSpreadChance({
    strength: 50, seconds: 1, bearingRad: upwind, windFromDeg, targetBurning: false, inRange: true,
  });
  const high = fireSpreadChance({
    strength: 50, seconds: 1, bearingRad: downwind, windFromDeg, targetBurning: false, inRange: true,
  });
  assert.ok(high > low);
  assert.equal(fireSpreadChance({
    strength: 50, seconds: 1, bearingRad: downwind, windFromDeg, targetBurning: true, inRange: true,
  }), 0);
});

test("explosion is only possible below 15% hull and blasts nearby ships", () => {
  assert.equal(explosionChance(1000, 200, 1), 0);
  assert.ok(explosionChance(1000, 100, 60) > 0);
  assert.deepEqual(explosionBlast(1000, 200, false), { hullLoss: 0, crewLoss: 0 });
  assert.deepEqual(explosionBlast(1000, 200, true), { hullLoss: 50, crewLoss: 10 });
});

test("friends are same owner or navy; a miss can hit one in the cone", () => {
  assert.equal(isFriendly("a", "British", "a", "French"), true);
  assert.equal(isFriendly("a", "British", "b", "British"), true);
  assert.equal(isFriendly("a", "British", "b", "French"), false);
  const target = { x: 0.1, y: 0 };
  const friendly = {
    id: "f", ownerId: "ally", navy: "British", x: 0.1005, y: 0, friendly: true,
  };
  const hit = friendlyFireTarget({
    shooter: { x: 0, y: 0 },
    target,
    candidates: [friendly],
    random: () => 0,
    addresseeOwnerId: "me",
    addresseeNavy: "British",
  });
  assert.equal(hit?.id, "f");
  assert.equal(friendlyFireTarget({
    shooter: { x: 0, y: 0 }, target, candidates: [friendly], random: () => 0.99,
    addresseeOwnerId: "me", addresseeNavy: "British",
  }), null);
  assert.equal(friendlyFireTarget({
    shooter: { x: 0, y: 0 },
    target: { x: -0.1, y: 0 },
    candidates: [{ ...friendly, x: 0.1005, y: 0 }],
    random: () => 0,
    addresseeOwnerId: "me",
    addresseeNavy: "British",
  }), null, "behind the target, not ahead of it");
});

test("a sinking ship cannot act and is removed after 20 seconds", () => {
  const sinking = startSinking(1_000);
  assert.equal(canActWhileSinking(sinking), false);
  assert.equal(sinkingComplete(sinking, 20_999), false);
  assert.equal(sinkingComplete(sinking, 21_000), true);
});
