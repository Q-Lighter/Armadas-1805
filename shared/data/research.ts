// The research tree. Names, branches and the system each effect belongs to
// live here; every numeric value lives in settings.research.effects so tuning
// stays a one-line edit.

import { settings } from "../settings.js";
import type { NavyId } from "../navies.js";

export type ResearchBranchId = "A" | "B" | "C" | "D" | "E" | "unique";

export interface ResearchBranch {
  id: ResearchBranchId;
  name: string;
  description: string;
}

export type ResearchEffectKind =
  | "speed"
  | "speedWindBand"
  | "raiderEscortSpeed"
  | "closestToWind"
  | "sight"
  | "nightSight"
  | "groundingDamage"
  | "groundingFree"
  | "reload"
  | "hitChance"
  | "chainGrape"
  | "grapeRange"
  | "fireShipUnlock"
  | "ignitionRange"
  | "fireShipSpot"
  | "fireShipPrice"
  | "hotShotUnlock"
  | "hotShotChance"
  | "supplies"
  | "seaRepair"
  | "hull"
  | "cargo"
  | "draught"
  | "lightning"
  | "storm"
  | "formationRotation"
  | "boardingStrength"
  | "prizeCrew"
  | "portShipPrice"
  | "portRepairTime"
  | "portRepairCost"
  | "portUpgradeCost"
  | "portStorage"
  | "portRepairSpeed"
  | "portResupplySpeed"
  | "portIncome"
  | "portHealing"
  | "portFortCost"
  | "portFortHealth"
  | "portLookout"
  | "portOutput"
  | "portRegionalIncome"
  | "tradeIncome"
  | "resupplyPrice"
  | "silverShare";

export type ResearchEffectKey = Exclude<
  keyof typeof settings.research.effects,
  "shipSightKm" | "fireShipSightKm"
>;

export interface ResearchEffectDef {
  kind: ResearchEffectKind;
  /** The settings array holding this level's number. */
  key: ResearchEffectKey;
  /** False means store the level and report the hook but change nothing. */
  active: boolean;
  /** The later system named by a HOOK effect. */
  hook?: string;
  /** Optional narrower text, such as "port batteries only". */
  note?: string;
}

export interface ResearchLevelDef {
  effects: ResearchEffectDef[];
}

export interface ResearchUpgradeDef {
  id: string;
  name: string;
  branch: ResearchBranchId;
  /** Present only for a navy's six unique upgrades. */
  navy?: NavyId;
  /** One-level cold items and Fortification still use three tree rows. */
  levels: ResearchLevelDef[];
  /** Fortification has its own 3 / 6 / 12 unit costs. */
  fortification?: boolean;
  /** The cold-weather trio costs two units for their single level. */
  cold?: boolean;
}

export const RESEARCH_BRANCHES: readonly ResearchBranch[] = [
  { id: "A", name: "A · Seamanship and navigation", description: "Ship handling and the chart." },
  { id: "B", name: "B · Gunnery and fire", description: "Guns, shot and fire ships." },
  { id: "C", name: "C · Weather and survival", description: "Later weather systems; stored as hooks." },
  { id: "D", name: "D · Ports and trade", description: "Every port the navy owns." },
  { id: "E", name: "E · Defence and command", description: "Forts, signals and boarding." },
  { id: "unique", name: "National upgrades", description: "Six upgrades unique to this navy." },
];

const shipEffect = (kind: ResearchEffectKind, key: ResearchEffectKey, active = true): ResearchEffectDef => ({
  kind,
  key,
  active,
});

const hook = (kind: ResearchEffectKind, key: ResearchEffectKey, system: string): ResearchEffectDef => ({
  kind,
  key,
  active: false,
  hook: system,
});

const three = (...effects: ResearchEffectDef[]): ResearchLevelDef[] => [
  { effects: effects.map((effect) => ({ ...effect })) },
  { effects: effects.map((effect) => ({ ...effect })) },
  { effects: effects.map((effect) => ({ ...effect })) },
];

