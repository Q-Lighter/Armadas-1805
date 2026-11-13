// The map pennant is optional; the Flagship tags in the panels stay put.
import { settings } from "./settings.js";

export function flagshipPennantVisible(
  ownShip: boolean,
  flagship: boolean,
  settingEnabled = settings.flagshipMarker.pennantDefaultVisible,
): boolean {
  return ownShip && flagship && settingEnabled;
}
