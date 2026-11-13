// Real-loop combat tests. These use the authoritative world step with real
// sailing, tacking, turn rates, wind, damage, reloads and order code. Nothing
// in the movement or firing path is mocked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  createWorld,
  orderBoarding,
  setShipBattleOrder,
  stepWorld,
  type World,
} from "@naval/shared/world";
import { shortestTurnDegrees, type Ship } from "@naval/shared/sailing";

const WIND_FROM_DEG = 315;
const BASE = { x: 1_693.8, y: 442.4 };
const TICK_REAL_SECONDS = 1 / settings.server.tickHz;
const DT_GAME_SECONDS = settings.time.sailingTimeScale * TICK_REAL_SECONDS;
const SCENARIO_REAL_SECONDS = 180;
const DIRECTIONS = [
  ["N", 0], ["NE", 45], ["E", 90], ["SE", 135],
  ["S", 180], ["SW", 225], ["W", 270], ["NW", 315],
] as const;

interface Scenario {
  name: string;
  attacker: Ship;
  target: Ship;
  world: World;
}

interface Metrics {
  name: string;
  firstShotSeconds: number | null;
  shots: number;
  hits: number;
  minDistanceM: number;
  boardingStarted: boolean;
  boardingStartSeconds: number | null;
  boardingSeconds: number | null;
  boardingDistanceM: number | null;
  boardingSpeedDifferenceKnots: number | null;
  boardingHeadingDifferenceDeg: number | null;
  overshootM: number;
  result: string;
  states: string[];
  notices: string[];
  sailAwayReasons: string[];
}

function positionAt(bearingDeg: number, distanceKm: number): { x: number; y: number } {
  const angle = bearingDeg * Math.PI / 180;
  return {
    x: BASE.x + Math.sin(angle) * distanceKm,
    y: BASE.y - Math.cos(angle) * distanceKm,
  };
}

function makeScenario(bearingDeg: number): Scenario {
  const world = createWorld("test-real-loop");
  const attacker = addPlayer(world, "attacker", "frigate", 50_000, "British");
  const target = addPlayer(world, "target", "frigate", 50_000, "French");
  const spot = positionAt(bearingDeg, 3);

  attacker.x = BASE.x;
  attacker.y = BASE.y;
  attacker.headingRad = 0;
  attacker.speedKnots = 0;
  attacker.order = null;
  attacker.route = null;
  attacker.fleetId = null;
  attacker.stance = "engage";
  attacker.lastCombatRealMs = null;

  target.x = spot.x;
  target.y = spot.y;
  target.headingRad = 0;
  target.speedKnots = 0;
  target.order = null;
  target.route = null;
  target.fleetId = null;
  target.stance = "stealth";
  target.lastCombatRealMs = null;
  return { name: "?", attacker, target, world };
}

function addMovingTarget(scenario: Scenario, headingDeg = 135, speedKnots = 3): void {
  const angle = headingDeg * Math.PI / 180;
  scenario.target.headingRad = angle;
  scenario.target.stationSpeedLimit = speedKnots;
  scenario.target.order = {
    type: "sailTo",
    x: scenario.target.x + Math.sin(angle) * 120,
    y: scenario.target.y - Math.cos(angle) * 120,
  };
}

function addSlowTarget(scenario: Scenario): void {
  addMovingTarget(scenario, 135, 3);
}

function stateLabel(world: World, ship: Ship): string {
  if (world.boardingFights.has(ship.id) || ship.boardingShipId) return "boarding";
  if (world.engagements.has(ship.id)) return "engage";
  if (ship.order) return "sail";
  return "hold";
}

