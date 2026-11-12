// Local Node proxy for the 3D mass fight: 100 ships, 20 burning, 5 boardings.
// Measures the shared world step and the JSON per player at the 10 Hz battle
// rate. Not Cloudflare CPU time. Compare with the 3C 1.52 ms and 480,981 B/s.

import { addBots } from "@naval/shared/bots";
import { createShip } from "@naval/shared/sailing";
import { shipTypeFor } from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";
import { fullStores } from "@naval/shared/trade";
import { addPlayer, createWorld, stepWorld, visibleStateFor } from "@naval/shared/world";

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
const world = createWorld("dev-battle-zone");
const one = addPlayer(world, "one", "frigate", 50_000, "British");
const two = addPlayer(world, "two", "frigate", 50_000, "British");
two.x = one.x + 0.3;
two.y = one.y + 0.2;
addBots(world, 48, "one", random);
const allies = [];
for (const [ownerId, fleet] of world.botFleets) {
  for (const ship of fleet) allies.push({ ownerId, ship });
}
const enemies = [];
const enemyFleet = [];
for (let index = 0; index < 50; index += 1) {
  const ship = createShip(
    `zone-enemy-${index}`,
    "frigate",
    one.x + (index - 25) * 0.01,
    one.y - 0.4,
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
world.botFleets.set("ZONE-ENEMY", enemyFleet);
for (const flight of [one, two, ...allies.map((entry) => entry.ship)]) {
  flight.x = one.x + (Math.random() - 0.5) * 0.5;
  flight.y = one.y + 0.4;
  flight.headingRad = 0;
  flight.order = null;
  flight.stores = fullStores(shipTypeFor("British", "frigate"));
  flight.crew = flight.fullCrew;
  flight.damage.crew = flight.crew;
}
for (const { ownerId, ship } of allies) {
  const target = enemies[Math.floor(random() * enemies.length)];
  world.engagements.set(ship.id, {
    ownerId, shipId: ship.id, targetShipId: target.id, objective: "sink",
    targetMissingSinceGameMs: 0,
  });
}
for (const ship of enemies) {
  world.engagements.set(ship.id, {
    ownerId: "ZONE-ENEMY", shipId: ship.id, targetShipId: one.id, objective: "sink",
    targetMissingSinceGameMs: 0,
  });
}
// 20 burning ships and 5 grappled boarding pairs.
for (let index = 0; index < 20; index += 1) {
  const ship = enemies[index];
  ship.fire = { burning: true, strength: 20 + index * 2 };
}
for (let index = 0; index < 5; index += 1) {
  const attacker = [one, two, ...allies.slice(0, 3).map((entry) => entry.ship)][index];
  const defender = enemies[30 + index];
  attacker.boardingShipId = defender.id;
  attacker.boardingAttacker = true;
  defender.boardingShipId = attacker.id;
  defender.boardingAttacker = false;
  world.boardingFights.set(attacker.id, {
    attackerId: attacker.id, defenderId: defender.id,
    attackerOwnerId: "one", defenderOwnerId: "ZONE-ENEMY",
    startedRealMs: 0, endsRealMs: 90_000,
    winner: "attacker", attackerLost: 20, defenderLost: 80, capturedCrew: 20,
    applied: false, fullSeconds: 90,
  });
}

for (let tick = 0; tick < 10; tick += 1) stepWorld(world, TICK);
const started = process.hrtime.bigint();
for (let tick = 0; tick < STEPS; tick += 1) stepWorld(world, TICK);
const stepMs = Number(process.hrtime.bigint() - started) / 1_000_000;

let bytes10 = 0;
let bytes5 = 0;
for (let tick = 0; tick < STEPS; tick += 1) {
  stepWorld(world, TICK);
  for (const id of ["one", "two"]) {
    bytes10 += JSON.stringify(visibleStateFor(world, id)).length;
    if (tick % 2 === 0) bytes5 += JSON.stringify(visibleStateFor(world, id)).length;
  }
}
const simulatedSeconds = STEPS / settings.server.tickHz;
console.log("LOCAL NODE PROXY — not Cloudflare CPU time");
console.log({
  initialShips: 100,
  burningShips: 20,
  boardingFights: 5,
  steps: STEPS,
  simulatedSeconds,
  msPerWorldStep: Number((stepMs / STEPS).toFixed(2)),
  bytesPerPlayerPerSecond10Hz: Math.round(bytes10 / 2 / simulatedSeconds),
  bytesPerPlayerPerSecond5Hz: Math.round(bytes5 / 2 / simulatedSeconds),
  combatEvents: world.combatEvents.length,
  boardingLeft: world.boardingFights.size,
  burningLeft: world.abandonedShips.filter((ship) => ship.fire?.burning).length,
});