const shared: readonly ResearchUpgradeDef[] = [
  // Branch A
  { id: "copperSheathing", name: "Copper sheathing", branch: "A", levels: three(shipEffect("speed", "copperSpeed")) },
  { id: "improvedRigging", name: "Improved rigging", branch: "A", levels: three(shipEffect("closestToWind", "improvedRiggingDeg")) },
  { id: "chronometerCharts", name: "Chronometer and charts", branch: "A", levels: three(shipEffect("sight", "chronometerSight")) },
  { id: "nightWatch", name: "Night watch", branch: "A", levels: three(hook("nightSight", "nightWatchSight", "night sight")) },
  { id: "masterPilots", name: "Master pilots", branch: "A", levels: three(hook("groundingDamage", "masterPilotsDamage", "grounding"), hook("groundingFree", "masterPilotsFreeSeconds", "grounding")) },
  // Branch B
  { id: "gunCarriages", name: "Gun carriages", branch: "B", levels: three(shipEffect("reload", "gunCarriagesReload")) },
  { id: "gunneryDrill", name: "Gunnery drill", branch: "B", levels: three(shipEffect("hitChance", "gunneryHit")) },
  { id: "specialistShot", name: "Specialist shot", branch: "B", levels: three(shipEffect("chainGrape", "specialistChainGrape"), shipEffect("grapeRange", "specialistGrapeRangeM")) },
  { id: "fireShips", name: "Fire ships", branch: "B", levels: three(shipEffect("fireShipUnlock", "fireShipIgnitionBonusM"), shipEffect("ignitionRange", "fireShipIgnitionBonusM"), shipEffect("fireShipSpot", "fireShipSpot"), shipEffect("fireShipPrice", "fireShipPrice")) },
  { id: "hotShot", name: "Hot shot", branch: "B", levels: three(shipEffect("hotShotUnlock", "hotShotChance"), shipEffect("hotShotChance", "hotShotChance")) },
  // Branch C: three single-level cold items, then two hooks.
  { id: "coldWeatherClothing", name: "Cold-weather clothing", branch: "C", cold: true, levels: [{ effects: [hook("supplies", "coldSuppliesDays", "cold weather")] }] },
  { id: "iceStrengthenedHulls", name: "Ice-strengthened hulls", branch: "C", cold: true, levels: [{ effects: [hook("hull", "coldSuppliesDays", "ice and grounding")] }] },
  { id: "extraColdStores", name: "Extra cold stores", branch: "C", cold: true, levels: [{ effects: [hook("supplies", "coldSuppliesDays", "cold weather")] }] },
  { id: "lightningConductors", name: "Lightning conductors", branch: "C", levels: three(hook("lightning", "lightningReduction", "lightning")) },
  { id: "stormSeamanship", name: "Storm seamanship", branch: "C", levels: three(hook("storm", "stormDamageReduction", "storms")) },
  // Branch D
  { id: "shipyard", name: "Shipyard", branch: "D", levels: three(shipEffect("portShipPrice", "shipyardDiscount"), shipEffect("portRepairTime", "shipyardDiscount"), shipEffect("portRepairCost", "shipyardDiscount"), shipEffect("portUpgradeCost", "shipyardDiscount")) },
  { id: "warehouse", name: "Warehouse", branch: "D", levels: three(shipEffect("portStorage", "warehouseStorage")) },
  { id: "harbour", name: "Harbour", branch: "D", levels: three(shipEffect("portRepairSpeed", "harbourSpeed"), hook("portResupplySpeed", "harbourSpeed", "resupply")) },
  { id: "market", name: "Market", branch: "D", levels: three(hook("portIncome", "marketIncome", "port income")) },
  { id: "hospital", name: "Hospital", branch: "D", levels: three(hook("portHealing", "hospitalCost", "healing")) },
  // Branch E
  { id: "fortification", name: "Fortification", branch: "E", fortification: true, levels: [{ effects: [] }, { effects: [] }, { effects: [] }] },
  { id: "lookout", name: "Lookout", branch: "E", levels: three(hook("portLookout", "lookoutRange", "port log")) },
  { id: "signalFlags", name: "Signal flags", branch: "E", levels: three(shipEffect("formationRotation", "signalRotation"), hook("sight", "signalRotation", "night station keeping")) },
  { id: "boardingDrill", name: "Boarding drill", branch: "E", levels: three(shipEffect("boardingStrength", "boardingStrength")) },
  { id: "prizeCrews", name: "Prize crews", branch: "E", levels: three(shipEffect("prizeCrew", "prizeCrewBonus")) },
];