function runScenario(name: string, scenario: Scenario): Metrics {
  const { world, attacker, target } = scenario;
  let firstShotSeconds: number | null = null;
  let shots = 0;
  let hits = 0;
  let minDistanceM = Infinity;
  let boardingStarted = false;
  let boardingStartSeconds: number | null = null;
  let boardingSeconds: number | null = null;
  let boardingDistanceM: number | null = null;
  let boardingSpeedDifferenceKnots: number | null = null;
  let boardingHeadingDifferenceDeg: number | null = null;
  let minUnderSixHundredM = Infinity;
  let maxUnderSixHundredM = 0;
  let lastDistanceM: number | null = null;
  const sailAwayReasons: string[] = [];
  let result = "no result";
  let lastBoarding = false;
  const states: string[] = [];
  let lastState = "";
  const targetOwnerAtStart = [...world.fleets.entries()]
    .find(([, fleet]) => fleet.includes(target))?.[0] ?? "";

  for (let tick = 0; tick < SCENARIO_REAL_SECONDS / TICK_REAL_SECONDS; tick += 1) {
    const eventStart = world.nextCombatEventId;
    const preDistanceM = Math.hypot(target.x - attacker.x, target.y - attacker.y) * 1000;
    const previousDistanceM = lastDistanceM;
    const preSpeedDifferenceKnots = Math.abs(attacker.speedKnots - target.speedKnots);
    const preHeadingDifferenceDeg = Math.abs(shortestTurnDegrees(attacker.headingRad, target.headingRad));
    stepWorld(world, DT_GAME_SECONDS, WIND_FROM_DEG);
    const now = (tick + 1) * TICK_REAL_SECONDS;
    const distanceM = Math.hypot(target.x - attacker.x, target.y - attacker.y) * 1000;
    minDistanceM = Math.min(minDistanceM, distanceM);
    const state = stateLabel(world, attacker);
    if (state !== lastState) {
      states.push(`${now.toFixed(0)}s ${state}`);
      lastState = state;
    }
    for (const event of world.combatEvents) {
      if (event.id < eventStart) continue;
      if (event.kind === "fire" && event.shipId === attacker.id) {
        shots += 1;
        firstShotSeconds ??= now;
      }
      if (event.kind === "hit") hits += 1;
    }
    if (distanceM < 600 && !lastBoarding) {
      minUnderSixHundredM = Math.min(minUnderSixHundredM, distanceM);
      maxUnderSixHundredM = Math.max(maxUnderSixHundredM, distanceM);
    }
    if (previousDistanceM !== null && distanceM > previousDistanceM + 150 &&
      distanceM < 600 && !attacker.combatStep && !attacker.boardingStep) {
      sailAwayReasons.push(`${now.toFixed(1)}s grew ${Math.round(distanceM - previousDistanceM)} m to ${Math.round(distanceM)} m`);
    }
    lastDistanceM = distanceM;
    const fighting = world.boardingFights.has(attacker.id);
    if (fighting && !lastBoarding) {
      boardingStarted = true;
      boardingStartSeconds = now;
      boardingDistanceM = distanceM;
      boardingSpeedDifferenceKnots = preSpeedDifferenceKnots;
      boardingHeadingDifferenceDeg = Math.abs(
        shortestTurnDegrees(attacker.headingRad, target.headingRad),
      );
    }
    if (!fighting && lastBoarding && boardingStartSeconds !== null) {
      boardingSeconds = now - boardingStartSeconds;
    }
    lastBoarding = fighting;
    if (target.damage.hull <= 0 || target.capturedCrew && target.capturedCrew > 0) break;
  }

  const targetOwnerNow = [...world.fleets.entries()]
    .find(([, fleet]) => fleet.includes(target))?.[0] ?? "";
  if (target.damage.hull <= 0) result = "sunk";
  else if (targetOwnerNow !== targetOwnerAtStart) result = "captured";
  else if (world.boardingFights.has(attacker.id)) result = "boarding in progress";
  else if (boardingStarted) result = "boarding ended";

  const notices = [...world.notices.values()].flat();
  return {
    name,
    firstShotSeconds,
    shots,
    hits,
    minDistanceM,
    boardingStarted,
    boardingStartSeconds,
    boardingSeconds,
    boardingDistanceM,
    boardingSpeedDifferenceKnots,
    boardingHeadingDifferenceDeg,
    overshootM: Math.max(0, maxUnderSixHundredM - minUnderSixHundredM),
    result,
    states,
    notices,
    sailAwayReasons,
  };
}

