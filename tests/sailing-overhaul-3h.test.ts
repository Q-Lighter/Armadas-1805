// 3H b1: the sailing overhaul's steering, manoeuvres and anchors.
//
// The tests use the same pure decision functions and the same real movement
// step as the server. They print the turning-circle table so the build log and
// the final report can quote measured numbers rather than guesses.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { shipTypeFor } from "@naval/shared/ships";
import {
  angleOffWindDeg,
  createShip,
  manoeuvreStateLabel,
  sailTo,
  shipSpecFor,
  shortestTurnDegrees,
  stepShip,
  type ShipClassId,
} from "@naval/shared/sailing";
import {
  advanceManoeuvre,
  chooseManoeuvre,
  missStaysChance,
  shortenedSailSpeedShare,
  steerageTurnFactor,
  turnPassesThroughWind,
  type ManoeuvreInput,
  type ManoeuvreKind,
  type ManoeuvreState,
} from "@naval/shared/manoeuvres";
import {
  addPlayer,
  applyOrder,
  createWorld,
  dropAnchor,
  stepWorld,
  visibleStateFor,
  weighAnchor,
} from "@naval/shared/world";

const DEG = Math.PI / 180;
const CLASSES: ShipClassId[] = [
  "flagship", "line", "frigate", "escort", "raider", "trade", "fireShip",
];
const WINDS = [0, 45, 90, 135, 180, 225, 270, 315];

function circleKm(classId: ShipClassId, divideBy: number): number {
  const ship = createShip(`circle-${classId}`, classId, 0, 0, 0);
  const spec = shipSpecFor(ship);
  const minutes = spec.turn90GameMinutes * divideBy;
  const omega = (90 / (minutes * 60)) * DEG;
  const cruiseKmPerSecond = (spec.cruiseKnots * 1.852) / 3600;
  return cruiseKmPerSecond / omega;
}

function baseInput(overrides: Partial<ManoeuvreInput> = {}): ManoeuvreInput {
  return {
    state: undefined,
    classId: "frigate",
    headingRad: 0,
    desiredHeadingRad: Math.PI,
    speedKnots: 6,
    windFromDeg: 315,
    dtGameSeconds: 1,
    sailsPercent: 100,
    mastsPercent: 100,
    rudderPercent: 100,
    crewPercent: 100,
    closestAngleDeg: 53,
    portWater: false,
    confined: false,
    coastDownwind: false,
    random: () => 1,
    ...overrides,
  };
}

interface SimulatedManoeuvre {
  headingRad: number;
  kinds: ManoeuvreKind[];
  backed: boolean;
  finished: boolean;
  seconds: number;
}

/** Run the shared state machine while turning the hull at a realistic rate. */
function simulateManoeuvre(
  initial: Partial<ManoeuvreInput>,
  maxSeconds = 20_000,
): SimulatedManoeuvre {
  let heading = 0;
  let state: ManoeuvreState | undefined;
  let finished = false;
  let backed = false;
  const kinds: ManoeuvreKind[] = [];
  let seconds = 0;

  while (!finished && seconds < maxSeconds) {
    const out = advanceManoeuvre({
      ...baseInput(initial),
      headingRad: heading,
      state,
      dtGameSeconds: 1,
    });
    state = out.state;
    if (state && !kinds.includes(state.kind)) kinds.push(state.kind);
    if (out.travelSign === -1) backed = true;
    if (out.finished) {
      heading = out.headingRad;
      finished = true;
      break;
    }
    const difference = shortestTurnDegrees(heading, out.headingRad);
    heading += Math.max(-3, Math.min(3, difference)) * DEG;
    seconds += 1;
  }
  return { headingRad: heading, kinds, backed, finished, seconds };
}

function headingClose(actual: number, expectedRad: number, toleranceDeg = 1.5): boolean {
  return Math.abs(shortestTurnDegrees(actual, expectedRad)) <= toleranceDeg;
}

test("B1 turning circle: frigate at cruise is 4-6 ship lengths and every class turns tighter", () => {
  console.log("\n3H B1 TURNING CIRCLE (cruise, calm steering, ship lengths)");
  console.log("class      old lengths  new lengths  new radius m  closest-to-wind");
  for (const classId of CLASSES) {
    const oldRadius = circleKm(classId, settings.manoeuvres.cruiseTurnRateMultiplier);
    const newRadius = circleKm(classId, 1);
    const lengthKm = settings.manoeuvres.shipLengthM[classId] / 1000;
    const oldLengths = oldRadius / lengthKm;
    const newLengths = newRadius / lengthKm;
    const spec = shipSpecFor(createShip(`spec-${classId}`, classId, 0, 0, 0));
    console.log(
      `${classId.padEnd(10)} ${oldLengths.toFixed(2).padStart(11)} ` +
      `${newLengths.toFixed(2).padStart(12)} ${(newRadius * 1000).toFixed(0).padStart(13)} ` +
      `${spec.closestAngleDeg.toFixed(0).padStart(15)}`,
    );
    assert.ok(newLengths > 0, classId);
    assert.ok(newLengths < oldLengths, `${classId} should turn tighter`);
  }
  const frigate = circleKm("frigate", 1) /
    (settings.manoeuvres.shipLengthM.frigate / 1000);
  assert.ok(frigate >= 4 && frigate <= 6, `frigate circle ${frigate.toFixed(2)} lengths`);
});

