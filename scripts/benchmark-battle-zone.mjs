// Local Node proxy for a 100-ship battle zone with two players watching.
// Measures the shared world step and the JSON sent per player at 10 Hz versus
// the unchanged 5 Hz rate. Not Cloudflare CPU time.

import { addBots } from "@naval/shared/bots";
import { createShip } from "@naval/shared/sailing";
import { shipTypeFor } from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";
import { fullStores } from "@naval/shared/trade";
import {
  addPlayer,
  applyShipSpecialOrder,
  battleZoneVisibleFor,
  createWorld,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

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
two.fleetId = null;
addBots(world, 50, "one", random);
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
for (let index = 0; index < allies.length; index += 1) {
  const { ship } = allies[index];
  ship.x = one.x + (index - 25) * 0.01;
  ship.y = one.y + 0.4;
  ship.headingRad = 0;
  ship.order = null;
  ship.stores = fullStores(shipTypeFor("British", "frigate"));
  ship.crew = ship.fullCrew;
  ship.damage.crew = ship.crew;
}
for (const { ownerId, ship } of allies) {
  const target = enemies[Math.floor(Math.random() * enemies.length)];
  applyShipSpecialOrder(world, ownerId, ship.id, { type: "engage", shipId: target.id, objective: "sink" });
}
for (const ship of enemies) {
  applyShipSpecialOrder(world, "two", ship.id, { type: "engage", shipId: one.id, objective: "sink" });
}

for (let tick = 0; tick < 10; tick += 1) stepWorld(world, TICK);
console.log("LOCAL NODE PROXY — not Cloudflare CPU time");
console.log("battle zone visible one/two:", battleZoneVisibleFor(world, "one"), battleZoneVisibleFor(world, "two"));

const stepStarted = process.hrtime.bigint();
for (let tick = 0; tick < STEPS; tick += 1) stepWorld(world, TICK);
const stepMs = Number(process.hrtime.bigint() - stepStarted) / 1_000_000;

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
console.log({
  initialShips: 102,
  shipsInBattle: 100,
  steps: STEPS,
  simulatedSeconds,
  msPerWorldStep: Number((stepMs / STEPS).toFixed(2)),
  battleSendHz: settings.combat.battleSendRate,
  normalSendHz: settings.server.broadcastHz,
  bytesPerPlayerPerSecond10Hz: Math.round(bytes10 / 2 / simulatedSeconds),
  bytesPerPlayerPerSecond5Hz: Math.round(bytes5 / 2 / simulatedSeconds),
  dataRatio10To5: Number((bytes10 / bytes5).toFixed(2)),
  combatEvents: world.combatEvents.length,
});
