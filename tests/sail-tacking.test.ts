// Real-loop tacking harness. It uses the authoritative world step, the real
// route planner, land lookup, wind, turn rate and speed curve. Nothing in the
// sailing or route path is mocked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { isInsideMapFrame, lonLatToMap } from "@naval/shared/map";
import { isLandAt } from "@naval/shared/land";
import {
  addPlayer,
  applyOrder,
  createWorld,
  stepWorld,
  type World,
} from "@naval/shared/world";
import {
  angleOffWindDeg,
  sailTo,
  shipSpecFor,
  shortestTurnDegrees,
  speedForHeading,
  stepShip,
  type Ship,
} from "@naval/shared/sailing";

const WIND_FROM_DEG = 315;
const BASE = { x: 1_693.8, y: 442.4 };
const TICK = 1 / settings.server.tickHz;
const GAME_DT = settings.time.sailingTimeScale * TICK;
const DISTANCES_KM = [10, 30, 100];
const OFFSETS_DEG = [0, 15, 30, 45, 60, 90];

interface Row {
  label: string;
  km: number;
  offsetDeg: number;
  seconds: number | null;
  vmgShare: number | null;
  tacks: number;
  longestLegKm: number | null;
  sidewaysKm: number;
  idealSeconds: number;
  arrived: boolean;
  timedOut: boolean;
  routePlanned: boolean;
  notes: string;
}

