// Real-loop formation harness. Real wind, sailing, turn rates, route planning,
// fleet commands and the authoritative step; only the starting positions are
// chosen by the test. Wind is 315 and the two legs are downwind and across the
// wind, so the upwind fallback is not the reason for a failure.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyFleetOrder,
  createPlayerFleet,
  createWorld,
  giveSpareShips,
  shipsForOwner,
  stepWorld,
  updatePlayerFleet,
  type World,
} from "@naval/shared/world";
import {
  formationForLeg,
  formationSlots,
  isOutOfStation,
  type FormationId,
} from "@naval/shared/fleets";
import { shipTypeFor } from "@naval/shared/ships";
import type { Ship } from "@naval/shared/sailing";

const WIND_FROM_DEG = 315;
const BASE = { x: 1_693.8, y: 442.4 };
const TICK = 1 / settings.server.tickHz;
const GAME_DT = settings.time.sailingTimeScale * TICK;
const LEG_KM = 10;

const PRESETS: FormationId[] = ["lineAhead", "lineAbreast", "wedge", "convoy", "freeChase"];

interface Row {
  formation: FormationId;
  seconds: number;
  inStation: number;
  largestErrorM: number;
  closestPairM: number;
}

function point(bearingDeg: number, distanceKm: number): { x: number; y: number } {
  const angle = bearingDeg * Math.PI / 180;
  return { x: BASE.x + Math.sin(angle) * distanceKm, y: BASE.y - Math.cos(angle) * distanceKm };
}

function stationReport(world: World, ownerId: string, fleetId: string): Omit<Row, "formation" | "seconds"> {
  const fleet = [...world.fleetModels.get(ownerId)?.values() ?? []].find((entry) => entry.id === fleetId);
  const own = shipsForOwner(world, ownerId);
  if (!fleet) throw new Error("fleet missing");
  const leader = own.find((ship) => ship.id === fleet.leaderId);
  if (!leader) throw new Error("leader missing");
  const active = fleet.members
    .map((id) => own.find((ship) => ship.id === id))
    .filter((ship): ship is Ship => Boolean(ship && !ship.detached && !ship.deliveryPortId && !ship.dockedPortId));
  const formation = formationForLeg(
    fleet.formation,
    leader.headingRad,
    WIND_FROM_DEG,
    shipTypeFor(leader.navy, leader.classId).closestAngleDeg,
  );
  const slots = formationSlots({
    formation,
    members: active,
    headingRad: leader.headingRad,
    leaderPath: world.fleetPaths.get(fleet.id) ?? [{ x: leader.x, y: leader.y }],
  });
  let inStation = 1;
  let largest = 0;
  for (let index = 1; index < active.length; index += 1) {
    const ship = active[index]!;
    const slot = slots[index];
    if (!slot) {
      if (formation !== "freeChase") continue;
      inStation += 1;
      continue;
    }
    const error = Math.hypot(ship.x - (leader.x + slot.x), ship.y - (leader.y + slot.y)) * 1000;
    largest = Math.max(largest, error);
    if (!isOutOfStation(ship, leader, slot)) inStation += 1;
  }
  let closest = Infinity;
  for (let a = 0; a < active.length; a += 1) {
    for (let b = a + 1; b < active.length; b += 1) {
      closest = Math.min(closest, Math.hypot(active[a]!.x - active[b]!.x, active[a]!.y - active[b]!.y) * 1000);
    }
  }
  return { inStation, largestErrorM: largest, closestPairM: closest };
}

function runPreset(formation: FormationId): Row[] {
  const world = createWorld(`test-formation-${formation}`);
  const leader = addPlayer(world, "formation-owner", "frigate", 50_000, "British");
  leader.x = BASE.x;
  leader.y = BASE.y;
  leader.headingRad = 135 * Math.PI / 180;
  leader.speedKnots = 0;
  giveSpareShips(world, "formation-owner", 9);
  const fleet = createPlayerFleet(world, "formation-owner", shipsForOwner(world, "formation-owner").map((ship) => ship.id));
  assert.ok(fleet);
  assert.equal(updatePlayerFleet(world, "formation-owner", fleet.id, { formation }), true);
  const first = point(135, LEG_KM);
  assert.equal(applyFleetOrder(world, "formation-owner", fleet.id, { type: "goTo", x: first.x, y: first.y }), true);

  const rows: Row[] = [];
  const marks = new Set([300, 600, 1_200]);
  let smallestPair = Infinity;
  for (let step = 0; step < 120 / TICK; step += 1) {
    stepWorld(world, GAME_DT, WIND_FROM_DEG);
    const active = shipsForOwner(world, "formation-owner").filter((ship) => !ship.detached);
    for (let a = 0; a < active.length; a += 1) {
      for (let b = a + 1; b < active.length; b += 1) {
        smallestPair = Math.min(
          smallestPair,
          Math.hypot(active[a]!.x - active[b]!.x, active[a]!.y - active[b]!.y) * 1000,
        );
      }
    }
    const seconds = (step + 1) * TICK;
    if (step === 599) {
      const second = point(45, LEG_KM);
      assert.equal(applyFleetOrder(world, "formation-owner", fleet.id, { type: "goTo", x: second.x, y: second.y }), true);
    }
    if (marks.has(step + 1)) {
      const report = stationReport(world, "formation-owner", fleet.id);
      rows.push({ formation, seconds: Math.round(seconds), ...report });
    }
  }
  assert.ok(smallestPair >= 40, `${formation}: ships came within ${smallestPair.toFixed(1)} m during the leg`);
  return rows;
}

test("real loop: every formation holds station and keeps 40 m apart", () => {
  const all: Row[] = [];
  for (const formation of PRESETS) all.push(...runPreset(formation));
  console.log("\nREAL-LOOP FORMATION TABLE (wind 315, 20 km with one 90 degree turn)");
  console.log("formation   second  in station  largest slot error m  closest pair m");
  for (const row of all) {
    console.log(
      `${row.formation.padEnd(11)} ${String(row.seconds).padStart(6)} ` +
      `${String(row.inStation).padStart(10)}/10 ${row.largestErrorM.toFixed(0).padStart(18)} ` +
      `${row.closestPairM.toFixed(0).padStart(16)}`,
    );
  }
  for (const row of all) {
    assert.ok(row.closestPairM >= 40, `${row.formation} at ${row.seconds}s: ships ${row.closestPairM.toFixed(0)} m apart`);
    if (row.seconds === 120 && row.formation !== "freeChase") {
      assert.ok(row.inStation >= 8, `${row.formation} at 120s: only ${row.inStation}/10 in station`);
    }
  }
});
