// 3F Part C benchmark: 100 ships and 5 ports all firing in the world step.
import { PLACED_PORTS } from "../shared/dist/data/ports.js";
import {
  addPlayer,
  createWorld,
  spawnTestFleet,
  stepWorld,
} from "../shared/dist/world.js";
import { settings } from "../shared/dist/settings.js";

const world = createWorld("test-port-benchmark");
const ports = PLACED_PORTS.filter((port) => !port.npc).slice(0, 5);
const playerIds = [];
for (let p = 0; p < 5; p += 1) {
  const id = `bench-${p}`;
  playerIds.push(id);
  addPlayer(world, id, "frigate", 50_000, "British");
  spawnTestFleet(world, id, "frigate:19");
  const fleet = world.fleets.get(id);
  const port = ports[p];
  fleet.forEach((ship, index) => {
    const angle = (index / fleet.length) * Math.PI * 2;
    ship.x = port.anchorage.x + Math.sin(angle) * 0.5;
    ship.y = port.anchorage.y + Math.cos(angle) * 0.5;
    ship.fleetId = null;
    ship.reloadReadyRealSeconds = 0;
    world.portAttackTargets.set(ship.id, port.id);
  });
}
for (const port of ports) {
  const state = world.portBattles.get(port.id);
  for (const id of playerIds) state.aggressors.set(id, 1_000_000);
  state.health = 12_000;
}
const dt = settings.time.sailingTimeScale / settings.server.tickHz;
for (let i = 0; i < 10; i += 1) stepWorld(world, dt);
const samples = [];
for (let i = 0; i < 100; i += 1) {
  const start = performance.now();
  stepWorld(world, dt);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
console.log(`100 ships + 5 ports firing: mean ${mean.toFixed(3)} ms/step, ` +
  `p50 ${samples[50].toFixed(3)} ms, p95 ${samples[95].toFixed(3)} ms, ` +
  `max ${samples[samples.length - 1].toFixed(3)} ms`);
