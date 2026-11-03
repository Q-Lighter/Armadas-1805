// The four navies in the game. A navy changes the flagship's cruise speed, the
// hull colour and, in test rooms, the start port. All values live in settings.

import { settings } from "./settings.js";

export type NavyId = keyof typeof settings.navies;

export const NAVY_IDS = Object.keys(settings.navies) as NavyId[];

/** Match a lower-case web-address value such as `dutch`. */
export function parseNavy(value: string): NavyId | null {
  const wanted = value.trim().toLowerCase();
  return NAVY_IDS.find((navy) => navy.toLowerCase() === wanted) ?? null;
}

/** A Pixi colour number from the settings hex string. */
export function navyColorNumber(navy: NavyId): number {
  return Number.parseInt(settings.navies[navy].hullColor.slice(1), 16);
}
