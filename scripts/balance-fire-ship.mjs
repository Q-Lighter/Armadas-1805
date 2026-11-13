// Seeded fire-ship balance simulation. Not part of the game build.
// Usage: node scripts/balance-fire-ship.mjs
//
// Real server loop, night, lights off, one fire ship 4 km west of five
// frigates hove to 60-100 m apart. 100 runs per stance.

import { settings } from "../shared/dist/settings.js";
import { createSeededRandom } from "../shared/dist/combat.js";
import {
  addPlayer,
  createWorld,
  orderFireShipIgnite,
  setTestTimeOfDay,
  spawnTestFireShips,
  stepWorld,
} from "../shared/dist/world.js";
import { createShip, holdPosition } from "../shared/dist/sailing.js";
import { fullStores } from "../shared/dist/trade.js";
import { shipTypeFor } from "../shared/dist/data/ships.js";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;
const RUNS = 100;
const REAL_SECONDS = 150;

function run(seed, stance) {
  const world = createWorld(`test-fire-balance-${seed}-${stance}`);
  world.combatRandom = createSeededRandom(seed * 7919 + 17);
  const leader = addPlayer(world, "alpha", "frigate", 50_000, "British");
  setTestTimeOfDay(world, 23);
  spawnTestFireShips(world, "alpha", 1);
  const fire = world.fleets.get("alpha").find((ship) => ship.classId === "fireShip");
  const groupX = leader.x + 24;
  const groupY = leader.y;
  fire.x = groupX - 4;
  fire.y = groupY;
  fire.lightsOff = true;
  fire.crew = fire.fullCrew;
  fire.damage.crew = fire.crew;

  const targets = [];
  for (let index = 0; index < 5; index += 1) {
    const ship = createShip(
      `enemy-${world.nextShipId++}`,
      "frigate",
      groupX,
      groupY + (index - 2) * 0.08,
      0,
      "French",
      `Target ${index + 1}`,
    );
    ship.crew = ship.fullCrew;
    ship.damage.crew = ship.crew;
    ship.stores = fullStores(shipTypeFor("French", "frigate"));
    ship.hoveTo = false;
    ship.speedKnots = 0;
    ship.order = null;
    ship.stance = stance;
    ship.lightsOff = true;
    holdPosition(ship);
    targets.push(ship);
  }
  world.botFleets.set("TEST-ENEMY", targets);

  orderFireShipIgnite(world, "alpha", fire.id, "contact", targets[0].id);
  let alight = new Set();
  for (let tick = 0; tick < REAL_SECONDS * settings.server.tickHz; tick += 1) {
    stepWorld(world, TICK);
    for (const target of targets) {
      if (target.fire?.burning) alight.add(target.id);
    }
    if (fire.fireShip?.ignited || !world.fleets.get("alpha").some((ship) => ship.id === fire.id)) {
      // Keep the hulk burning beside the group so later spread is counted.
      if (!fire.fireShip?.ignited) break;
    }
    if (alight.size === targets.length) break;
  }
  return {
    ignited: fire.fireShip?.ignited === true,
    sunk: !world.fleets.get("alpha").some((ship) => ship.id === fire.id),
    alight: alight.size,
  };
}

for (const stance of ["fightIfAttacked", "engage"]) {
  let ignited = 0;
  let sunk = 0;
  let shipsAlight = 0;
  let runsWithAnyAlight = 0;
  for (let runIndex = 1; runIndex <= RUNS; runIndex += 1) {
    const result = run(runIndex, stance);
    if (result.ignited) ignited += 1;
    if (result.sunk) sunk += 1;
    shipsAlight += result.alight;
    if (result.alight > 0) runsWithAnyAlight += 1;
  }
  console.log(JSON.stringify({
    stance,
    runs: RUNS,
    fireShipIgnitionRate: ignited / RUNS,
    fireShipSunkRate: sunk / RUNS,
    runsWithAnyShipAlight: runsWithAnyAlight / RUNS,
    meanShipsAlight: shipsAlight / RUNS,
  }));
}
