// The 1805 ship catalogue: six ships for each navy.
//
// This is world data, not a balance file. The sailing numbers here belong to the
// individual ship, so a French 74 and a British 74 do not have to sail alike.
// Prices, delivery times and crew rules live in shared/settings.ts.

import type { NavyId } from "../navies.js";

export type ShipClassId =
  | "flagship"
  | "line"
  | "frigate"
  | "escort"
  | "raider"
  | "trade";

export type ShipSize = "small" | "mid" | "large";

export interface ShipType {
  navy: NavyId;
  classId: ShipClassId;
  /** The type name shown in the shipyard. This is not the chosen ship name. */
  name: string;
  guns: number;
  crew: number;
  cruiseKnots: number;
  topKnots: number;
  cargoTonnes: number;
  storesDays: number;
  heavyGuns: number;
  mediumGuns: number;
  lightGuns: number;
  broadsideLb: number;
  reloadGameMinutes: number;
  hull: number;
  /** Closest angle to the wind at which the ship still sails. */
  closestAngleDeg: number;
  /** Game minutes to turn through 90 degrees. */
  turn90GameMinutes: number;
  draughtM: number;
}

export const SHIP_CLASS_IDS: readonly ShipClassId[] = [
  "flagship",
  "line",
  "frigate",
  "escort",
  "raider",
  "trade",
];

export const BUYABLE_SHIP_CLASS_IDS = [
  "line",
  "frigate",
  "escort",
  "raider",
  "trade",
] as const;

export type BuyableShipClassId = (typeof BUYABLE_SHIP_CLASS_IDS)[number];

/** A port size may sell these classes. A flagship is never for sale. */
export const SHIP_SIZE_BY_CLASS: Record<ShipClassId, ShipSize> = {
  flagship: "large",
  line: "large",
  frigate: "mid",
  escort: "small",
  raider: "small",
  trade: "mid",
};

/**
 * The table order is the display order in the shipyard: largest first, then
 * the small and merchant types.
 */
