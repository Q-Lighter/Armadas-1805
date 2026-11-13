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
    if (!towed) {
      if (ship.fireShipMode === "contact" && ship.fireShipTargetId) {
        actions.push({ id: "cancelContact", label: "Cancel contact attack", confirm: false });
      } else {
        actions.push({ id: "igniteNow", label: "Ignite now", confirm: true });
        actions.push({ id: "igniteContact", label: "Ignite on contact", confirm: false });
      }
    }
  }
  if (fireShip && towed) {
    actions.push({ id: "castOff", label: "Cast off", confirm: false });
  }
  if (ship.towingId) {
    actions.push({ id: "castOff", label: "Cast off", confirm: false });
  } else if (!fireShip && hasTowTarget &&
    (ship.classId === "frigate" || ship.classId === "line" || ship.classId === "flagship")) {
    actions.push({ id: "tow", label: "Tow fire ship", confirm: false });
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
  ship: Pick<OwnShipSnapshot, "classId" | "fireShipIgnited" | "fireShipMode" | "towedBy" | "towingId" | "burning">,
  towName?: string | null,
): string {
  if (ship.classId !== "fireShip" && !ship.towingId) return "";
  if (ship.fireShipIgnited || ship.burning) return "Burning hulk · the crew is away";
  if (ship.towedBy) return "In tow · only Cast off is accepted";
  if (ship.towingId) return towName ? `Towing ${towName}` : "Towing a fire ship";
  if (ship.fireShipMode === "contact") return "Contact attack · steering for the target";
  return "Fire ship · not yet lit";
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