test("B2 steering: the rudder loses bite below steerage and pivots only slowly at rest", () => {
  assert.equal(steerageTurnFactor(0), 0);
  assert.equal(steerageTurnFactor(0.5), 0.25);
  assert.equal(steerageTurnFactor(1), 0.5);
  assert.equal(steerageTurnFactor(2), 1);
  assert.equal(steerageTurnFactor(9), 1);

  const steps = [0, 2, 5].map((speed) => {
    const ship = createShip(`speed-${speed}`, "frigate", 0, 0, 0);
    ship.speedKnots = speed;
    const before = ship.headingRad;
    sailTo(ship, 200, 0);
    stepShip(ship, 1);
    return Math.abs(ship.headingRad - before) / DEG;
  });
  assert.ok(steps[0]! < 0.2, `zero-speed turn was ${steps[0]}`);
  assert.ok(steps[1]! > steps[0]! * 5, "2 kn should bite much better than rest");
  assert.ok(steps[2]! > 0.5, "5 kn helm should answer at once");
  console.log(`B2 one-second turns at 0/2/5 kn: ${steps.map((v) => v.toFixed(3)).join(" / ")} degrees`);
});

test("B3 selection: tack, wear, box-haul, recovery and warp obey wind and damage", () => {
  // Through the wind is a tack; the other big turn is a wear.
  for (const wind of WINDS) {
    const input = baseInput({ windFromDeg: wind });
    const expected = turnPassesThroughWind(0, Math.PI, wind) ? "tack" : "wear";
    assert.equal(chooseManoeuvre(input), expected, `wind ${wind}`);
  }
  assert.equal(chooseManoeuvre(baseInput({ speedKnots: 0 })), "irons");
  assert.equal(chooseManoeuvre(baseInput({ speedKnots: 3 })), "wear");
  assert.equal(chooseManoeuvre(baseInput({ sailsPercent: 40 })), "wear");
  assert.equal(chooseManoeuvre(baseInput({ mastsPercent: 20 })), "wear");
  assert.equal(chooseManoeuvre(baseInput({ crewPercent: 20 })), "wear");
  assert.equal(chooseManoeuvre(baseInput({ portWater: true })), "warp");
  assert.equal(
    chooseManoeuvre(baseInput({ confined: true, coastDownwind: true })),
    "boxHaul",
  );
  assert.equal(
    chooseManoeuvre(baseInput({ headingRad: 0, desiredHeadingRad: 90 * DEG })),
    "none",
    "an ordinary helm change is not a manoeuvre",
  );
  assert.ok(missStaysChance(100, 100, 100, 12) > 0);
  assert.ok(missStaysChance(20, 20, 20, 30) > missStaysChance(100, 100, 100, 12));
});

test("B3 tack and wear finish on the new course for all eight winds", () => {
  for (const wind of WINDS) {
    const sim = simulateManoeuvre({ windFromDeg: wind });
    assert.equal(sim.finished, true, `wind ${wind} did not finish`);
    assert.ok(
      headingClose(sim.headingRad, Math.PI, 2),
      `wind ${wind} ended at ${(sim.headingRad / DEG).toFixed(1)} degrees`,
    );
    assert.ok(
      sim.kinds.every((kind) => kind === "tack" || kind === "wear"),
      `wind ${wind} chose ${sim.kinds.join(",")}`,
    );
    assert.ok(sim.kinds.length >= 1);
  }
});

test("B3 box-haul gains sternway and finishes for all eight winds", () => {
  for (const wind of WINDS) {
    const sim = simulateManoeuvre({
      windFromDeg: wind,
      confined: true,
      coastDownwind: true,
    });
    assert.equal(sim.finished, true, `wind ${wind} box-haul did not finish`);
    assert.deepEqual(sim.kinds, ["boxHaul"]);
    assert.equal(sim.backed, true, "box-haul did not back the sails");
    assert.ok(headingClose(sim.headingRad, Math.PI, 2), `wind ${wind} ended off course`);
  }
});

