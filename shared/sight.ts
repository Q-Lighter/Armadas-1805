// 3K: one sight rule for the chart discovery radius, the ship circles and
// which enemies are visible. The numbers come from the design table and never
// change to make a test pass.

import { settings } from "./settings.js";

export type MoonPhaseName = "new" | "crescent" | "quarter" | "gibbous" | "full";

/** Quarter moon gives sixteen percent of the daytime sight (AGREED). */
export const NIGHT_SIGHT_FRACTION = 0.16;
/** A lit ship is seen from this far at night (AGREED). */
export const LIT_SHIP_VISIBLE_KM = 10;
/** Weather is a stub multiplier until weather exists. */
export const WEATHER_SIGHT_MULTIPLIER = 1;

export const MOON_SIGHT_MULTIPLIERS: Readonly<Record<MoonPhaseName, number>> = {
  new: 0.375,
  crescent: 0.675,
  quarter: 1,
  gibbous: 1.2,
  full: 1.375,
};

/** Map a 0..1 moon phase to the five design phases. */
export function moonPhaseName(phase: number): MoonPhaseName {
  const p = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  if (p < 0.0625 || p >= 0.9375) return "new";
  if (p < 0.1875 || p >= 0.8125) return "crescent";
  if (p < 0.3125 || p >= 0.6875) return "quarter";
  if (p < 0.4375 || p >= 0.5625) return "gibbous";
  return "full";
}

export interface SightShip {
  /** Daytime sight from the ship table, when a class supplies one. */
  daySightKm?: number;
  lightsOn?: boolean;
}

/**
 * The distance at which this ship can be seen. Daylight blends smoothly into
 * the night value over the clock's one-hour twilight. At night a lit ship is
 * seen from 10 km instead of its own moon-scaled sight.
 */
export function sightRangeKm(
  ship: SightShip,
  daylight: number,
  moonPhase: number,
  lightsOn: boolean,
  weather = WEATHER_SIGHT_MULTIPLIER,
): number {
  const day = Math.max(0, ship.daySightKm ?? settings.fog.sightRangeKm);
  const light = Math.max(0, Math.min(1, Number.isFinite(daylight) ? daylight : 1));
  const night = day * NIGHT_SIGHT_FRACTION * MOON_SIGHT_MULTIPLIERS[moonPhaseName(moonPhase)];
  const own = night * Math.max(0, weather);
  const nightRange = lightsOn ? Math.max(own, LIT_SHIP_VISIBLE_KM) : own;
  return day * light + nightRange * (1 - light);
}

/** Can `observer` see `target` at the current light and moon? */
export function targetInSight(
  observer: { x: number; y: number; daySightKm?: number; lightsOn?: boolean },
  target: { x: number; y: number; daySightKm?: number; lightsOn?: boolean },
  daylight: number,
  moonPhaseValue: number,
): boolean {
  const distance = Math.hypot(target.x - observer.x, target.y - observer.y);
  const observerRange = sightRangeKm(
    observer,
    daylight,
    moonPhaseValue,
    false,
  );
  const targetRange = sightRangeKm(
    target,
    daylight,
    moonPhaseValue,
    target.lightsOn !== false,
  );
  return distance <= Math.max(observerRange, targetRange);
}
