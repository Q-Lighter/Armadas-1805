// Part B sailing smoothness: straight tracks, hove-to neighbours and a
// 100-ship world-step budget.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { addBots } from "@naval/shared/bots";
import { holdPosition } from "@naval/shared/sailing";
import {
  addPlayer,
  applyOrder,
  createWorld,
  giveSpareShips,
  shipsForOwner,
  stepWorld,
} from "@naval/shared/world";

const BASE = { x: 1_693.8, y: 442.4 };
const WIND = 315;
const TICK = settings.time.sailingTimeScale / settings.server.tickHz;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function straightRun(withForty: boolean): { sidewaysKm: number; minKnots: number; maxKnots: number; samples: number } {
  const world = createWorld(withForty ? "dev-straight-with-forty" : "dev-straight-alone");
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  world.windFromDeg = WIND;
  world.charts.get("alpha")!.bits.fill(0xff);
  ship.x = BASE.x;
  ship.y = BASE.y;
  ship.headingRad = Math.PI / 2;
  ship.speedKnots = 5;
  ship.fleetId = null;
  ship.order = null;
  ship.route = null;
  if (withForty) {
    addBots(world, 40, "alpha", seeded(1805));
    let index = 0;
    for (const fleet of world.botFleets.values()) {
      for (const bot of fleet) {
        bot.x = BASE.x + (index % 8) * 0.08;
        bot.y = BASE.y + 10 + Math.floor(index / 8) * 0.08;
        bot.speedKnots = 0;
        bot.order = null;
        bot.route = null;
        index += 1;
      }
    }
  }
  assert.equal(applyOrder(world, "alpha", BASE.x + 8, BASE.y), true);
  let sidewaysKm = 0;
  let minKnots = Number.POSITIVE_INFINITY;
  let maxKnots = 0;
  let samples = 0;
  for (let tick = 0; tick < 100 && ship.route; tick += 1) {
    stepWorld(world, TICK);
    if (tick < 10 || !ship.route || ship.speedKnots < 0.5) continue;
    sidewaysKm = Math.max(sidewaysKm, Math.abs(ship.y - BASE.y));
    minKnots = Math.min(minKnots, ship.speedKnots);
    maxKnots = Math.max(maxKnots, ship.speedKnots);
    samples += 1;
  }
  return { sidewaysKm, minKnots, maxKnots, samples };
}

test("a straight sea order is a straight line at constant speed, with and without 40 ships", () => {
  for (const withForty of [false, true]) {
    const run = straightRun(withForty);
    assert.ok(run.samples >= 10, "the ship stayed under way long enough");
    assert.ok(run.sidewaysKm < 0.02,
      `${withForty ? "with" : "without"} 40 ships drifted ${(run.sidewaysKm * 1000).toFixed(1)} m off the line`);
    assert.ok(run.maxKnots - run.minKnots < 0.1,
      `speed varied by ${(run.maxKnots - run.minKnots).toFixed(2)} knots`);
  }
});

test("five hove-to ships 60-100 m apart do not drift or swing in 60 seconds", () => {
  const world = createWorld("test-hove-to-separation");
  addPlayer(world, "alpha", "frigate", 50_000, "British");
  giveSpareShips(world, "alpha", 4);
  const ships = shipsForOwner(world, "alpha").slice(0, 5);
  assert.equal(ships.length, 5);
  // A five-point ring: nearest neighbours are about 70 m apart, inside the
  // old 80 m heading-avoid band.
  const points: Array<[number, number]> = [
    [0, 0.06], [0.057, 0.019], [0.035, -0.049], [-0.035, -0.049], [-0.057, 0.019],
  ];
  for (let index = 0; index < ships.length; index += 1) {
    const ship = ships[index]!;
    const point = points[index]!;
    ship.x = BASE.x + point[0];
    ship.y = BASE.y + point[1];
    ship.fleetId = null;
    ship.detached = true;
    ship.formationStation = false;
    holdPosition(ship);
  }
  const started = ships.map((ship) => ({ x: ship.x, y: ship.y, heading: ship.headingRad }));
  for (let tick = 0; tick < 60; tick += 1) stepWorld(world, 1);
  let movedKm = 0;
  let turnedRad = 0;
  for (let index = 0; index < ships.length; index += 1) {
    const ship = ships[index]!;
    movedKm = Math.max(movedKm, Math.hypot(ship.x - started[index]!.x, ship.y - started[index]!.y));
    turnedRad = Math.max(turnedRad, Math.abs(ship.headingRad - started[index]!.heading));
  }
  assert.ok(movedKm <= 0.002, `hove-to ship moved ${(movedKm * 1000).toFixed(1)} m`);
  assert.ok(turnedRad < 0.002, `hove-to ship swung ${(turnedRad * 180 / Math.PI).toFixed(2)}°`);
});

test("a 100-ship world step stays under the Draft limit", () => {
  const world = createWorld("dev-100-step-limit");
  const one = addPlayer(world, "one", "frigate", 50_000, "British");
  addPlayer(world, "two", "frigate", 50_000, "British");
  addBots(world, 98, "one", seeded(100));
  const bots = [];
  for (const fleet of world.botFleets.values()) for (const ship of fleet) bots.push(ship);
  for (let index = 0; index < bots.length; index += 1) {
    const angle = (index / bots.length) * Math.PI * 2;
    const ring = 0.1 + (index % 4) * 0.06;
    bots[index]!.x = one.x + Math.sin(angle) * ring;
    bots[index]!.y = one.y - Math.cos(angle) * ring;
    bots[index]!.speedKnots = 0;
  }
  for (let tick = 0; tick < 20; tick += 1) stepWorld(world, TICK);
  let worstMs = 0;
  for (let tick = 0; tick < 100; tick += 1) {
    const started = process.hrtime.bigint();
    stepWorld(world, TICK);
    worstMs = Math.max(worstMs, Number(process.hrtime.bigint() - started) / 1_000_000);
  }
  assert.ok(worstMs < settings.server.maxWorldStepMs,
    `worst 100-ship world step was ${worstMs.toFixed(1)} ms (limit ${settings.server.maxWorldStepMs} ms)`);
});