const unique: readonly ResearchUpgradeDef[] = [
  // British
  { id: "blockadeDiscipline", name: "Blockade discipline", branch: "unique", navy: "British", levels: three(shipEffect("supplies", "blockadeSupplies")) },
  { id: "dockyardMethods", name: "Dockyard methods", branch: "unique", navy: "British", levels: three(shipEffect("seaRepair", "dockyardSeaRepair")) },
  { id: "weatherlyShips", name: "Weatherly ships", branch: "unique", navy: "British", levels: three(hook("storm", "weatherlyStorm", "storms")) },
  { id: "jamaicaStation", name: "Jamaica station", branch: "unique", navy: "British", levels: three(hook("portRegionalIncome", "jamaicaIncome", "port income")) },
  { id: "hondurasMosquito", name: "Honduras and Mosquito Coast", branch: "unique", navy: "British", levels: three(shipEffect("portOutput", "hondurasTimber")) },
  { id: "navigationActs", name: "Navigation Acts", branch: "unique", navy: "British", levels: three(hook("tradeIncome", "navigationActs", "trade routes")) },
  // French
  { id: "saneHullLines", name: "Sane hull lines", branch: "unique", navy: "French", levels: three(shipEffect("speedWindBand", "saneHullSpeed")) },
  { id: "raidingDoctrine", name: "Raiding doctrine", branch: "unique", navy: "French", levels: three(shipEffect("raiderEscortSpeed", "raidingSpeed")) },
  { id: "biscuitBrandy", name: "Biscuit and brandy rations", branch: "unique", navy: "French", levels: three(shipEffect("supplies", "biscuitSupplies")) },
  { id: "caribbeanPlanters", name: "Caribbean planters", branch: "unique", navy: "French", levels: three(shipEffect("portOutput", "caribbeanPlanters")) },
  { id: "pacificContacts", name: "Pacific contacts", branch: "unique", navy: "French", levels: three(hook("portRegionalIncome", "pacificIncome", "port income")) },
  { id: "francoDutchAccord", name: "Franco-Dutch accord", branch: "unique", navy: "French", levels: three(hook("resupplyPrice", "francoDutchDiscount", "alliances")) },
  // Spanish
  { id: "heavyTimbers", name: "Heavy timbers", branch: "unique", navy: "Spanish", levels: three(shipEffect("hull", "heavyTimbersHull")) },
  { id: "havanaShipwrights", name: "Havana shipwrights", branch: "unique", navy: "Spanish", levels: three(shipEffect("portRepairCost", "havanaRepairMaterial")) },
  { id: "stoutBatteries", name: "Stout batteries", branch: "unique", navy: "Spanish", levels: three(shipEffect("portFortHealth", "stoutBatteriesHealth")) },
  { id: "silverPeruMexico", name: "Silver of Peru and Mexico", branch: "unique", navy: "Spanish", levels: three(shipEffect("portOutput", "silverOutput")) },
  { id: "riverPlateHides", name: "River Plate hides", branch: "unique", navy: "Spanish", levels: three(shipEffect("portOutput", "riverPlateHides"), hook("portRegionalIncome", "riverPlateIncome", "port income")) },
  { id: "treasureFleets", name: "Treasure fleets", branch: "unique", navy: "Spanish", levels: three(shipEffect("cargo", "treasureCargo"), hook("silverShare", "treasureSilverShare", "silver cargo")) },
  // Dutch
  { id: "shallowDraughtHulls", name: "Shallow-draught hulls", branch: "unique", navy: "Dutch", levels: three(hook("draught", "shallowDraughtM", "depth")) },
  { id: "roomyHolds", name: "Roomy holds", branch: "unique", navy: "Dutch", levels: three(shipEffect("cargo", "roomyHolds")) },
  { id: "dykeDockBuilders", name: "Dyke and dock builders", branch: "unique", navy: "Dutch", levels: three(shipEffect("portFortCost", "dykeFortCost")) },
  { id: "guianasRiver", name: "Guianas and river colonies", branch: "unique", navy: "Dutch", levels: three(shipEffect("portOutput", "guianasOutput"), hook("portRegionalIncome", "guianasIncome", "port income")) },
  { id: "caribbeanFreePorts", name: "Caribbean free ports", branch: "unique", navy: "Dutch", levels: three(hook("portRegionalIncome", "caribbeanFreePortsIncome", "port income")) },
  { id: "bankingHouses", name: "Banking houses and trading companies", branch: "unique", navy: "Dutch", levels: three(shipEffect("portShipPrice", "bankingPurchase")) },
];

export const RESEARCH_UPGRADES: readonly ResearchUpgradeDef[] = [...shared, ...unique];

const byId = new Map(RESEARCH_UPGRADES.map((upgrade) => [upgrade.id, upgrade]));

export function researchUpgrade(id: string): ResearchUpgradeDef | null {
  return byId.get(id) ?? null;
}

/** Shared upgrades plus this navy's unique six, in branch order. */
export function researchTreeFor(navy: NavyId): ResearchUpgradeDef[] {
  return [...shared, ...unique.filter((upgrade) => upgrade.navy === navy)];
}

export function researchBranchName(id: ResearchBranchId): string {
  return RESEARCH_BRANCHES.find((branch) => branch.id === id)?.name ?? id;
}

/** Cost in units for one level; the level is 1-based. */
export function researchLevelCostUnits(upgrade: ResearchUpgradeDef, level: number): number {
  if (upgrade.fortification) {
    return settings.research.fortificationCostUnits[level - 1] ?? Infinity;
  }
  if (upgrade.cold) return settings.research.coldCostUnits;
  return settings.research.levelCostUnits[level - 1] ?? Infinity;
}

export function isShipUpgrade(upgrade: ResearchUpgradeDef): boolean {
  // Port upgrades change every owned port; everything else is fitted to ships.
  if (upgrade.fortification) return false;
  const portUpgradeIds = new Set([
    "shipyard", "warehouse", "harbour", "market", "hospital", "lookout",
    "jamaicaStation", "hondurasMosquito", "navigationActs", "caribbeanPlanters",
    "pacificContacts", "francoDutchAccord", "havanaShipwrights", "stoutBatteries",
    "silverPeruMexico", "riverPlateHides", "guianasRiver", "caribbeanFreePorts",
    "dykeDockBuilders", "bankingHouses",
  ]);
  return !portUpgradeIds.has(upgrade.id);
}

/** The systems that are not built yet, named for the screen text. */
export function hookSystemFor(upgrade: ResearchUpgradeDef): string | null {
  for (const level of upgrade.levels) {
    for (const effect of level.effects) {
      if (!effect.active && effect.hook) return effect.hook;
    }
  }
  return null;
}
