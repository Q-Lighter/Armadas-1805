// Browser-free fleet, shipyard and crew presentation.
//
// The client and tests share these decisions, so a phone panel and a desk panel
// tell the same story about a ship, its crew and a shipyard card.

import { settings } from "./settings.js";
import {
  BUYABLE_SHIP_CLASS_IDS,
  SHIP_SIZE_BY_CLASS,
  shipTypeFor,
  type BuyableShipClassId,
  type ShipClassId,
  type ShipSize,
} from "./data/ships.js";
import type { RoomKind } from "./fog.js";
import { fireShipsUnlocked } from "./fireShip.js";
import {
  canPortSellShip,
  crewHireCost,
  deliveryGameMs,
  deliveryRealMinutes,
  minimumCrew,
  shipPrice,
} from "./shipRules.js";
import type { OwnShipSnapshot, ShipStatus } from "./world.js";
import { formatCrew, formatMoney, formatTonnesWithUnit } from "./format.js";
export { formatMoney } from "./format.js";

/** A short real-time countdown, from game milliseconds. */
export function formatDuration(gameMs: number): string {
  const realSeconds = Math.max(0, gameMs) /
    (settings.time.sailingTimeScale * 1_000);
  const totalSeconds = Math.ceil(realSeconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function crewPercent(crew: number, fullCrew: number): number {
  if (!(fullCrew > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((crew / fullCrew) * 100)));
}

export interface FleetShipRow {
  id: string;
  name: string;
  /** 3E: my one flagship, marked in the Fleet panel. */
  isFlagship: boolean;
  typeName: string;
  crewText: string;
  crewPercent: number;
  /** Short state line, without the separate red Needs crew label. */
  stateText: string;
  needsCrew: boolean;
  selectable: boolean;
  status: ShipStatus;
  /** Days of provisions left, or a dash for a ship with no crew. */
  provisionsText: string;
  provisionsLow: boolean;
  starving: boolean;
}

/** Clearly readable days left; a ship with no crew eats nothing. */
export function provisionsDaysText(days: number): string {
  if (!Number.isFinite(days) || days >= 9_999) return "—";
  const value = Math.max(0, days);
  const shown = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${shown === 1 ? "day" : "days"} left`;
}

export interface ShipStoreBar {
  key: "provisions" | "repair" | "ammunition" | "cargo";
  label: string;
  percent: number;
  amountText: string;
  detail: string;
  /** Red ink: under ten provision days, or a starving crew. */
  urgent: boolean;
}

function storePercent(amount: number, capacity: number): number {
  if (!(capacity > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((amount / capacity) * 100)));
}

/** Four separate paper bars for the selected ship panel. */
export function buildShipStoreBars(ship: OwnShipSnapshot): ShipStoreBar[] {
  const c = ship.capacities;
  const s = ship.stores;
  const provisionsLow = ship.provisionsDays < 10;
  return [
    {
      key: "provisions",
      label: "Provisions",
      percent: storePercent(s.provisions, c.provisions),
      amountText: `${formatTonnesWithUnit(s.provisions)} / ${formatTonnesWithUnit(c.provisions)}`,
      detail: provisionsDaysText(ship.provisionsDays),
      urgent: provisionsLow || ship.starving,
    },
    {
      key: "repair",
      label: "Repair materials",
      percent: storePercent(s.repairMaterials, c.repairMaterials),
      amountText: `${formatTonnesWithUnit(s.repairMaterials)} / ${formatTonnesWithUnit(c.repairMaterials)}`,
      detail: ship.portRepair?.active
        ? "Port repairs active"
        : ship.repairEnabled === false
          ? "Repairs off"
          : ship.canRepair === false
            ? "Repairs paused after combat"
            : "Repairs ready",
      urgent: false,
    },
    {
      key: "ammunition",
      label: "Ammunition",
      percent: storePercent(s.ammunition, c.ammunition),
      amountText: `${formatTonnesWithUnit(s.ammunition)} / ${formatTonnesWithUnit(c.ammunition)}`,
      detail: `${Math.floor(ship.ammunitionBroadsides ?? 0)} broadsides`,
      urgent: false,
    },
    {
      key: "cargo",
      label: "Cargo hold",
      percent: storePercent(ship.cargoUsed, c.cargo),
      amountText: `${formatTonnesWithUnit(ship.cargoUsed)} / ${formatTonnesWithUnit(c.cargo)}`,
      detail: "Goods, timber and cloth",
      urgent: false,
    },
  ];
}

const STATUS_WORDS: Record<Exclude<ShipStatus, "docked" | "delivery">, string> = {
  sailing: "Sailing",
  waiting: "Waiting at anchor",
};

/** One row of the Fleet panel. Port names come from this player's found ports. */
export function buildFleetRow(
  ship: OwnShipSnapshot,
  portName: string | null,
): FleetShipRow {
  const type = shipTypeFor(ship.navy, ship.classId);
  const percent = crewPercent(ship.crew, ship.fullCrew);
  const needsCrew = ship.status !== "delivery" && ship.crew < minimumCrew(ship.fullCrew);
  let stateText: string;
  if (ship.status === "delivery") {
    stateText = `In delivery · ${formatDuration(ship.deliveryLeftMs)}`;
  } else if (ship.status === "docked") {
    stateText = `Docked at ${portName ?? "port"}`;
  } else {
    stateText = ship.stateLabel ?? STATUS_WORDS[ship.status];
  }

  return {
    id: ship.id,
    name: ship.name,
    isFlagship: ship.isFlagship === true,
    typeName: type.name,
    crewText: formatCrew(ship.crew, ship.fullCrew),
    crewPercent: percent,
    stateText,
    needsCrew,
    selectable: ship.status !== "delivery",
    status: ship.status,
    provisionsText: provisionsDaysText(ship.provisionsDays),
    provisionsLow: ship.provisionsDays < 10,
    starving: ship.starving,
  };
}

export interface ShipyardCard {
  classId: BuyableShipClassId;
  name: string;
  price: number;
  deliveryText: string;
  crew: number;
  guns: string;
  speed: string;
  cargoTonnes: number;
  hull: number;
  closestAngleDeg: number;
  turn90GameMinutes: number;
  draughtM: number;
  /** The Fire ships research hook is closed outside test and dev rooms. */
  locked: boolean;
}

function deliveryText(kind: RoomKind, classId: ShipClassId): string {
  const days = settings.ships.deliveryGameDays[SHIP_SIZE_BY_CLASS[classId]];
  const minutes = deliveryRealMinutes(kind, classId);
  const shown = Math.round(minutes * 10) / 10;
  return `${days} game ${days === 1 ? "day" : "days"} · ${shown} real min`;
}

/** The buyable cards this port may show, largest first. */
export function shipyardCards(
  kind: RoomKind,
  portSize: ShipSize,
  navy: OwnShipSnapshot["navy"],
): ShipyardCard[] {
  const cards: ShipyardCard[] = [];
  for (const classId of BUYABLE_SHIP_CLASS_IDS) {
    if (!canPortSellShip(portSize, classId)) continue;
    const type = shipTypeFor(navy, classId);
    const price = shipPrice(classId);
    if (price === null) continue;
    cards.push({
      classId,
      name: type.name,
      price,
      deliveryText: deliveryText(kind, classId),
      crew: type.crew,
      guns: `${type.guns} (${type.heavyGuns}H / ${type.mediumGuns}M / ${type.lightGuns}L)`,
      speed: `${type.cruiseKnots} / ${type.topKnots} kn`,
      cargoTonnes: type.cargoTonnes,
      hull: type.hull,
      closestAngleDeg: type.closestAngleDeg,
      turn90GameMinutes: type.turn90GameMinutes,
      draughtM: type.draughtM,
      locked: classId === "fireShip" && !fireShipsUnlocked(kind),
    });
  }
  return cards;
}

/** Absolute crew targets for the three quick buttons. */
export function crewQuickTargets(ship: OwnShipSnapshot): {
  minimum: number;
  half: number;
  full: number;
} {
  const clamp = (value: number): number =>
    Math.max(ship.crew, Math.min(ship.fullCrew, Math.ceil(value)));
  return {
    minimum: clamp(minimumCrew(ship.fullCrew)),
    half: clamp(ship.fullCrew / 2),
    full: ship.fullCrew,
  };
}

export interface CrewQuote {
  target: number;
  count: number;
  cost: number;
  poolLeft: number;
  canHire: boolean;
  reason: string | null;
}

/** Check one proposed crew target against the ship, pool and purse. */
export function crewQuote(
  ship: OwnShipSnapshot,
  target: number,
  poolAvailable: number,
  money: number,
): CrewQuote {
  const wanted = Math.max(
    ship.crew,
    Math.min(ship.fullCrew, Math.floor(Number.isFinite(target) ? target : ship.crew)),
  );
  const count = wanted - ship.crew;
  const cost = crewHireCost(count);
  let reason: string | null = null;
  if (count <= 0) reason = "Choose at least one sailor.";
  else if (count > poolAvailable) reason = "Not enough sailors at this port.";
  else if (cost > money) reason = "Not enough money.";
  return {
    target: wanted,
    count,
    cost,
    poolLeft: Math.max(0, poolAvailable - count),
    canHire: reason === null,
    reason,
  };
}

/** Text for the Fleet button and TEMP-DEBUG, e.g. "7 of 30". */
export function fleetCountText(count: number): string {
  return `${count} of ${settings.ships.maxShipsPerPlayer}`;
}

/** The game-day count for a card, kept separate for compact UI labels. */
export function deliveryDayCount(classId: ShipClassId): number {
  return settings.ships.deliveryGameDays[SHIP_SIZE_BY_CLASS[classId]];
}

/** Game-time milliseconds, exposed for the client countdown if needed. */
export function deliveryFor(kind: RoomKind, classId: ShipClassId): number {
  return deliveryGameMs(kind, classId);
}
