// Browser-free plans for the 3B-c combat screens. The client uses the same
// labels and limits; tests can check layout, privacy and throttling without a
// browser.

import type { DamagePercents } from "./combat.js";
import type { BattleOrder } from "./battleOrders.js";
import { surrenderAcceptProblem } from "./battleOrders.js";

export const DAMAGE_AREA_ROWS = [
  { key: "hull", label: "Hull" },
  { key: "sails", label: "Sails" },
  { key: "masts", label: "Masts" },
  { key: "rudder", label: "Rudder" },
  { key: "guns", label: "Guns" },
  { key: "crew", label: "Crew" },
] as const;

export interface DamageRow {
  key: keyof DamagePercents;
  label: string;
  percent: number;
  /** A short explanation of what this area affects. */
  hint: string;
}

const HINTS: Record<keyof DamagePercents, string> = {
  hull: "Only sinking. At 0% the ship goes down.",
  sails: "Speed falls with the effective sail plan.",
  masts: "Masts multiply with sails for effective sail.",
  rudder: "Turn rate falls; at 0% the ship drifts downwind.",
  guns: "How much of the broadside can still fire.",
  crew: "Reload and repair speed fall; below 10% the ship stops.",
};

export function damageRows(damage: DamagePercents | undefined): DamageRow[] {
  return DAMAGE_AREA_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    percent: Math.max(0, Math.min(100, damage?.[row.key] ?? 100)),
    hint: HINTS[row.key],
  }));
}

export interface CombatLayout {
  /** Phones get bottom sheets and the compact log. */
  sheet: boolean;
  minTargetPx: number;
  contentWidth: number;
  /** Scrolling height inside the damage sheet. */
  damageScrollHeight: number;
  /** Height reserved for the battle log list. */
  logHeight: number;
  /** One column on phones, two on a wide screen. */
  attackColumns: 1 | 2;
}

/** The same 640 px breakpoint as the paper style sheet. */
export function combatLayout(width: number, height: number): CombatLayout {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const phone = safeWidth <= 640;
  const margin = phone ? 12.8 : 24;
  const contentWidth = Math.max(0, safeWidth - margin * 2);
  const contentHeight = Math.max(0, safeHeight - margin * 2);
  const damageScrollHeight = Math.max(80, Math.min(260, contentHeight - (phone ? 250 : 230)));
  return {
    sheet: phone,
    minTargetPx: 44,
    contentWidth,
    // The panel itself scrolls, so its inner list can be shorter than the
    // viewport while every control stays reachable.
    damageScrollHeight: Math.min(damageScrollHeight, Math.max(80, contentHeight)),
    logHeight: phone ? 96 : 140,
    attackColumns: phone ? 1 : 2,
  };
}

export interface AttackMenuItem {
  id: "attackSink" | "attackCapture" | "close";
  label: string;
}

/** The attack menu exists only for a visible foreign ship. */
export function attackMenuItems(visible: boolean, sameNavy: boolean): AttackMenuItem[] {
  if (!visible || sameNavy) return [];
  return [
    { id: "attackSink", label: "Attack: Sink" },
    { id: "attackCapture", label: "Attack: Capture" },
    { id: "close", label: "Cancel" },
  ];
}

/**
 * Keep only private lines that mention the receiving player's ship. The
 * server already filters these, but the client repeats the check because a
 * socket payload is untrusted.
 */
export function battleLogLines(lines: readonly string[] | undefined): string[] {
  const clean: string[] = [];
  for (const line of lines ?? []) {
    if (typeof line !== "string" || line.length === 0 || line.length > 120) continue;
    if (!/\b(you|your)\b/i.test(line)) continue;
    clean.push(line);
  }
  return clean.slice(-30);
}

/**
 * Record a notification only when its key has been quiet for the cooldown.
 * Keys are owner:ship:kind, so each kind is throttled per ship.
 */
export function notificationAllowed(
  lastAt: Map<string, number>,
  key: string,
  nowMs: number,
  cooldownMs = 60_000,
): boolean {
  const last = lastAt.get(key);
  if (last !== undefined && nowMs - last < cooldownMs) return false;
  lastAt.set(key, nowMs);
  return true;
}

export interface EffectPoint {
  x: number;
  y: number;
}

/** Effects are drawn only inside one of the player's sight circles. */
export function visibleCombatEffects<T extends EffectPoint>(
  events: readonly T[],
  ownShips: readonly EffectPoint[],
  sightRangeKm: number,
): T[] {
  const rangeSq = Math.max(0, sightRangeKm) ** 2;
  return events.filter((event) =>
    ownShips.some((ship) => (ship.x - event.x) ** 2 + (ship.y - event.y) ** 2 <= rangeSq),
  );
}