function pointFrom(base: { x: number; y: number }, bearingDeg: number, km: number): { x: number; y: number } {
  const angle = bearingDeg * Math.PI / 180;
  return { x: base.x + Math.sin(angle) * km, y: base.y - Math.cos(angle) * km };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Perpendicular distance from the start-target straight line. */
function sideDistance(
  position: { x: number; y: number },
  start: { x: number; y: number },
  target: { x: number; y: number },
): number {
  const length = distance(start, target);
  if (length < 1e-9) return distance(position, start);
  return Math.abs(
    (position.x - start.x) * (target.y - start.y) -
    (position.y - start.y) * (target.x - start.x),
  ) / length;
}

function idealSecondsFor(ship: Ship, bearingRad: number, km: number): number {
  const spec = shipSpecFor(ship);
  const direct = speedForHeading(spec, bearingRad, WIND_FROM_DEG);
  let best = direct;
  if (direct <= 0.05) {
    const wind = WIND_FROM_DEG * Math.PI / 180;
    const closest = spec.closestAngleDeg * Math.PI / 180;
    const tackSpeed = Math.max(
      speedForHeading(spec, wind + closest, WIND_FROM_DEG),
      speedForHeading(spec, wind - closest, WIND_FROM_DEG),
    );
    const offWind = angleOffWindDeg(bearingRad, WIND_FROM_DEG) * Math.PI / 180;
    // A perfect zigzag makes good this much of the tack speed along the bearing.
    best = tackSpeed * Math.cos(closest - offWind);
  }
  return (km / Math.max(0.1, best)) * 3600;
}

function makeWorld(label: string, start: { x: number; y: number }): { world: World; ship: Ship } {
  const world = createWorld(`test-tack-${label}`);
  const ship = addPlayer(world, "sailor", "frigate", 50_000, "British");
  world.charts.get("sailor")!.bits.fill(0xff);
  ship.x = start.x;
  ship.y = start.y;
  ship.headingRad = WIND_FROM_DEG * Math.PI / 180;
  ship.speedKnots = 0;
  ship.order = null;
  ship.route = null;
  ship.fleetId = null;
  ship.stance = "stealth";
  ship.lastCombatRealMs = null;
  return { world, ship };
}

function runCase(
  label: string,
  start: { x: number; y: number },
  target: { x: number; y: number },
  idealSeconds: number,
  maxSeconds: number,
): Row {
  const { world, ship } = makeWorld(label, start);
  const km = distance(start, target);
  const routePlanned = applyOrder(world, "sailor", target.x, target.y);
  let tacks = 0;
  let previousSide = ship.tackSide;
  let lastTackAt = start;
  let longestLegKm = 0;
  let sidewaysKm = 0;
  let seconds = 0;
  let travelledKm = 0;
  let lastPosition = { x: ship.x, y: ship.y };
  let arrived = false;
  let timedOut = false;
  let routeSeen = Boolean(ship.route);
  const bearingDeg = (Math.atan2(target.x - start.x, -(target.y - start.y)) * 180 / Math.PI + 360) % 360;
  const rawOffset = ((bearingDeg - WIND_FROM_DEG) % 360 + 360) % 360;
  const offsetDeg = rawOffset > 180 ? 360 - rawOffset : rawOffset;
  if (ship.route) routeSeen = true;

  while (ship.order && seconds < maxSeconds) {
    stepWorld(world, GAME_DT, WIND_FROM_DEG);
    seconds += GAME_DT;
    travelledKm += distance(lastPosition, ship);
    lastPosition = { x: ship.x, y: ship.y };
    if (ship.route) routeSeen = true;
    if (ship.tackSide !== previousSide) {
      tacks += 1;
      longestLegKm = Math.max(longestLegKm, distance(lastTackAt, ship));
      lastTackAt = { x: ship.x, y: ship.y };
      previousSide = ship.tackSide;
    }
    sidewaysKm = Math.max(sidewaysKm, sideDistance(ship, start, target));
    arrived = distance(ship, target) <= settings.sailing.arrivalRadiusKm + 0.1 || !ship.order;
  }
  if (ship.order) timedOut = true;
  if (!timedOut) longestLegKm = Math.max(longestLegKm, distance(lastTackAt, ship));
  const straightKm = distance(start, ship);
  const ownSeconds = Math.max(1e-9, seconds);
  return {
    label,
    km,
    offsetDeg: Math.round(offsetDeg),
    seconds: timedOut ? null : seconds,
    vmgShare: timedOut ? null : straightKm / Math.max(1e-9, travelledKm),
    tacks,
    longestLegKm: timedOut ? null : longestLegKm,
    sidewaysKm,
    idealSeconds,
    arrived,
    timedOut,
    routePlanned,
    notes: !routePlanned ? "no route" : !isInsideMapFrame(target.x, target.y) ? "outside chart" : "",
  };
}

function printRows(rows: Row[]): void {
  console.log("\nTACKING TABLE (wind 315, frigate, real world loop)");
  console.log("case                         km  off  time h  vmg/own  turns  longest  sideways  ideal h  arrived");
  for (const row of rows) {
    console.log(
      `${row.label.padEnd(28)} ${row.km.toFixed(0).padStart(3)} ${String(row.offsetDeg).padStart(3)} ` +
      `${(row.seconds === null ? "-" : (row.seconds / 3600).toFixed(2)).padStart(6)} ` +
      `${(row.vmgShare === null ? "-" : row.vmgShare.toFixed(3)).padStart(7)} ` +
      `${String(row.tacks).padStart(5)} ` +
      `${(row.longestLegKm === null ? "-" : row.longestLegKm.toFixed(1)).padStart(7)} ` +
      `${row.sidewaysKm.toFixed(1).padStart(8)} ` +
      `${(row.idealSeconds / 3600).toFixed(2).padStart(7)}  ${row.arrived ? "yes" : "no"}` +
      `${row.notes ? ` ${row.notes}` : ""}`,
    );
  }
}

test("exact-upwind targets at 0, 5, 10 and 20 degrees are always reached", { timeout: 300_000 }, () => {
  for (const offset of [0, 5, 10, 20]) {
    const bearing = WIND_FROM_DEG + offset;
    const target = pointFrom(BASE, bearing, 30);
    const label = `exact ${offset}`;
    const { ship } = makeWorld(label, BASE);
    const ideal = idealSecondsFor(ship, bearing * Math.PI / 180, 30);
    const row = runCase(label, BASE, target, ideal, Math.max(6 * 3600, ideal * 2.5));
    assert.equal(row.arrived, true, `${label} target was not reached`);
    assert.ok(row.seconds !== null && row.seconds <= ideal * 2, `${label} took too long`);
  }
});

test("a tack manoeuvre finishes in about 20 game seconds", { timeout: 60_000 }, () => {
  const target = pointFrom(BASE, WIND_FROM_DEG, 30);
  const { ship } = makeWorld("tack-cost", BASE);
  assert.equal(sailTo(ship, target.x, target.y), true);
  const spec = shipSpecFor(ship);
  let previousSide = ship.tackSide;
  let tackStart: number | null = null;
  let tackSide = previousSide;
  let elapsed = 0;
  let finished: number | null = null;
  for (let step = 0; step < 60_000; step += 1) {
    stepShip(ship, 2, WIND_FROM_DEG);
    elapsed += 2;
    if (ship.tackSide !== previousSide) {
      previousSide = ship.tackSide;
      tackSide = ship.tackSide;
      tackStart = elapsed;
    }
    if (tackStart !== null) {
      const wanted = WIND_FROM_DEG * Math.PI / 180 + tackSide * spec.closestAngleDeg * Math.PI / 180;
      if (Math.abs(shortestTurnDegrees(ship.headingRad, wanted)) <= 2) {
        finished = elapsed;
        break;
      }
    }
  }
  assert.notEqual(tackStart, null, "the ship never tacked");
  assert.notEqual(finished, null, "the tack turn never finished");
  assert.ok(finished! - tackStart! <= 22, `tack took ${finished! - tackStart!} game seconds`);
});

test("real loop: tacking measurement table", { timeout: 300_000 }, () => {
  const rows: Row[] = [];
  for (const km of DISTANCES_KM) {
    for (const offset of OFFSETS_DEG) {
      const bearing = WIND_FROM_DEG + offset;
      const target = pointFrom(BASE, bearing, km);
      const label = `${km}km +${offset}`;
      const { ship } = makeWorld(label, BASE);
      if (process.env.DEBUG_CASE && process.env.DEBUG_CASE !== label) continue;
      const ideal = idealSecondsFor(ship, bearing * Math.PI / 180, km);
      rows.push(runCase(label, BASE, target, ideal, Math.max(6 * 3600, ideal * 3)));
    }
  }

  // A route that must use the coast planner: Kingston to Montego Bay, around
  // the western end of Jamaica. The target is not on the upwind bearings above.
  const coastStart = { x: 1_122.116, y: 364.98 };
  const coastTarget = { x: 1_106.237, y: 315.21 };
  const { ship: coastShip } = makeWorld("coast", coastStart);
  const coastBearing = Math.atan2(coastTarget.x - coastStart.x, -(coastTarget.y - coastStart.y));
  const coastIdeal = idealSecondsFor(coastShip, coastBearing, distance(coastStart, coastTarget));
  rows.push(runCase("coast west Jamaica", coastStart, coastTarget, coastIdeal, 24 * 3600));

  printRows(rows);
  assert.ok(rows.length >= 18);

  const table = rows.filter((row) => !row.label.startsWith("coast"));
  for (const row of rows) {
    assert.equal(row.arrived, true, `${row.label} did not arrive`);
    assert.ok(row.seconds !== null, `${row.label} timed out`);
    assert.ok(
      row.seconds! <= row.idealSeconds * 2,
      `${row.label} took ${(row.seconds! / 3600).toFixed(1)} h, more than twice the ${(row.idealSeconds / 3600).toFixed(1)} h ideal`,
    );
  }
  const deadUpwind = table.find((row) => Math.abs(row.km - 30) < 0.01 && row.offsetDeg === 0)!;
  assert.ok(deadUpwind.vmgShare! >= 0.6, `dead upwind made good only ${deadUpwind.vmgShare}`);
  assert.ok(
    deadUpwind.sidewaysKm <= Math.min(6, Math.max(0.5, 0.08 * 30)) + 0.05,
    `dead upwind strayed ${deadUpwind.sidewaysKm.toFixed(2)} km`,
  );
  // The requirement counts complete tacks: one turn to port plus one to
  // starboard. The table prints turns so the raw manoeuvre count is visible.
  assert.ok(Math.ceil(deadUpwind.tacks / 2) <= 8, `dead upwind made ${deadUpwind.tacks} turns`);
});