export const ALL_SHIP_TYPES: readonly ShipType[] = [
  {
    navy: "British", classId: "flagship", name: "First rate 100 (Victory type)",
    guns: 104, crew: 820, cruiseKnots: 6, topKnots: 9, cargoTonnes: 260,
    storesDays: 52, heavyGuns: 58, mediumGuns: 44, lightGuns: 2,
    broadsideLb: 1130, reloadGameMinutes: 3.5, hull: 20000,
    closestAngleDeg: 70, turn90GameMinutes: 8, draughtM: 7.5,
  },
  {
    navy: "British", classId: "line", name: "Third rate 74",
    guns: 57, crew: 590, cruiseKnots: 7, topKnots: 10, cargoTonnes: 204,
    storesDays: 47, heavyGuns: 28, mediumGuns: 28, lightGuns: 1,
    broadsideLb: 640, reloadGameMinutes: 3, hull: 11000,
    closestAngleDeg: 68, turn90GameMinutes: 6, draughtM: 6.5,
  },
  {
    navy: "British", classId: "frigate", name: "38-gun frigate (Leda class)",
    guns: 38, crew: 284, cruiseKnots: 9, topKnots: 13, cargoTonnes: 132,
    storesDays: 42, heavyGuns: 0, mediumGuns: 28, lightGuns: 10,
    broadsideLb: 230, reloadGameMinutes: 2, hull: 5200,
    closestAngleDeg: 62, turn90GameMinutes: 4, draughtM: 5.2,
  },
  {
    navy: "British", classId: "escort", name: "Brig-sloop (Cruizer class)",
    guns: 18, crew: 121, cruiseKnots: 8, topKnots: 11, cargoTonnes: 46,
    storesDays: 37, heavyGuns: 0, mediumGuns: 8, lightGuns: 10,
    broadsideLb: 90, reloadGameMinutes: 1.5, hull: 1800,
    closestAngleDeg: 64, turn90GameMinutes: 3, draughtM: 3.5,
  },
  {
    navy: "British", classId: "raider", name: "Schooner (Pickle type)",
    guns: 10, crew: 40, cruiseKnots: 8.5, topKnots: 12, cargoTonnes: 15,
    storesDays: 32, heavyGuns: 0, mediumGuns: 0, lightGuns: 10,
    broadsideLb: 30, reloadGameMinutes: 1, hull: 800,
    closestAngleDeg: 55, turn90GameMinutes: 2, draughtM: 2.7,
  },
  {
    navy: "British", classId: "trade", name: "West Indiaman",
    guns: 12, crew: 40, cruiseKnots: 5, topKnots: 7.5, cargoTonnes: 255,
    storesDays: 65, heavyGuns: 0, mediumGuns: 0, lightGuns: 12,
    broadsideLb: 40, reloadGameMinutes: 3, hull: 3000,
    closestAngleDeg: 78, turn90GameMinutes: 8, draughtM: 5.5,
  },

  {
    navy: "French", classId: "flagship", name: "120-gun first rate (Ocean class)",
    guns: 120, crew: 1130, cruiseKnots: 6.5, topKnots: 9.5, cargoTonnes: 336,
    storesDays: 48, heavyGuns: 66, mediumGuns: 54, lightGuns: 0,
    broadsideLb: 1300, reloadGameMinutes: 3.5, hull: 22000,
    closestAngleDeg: 70, turn90GameMinutes: 8, draughtM: 8,
  },
  {
    navy: "French", classId: "line", name: "74-gun (Temeraire class)",
    guns: 59, crew: 700, cruiseKnots: 7, topKnots: 10.5, cargoTonnes: 228,
    storesDays: 43, heavyGuns: 28, mediumGuns: 30, lightGuns: 1,
    broadsideLb: 650, reloadGameMinutes: 3, hull: 10000,
    closestAngleDeg: 67, turn90GameMinutes: 6, draughtM: 6.5,
  },
  {
    navy: "French", classId: "frigate", name: "40-gun frigate (Hortense class)",
    guns: 40, crew: 330, cruiseKnots: 9.5, topKnots: 13, cargoTonnes: 110,
    storesDays: 38, heavyGuns: 0, mediumGuns: 28, lightGuns: 12,
    broadsideLb: 230, reloadGameMinutes: 2, hull: 4600,
    closestAngleDeg: 60, turn90GameMinutes: 4, draughtM: 5.2,
  },
  {
    navy: "French", classId: "escort", name: "Brig (Argus type)",
    guns: 16, crew: 100, cruiseKnots: 8, topKnots: 11, cargoTonnes: 36,
    storesDays: 33, heavyGuns: 0, mediumGuns: 4, lightGuns: 12,
    broadsideLb: 60, reloadGameMinutes: 1.5, hull: 1600,
    closestAngleDeg: 64, turn90GameMinutes: 3, draughtM: 3.5,
  },
  {
    navy: "French", classId: "raider", name: "Privateer lugger",
    guns: 14, crew: 70, cruiseKnots: 9, topKnots: 12.5, cargoTonnes: 18,
    storesDays: 28, heavyGuns: 0, mediumGuns: 0, lightGuns: 14,
    broadsideLb: 40, reloadGameMinutes: 1, hull: 900,
    closestAngleDeg: 52, turn90GameMinutes: 2, draughtM: 2.5,
  },
  {
    navy: "French", classId: "trade", name: "Gabarre (state transport)",
    guns: 8, crew: 70, cruiseKnots: 4.5, topKnots: 7, cargoTonnes: 330,
    storesDays: 60, heavyGuns: 0, mediumGuns: 0, lightGuns: 8,
    broadsideLb: 20, reloadGameMinutes: 3, hull: 2400,
    closestAngleDeg: 80, turn90GameMinutes: 9, draughtM: 4.5,
  },

  {
    navy: "Spanish", classId: "flagship", name: "Santisima Trinidad (four-decker)",
    guns: 116, crew: 1050, cruiseKnots: 5.5, topKnots: 8, cargoTonnes: 360,
    storesDays: 50, heavyGuns: 62, mediumGuns: 52, lightGuns: 2,
    broadsideLb: 1300, reloadGameMinutes: 4, hull: 26000,
    closestAngleDeg: 76, turn90GameMinutes: 10, draughtM: 8,
  },
  {
    navy: "Spanish", classId: "line", name: "74-gun (Monarca class)",
    guns: 59, crew: 650, cruiseKnots: 6.5, topKnots: 9.5, cargoTonnes: 228,
    storesDays: 45, heavyGuns: 28, mediumGuns: 30, lightGuns: 1,
    broadsideLb: 650, reloadGameMinutes: 3, hull: 12000,
    closestAngleDeg: 70, turn90GameMinutes: 7, draughtM: 6.8,
  },
  {
    navy: "Spanish", classId: "frigate", name: "40-gun frigate (Medea)",
    guns: 40, crew: 300, cruiseKnots: 8.5, topKnots: 12, cargoTonnes: 144,
    storesDays: 40, heavyGuns: 0, mediumGuns: 26, lightGuns: 14,
    broadsideLb: 220, reloadGameMinutes: 2, hull: 5400,
    closestAngleDeg: 63, turn90GameMinutes: 4.5, draughtM: 5.4,
  },
  {
    navy: "Spanish", classId: "escort", name: "Brig (bergantin)",
    guns: 16, crew: 110, cruiseKnots: 7.5, topKnots: 10.5, cargoTonnes: 36,
    storesDays: 35, heavyGuns: 0, mediumGuns: 2, lightGuns: 14,
    broadsideLb: 60, reloadGameMinutes: 1.5, hull: 1700,
    closestAngleDeg: 65, turn90GameMinutes: 3.5, draughtM: 3.4,
  },
  {
    navy: "Spanish", classId: "raider", name: "Xebec",
    guns: 24, crew: 190, cruiseKnots: 8.5, topKnots: 12, cargoTonnes: 54,
    storesDays: 30, heavyGuns: 0, mediumGuns: 4, lightGuns: 20,
    broadsideLb: 90, reloadGameMinutes: 1, hull: 1200,
    closestAngleDeg: 50, turn90GameMinutes: 2.5, draughtM: 3,
  },
  {
    navy: "Spanish", classId: "trade", name: "Armed treasure and merchant frigate",
    guns: 24, crew: 150, cruiseKnots: 5, topKnots: 8, cargoTonnes: 400,
    storesDays: 70, heavyGuns: 0, mediumGuns: 0, lightGuns: 24,
    broadsideLb: 70, reloadGameMinutes: 2.5, hull: 3600,
    closestAngleDeg: 78, turn90GameMinutes: 6, draughtM: 5.5,
  },

  {
    navy: "Dutch", classId: "flagship", name: "76-gun (Brutus type)",
    guns: 61, crew: 650, cruiseKnots: 5.5, topKnots: 8, cargoTonnes: 204,
    storesDays: 50, heavyGuns: 30, mediumGuns: 30, lightGuns: 1,
    broadsideLb: 680, reloadGameMinutes: 3, hull: 15000,
    closestAngleDeg: 76, turn90GameMinutes: 9, draughtM: 6.2,
  },
  {
    navy: "Dutch", classId: "line", name: "68-gun (Joan de Witt type)",
    guns: 55, crew: 520, cruiseKnots: 6, topKnots: 8.5, cargoTonnes: 180,
    storesDays: 45, heavyGuns: 26, mediumGuns: 28, lightGuns: 1,
    broadsideLb: 600, reloadGameMinutes: 3, hull: 9000,
    closestAngleDeg: 74, turn90GameMinutes: 7, draughtM: 5.5,
  },
  {
    navy: "Dutch", classId: "frigate", name: "36-gun frigate",
    guns: 36, crew: 250, cruiseKnots: 8, topKnots: 11.5, cargoTonnes: 102,
    storesDays: 40, heavyGuns: 0, mediumGuns: 26, lightGuns: 10,
    broadsideLb: 210, reloadGameMinutes: 2, hull: 4400,
    closestAngleDeg: 68, turn90GameMinutes: 5, draughtM: 4.3,
  },
  {
    navy: "Dutch", classId: "escort", name: "Brig",
    guns: 16, crew: 100, cruiseKnots: 7.5, topKnots: 10.5, cargoTonnes: 36,
    storesDays: 35, heavyGuns: 0, mediumGuns: 0, lightGuns: 16,
    broadsideLb: 50, reloadGameMinutes: 1.5, hull: 1600,
    closestAngleDeg: 70, turn90GameMinutes: 3.5, draughtM: 2.8,
  },
  {
    navy: "Dutch", classId: "raider", name: "Gun schooner (shallow draught)",
    guns: 8, crew: 55, cruiseKnots: 7, topKnots: 10, cargoTonnes: 11,
    storesDays: 30, heavyGuns: 0, mediumGuns: 0, lightGuns: 8,
    broadsideLb: 24, reloadGameMinutes: 1, hull: 700,
    closestAngleDeg: 62, turn90GameMinutes: 3, draughtM: 2,
  },
  {
    navy: "Dutch", classId: "trade", name: "Merchant ship (Indiaman type)",
    guns: 8, crew: 45, cruiseKnots: 4.5, topKnots: 6.5, cargoTonnes: 440,
    storesDays: 80, heavyGuns: 0, mediumGuns: 0, lightGuns: 8,
    broadsideLb: 20, reloadGameMinutes: 3.5, hull: 3200,
    closestAngleDeg: 82, turn90GameMinutes: 10, draughtM: 4.5,
  },
];

