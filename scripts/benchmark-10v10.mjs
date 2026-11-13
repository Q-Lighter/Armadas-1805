// TEMP-DEBUG: local Node benchmark for two 10-ship fleets in one battle zone.
// It measures the shared world step and the full player state before delta
// updates exist. Not Cloudflare CPU time.

import { createShip } from "@naval/shared/sailing";
import { shipTypeFor } from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";
import { fullStores } from "@naval/shared/trade";
import { buildStateDelta, encodeStateDelta } from "@naval/shared/state-delta";
import {
  addPlayer,
  applyFleetOrder,
  applyShipSpecialOrder,
  createPlayerFleet,
  createWorld,
  giveSpareShips,
  shipsForOwner,
  stepWorld,
  updatePlayerFleet,
  visibleStateFor,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const STEPS = 200;
const WARMUP = 30;

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const world = createWorld("dev-bench-10v10");
const a = addPlayer(world, "blue", "frigate", 50_000, "British");
const b = addPlayer(world, "red", "frigate", 50_000, "French");
giveSpareShips(world, "blue", 9);
giveSpareShips(world, "red", 9);
const blue = shipsForOwner(world, "blue");
const red = shipsForOwner(world, "red");
if (blue.length !== 10 || red.length !== 10) throw new Error("benchmark needs 10 v 10");

// Put the two fleets in parallel lines inside one battle zone.
for (const [fleet, xOffset] of [[blue, 0], [red, 0.65]]) {
  fleet.forEach((ship, index) => {
    ship.x = 1693.8 + xOffset;
    ship.y = 442.4 + (index - 4.5) * 0.185;
    ship.headingRad = Math.PI / 2;
    ship.speedKnots = 4;
    ship.stores = fullStores(shipTypeFor(ship.navy, "frigate"));
    ship.crew = ship.fullCrew;
    ship.damage.crew = ship.crew;
    ship.repairEnabled = false;
  });
}
const blueFleet = createPlayerFleet(world, "blue", blue.map((ship) => ship.id), "Blue line");
const redFleet = createPlayerFleet(world, "red", red.map((ship) => ship.id), "Red line");
if (!blueFleet || !redFleet) throw new Error("could not create fleets");
updatePlayerFleet(world, "blue", blueFleet.id, { formation: "lineAhead" });
updatePlayerFleet(world, "red", redFleet.id, { formation: "lineAhead" });
applyFleetOrder(world, "blue", blueFleet.id, { type: "goTo", x: 1703.8, y: 442.4 });
applyFleetOrder(world, "red", redFleet.id, { type: "goTo", x: 1683.8, y: 442.4 });

world.combatRandom = seededRandom(1805);
for (let index = 0; index < 10; index += 1) {
  applyShipSpecialOrder(world, "blue", blue[index].id, {
    type: "engage", shipId: red[index].id, objective: "sink",
  });
  applyShipSpecialOrder(world, "red", red[index].id, {
    type: "engage", shipId: blue[index].id, objective: "sink",
  });
}
// Every fifth ship is already burning; the first pair is boarding.
for (let index = 0; index < 10; index += 5) {
  blue[index].fire = { burning: true, strength: 20 };
  red[index].fire = { burning: true, strength: 20 };
}
red[0].x = blue[0].x + 0.05;
red[0].y = blue[0].y;
red[0].headingRad = blue[0].headingRad;
red[0].speedKnots = blue[0].speedKnots;
const { orderBoarding } = await import("@naval/shared/world");
orderBoarding(world, "blue", blue[0].id, red[0].id);

for (let step = 0; step < WARMUP; step += 1) stepWorld(world, TICK);

const stepStarted = process.hrtime.bigint();
for (let step = 0; step < STEPS; step += 1) stepWorld(world, TICK);
const stepMs = Number(process.hrtime.bigint() - stepStarted) / 1_000_000;

// Measure the exact full state bytes and message count over one simulated second.
let bytes = 0;
let messages = 0;
let events = 0;
let tenHzBytes = 0;
let tenHzMessages = 0;
for (let step = 0; step < settings.server.tickHz; step += 1) {
  stepWorld(world, TICK);
  for (const id of ["blue", "red"]) {
    const state = visibleStateFor(world, id);
    const size = Buffer.byteLength(JSON.stringify(state));
    bytes += size;
    messages += 1;
    events += state.events?.length ?? 0;
    if (step % Math.max(1, Math.round(settings.server.tickHz / settings.combat.battleSendRate)) === 0) {
      tenHzBytes += size;
      tenHzMessages += 1;
    }
  }
}
const seconds = settings.server.tickHz / settings.server.tickHz;
// Steady-state delta stream: first state is full, then each send carries only
// changed ships/fields. Fleet detail is sent at the configured panel period.
const deltaStreams = new Map();
for (const id of ["blue", "red"]) {
  const full = visibleStateFor(world, id);
  full.seq = 1;
  deltaStreams.set(id, { seq: 1, base: full, fleetAt: 0 });
}
let deltaBytes = 0;
let deltaMessages = 0;
for (let step = 0; step < settings.server.tickHz; step += 1) {
  stepWorld(world, TICK);
  for (const id of ["blue", "red"]) {
    const stream = deltaStreams.get(id);
    const includeFleet = step % Math.max(1, Math.round(settings.network.fleetDetailSeconds * settings.server.tickHz)) === 0;
    const current = visibleStateFor(world, id, undefined, undefined, includeFleet);
    stream.seq += 1;
    current.seq = stream.seq;
    const delta = buildStateDelta(stream.base, current, stream.seq, includeFleet);
    deltaBytes += encodeStateDelta(delta).byteLength;
    deltaMessages += 1;
    stream.base = current;
  }
}
console.log("10 v 10 BATTLE BENCHMARK (after delta/network changes)");
console.log({
  ships: blue.length + red.length,
  steps: STEPS,
  msPerWorldStep: Number((stepMs / STEPS).toFixed(2)),
  fiveHzBytesPerPlayerPerSecond: Math.round(bytes / 2 / seconds),
  fiveHzMessagesPerPlayerPerSecond: Math.round(messages / 2 / seconds),
  tenHzBytesPerPlayerPerSecond: Math.round(tenHzBytes / 2 / seconds),
  tenHzMessagesPerPlayerPerSecond: Math.round(tenHzMessages / 2 / seconds),
  combatEventsPerSecond: Math.round(events / 2 / seconds),
  activeFires: [...world.fleets.values()].flat().filter((ship) => ship.fire?.burning).length,
  boardingFights: world.boardingFights.size,
  deltaBytesPerPlayerPerSecond: Math.round(deltaBytes / 2 / seconds),
  deltaMessagesPerPlayerPerSecond: Math.round(deltaMessages / 2 / seconds),
});
