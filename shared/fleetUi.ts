// Browser-free Fleet panel and orders-menu plans. The client uses these for
// labels and touch layout; tests can check every target and sheet without a
// browser.

import {
  FORMATION_IDS,
  FLEET_STANCES,
  type FormationId,
  type FleetStance,
} from "./fleets.js";
import { STANCE_LABELS } from "./stances.js";
import type { MapPoint } from "./map.js";

export interface FormationOption {
  id: FormationId;
  label: string;
  icon: string;
}

export const FORMATION_OPTIONS: readonly FormationOption[] = [
  { id: "lineAhead", label: "Line ahead", icon: "⋮" },
  { id: "lineAbreast", label: "Line abreast", icon: "⋯" },
  { id: "wedge", label: "Wedge", icon: "∨" },
  { id: "convoy", label: "Convoy", icon: "▥" },
  { id: "freeChase", label: "Free chase", icon: "⁙" },
];

export function formationLabel(id: FormationId): string {
  return FORMATION_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export function formationIcon(id: FormationId): string {
  return FORMATION_OPTIONS.find((option) => option.id === id)?.icon ?? "·";
}

export function stanceLabel(id: FleetStance): string {
  return STANCE_LABELS[id];
}

export function formationOptionIds(): readonly FormationId[] {
  return FORMATION_IDS;
}

export function stanceOptionIds(): readonly FleetStance[] {
  return FLEET_STANCES;
}

export type OrderMenuKind = "sea" | "ship" | "port" | "enemy";

export interface OrderMenuItem {
  id: string;
  label: string;
  /** The first sea item is the quick "Sail here" action. */
  primary: boolean;
}

export function orderMenuItems(kind: OrderMenuKind): OrderMenuItem[] {
  if (kind === "ship") {
    return [
      { id: "follow", label: "Follow this ship", primary: true },
      { id: "escort", label: "Escort this ship", primary: false },
      { id: "close", label: "Cancel", primary: false },
    ];
  }
  if (kind === "port") {
    return [
      { id: "sailToPort", label: "Sail to port", primary: true },
      { id: "attackPort", label: "Attack port", primary: false },
      { id: "close", label: "Cancel", primary: false },
    ];
  }
  if (kind === "enemy") {
    return [
      { id: "attackSink", label: "Attack: Sink", primary: true },
      { id: "attackCapture", label: "Attack: Capture", primary: false },
      { id: "board", label: "Board", primary: false },
      { id: "close", label: "Cancel", primary: false },
    ];
  }
  return [
    { id: "sailHere", label: "Sail here", primary: true },
    { id: "heading", label: "Heading and distance from here", primary: false },
    { id: "patrol", label: "Patrol from here to…", primary: false },
    { id: "rendezvous", label: "Rendezvous here", primary: false },
    { id: "returnPort", label: "Return to nearest port", primary: false },
    { id: "hold", label: "Hold position", primary: false },
    { id: "dropAnchor", label: "Drop anchor", primary: false },
    { id: "weighAnchor", label: "Weigh anchor", primary: false },
    { id: "close", label: "Cancel", primary: false },
  ];
}

export interface ResponsiveFleetLayout {
  /** A full-screen paper sheet is used for the Fleet panel. */
  sheet: boolean;
  /** The orders menu is a bottom sheet. */
  bottomSheet: boolean;
  /** Smallest allowed interactive target. */
  minTargetPx: number;
  /** Useful maximum content width, leaving phone margins. */
  contentWidth: number;
  /** Panel height available for scrolling. */
  contentHeight: number;
}

/** The same breakpoints as the paper style sheet. */
export function responsiveFleetLayout(
  width: number,
  height: number,
): ResponsiveFleetLayout {
  const phone = width <= 640;
  const margin = phone ? 12.8 : 24;
  return {
    sheet: phone,
    bottomSheet: phone,
    minTargetPx: 44,
    contentWidth: Math.max(0, width - margin * 2),
    contentHeight: Math.max(0, height - margin * 2),
  };
}

export interface SelectionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function selectionBox(
  start: MapPoint,
  end: MapPoint,
): SelectionBox {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function pointInsideBox(point: MapPoint, box: SelectionBox): boolean {
  return point.x >= box.left && point.x <= box.right &&
    point.y >= box.top && point.y <= box.bottom;
}

export function selectedShipIdsInBox<T extends { id: string; x: number; y: number }>(
  ships: readonly T[],
  start: MapPoint,
  end: MapPoint,
): string[] {
  const box = selectionBox(start, end);
  return ships.filter((ship) => pointInsideBox(ship, box)).map((ship) => ship.id);
}

export interface FleetMemberUi {
  id: string;
  state: string;
}

export interface FleetCardUi {
  id: string;
  name: string;
  leaderId: string;
  leaderName: string;
  formation: FormationId;
  stance: FleetStance;
  members: FleetMemberUi[];
}

export function fleetMemberStateText(state: string): string {
  if (state === "leader") return "Leader";
  if (state === "detached") return "Detached";
  if (state === "docked") return "Docked";
  if (state === "needsCrew") return "Needs crew";
  if (state === "outOfStation") return "Out of station";
  return "In station";
}

/** Fleets come first, then ships that are not in any fleet. */
export function fleetAndLooseShips<T extends { id: string; fleetId?: string | null }>(
  ships: readonly T[],
): { fleets: T[]; loose: T[] } {
  const fleets = ships.filter((ship) => Boolean(ship.fleetId));
  const loose = ships.filter((ship) => !ship.fleetId);
  return { fleets, loose };
}

export function queueButtonText(queueing: boolean, queuedCount: number): string {
  if (!queueing) return "Queue off";
  return queuedCount > 0 ? `Queue on · ${queuedCount}` : "Queue on";
}

/** Keyboard digit 1-9 selects that control group; anything else is ignored. */
export function controlGroupSlotForKey(key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  return Number(key);
}
