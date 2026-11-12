// Local duel simulation for the combat numbers. Not part of the game.
// Both ships hold a steady 450 m beam-on range, fire every reload and use
// Sink orders. The range is inside the agreed 300-600 m band.

import { createSeededRandom, createShipDamage, crewPercent, crewTooLow, damageCapacities, reloadRealSeconds, resolveFiring, shipPerformance } from "@naval/shared/combat";
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
  const nextFire = [0, 0];
  const random = createSeededRandom(seed);
  let time = 0;
  let sunkAt = null;

  for (let event = 0; event < 10_000; event += 1) {
    const live = damage.map((state) => state.hull > 0);
    if (!live[0] || !live[1]) break;
    time = Math.min(nextFire[0], nextFire[1]);
    if (!Number.isFinite(time) || time > 1_200) break;

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
      const capacities = damageCapacities(spec);
      const pct = crewPercent(damage[index], capacities);
      nextFire[index] = time + reloadRealSeconds(spec, pct);
    }
    if (damage[0].hull <= 0 || damage[1].hull <= 0) {
      sunkAt = time;
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

console.log(`DUEL SIMULATION: ${RUNS} runs, 450 m, beam-on, Sink orders, one game minute = ${settings.combat.battleSecondsPerGameMinute} real second`);
run("raider vs raider", "British", "raider");
run("frigate vs frigate", "British", "frigate");
run("line vs line", "British", "line");
run("flagship vs flagship", "British", "flagship");
