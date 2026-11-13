// 3F Part B balance simulation. Stand-and-fire at 600 m with Sink orders.
// This is deliberately the same pure damage and hit-band rules as the game.
import { settings } from "../shared/dist/settings.js";
import { shipTypeFor } from "../shared/dist/data/ships.js";
import {
  damagePort,
  hitChanceAt,
  newPortBattle,
  portGunPounds,
  portGuns,
  setPortCentreHook,
} from "../shared/dist/portBattle.js";

setPortCentreHook(() => ({ x: 0, y: 0 }));
const B = settings.ports.battle;
const PORTS = {
  S: { id: "small", name: "Small port", size: "S", npc: false },
  M: { id: "medium", name: "Medium port", size: "M", npc: false },
  L: { id: "large", name: "Large port", size: "L", npc: false },
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function simulate(label, port, shipTypes, seed) {
  const random = seeded(seed);
  const state = newPortBattle(port);
  const ships = shipTypes.map((classId, index) => {
    const spec = shipTypeFor("British", classId);
    return {
      id: `${label}-${index}`,
      spec,
      hull: spec.hull,
      maxHull: spec.hull,
      reload: 0,
    };
  });
  let portReload = 0;
  let gameSeconds = 0;
  const step = 1;
  while (state.health > 0 && ships.some((ship) => ship.hull > 0) && gameSeconds < 12 * 3600) {
    gameSeconds += step;
    for (const ship of ships) {
      if (ship.hull <= 0) continue;
      ship.reload -= step;
      if (ship.reload > 0) continue;
      ship.reload = ship.spec.reloadGameMinutes * 60;
      if (random() < hitChanceAt(B.engageRangeKm)) {
        damagePort(state, port, "attacker", ship.spec.broadsideLb, gameSeconds / 144);
      }
    }
    portReload -= step;
    if (portReload <= 0) {
      portReload = B.reloadGameMinutes * 60;
      const guns = portGuns(port.size, state.tier);
      const share = state.health / (B.health[port.size]);
      const barrels = [
        ...Array(guns.heavy).fill(B.gunPounds.heavy),
        ...Array(guns.medium).fill(B.gunPounds.medium),
        ...Array(guns.light).fill(B.gunPounds.light),
      ];
      const alive = ships.filter((ship) => ship.hull > 0);
      if (alive.length > 0) {
        for (const pounds of barrels) {
          if (random() >= share) continue;
          if (random() >= hitChanceAt(B.engageRangeKm)) continue;
          const target = alive[Math.floor(random() * alive.length)];
          target.hull = Math.max(0, target.hull - pounds);
        }
      }
    }
  }
  const hullLost = ships.reduce((sum, ship) => sum + (ship.maxHull - ship.hull), 0);
  const totalHull = ships.reduce((sum, ship) => sum + ship.maxHull, 0);
  const lostShare = totalHull > 0 ? hullLost / totalHull : 0;
  const sunk = ships.filter((ship) => ship.hull <= 0).length;
  console.log(
    `${label.padEnd(26)} port ${state.health <= 0 ? "SILENCED" : "holds"} in ` +
    `${(gameSeconds / 60).toFixed(0).padStart(4)} game min ` +
    `(${(gameSeconds / 144 / 60).toFixed(1)} real min at 144x); ` +
    `hull lost ${(lostShare * 100).toFixed(1)}% (${sunk} sunk); ` +
    `port health left ${Math.round(state.health)}/${B.health[port.size]}`,
  );
  return { gameSeconds, lostShare, silenced: state.health <= 0, sunk };
}

console.log("Port defence balance, stand-and-fire at 600 m (Draft numbers)");
simulate("flagship vs small", PORTS.S, ["flagship"], 11);
simulate("frigate vs small", PORTS.S, ["frigate"], 12);
simulate("flagship vs medium", PORTS.M, ["flagship"], 13);
simulate("1 line vs large", PORTS.L, ["line"], 14);
simulate("3 line vs large", PORTS.L, ["line", "line", "line"], 15);
simulate("4 line vs large", PORTS.L, ["line", "line", "line", "line"], 16);