export interface PortRepairChoice {
  mode: "stores" | "pay";
  label: string;
  /** Tonnes of the ship's own stock that the stores choice can use. */
  usesMaterials: number;
  /** Pieces of eight charged by the pay choice. */
  chargesMoney: number;
}

export function portRepairChoices(
  materialsTonnes: number,
  money: number,
): PortRepairChoice[] {
  const materials = Math.max(0, materialsTonnes);
  return [
    {
      mode: "stores",
      label: `Repair with stores: ${materials.toFixed(1)} t at x4`,
      usesMaterials: materials,
      chargesMoney: 0,
    },
    {
      mode: "pay",
      label: `Pay locals: ${Math.max(0, Math.round(money))} pieces at x2, x6`,
      usesMaterials: 0,
      chargesMoney: Math.max(0, Math.round(money)),
    },
  ];
}


// --- 3C-c: battle bar, surrender offer and white flags -------------------

export interface BattleBarItem {
  id: "capture" | "sink" | "run" | "surrender" | "cancelSurrender";
  label: string;
  active: boolean;
}

/** Four orders, except that a fleet cannot surrender as a whole. */
export function battleBarItems(options: {
  fleet: boolean;
  surrendered: boolean;
  battleOrder?: BattleOrder;
  running?: boolean;
}): BattleBarItem[] {
  if (options.surrendered) {
    return [{ id: "cancelSurrender", label: "Take down flag", active: true }];
  }
  const items: BattleBarItem[] = [
    { id: "capture", label: "Capture", active: options.battleOrder === "capture" },
    { id: "sink", label: "Sink", active: options.battleOrder === "sink" },
    { id: "run", label: "Run", active: options.running === true },
  ];
  if (!options.fleet) {
    items.push({ id: "surrender", label: "Surrender", active: false });
  }
  return items;
}

/** Show the bar for an engaged ship or fleet, a run, a flag, or an enemy. */
export function battleBarVisible(options: {
  hasOwnShip: boolean;
  inCombat: boolean;
  fleetInCombat: boolean;
  enemySelected: boolean;
  surrendered?: boolean;
  running?: boolean;
}): boolean {
  if (options.enemySelected) return true;
  if (!options.hasOwnShip) return false;
  return options.inCombat || options.fleetInCombat ||
    options.surrendered === true || options.running === true;
}

export interface SurrenderOffer {
  title: string;
  detail: string;
  fleetText: string;
  acceptEnabled: boolean;
  reason: string | null;
  sailThere: boolean;
}

/** The sheet only exists for a visible foreign ship whose flag is up. */
export function surrenderOffer(options: {
  visible: boolean;
  name: string;
  navy: string;
  classId: string;
  fleetCount: number;
  maxShips: number;
  nearestShipKm: number;
  acceptRangeM?: number;
}): SurrenderOffer | null {
  if (!options.visible) return null;
  const problem = surrenderAcceptProblem({
    fleetCount: options.fleetCount,
    nearestShipKm: options.nearestShipKm,
    maxShips: options.maxShips,
    rangeM: options.acceptRangeM,
  });
  return {
    title: `${options.name || options.classId} of the ${options.navy} has struck her flag`,
    detail: `${options.navy} ${options.classId}`,
    fleetText: `Your fleet: ${options.fleetCount} of ${options.maxShips}`,
    acceptEnabled: problem === null,
    reason: problem,
    sailThere: (options.nearestShipKm * 1_000) > (options.acceptRangeM ?? 1_000),
  };
}

/** A white flag is drawn only for a ship that is both surrendered and visible. */
export function whiteFlagVisible(visible: boolean, surrendered: boolean): boolean {
  return visible && surrendered;
}

export interface BattleBarLayout {
  sheet: boolean;
  minTargetPx: number;
  barHeight: number;
  contentWidth: number;
  /** Phone sheets scroll; the bar itself never grows past this. */
  maxBarHeight: number;
}

export function battleBarLayout(width: number, height: number): BattleBarLayout {
  const phone = width <= 640;
  const margin = phone ? 12.8 : 24;
  return {
    sheet: phone,
    minTargetPx: 44,
    barHeight: 56,
    contentWidth: Math.max(0, width - margin * 2),
    maxBarHeight: Math.max(44, Math.min(72, Math.floor(height * 0.2))),
  };
}

export interface SurrenderSheetLayout {
  sheet: boolean;
  minTargetPx: number;
  width: number;
  maxHeight: number;
  scrolls: boolean;
}

/** The offer is a centred sheet, or the phone's full paper page. */
export function surrenderSheetLayout(width: number, height: number): SurrenderSheetLayout {
  const phone = width <= 640;
  const margin = phone ? 8 : 16;
  return {
    sheet: phone,
    minTargetPx: 44,
    width: Math.max(0, Math.min(phone ? width - margin * 2 : 448, width - margin * 2)),
    maxHeight: Math.max(0, height - margin * 2),
    scrolls: true,
  };
}
