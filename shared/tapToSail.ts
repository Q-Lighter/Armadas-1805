// Tap-to-sail is a client preference. The server never reads it: this module
// only decides whether a completed map tap is allowed to send a move order.

import { settings } from "./settings.js";

export const TAP_TO_SAIL_KEY = "armadas.tapToSail";

export interface TapPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** New players get the ordinary one-tap sailing behaviour. */
export function readTapToSail(storage: TapPreferenceStorage | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(TAP_TO_SAIL_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeTapToSail(
  storage: TapPreferenceStorage | null,
  enabled: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(TAP_TO_SAIL_KEY, enabled ? "on" : "off");
  } catch {
    // A blocked preference store must never stop the player sailing.
  }
}

export interface TapDecision {
  /** The map tap has become a move order. */
  sendOrder: boolean;
  /** Whether the one-shot Move button is still armed for a later tap. */
  moveArmed: boolean;
}

/**
 * Resolve one completed sea tap. A hold that reached the threshold counts once;
 * an armed Move button is spent by the order it produces.
 */
export function resolveTap(input: {
  tapToSail: boolean;
  moveArmed: boolean;
  heldMs: number;
}): TapDecision {
  const sendOrder =
    input.tapToSail ||
    input.moveArmed ||
    input.heldMs >= settings.client.tapHoldMs;
  return {
    sendOrder,
    moveArmed: sendOrder ? false : input.moveArmed,
  };
}
