// Local Node benchmark for eight players, each with a twelve-ship fleet in
// formation. This is a proxy for Cloudflare CPU, not a deployed measurement.

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyFleetOrder,
  createPlayerFleet,
  createWorld,
  spawnTestFleet,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const PLAYERS = 8;
const STEPS = 100;

function run() {
  const world = createWorld("dev-fleet-benchmark");
  for (let index = 0; index < PLAYERS; index += 1) {
    const id = `fleet-player-${index}`;
    const leader = addPlayer(world, id);
    spawnTestFleet(world, id, "frigate:11");
    const own = world.fleets.get(id) ?? [];
    const fleet = createPlayerFleet(world, id, own.map((ship) => ship.id));
    if (!fleet) throw new Error("Could not create benchmark fleet");
    const seaward = leader.headingRad;
    const point = {
      x: leader.x + Math.sin(seaward) * 60,
      y: leader.y - Math.cos(seaward) * 60,
    };
    applyFleetOrder(world, id, fleet.id, { type: "goTo", ...point });
  }

  for (let tick = 0; tick < 10; tick += 1) stepWorld(world, TICK);

  let updates = 0;
  let bytes = 0;
  const started = process.hrtime.bigint();
  for (let tick = 0; tick < STEPS; tick += 1) {
    stepWorld(world, TICK);
    if (tick % 2 === 1) {
      for (let index = 0; index < PLAYERS; index += 1) {
        const encoded = JSON.stringify(visibleStateFor(world, `fleet-player-${index}`));
        bytes += encoded.length;
        updates += 1;
      }
    }
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    players: PLAYERS,
    ships: PLAYERS * 12,
    steps: STEPS,
    totalMs: Number(elapsedMs.toFixed(1)),
    perWorldStepMs: Number((elapsedMs / STEPS).toFixed(2)),
    perUpdateMs: Number((elapsedMs / updates).toFixed(2)),
    averageUpdateBytes: Math.round(bytes / updates),
  };
}

console.log("LOCAL NODE PROXY — not Cloudflare CPU time");
console.table([run()]);
