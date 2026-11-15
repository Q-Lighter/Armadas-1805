// Local Node proxy for 3J-fix-b network targets. Not Cloudflare CPU time.
//
// 40 ships in sight while normal sailing at 5 Hz, with the server's entity
// level of detail, 1 Hz log/route detail and capped combat events.

import { createShip } from "@naval/shared/sailing";
import { shipTypeFor } from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";
import { fullStores } from "@naval/shared/trade";
import { buildStateDelta, encodeStateDelta } from "@naval/shared/state-delta";
import { holdFarShips } from "@naval/shared/net-rate";
import {
  addPlayer,
  createWorld,
  stepWorld,
  visibleStateFor,
} from "@naval/shared/world";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const STEPS = 100;
const world = createWorld("dev-net-40");
const player = addPlayer(world, "solo", "frigate", 50_000, "British");
const ships = [];
for (let index = 0; index < 40; index += 1) {
  const angle = index * 0.618 * Math.PI * 2;
  const distance = 0.5 + index * 0.45;
  const ship = createShip(
    `sail-${index}`,
    index % 5 === 0 ? "line" : "frigate",
    player.x + Math.cos(angle) * distance,
    player.y + Math.sin(angle) * distance,
    angle + Math.PI,
    index % 2 === 0 ? "French" : "British",
    `Sail ${index}`,
  );
  ship.stores = fullStores(shipTypeFor(ship.navy, index % 5 === 0 ? "line" : "frigate"));
  ship.crew = ship.fullCrew;
  ship.damage.crew = ship.crew;
  ships.push(ship);
}
world.botFleets.set("NET-40", ships);
for (let step = 0; step < 20; step += 1) stepWorld(world, TICK);

const stream = { seq: 1, base: visibleStateFor(world, "solo"), fleetAt: 0, routeAt: 0, logAt: 0 };
stream.base.seq = 1;
let fullJson = 0;
let deltaBytes = 0;
let sends = 0;
for (let step = 0; step < STEPS; step += 1) {
  stepWorld(world, TICK);
  if (step % 2 !== 0) continue;
  const includeFleet = step % 5 === 0;
  const includeRoutes = step % 10 === 0;
  const includeLog = step % 10 === 0;
  const current = visibleStateFor(world, "solo", undefined, undefined, includeFleet);
  if (!includeFleet && stream.base.fleet) current.fleet = stream.base.fleet;
  if (!includeLog) current.log = stream.base.log;
  if ((current.events?.length ?? 0) > settings.network.maxCombatEventsPerMessage) {
    current.events = current.events.slice(-settings.network.maxCombatEventsPerMessage);
  }
  current.ships = holdFarShips(
    stream.base.ships,
    current.ships,
    new Set([player.id]),
    { x: player.x, y: player.y },
    "auto",
    step,
    settings.server.tickHz,
  );
  stream.seq += 1;
  current.seq = stream.seq;
  const delta = buildStateDelta(stream.base, current, stream.seq, includeFleet, includeRoutes);
  deltaBytes += encodeStateDelta(delta).byteLength;
  fullJson += JSON.stringify(current).length;
  stream.base = current;
  stream.fleetAt = includeFleet ? step : stream.fleetAt;
  stream.routeAt = includeRoutes ? step : stream.routeAt;
  stream.logAt = includeLog ? step : stream.logAt;
  sends += 1;
}
const seconds = STEPS / settings.server.tickHz;
console.log("40 SHIPS IN SIGHT, NORMAL SAILING (5 Hz)");
console.log({
  ships: 41,
  sends,
  simulatedSeconds: seconds,
  fullJsonBytesPerPlayerPerSecond: Math.round(fullJson / seconds),
  deltaBytesPerPlayerPerSecond: Math.round(deltaBytes / seconds),
  targetBytesPerPlayerPerSecond: 15 * 1024,
});