function buildShipMap(): Record<NavyId, Record<ShipClassId, ShipType>> {
  const navies: NavyId[] = ["British", "Dutch", "Spanish", "French"];
  const out = {} as Record<NavyId, Record<ShipClassId, ShipType>>;
  for (const navy of navies) {
    out[navy] = {} as Record<ShipClassId, ShipType>;
  }
  for (const ship of ALL_SHIP_TYPES) out[ship.navy][ship.classId] = ship;
  return out;
}

/** Look up a ship type by navy and role. */
export const SHIP_TYPES = buildShipMap();

export function shipTypeFor(navy: NavyId, classId: ShipClassId): ShipType {
  return SHIP_TYPES[navy][classId];
}

/** Twenty period names per navy, used only to suggest a new ship's name. */
export const SHIP_NAMES: Record<NavyId, readonly string[]> = {
  British: [
    "Agamemnon", "Bellerophon", "Orion", "Leviathan", "Conqueror",
    "Ajax", "Defence", "Thunderer", "Revenge", "Swiftsure",
    "Spartiate", "Mars", "Tonnant", "Colossus", "Achille",
    "Dreadnought", "Superb", "Powerful", "Ethalion", "Arrow",
  ],
  French: [
    "Redoutable", "Fougueux", "Intrepide", "Formidable", "Scipion",
    "Mont-Blanc", "Heros", "Pluton", "Argonaute", "Rivoli",
    "Wagram", "Austerlitz", "Jemmapes", "Commerce de Bordeaux", "Dix-Aout",
    "Patriote", "Revolutionnaire", "Audacieux", "Achille", "Aquilon",
  ],
  Spanish: [
    "Argonauta", "Bahama", "San Juan Nepomuceno", "Monarca", "Rayo",
    "San Agustin", "San Ildefonso", "San Francisco de Asis", "Neptuno",
    "Montanes", "San Justo", "San Leandro", "San Pedro de Alcantara",
    "Glorioso", "Mejicano", "Diligente", "Ninfa", "Santa Ana",
    "San Hermenegildo", "Principe de Asturias",
  ],
  Dutch: [
    "Brutus", "Joan de Witt", "Delft", "Alkmaar", "Amsterdam",
    "Batavier", "Mars", "Cerberus", "Bellona", "Eendracht",
    "De Ruyter", "Tromp", "Hercules", "Willem de Eerste", "Vrijheid",
    "Zeeland", "Utrecht", "Gelderland", "Noord-Holland", "Friesland",
  ],
};
