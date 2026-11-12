// The four battle orders and their pure geometry. Capture and Sink change the
// existing engagement objective; Run and Surrender are separate ship states.
// The server owns timing and land checks; these functions stay browser-free.

import { settings } from "./settings.js";
import type { Stance } from "./stances.js";

export type BattleOrder = "capture" | "sink" | "run" | "surrender";

export const BATTLE_ORDERS: readonly BattleOrder[] = [
  "capture",
  "sink",
  "run",
  "surrender",
];

export const BATTLE_ORDER_LABELS: Record<BattleOrder, string> = {
  capture: "Capture",
  sink: "Sink",
  run: "Run",
  surrender: "Surrender",
};

export function objectiveForOrder(order: BattleOrder): "capture" | "sink" | null {
  return order === "capture" || order === "sink" ? order : null;
}

export function battleOrderForObjective(objective: "capture" | "sink"): BattleOrder {
  return objective;
}

/** A point on the compass, in radians, that the ship should head for. */
export interface RunState {
  /** Game time the run started. */
  startedAtGameMs: number;
  /** Current heading away from the enemies, in radians. */
  headingRad: number;
  /** Last re-steer, on the real battle clock in seconds. */
  lastSteerRealSeconds: number;
  /** Enemy ship ids that were fighting or in sight when the run began. */
  enemies: string[];
  /** Real milliseconds when every enemy was last out of sight, or null. */
  outOfSightSinceRealMs: number | null;
}

export interface RunEnemy {
  x: number;
  y: number;
}

/**
 * The weighted direction directly away from the nearest enemies. Closer ships
 * count more (weight 1 / distance), so a close attacker turns the ship away
 * before a distant one. Returns null when there is nothing to run from.
 */
export function runHeadingAway(
  from: { x: number; y: number },
  enemies: readonly RunEnemy[],
): number | null {
  let x = 0;
  let y = 0;
  for (const enemy of enemies) {
    const dx = from.x - enemy.x;
    const dy = from.y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (!(distance > 0.01)) continue;
    const weight = 1 / Math.max(distance, 0.2);
    x += (dx / distance) * weight;
    y += (dy / distance) * weight;
  }
  if (Math.hypot(x, y) < 1e-9) return null;
  return Math.atan2(x, -y);
}

/** A run ends after this many real seconds with every enemy out of sight. */
export function runEscaped(
  outOfSightSinceRealMs: number | null,
  nowRealMs: number,
): boolean {
  return outOfSightSinceRealMs !== null &&
    nowRealMs - outOfSightSinceRealMs >= settings.combat.runEscapeSeconds * 1_000;
}

/** Why a surrender cannot be accepted; null means it can. */
export function surrenderAcceptProblem(input: {
  fleetCount: number;
  nearestShipKm: number | null;
  maxShips?: number;
  rangeM?: number;
}): string | null {
  const rangeKm = (input.rangeM ?? settings.combat.surrenderAcceptRangeM) / 1_000;
  if (input.nearestShipKm === null || input.nearestShipKm > rangeKm) {
    return "No ship of yours is within 1 km.";
  }
  if (input.fleetCount >= (input.maxShips ?? settings.ships.maxShipsPerPlayer)) {
    return `Fleet full (${settings.ships.maxShipsPerPlayer} ships).`;
  }
  return null;
}

/** The default objective and stance behaviour, kept pure for tests. */
export function stanceBattleOrder(stance: Stance): BattleOrder | null {
  if (stance === "engage") return "sink";
  if (stance === "fightIfAttacked") return "sink";
  if (stance === "avoid") return "run";
  return null;
}

/** Ships inside this radius of an engaged enemy make a battle zone. */
export function isInBattleZone(
  ship: { x: number; y: number },
  engaged: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  return engaged.some(
    (enemy) =>
      Math.hypot(ship.x - enemy.x, ship.y - enemy.y) <= settings.combat.battleZoneKm,
  );
}
