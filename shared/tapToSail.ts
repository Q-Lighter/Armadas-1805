// Tap-to-sail is a client preference. The server never reads it: this module
// only decides whether a completed map tap is allowed to send a move order.

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
 * Resolve one completed sea tap. There is no hold path: a tap either sends a
 * move order because Tap-to-sail is on, spends an armed Move, or opens the
 * order palette. Holding changes nothing.
 */
export function resolveTap(input: {
  tapToSail: boolean;
  moveArmed: boolean;
}): TapDecision {
  const sendOrder = input.tapToSail || input.moveArmed;
  return {
    sendOrder,
    moveArmed: sendOrder ? false : input.moveArmed,
  };
}
