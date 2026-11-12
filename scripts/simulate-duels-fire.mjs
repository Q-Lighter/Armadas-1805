// Duel-length check with 3D fires enabled. Same 100 runs, 450 m beam-on,
// Sink orders. Each landed hit may ignite; fire grows, fights with stores and
// damages hull and crew until it is out or the ship sinks.

import {
  createSeededRandom, createShipDamage, crewPercent, crewTooLow,
  damageCapacities, reloadRealSeconds, resolveFiring,
} from "@naval/shared/combat";
import { fireDamage as fireDamage3d, fightFire as fightFire3d, growFire as growFire3d, igniteFire as igniteFire3d, explosionChance } from "@naval/shared/boarding";
import { shipTypeFor } from "@naval/shared/ships";
import { settings } from "@naval/shared/settings";

const RUNS = 100;
const RANGE_KM = 0.45;
const BEARING = Math.PI / 2;
const HEADING = 0;
const WIND_FROM = 0;

function duel(navy, classId, seed) {
  const spec = shipTypeFor(navy, classId);
  const damage = [createShipDamage(spec), createShipDamage(spec)];
  const fire = [{ burning: false, strength: 0 }, { burning: false, strength: 0 }];
  const stores = [100, 100];
  const nextFire = [0, 0];
  const random = createSeededRandom(seed);
  let time = 0;
  let lastTime = 0;
  let sunkAt = null;

  function burn(seconds) {
    if (seconds <= 0) return;
    for (let index = 0; index < 2; index += 1) {
      if (!fire[index].burning || damage[index].hull <= 0) continue;
      const hit = fireDamage3d(fire[index].strength, spec.hull, spec.crew, seconds);
      damage[index].hull = Math.max(0, damage[index].hull - hit.hullLoss);
      damage[index].crew = Math.max(0, damage[index].crew - hit.crewLoss);
      const fought = fightFire3d(fire[index], crewPercent(damage[index], damageCapacities(spec)), stores[index], seconds);
      stores[index] = Math.max(0, stores[index] - fought.materialsUsed);
      fire[index] = { burning: fought.burning, strength: fought.strength };
      if (damage[index].hull <= 0) sunkAt = time;
    }
  }

  for (let event = 0; event < 10_000; event += 1) {
    const live = damage.map((state) => state.hull > 0);
    if (!live[0] || !live[1]) break;
    time = Math.min(nextFire[0], nextFire[1]);
    if (!Number.isFinite(time) || time > 1_200) break;
    burn(time - lastTime);
    lastTime = time;
    if (damage[0].hull <= 0 || damage[1].hull <= 0) {
      sunkAt ??= time;
      break;
    }

    const firing = nextFire.map((ready, index) => ready <= time + 1e-9 && live[index]);
    const snapshot = damage.map((state) => ({ ...state }));
    const results = [null, null];
    for (let index = 0; index < 2; index += 1) {
      if (!firing[index]) continue;
      const capacities = damageCapacities(spec);
      if (crewTooLow(snapshot[index], capacities)) continue;
      results[index] = resolveFiring({
        spec,
        damage: snapshot[index],
        targetClass: classId,
        distanceKm: RANGE_KM,
        targetBearingRad: BEARING,
        headingRad: HEADING,
        windFromDeg: WIND_FROM,
        ammunitionTonnes: 100_000,
        objective: "sink",
        random,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      const result = results[index];
      if (!result) continue;
      damage[1 - index] = result.damage;
      if (result.fired && result.hits > 0) {
        for (let hit = 0; hit < result.hits; hit += 1) {
          fire[1 - index] = igniteFire3d(fire[1 - index], random);
        }
      }
      const capacities = damageCapacities(spec);
      const pct = crewPercent(damage[index], capacities);
      nextFire[index] = time + reloadRealSeconds(spec, pct);
    }
    // Explosions under 15% hull, checked at each salvo interval.
    for (let index = 0; index < 2; index += 1) {
      if (damage[index].hull > 0 && random() < explosionChance(spec.hull, damage[index].hull, Math.max(1, time - lastTime))) {
        damage[index].hull = 0;
        damage[index].crew = 0;
        sunkAt ??= time;
      }
    }
    if (damage[0].hull <= 0 || damage[1].hull <= 0) {
      sunkAt ??= time;
      break;
    }
  }
  return (sunkAt ?? time) / 60;
}

function run(label, navy, classId) {
  const lengths = [];
  for (let runIndex = 0; runIndex < RUNS; runIndex += 1) {
    lengths.push(duel(navy, classId, 10_000 + runIndex * 17 + classId.length * 101 + navy.length));
  }
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  lengths.sort((a, b) => a - b);
  console.log(`${label.padEnd(22)} avg ${average.toFixed(2)} min  median ${lengths[50].toFixed(2)}  range ${lengths[0].toFixed(2)}-${lengths.at(-1).toFixed(2)}`);
  return average;
}

console.log(`DUEL SIMULATION WITH FIRES: ${RUNS} runs, 450 m, beam-on, Sink orders, one game minute = ${settings.combat.battleSecondsPerGameMinute} real second`);
run("raider vs raider", "British", "raider");
run("frigate vs frigate", "British", "frigate");
run("line vs line", "British", "line");
run("flagship vs flagship", "British", "flagship");
