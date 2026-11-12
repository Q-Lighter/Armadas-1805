// TEMP-DEBUG: local Node proxy for a 100-ship mass battle.
//
// 50 British frigates against 50 French frigates, every ship engaged and all
// within 1 km of an enemy. This measures the shared world update only; it is
// not Cloudflare CPU time. Compare it with the earlier 96-ship fleet benchmark.

import { addBots } from "@naval/shared/bots";
import { createShip } from "@naval/shared/sailing";
import { shipTypeFor } from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";
import { fullStores } from "@naval/shared/trade";
import { addPlayer, createWorld, stepWorld } from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
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

const random = seededRandom(1805);
const world = createWorld("dev-battle-benchmark");
const human = addPlayer(world, "benchmark-human");
addBots(world, 50, "benchmark-human", random);

const allies = [];
for (const [ownerId, fleet] of world.botFleets) {
  for (const ship of fleet) allies.push({ ownerId, ship });
}

const enemies = [];
const enemyFleet = [];
for (let index = 0; index < 50; index += 1) {
  const ship = createShip(
    `bench-enemy-${index}`,
    "frigate",
    human.x + (index - 25) * 0.012,
    human.y - 0.4,
    0,
    "French",
    `Enemy ${index}`,
  );
  ship.stores = fullStores(shipTypeFor("French", "frigate"));
  ship.crew = ship.fullCrew;
  ship.damage.crew = ship.crew;
  enemyFleet.push(ship);
  enemies.push(ship);
}
world.botFleets.set("BENCH-ENEMY", enemyFleet);

for (let index = 0; index < allies.length; index += 1) {
  const { ship } = allies[index];
  ship.x = human.x + (index - 25) * 0.012;
  ship.y = human.y + 0.4;
  ship.headingRad = 0;
  ship.order = null;
  ship.stores = fullStores(shipTypeFor("British", "frigate"));
  ship.crew = ship.fullCrew;
  ship.damage.crew = ship.crew;
}

function nearest(from, list) {
  let best = list[0];
  let bestDistance = Infinity;
  for (const other of list) {
    const distance = Math.hypot(other.x - from.x, other.y - from.y);
    if (distance < bestDistance) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
}

for (const { ownerId, ship } of allies) {
  const target = nearest(ship, enemies);
  world.engagements.set(ship.id, {
    ownerId,
    shipId: ship.id,
    targetShipId: target.id,
    objective: "sink",
    targetMissingSinceGameMs: 0,
  });
}
for (const ship of enemies) {
  const target = nearest(ship, allies.map((entry) => entry.ship));
  world.engagements.set(ship.id, {
    ownerId: "BENCH-ENEMY",
    shipId: ship.id,
    targetShipId: target.id,
    objective: "sink",
    targetMissingSinceGameMs: 0,
  });
}

for (let tick = 0; tick < 10; tick += 1) stepWorld(world, TICK);

const started = process.hrtime.bigint();
for (let tick = 0; tick < STEPS; tick += 1) stepWorld(world, TICK);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
const shipsLeft = [...world.fleets.values()].reduce((sum, fleet) => sum + fleet.length, 0) +
  [...world.botFleets.values()].reduce((sum, fleet) => sum + fleet.length, 0);

console.log("LOCAL NODE PROXY — not Cloudflare CPU time");
console.log({
  initialShips: 101,
  shipsInBattle: 100,
  steps: STEPS,
  simulatedSeconds: STEPS / settings.server.tickHz,
  totalMs: Number(elapsedMs.toFixed(1)),
  msPerWorldStep: Number((elapsedMs / STEPS).toFixed(2)),
  msPerSimulatedSecond: Number((elapsedMs / (STEPS / settings.server.tickHz)).toFixed(1)),
  shipsLeft,
  combatEvents: world.combatEvents.length,
});