function printTable(rows: Metrics[]): void {
  console.log("\nREAL-LOOP SCENARIOS (180 s each, wind 315, frigate v frigate)");
  console.log("scenario                 first shots hits  min m board start  dist  dkn  dh  over  result                 states");
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(24)} ${String(row.firstShotSeconds ?? "-").padStart(5)} ` +
      `${String(row.shots).padStart(6)} ${String(row.hits).padStart(5)} ` +
      `${Math.round(row.minDistanceM).toString().padStart(6)} ` +
      `${(row.boardingStarted ? "yes" : "no").padStart(5)} ` +
      `${(row.boardingStartSeconds === null ? "-" : row.boardingStartSeconds.toFixed(0)).padStart(5)} ` +
      `${(row.boardingDistanceM === null ? "-" : row.boardingDistanceM.toFixed(0)).padStart(5)} ` +
      `${(row.boardingSpeedDifferenceKnots === null ? "-" : row.boardingSpeedDifferenceKnots.toFixed(1)).padStart(4)} ` +
      `${(row.boardingHeadingDifferenceDeg === null ? "-" : row.boardingHeadingDifferenceDeg.toFixed(0)).padStart(3)} ` +
      `${row.overshootM.toFixed(0).padStart(5)}  ` +
      `${row.result.padEnd(22)} ${row.states.join(" > ")}`,
    );
  }
}

test("real loop: Sink closes and fires from all eight wind directions and a moving target", () => {
  const rows: Metrics[] = [];
  for (const [label, bearing] of DIRECTIONS) {
    const scenario = makeScenario(bearing);
    scenario.name = `sink ${label} stationary`;
    assert.equal(setShipBattleOrder(scenario.world, "attacker", scenario.attacker.id, "sink"), true);
    rows.push(runScenario(scenario.name, scenario));
  }
  const moving = makeScenario(90);
  moving.name = "sink E moving 3 kn";
  addSlowTarget(moving);
  assert.equal(setShipBattleOrder(moving.world, "attacker", moving.attacker.id, "sink"), true);
  rows.push(runScenario(moving.name, moving));
  printTable(rows);

  for (const row of rows) {
    assert.ok(row.shots > 0, `${row.name}: never fired`);
    assert.ok(row.hits > 0, `${row.name}: never hit`);
    assert.ok(row.minDistanceM <= 450, `${row.name}: stayed ${Math.round(row.minDistanceM)} m away`);
  }
});

test("real loop: Capture closes and fires from all eight wind directions and a moving target", () => {
  const rows: Metrics[] = [];
  for (const [label, bearing] of DIRECTIONS) {
    const scenario = makeScenario(bearing);
    scenario.name = `capture ${label} stationary`;
    assert.equal(setShipBattleOrder(scenario.world, "attacker", scenario.attacker.id, "capture"), true);
    rows.push(runScenario(scenario.name, scenario));
  }
  const moving = makeScenario(90);
  moving.name = "capture E moving 3 kn";
  addSlowTarget(moving);
  assert.equal(setShipBattleOrder(moving.world, "attacker", moving.attacker.id, "capture"), true);
  rows.push(runScenario(moving.name, moving));
  printTable(rows);

  for (const row of rows) {
    assert.ok(row.shots > 0, `${row.name}: never fired`);
    assert.ok(row.minDistanceM <= 450, `${row.name}: stayed ${Math.round(row.minDistanceM)} m away`);
  }
});

test("real loop: Board reaches and starts against all eight stationary placements", () => {
  const rows: Metrics[] = [];
  for (const [label, bearing] of DIRECTIONS) {
    const scenario = makeScenario(bearing);
    scenario.name = `board ${label} stationary`;
    assert.equal(orderBoarding(scenario.world, "attacker", scenario.attacker.id, scenario.target.id), true);
    rows.push(runScenario(scenario.name, scenario));
  }
  printTable(rows);
  for (const row of rows) {
    assert.ok(row.boardingStarted, `${row.name}: boarding never started; ${row.states.join(" > ")}`);
    assert.ok(row.minDistanceM <= settings.combat.boardingRangeM + 20,
      `${row.name}: closest ${Math.round(row.minDistanceM)} m`);
  }
});

test("real loop: Board catches a target sailing at three knots", () => {
  const scenario = makeScenario(90);
  scenario.name = "board E moving 3 kn";
  addSlowTarget(scenario);
  assert.equal(orderBoarding(scenario.world, "attacker", scenario.attacker.id, scenario.target.id), true);
  const row = runScenario(scenario.name, scenario);
  printTable([row]);
  assert.ok(row.boardingStarted, `boarding never started; ${row.states.join(" > ")}`);
});

test("real loop: Board starts within 150 s at 45-60 m for stopped targets", () => {
  const rows: Metrics[] = [];
  for (const [label, bearing] of DIRECTIONS) {
    const scenario = makeScenario(bearing);
    scenario.name = `board ${label} stationary`;
    assert.equal(orderBoarding(scenario.world, "attacker", scenario.attacker.id, scenario.target.id), true);
    rows.push(runScenario(scenario.name, scenario));
  }
  printTable(rows);
  for (const row of rows) {
    assert.ok(row.boardingStarted, `${row.name}: boarding never started; ${row.states.join(" > ")}`);
    assert.ok((row.boardingStartSeconds ?? Infinity) <= 150,
      `${row.name}: boarding took ${row.boardingStartSeconds}s`);
    assert.ok((row.boardingDistanceM ?? Infinity) <= 61,
      `${row.name}: grappled at ${row.boardingDistanceM?.toFixed(0)} m`);
    assert.ok((row.boardingDistanceM ?? 0) >= 35,
      `${row.name}: grappled too far apart at ${row.boardingDistanceM?.toFixed(0)} m`);
    assert.ok((row.boardingSpeedDifferenceKnots ?? Infinity) <= 3,
      `${row.name}: speed difference ${row.boardingSpeedDifferenceKnots?.toFixed(1)} kn`);
    assert.ok((row.boardingHeadingDifferenceDeg ?? Infinity) <= 30,
      `${row.name}: heading difference ${row.boardingHeadingDifferenceDeg?.toFixed(0)} deg`);
  }
});

test("real loop: Board catches three-knot targets on four fixed courses", () => {
  const rows: Metrics[] = [];
  for (const heading of [45, 90, 135, 180]) {
    const scenario = makeScenario(90);
    scenario.name = `board 3 kn hdg ${heading}`;
    addMovingTarget(scenario, heading, 3);
    assert.equal(orderBoarding(scenario.world, "attacker", scenario.attacker.id, scenario.target.id), true);
    rows.push(runScenario(scenario.name, scenario));
  }
  printTable(rows);
  for (const row of rows) {
    assert.ok(row.boardingStarted, `${row.name}: boarding never started; ${row.notices.join(" | ")}`);
    assert.ok((row.boardingStartSeconds ?? Infinity) <= 150,
      `${row.name}: boarding took ${row.boardingStartSeconds}s`);
    assert.ok((row.boardingDistanceM ?? Infinity) <= 61,
      `${row.name}: grappled at ${row.boardingDistanceM?.toFixed(0)} m`);
    assert.ok((row.boardingSpeedDifferenceKnots ?? Infinity) <= 3,
      `${row.name}: speed difference ${row.boardingSpeedDifferenceKnots?.toFixed(1)} kn`);
    assert.ok((row.boardingHeadingDifferenceDeg ?? Infinity) <= 30,
      `${row.name}: heading difference ${row.boardingHeadingDifferenceDeg?.toFixed(0)} deg`);
  }
});

test("real loop: Board against a six-knot target is caught or says it cannot reach", () => {
  const scenario = makeScenario(90);
  scenario.name = "board 6 kn away";
  addMovingTarget(scenario, 90, 6);
  assert.equal(orderBoarding(scenario.world, "attacker", scenario.attacker.id, scenario.target.id), true);
  const row = runScenario(scenario.name, scenario);
  printTable([row]);
  const saidSo = row.notices.some((notice) =>
    /Cannot reach|Could not reach/.test(notice));
  assert.ok(row.boardingStarted || saidSo,
    `silently sailed on; notices: ${row.notices.join(" | ")}; states: ${row.states.join(" > ")}`);
  if (row.boardingStarted) {
    assert.ok((row.boardingDistanceM ?? Infinity) <= 61);
    assert.ok((row.boardingSpeedDifferenceKnots ?? Infinity) <= 3);
    assert.ok((row.boardingHeadingDifferenceDeg ?? Infinity) <= 30);
  }
});

test("real loop: changing a failed Board order to Sink clears the boarding flag and fires", () => {
  const scenario = makeScenario(90);
  scenario.name = "board then sink";
  assert.equal(orderBoarding(scenario.world, "attacker", scenario.attacker.id, scenario.target.id), true);
  // Change order before the fast approach reaches the target.
  assert.equal(setShipBattleOrder(scenario.world, "attacker", scenario.attacker.id, "sink"), true);
  const row = runScenario(scenario.name, scenario);
  printTable([row]);
  assert.equal(scenario.attacker.boardingShipId ?? null, null, "stale boarding target was not cleared");
  assert.equal(scenario.target.boardingShipId ?? null, null, "target still thinks it is being boarded");
  assert.ok(row.shots > 0, "no shot after changing Board to Sink");
});

test("real loop: Sink and Capture never sail away without a labelled reason", () => {
  const failures: string[] = [];
  for (const [label, bearing] of DIRECTIONS) {
    for (const objective of ["sink", "capture"] as const) {
      const scenario = makeScenario(bearing);
      scenario.name = `${objective} ${label}`;
      assert.equal(setShipBattleOrder(
        scenario.world, "attacker", scenario.attacker.id, objective,
      ), true);
      const row = runScenario(scenario.name, scenario);
      if (row.sailAwayReasons.length > 0) {
        failures.push(`${row.name}: ${row.sailAwayReasons.join("; ")}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("real loop: a two-minute duel at range turns under 360 degrees and stays inside 450 m", () => {
  const scenario = makeScenario(90);
  scenario.name = "two-minute duel";
  scenario.target.stance = "engage";
  assert.equal(setShipBattleOrder(scenario.world, "attacker", scenario.attacker.id, "sink"), true);
  assert.equal(setShipBattleOrder(scenario.world, "target", scenario.target.id, "sink"), true);

  let reached = false;
  let secondsAtRange = 0;
  let attackerTurn = 0;
  let targetTurn = 0;
  let previousAttackerHeading = scenario.attacker.headingRad;
  let previousTargetHeading = scenario.target.headingRad;

  for (let tick = 0; tick < SCENARIO_REAL_SECONDS / TICK_REAL_SECONDS; tick += 1) {
    stepWorld(scenario.world, DT_GAME_SECONDS, WIND_FROM_DEG);
    const distance = Math.hypot(
      scenario.target.x - scenario.attacker.x,
      scenario.target.y - scenario.attacker.y,
    ) * 1000;
    if (!reached) {
      reached = distance <= settings.combat.engageHysteresisM;
      previousAttackerHeading = scenario.attacker.headingRad;
      previousTargetHeading = scenario.target.headingRad;
      continue;
    }
    secondsAtRange += TICK_REAL_SECONDS;
    attackerTurn += Math.abs(shortestTurnDegrees(previousAttackerHeading, scenario.attacker.headingRad));
    targetTurn += Math.abs(shortestTurnDegrees(previousTargetHeading, scenario.target.headingRad));
    previousAttackerHeading = scenario.attacker.headingRad;
    previousTargetHeading = scenario.target.headingRad;
    if (secondsAtRange >= 120) break;
  }

  const distance = Math.hypot(
    scenario.target.x - scenario.attacker.x,
    scenario.target.y - scenario.attacker.y,
  ) * 1000;
  console.log(`two-minute duel: reach=${reached} atRange=${secondsAtRange.toFixed(0)}s attackerTurn=${attackerTurn.toFixed(1)} targetTurn=${targetTurn.toFixed(1)} endDistance=${distance.toFixed(0)}m`);
  assert.ok(reached, "never reached engage range");
  assert.ok(secondsAtRange >= 119, `only ${secondsAtRange.toFixed(0)} s at range`);
  assert.ok(attackerTurn <= 360 + 1e-6, `attacker turned ${attackerTurn.toFixed(1)} degrees`);
  assert.ok(targetTurn <= 360 + 1e-6, `target turned ${targetTurn.toFixed(1)} degrees`);
  assert.ok(distance <= settings.combat.engageHysteresisM + 1, `ended ${distance.toFixed(0)} m apart`);
});

test("real loop: two real players engaging each other both fire", () => {
  const scenario = makeScenario(90);
  scenario.name = "two players mutual";
  scenario.target.stance = "engage";
  assert.equal(setShipBattleOrder(scenario.world, "attacker", scenario.attacker.id, "sink"), true);
  assert.equal(setShipBattleOrder(scenario.world, "target", scenario.target.id, "sink"), true);
  const row = runScenario(scenario.name, scenario);
  printTable([row]);
  assert.ok(row.shots > 0, "the attacker never fired");
  // The target's fire events use its own ship id; count them from the world.
  const targetFired = scenario.world.combatEvents.some(
    (event) => event.kind === "fire" && event.shipId === scenario.target.id,
  );
  assert.ok(targetFired, "the other player never fired");
  assert.ok(row.minDistanceM <= 450, `ships stayed ${Math.round(row.minDistanceM)} m apart`);
});