test("B3 in-irons recovery backs off and pays onto a tack, never spinning in place", () => {
  for (const wind of WINDS) {
    const sim = simulateManoeuvre({ windFromDeg: wind, speedKnots: 0 });
    assert.equal(sim.finished, true, `wind ${wind} recovery did not finish`);
    assert.ok(sim.backed, "recovery never gained sternway");
    assert.ok(sim.kinds.includes("irons"));
    const offWind = angleOffWindDeg(sim.headingRad, wind);
    assert.ok(
      Math.abs(offWind - 53) <= 2,
      `wind ${wind} paid off at ${offWind.toFixed(1)} degrees, not a close-hauled tack`,
    );
  }
});

test("B3 a missed tack ends in irons instead of magically completing", () => {
  const sim = simulateManoeuvre({ windFromDeg: 0, random: () => 0 });
  assert.equal(sim.finished, true);
  assert.ok(sim.kinds.includes("irons"), "a missed stays never fell into irons");
  assert.equal(sim.backed, true);
});

test("B3 warp is port-only; shortening sail halves speed near land or in a channel", () => {
  const warp = advanceManoeuvre(baseInput({ portWater: true }));
  assert.equal(warp.state?.kind, "warp");
  assert.equal(warp.speedKnots, settings.manoeuvres.warpSpeedKnots);
  assert.equal(warp.travelSign, 1);
  const warpedOut = advanceManoeuvre(baseInput({
    portWater: false,
    state: warp.state,
  }));
  assert.equal(warpedOut.finished, true);

  const notWarp = simulateManoeuvre({ portWater: false });
  assert.equal(notWarp.kinds.includes("warp"), false);

  assert.equal(shortenedSailSpeedShare(true, false), settings.manoeuvres.shortenSailSpeedShare);
  assert.equal(shortenedSailSpeedShare(false, true), settings.manoeuvres.shortenSailSpeedShare);
  assert.equal(shortenedSailSpeedShare(false, false), 1);
  const shortened = advanceManoeuvre(baseInput({
    confined: true,
    desiredHeadingRad: 0,
  }));
  assert.equal(shortened.speedShare, settings.manoeuvres.shortenSailSpeedShare);
  assert.equal(shortened.label, "Shortening sail");
});

test("B4 anchoring: no drift, slow swing to wind, 20 real seconds to weigh", () => {
  const world = createWorld("test-3h-anchor");
  const ship = addPlayer(world, "anchor", "frigate");
  ship.headingRad = 0;
  ship.speedKnots = 2;

  assert.equal(dropAnchor(world, "anchor", ship.id), true);
  assert.equal(ship.anchored, true);
  assert.equal(manoeuvreStateLabel(ship), "Anchored");
  const x = ship.x;
  const y = ship.y;
  for (let index = 0; index < 300; index += 1) stepWorld(world, 9);
  assert.ok(Math.abs(ship.x - x) < 1e-9 && Math.abs(ship.y - y) < 1e-9, "anchored ship drifted");
  assert.ok(
    angleOffWindDeg(ship.headingRad, world.windFromDeg) < 45,
    "anchored hull did not swing toward the wind",
  );
  assert.equal(visibleStateFor(world, "anchor").fleet[0]?.anchored, true);

  const target = { x: ship.x + 20, y: ship.y };
  assert.equal(sailTo(ship, target.x, target.y), true);
  // A low-level sailTo is not a server order; the server guard is tested below.
  ship.order = null;
  assert.equal(weighAnchor(world, "anchor", ship.id), true);
  assert.equal(manoeuvreStateLabel(ship), "Weighing anchor");
  const tick = settings.time.sailingTimeScale / settings.server.tickHz;
  for (let index = 0; index < 19 * settings.server.tickHz; index += 1) {
    stepWorld(world, tick);
  }
  assert.equal(ship.anchored, true, "anchor came aweigh too early");
  for (let index = 0; index < settings.server.tickHz; index += 1) {
    stepWorld(world, tick);
  }
  assert.equal(ship.anchored, false, "anchor did not come aweigh after 20 real seconds");

  ship.speedKnots = 4;
  assert.equal(dropAnchor(world, "anchor", ship.id), false, "anchored above three knots");
});

test("B4 an anchored ship refuses sailing orders until it weighs", () => {
  const world = createWorld("test-3h-anchor-order");
  const ship = addPlayer(world, "anchor-order", "frigate");
  ship.speedKnots = 0;
  assert.equal(dropAnchor(world, "anchor-order", ship.id), true);
  const ordered = applyOrder(world, "anchor-order", ship.x + 10, ship.y);
  assert.equal(ordered, false, "an anchored ship accepted a sailing order");
  assert.equal(ship.order, null);
  assert.equal(manoeuvreStateLabel(ship), "Anchored");
});
