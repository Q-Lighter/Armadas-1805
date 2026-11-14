// Fire ship, tow and lights presentation shared by the browser and tests.
// Pure functions only: no DOM and no world state.

import type { OwnShipSnapshot } from "./world.js";

export type FireShipActionId =
  | "igniteNow"
  | "igniteContact"
  | "cancelContact"
  | "tow"
  | "castOff"
  | "lightsOn"
  | "lightsOff";

export interface FireShipActionButton {
  id: FireShipActionId;
  label: string;
  /** Ignite now always asks before consuming the ship. */
  confirm: boolean;
  /** A false condition disables the button; it never hides it. */
  disabled?: boolean;
  reason?: string;
}

/**
 * The buttons for one ship card. A towed fire ship only accepts Cast off.
 * Every other ship gets the lights switch, and a tower gets Tow.
 */
export function fireShipCardActions(
  ship: Pick<OwnShipSnapshot, "classId" | "fireShipIgnited" | "fireShipMode" | "fireShipTargetId" | "towedBy" | "towingId" | "lightsOn">,
  hasTowTarget = true,
): FireShipActionButton[] {
  const actions: FireShipActionButton[] = [];
  const fireShip = ship.classId === "fireShip";
  const towed = Boolean(ship.towedBy);
  if (fireShip && !ship.fireShipIgnited) {
    const refusal = towed ? { disabled: true, reason: "Cast off first" } : {};
    actions.push({ id: "igniteNow", label: "Ignite now", confirm: true, ...refusal });
    actions.push({ id: "igniteContact", label: "Ignite on contact", confirm: false, ...refusal });
    if (ship.fireShipMode === "contact" && ship.fireShipTargetId) {
      actions.push({ id: "cancelContact", label: "Cancel contact attack", confirm: false });
    }
  }
  if (fireShip && towed) {
    actions.push({ id: "castOff", label: "Cast off", confirm: false });
  }
  const towerClass = ship.classId === "frigate" || ship.classId === "line" ||
    ship.classId === "flagship";
  if (towerClass) {
    const towReason = ship.towingId
      ? "Already towing a fire ship"
      : hasTowTarget ? undefined : "No unlit fire ship within 300 m";
    actions.push({
      id: "tow",
      label: "Tow fire ship",
      confirm: false,
      disabled: towReason !== undefined,
      reason: towReason,
    });
  }
  if (ship.towingId) {
    actions.push({ id: "castOff", label: "Cast off", confirm: false });
  }
  if (ship.lightsOn === false) {
    actions.push({ id: "lightsOn", label: "Lights on", confirm: false });
  } else {
    actions.push({ id: "lightsOff", label: "Lights off", confirm: false });
  }
  return actions;
}

/** A short card line for the fire-ship state, or an empty string. */
export function fireShipStatusText(
  ship: Pick<OwnShipSnapshot, "classId" | "fireShipIgnited" | "fireShipMode" | "towedBy" | "towingId" | "burning" | "lightsOn">,
  towName?: string | null,
): string {
  const lights = ship.lightsOn === false ? "Lights: Off" : "Lights: On";
  if (ship.classId !== "fireShip" && !ship.towingId) return lights;
  if (ship.fireShipIgnited || ship.burning) return `Burning hulk · the crew is away · ${lights}`;
  if (ship.towedBy) return `In tow · only Cast off is accepted · ${lights}`;
  if (ship.towingId) return `${towName ? `Towing ${towName}` : "Towing a fire ship"} · ${lights}`;
  if (ship.fireShipMode === "contact") return `Contact attack · steering for the target · ${lights}`;
  return `Fire ship · not yet lit · ${lights}`;
}

/** Three size bands used by the five review viewports. */
export type FireShipLayoutBand = "phone" | "tablet" | "desk";

export function fireShipLayoutBand(width: number, height: number): FireShipLayoutBand {
  if (width <= 640 || height <= 440) return "phone";
  if (width <= 900) return "tablet";
  return "desk";
}

export interface FireShipLayoutPlan {
  band: FireShipLayoutBand;
  /** The card scrolls instead of adding another floating bar. */
  scroll: boolean;
  columns: 1 | 2;
  buttonMinHeightPx: number;
  /** The target sheet never exceeds this share of the viewport. */
  maxHeightShare: number;
}

export function fireShipLayoutPlan(width: number, height: number): FireShipLayoutPlan {
  const band = fireShipLayoutBand(width, height);
  return {
    band,
    scroll: true,
    columns: band === "desk" ? 2 : 1,
    buttonMinHeightPx: 44,
    maxHeightShare: band === "phone" ? 0.72 : 0.82,
  };
}
