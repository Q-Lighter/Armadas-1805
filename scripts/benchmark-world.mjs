// TEMP-DEBUG: rough local benchmark of the shared world with bot fleets.
//
// This is a Node proxy, not a measurement of Cloudflare CPU. Run it after
// `npm test` or `npm run build` has compiled shared/dist.
//
// It simulates ten real seconds per ship count: 100 world steps and eight fake
// player updates at 5 Hz, including JSON encoding and then discarding the bytes.

import { addBots } from "@naval/shared/bots";
import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  createWorld,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const FAKE_PLAYERS = settings.loadTest.fakePlayers;
const STEPS = 100;

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

function run(shipCount) {
  const world = createWorld("dev-benchmark");
  addPlayer(world, "benchmark-human");
  addBots(world, shipCount, "benchmark-human", seededRandom(1805 + shipCount));
  const owners = [...world.botFleets.keys()];

  // Warm-up: let the fleets settle onto their first courses.
  for (let tick = 0; tick < 10; tick += 1) stepWorld(world, TICK);

  let updates = 0;
  let bytes = 0;
  const started = process.hrtime.bigint();

  for (let tick = 0; tick < STEPS; tick += 1) {
    stepWorld(world, TICK);
    if (tick % 2 === 1) {
      for (const owner of owners) {
        const encoded = JSON.stringify(visibleStateFor(world, owner));
        bytes += encoded.length;
        updates += 1;
      }
    }
  }

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    ships: shipCount,
    fakePlayers: owners.length,
    simulatedSeconds: STEPS / settings.server.tickHz,
    totalMs: Number(elapsedMs.toFixed(1)),
    perSimulatedSecondMs: Number((elapsedMs / (STEPS / settings.server.tickHz)).toFixed(1)),
    perWorldStepMs: Number((elapsedMs / STEPS).toFixed(2)),
    perBotUpdateMs: Number((elapsedMs / updates).toFixed(2)),
    averageUpdateBytes: Math.round(bytes / updates),
  };
}

console.log("LOCAL NODE PROXY — not Cloudflare CPU time");
console.table([25, 50, 100, 200].map(run));
