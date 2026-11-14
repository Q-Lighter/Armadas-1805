// 3I research: points, buying, fitting, capture unlocks and the one effects
// registry used by ships, ports and the screens. Plain TypeScript only.

import { settings } from "./settings.js";
import { GAME_DAY_MS } from "./time.js";
import { shipPrice } from "./shipRules.js";
import { shipTypeFor, type ShipClassId } from "./data/ships.js";
import {
  RESEARCH_UPGRADES,
  isShipUpgrade,
  researchLevelCostUnits,
  researchTreeFor,
  researchUpgrade,
  type ResearchEffectDef,
  type ResearchUpgradeDef,
} from "./data/research.js";
import type { NavyId } from "./navies.js";
import type { PortSize } from "./data/ports.js";

export interface NavyResearch {
  /** Fractional points are kept; units display floors the total. */
  points: number;
  /** Purchased levels, keyed by upgrade id. Missing means level zero. */
  levels: Map<string, number>;
  /** Capture points accumulated for the next level, keyed by upgrade id. */
  capturePoints: Map<string, number>;
  /** Ports this navy has found first; the discovery award is paid once. */
  discoveredPorts: Set<string>;
  /** 25 km block ids already paid to this navy. */
  exploredBlocks: Set<string>;
}

export interface ResearchHookStatus {
  upgradeId: string;
  kind: string;
  level: number;
  system: string;
  value: number;
}

export interface PortResearchModifiers {
  shipPrice: number;
  repairTime: number;
  repairCost: number;
  upgradeCost: number;
  storage: number;
  repairSpeed: number;
  resupplySpeed: number;
  income: number;
  healingCost: number;
  fortCost: number;
  fortHealth: number;
  lookout: number;
}

export interface ResearchModifiers {
  speed: number;
  speedInWindBand: number;
  raiderEscortSpeed: number;
  closestToWindDeg: number;
  sight: number;
  nightSight: number;
  reload: number;
  hitChance: number;
  chainGrape: number;
  grapeRangeM: number;
  supplies: number;
  seaRepair: number;
  hull: number;
  cargo: number;
  boardingStrength: number;
  prizeJoin: number;
  fireShipUnlocked: boolean;
  ignitionRangeM: number;
  fireShipSpot: number;
  fireShipPrice: number;
  formationRotation: number;
  draughtReductionM: number;
  groundingDamage: number;
  groundingFreeSeconds: number;
  lightningChance: number;
  stormDamage: number;
  hotShotUnlocked: boolean;
  hotShotChance: number;
  port: PortResearchModifiers;
  hooks: ResearchHookStatus[];
}

export function emptyResearch(): NavyResearch {
  return {
    points: 0,
    levels: new Map(),
    capturePoints: new Map(),
    discoveredPorts: new Set(),
    exploredBlocks: new Set(),
  };
}

function cloneResearch(state: NavyResearch): NavyResearch {
  return {
    points: state.points,
    levels: new Map(state.levels),
    capturePoints: new Map(state.capturePoints),
    discoveredPorts: new Set(state.discoveredPorts),
    exploredBlocks: new Set(state.exploredBlocks),
  };
}

export function researchUnits(points: number): number {
  return Math.floor(Math.max(0, points) / settings.research.pointsPerUnit);
}

export function researchCostPoints(upgradeId: string, level: number): number {
  const upgrade = researchUpgrade(upgradeId);
  if (!upgrade || level < 1 || level > upgrade.levels.length) return Infinity;
  return researchLevelCostUnits(upgrade, level) * settings.research.pointsPerUnit;
}

export function ownedLevel(state: Pick<NavyResearch, "levels">, upgradeId: string): number {
  return state.levels.get(upgradeId) ?? 0;
}

export function researchLevelsForNavy(navy: NavyId): ResearchUpgradeDef[] {
  return researchTreeFor(navy);
}

export function researchBuyProblem(
  state: NavyResearch,
  upgradeId: string,
  level: number,
): string | null {
  const upgrade = researchUpgrade(upgradeId);
  if (!upgrade) return "Unknown upgrade";
  if (!Number.isInteger(level) || level < 1 || level > upgrade.levels.length) {
    return "Unknown level";
  }
  const current = ownedLevel(state, upgradeId);
  if (level <= current) return "Already owned";
  if (level > current + 1) return `Level ${current + 1} first`;
  const cost = researchCostPoints(upgradeId, level);
  if (state.points + 1e-9 < cost) return "Not enough points";
  return null;
}

export function buyResearch(
  state: NavyResearch,
  upgradeId: string,
  level: number,
): { state: NavyResearch; problem: string | null; spent: number } {
  const problem = researchBuyProblem(state, upgradeId, level);
  if (problem) return { state, problem, spent: 0 };
  const next = cloneResearch(state);
  const cost = researchCostPoints(upgradeId, level);
  next.points = Math.max(0, next.points - cost);
  next.levels.set(upgradeId, level);
  return { state: next, problem: null, spent: cost };
}

export function awardResearchPoints(state: NavyResearch, points: number): NavyResearch {
  if (!(points > 0)) return state;
  const next = cloneResearch(state);
  next.points += points;
  return next;
}

export function awardPortDiscovery(
  state: NavyResearch,
  portId: string,
  size: PortSize,
): { state: NavyResearch; awarded: number } {
  if (state.discoveredPorts.has(portId)) return { state, awarded: 0 };
  const next = cloneResearch(state);
  next.discoveredPorts.add(portId);
  const awarded = settings.research.foundPortPoints[size];
  next.points += awarded;
  return { state: next, awarded };
}

export function awardPortCapture(
  state: NavyResearch,
  portId: string,
  size: PortSize,
): { state: NavyResearch; awarded: number } {
  const next = cloneResearch(state);
  const awarded = settings.research.capturedPortPoints[size];
  next.points += awarded;
  // A captured port should also count as discovered if this navy never saw it.
  next.discoveredPorts.add(portId);
  return { state: next, awarded };
}

export function awardDiscoveredBlocks(
  state: NavyResearch,
  blockIds: Iterable<string>,
): { state: NavyResearch; awarded: number; added: number } {
  const next = cloneResearch(state);
  let added = 0;
  for (const id of blockIds) {
    if (next.exploredBlocks.has(id)) continue;
    next.exploredBlocks.add(id);
    added += 1;
  }
  const awarded = added * settings.research.blockPoints;
  next.points += awarded;
  return { state: next, awarded, added };
}

function asLevels(value: ReadonlyMap<string, number> | Record<string, number>): Map<string, number> {
  return value instanceof Map ? new Map(value) : new Map(Object.entries(value));
}

/** First capture of a level unlocks it; repeats earn points toward the next. */
export function applyCaptureUnlocks(
  state: NavyResearch,
  captured: ReadonlyMap<string, number> | Record<string, number>,
): {
  state: NavyResearch;
  unlocked: Array<{ id: string; level: number }>;
  points: Array<{ id: string; points: number; level: number }>;
} {
  const next = cloneResearch(state);
  const seen = asLevels(captured);
  const unlocked: Array<{ id: string; level: number }> = [];
  const points: Array<{ id: string; points: number; level: number }> = [];
  const perLevel = Math.max(1, settings.research.capturePointsPerLevel);

  for (const [id, seenLevelRaw] of seen) {
    if (!researchUpgrade(id)) continue;
    const seenLevel = Math.max(0, Math.min(3, Math.floor(seenLevelRaw)));
    if (seenLevel <= 0) continue;
    let current = ownedLevel(next, id);
    if (current === 0) {
      current = 1;
      next.levels.set(id, current);
      unlocked.push({ id, level: current });
      // The first capture is the unlock, not one of the repeat points.
      continue;
    }
    let capturePoints = next.capturePoints.get(id) ?? 0;
    capturePoints += 1;
    while (capturePoints >= perLevel && current < seenLevel) {
      capturePoints -= perLevel;
      current += 1;
      next.levels.set(id, current);
      unlocked.push({ id, level: current });
    }
    next.capturePoints.set(id, capturePoints);
    points.push({ id, points: capturePoints, level: current });
  }

  return { state: next, unlocked, points };
}

/** A newly ordered ship starts with every researched ship level fitted. */
export function newShipUpgrades(levels: ReadonlyMap<string, number>): Map<string, number> {
  const fitted = new Map<string, number>();
  for (const upgrade of RESEARCH_UPGRADES) {
    if (!isShipUpgrade(upgrade)) continue;
    const level = levels.get(upgrade.id) ?? 0;
    if (level > 0) fitted.set(upgrade.id, Math.min(level, upgrade.levels.length));
  }
  return fitted;
}

export interface FittingPlan {
  missingLevels: number;
  levels: Map<string, number>;
  cost: number;
  gameDays: number;
  gameMs: number;
}

/** Costs 5% of the ship's price per missing level, after Shipyard discounts. */
export function fittingPlan(input: {
  classId: ShipClassId;
  fitted: ReadonlyMap<string, number>;
  unlocked: ReadonlyMap<string, number>;
  portModifiers?: Pick<PortResearchModifiers, "upgradeCost">;
}): FittingPlan {
  const basePrice = shipPrice(input.classId) ?? 0;
  const levels = new Map<string, number>();
  let missing = 0;
  for (const upgrade of RESEARCH_UPGRADES) {
    if (!isShipUpgrade(upgrade)) continue;
    const unlocked = Math.min(input.unlocked.get(upgrade.id) ?? 0, upgrade.levels.length);
    if (unlocked <= 0) continue;
    const fitted = Math.min(input.fitted.get(upgrade.id) ?? 0, unlocked);
    if (unlocked > fitted) {
      levels.set(upgrade.id, unlocked);
      missing += unlocked - fitted;
    }
  }
  const discount = input.portModifiers?.upgradeCost ?? 1;
  const cost = Math.ceil(basePrice * settings.research.fittingPriceSharePerLevel * missing * discount);
  const gameDays = settings.research.fittingDockGameDays;
  return {
    missingLevels: missing,
    levels,
    cost,
    gameDays,
    gameMs: gameDays * GAME_DAY_MS,
  };
}

export function fittedAfterUpgrade(
  fitted: ReadonlyMap<string, number>,
  plan: FittingPlan,
): Map<string, number> {
  const next = new Map(fitted);
  for (const [id, level] of plan.levels) {
    next.set(id, Math.max(next.get(id) ?? 0, level));
  }
  return next;
}

export function fortificationResearchTier(levels: ReadonlyMap<string, number>): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, levels.get("fortification") ?? 0)) as 0 | 1 | 2 | 3;
}

export function canBuildFortification(
  researchedTier: number,
  currentTier: number,
): boolean {
  return currentTier < Math.min(3, Math.max(0, researchedTier));
}

export function fireShipsUnlockedFor(levels: ReadonlyMap<string, number>): boolean {
  return (levels.get("fireShips") ?? 0) >= 1;
}

export function hotShotLevel(levels: ReadonlyMap<string, number>): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, levels.get("hotShot") ?? 0)) as 0 | 1 | 2 | 3;
}

function effectValue(effect: ResearchEffectDef, levelIndex: number): number {
  const values = settings.research.effects[effect.key] as readonly number[] | number;
  if (!Array.isArray(values)) return values as number;
  return (values as readonly number[])[Math.min(levelIndex, values.length - 1)] ?? 0;
}

function clampPriceMultiplier(value: number): number {
  return Math.max(settings.research.minimumPriceMultiplier, value);
}

/** One place that turns fitted ship levels or navy levels into modifiers. */
export function computeResearchModifiers(
  levels: ReadonlyMap<string, number>,
): ResearchModifiers {
  const modifiers: ResearchModifiers = {
    speed: 1,
    speedInWindBand: 1,
    raiderEscortSpeed: 1,
    closestToWindDeg: 0,
    sight: 1,
    nightSight: 1,
    reload: 1,
    hitChance: 1,
    chainGrape: settings.combat.chainDamageMultiplier,
    grapeRangeM: settings.combat.grapeRangeKm * 1_000,
    supplies: 1,
    seaRepair: 1,
    hull: 1,
    cargo: 1,
    boardingStrength: 1,
    prizeJoin: settings.research.prizeJoinBase,
    fireShipUnlocked: false,
    ignitionRangeM: settings.ships.fireShips.igniteRangeM,
    fireShipSpot: 1,
    fireShipPrice: 1,
    formationRotation: 1,
    draughtReductionM: 0,
    groundingDamage: 1,
    groundingFreeSeconds: 0,
    lightningChance: 1,
    stormDamage: 1,
    hotShotUnlocked: false,
    hotShotChance: 0,
    port: {
      shipPrice: 1,
      repairTime: 1,
      repairCost: 1,
      upgradeCost: 1,
      storage: 1,
      repairSpeed: 1,
      resupplySpeed: 1,
      income: 1,
      healingCost: 1,
      fortCost: 1,
      fortHealth: 1,
      lookout: 1,
    },
    hooks: [],
  };

  for (const upgrade of RESEARCH_UPGRADES) {
    const level = Math.max(0, Math.min(upgrade.levels.length, levels.get(upgrade.id) ?? 0));
    if (level <= 0) continue;
    const levelDef = upgrade.levels[level - 1]!;
    for (const effect of levelDef.effects) {
      const value = effectValue(effect, level - 1);
      if (!effect.active) {
        modifiers.hooks.push({
          upgradeId: upgrade.id,
          kind: effect.kind,
          level,
          system: effect.hook ?? "a later system",
          value,
        });
        continue;
      }
      switch (effect.kind) {
        case "speed": modifiers.speed *= 1 + value; break;
        case "speedWindBand": modifiers.speedInWindBand *= 1 + value; break;
        case "raiderEscortSpeed": modifiers.raiderEscortSpeed *= 1 + value; break;
        case "closestToWind": modifiers.closestToWindDeg += value; break;
        case "sight": modifiers.sight *= 1 + value; break;
        case "nightSight": modifiers.nightSight *= 1 + value; break;
        case "reload": modifiers.reload *= 1 - value; break;
        case "hitChance": modifiers.hitChance *= value; break;
        case "chainGrape": modifiers.chainGrape = Math.max(modifiers.chainGrape, value); break;
        case "grapeRange": modifiers.grapeRangeM = Math.max(modifiers.grapeRangeM, value); break;
        case "fireShipUnlock": modifiers.fireShipUnlocked = true; break;
        case "ignitionRange": modifiers.ignitionRangeM += value; break;
        case "fireShipSpot": modifiers.fireShipSpot = Math.min(modifiers.fireShipSpot, value); break;
        case "fireShipPrice": modifiers.fireShipPrice *= value; break;
        case "hotShotUnlock": modifiers.hotShotUnlocked = true; break;
        case "hotShotChance": modifiers.hotShotChance = Math.max(modifiers.hotShotChance, value); break;
        case "supplies": modifiers.supplies *= 1 + value; break;
        case "seaRepair": modifiers.seaRepair *= 1 + value; break;
        case "hull": modifiers.hull *= 1 + value; break;
        case "cargo": modifiers.cargo *= 1 + value; break;
        case "boardingStrength": modifiers.boardingStrength *= value; break;
        case "prizeCrew": modifiers.prizeJoin = Math.min(1, modifiers.prizeJoin + value); break;
        case "formationRotation": modifiers.formationRotation *= 1 + value; break;
        case "draught": modifiers.draughtReductionM += value; break;
        case "groundingDamage": modifiers.groundingDamage *= 1 - value; break;
        case "groundingFree": modifiers.groundingFreeSeconds = Math.max(modifiers.groundingFreeSeconds, value); break;
        case "lightning": modifiers.lightningChance *= 1 - value; break;
        case "storm": modifiers.stormDamage *= 1 - value; break;
        case "portShipPrice": modifiers.port.shipPrice *= 1 - value; break;
        case "portRepairTime": modifiers.port.repairTime *= 1 - value; break;
        case "portRepairCost": modifiers.port.repairCost *= 1 - value; break;
        case "portUpgradeCost": modifiers.port.upgradeCost *= 1 - value; break;
        case "portStorage": modifiers.port.storage *= 1 + value; break;
        case "portRepairSpeed": modifiers.port.repairSpeed *= 1 + value; break;
        case "portResupplySpeed": modifiers.port.resupplySpeed *= 1 + value; break;
        case "portIncome": modifiers.port.income *= 1 + value; break;
        case "portHealing": modifiers.port.healingCost *= 1 - value; break;
        case "portFortCost": modifiers.port.fortCost *= 1 - value; break;
        case "portFortHealth": modifiers.port.fortHealth *= 1 + value; break;
        case "portLookout": modifiers.port.lookout *= 1 + value; break;
        case "portOutput": break;
        case "portRegionalIncome": break;
        case "tradeIncome": break;
        case "resupplyPrice": break;
        case "silverShare": break;
        default: break;
      }
    }
  }

  modifiers.port.shipPrice = clampPriceMultiplier(modifiers.port.shipPrice);
  modifiers.port.repairTime = Math.max(settings.research.minimumPriceMultiplier, modifiers.port.repairTime);
  modifiers.port.repairCost = clampPriceMultiplier(modifiers.port.repairCost);
  modifiers.port.upgradeCost = clampPriceMultiplier(modifiers.port.upgradeCost);
  modifiers.port.fortCost = clampPriceMultiplier(modifiers.port.fortCost);
  modifiers.fireShipPrice = clampPriceMultiplier(modifiers.fireShipPrice);
  return modifiers;
}

/** Add a port's stored prior levels to the navy's current research. */
export function mergeResearchLevels(
  navyLevels: ReadonlyMap<string, number>,
  portLevels?: ReadonlyMap<string, number>,
): Map<string, number> {
  const merged = new Map(navyLevels);
  if (!portLevels) return merged;
  for (const [id, level] of portLevels) {
    merged.set(id, Math.max(merged.get(id) ?? 0, level));
  }
  return merged;
}

export function perShipSightKm(
  classId: ShipClassId,
  modifiers: ResearchModifiers,
): number {
  const base = classId === "fireShip"
    ? settings.research.effects.fireShipSightKm
    : settings.research.effects.shipSightKm;
  // The night multiplier is a hook and deliberately stays at 1 until Phase 6.
  return base * modifiers.sight;
}

export function isNightSightHook(modifiers: ResearchModifiers): boolean {
  return modifiers.hooks.some((hook) => hook.kind === "nightSight");
}

/** A description for the screen and the balance report. */
export function effectText(effect: ResearchEffectDef, levelIndex: number): string {
  const value = effectValue(effect, levelIndex);
  const pct = (number: number): string => `${Math.round(number * 1_000) / 10}%`;
  switch (effect.kind) {
    case "speed": return `Speed +${pct(value)} in all winds`;
    case "speedWindBand": return `Speed +${pct(value)} in 16–25 knot winds`;
    case "raiderEscortSpeed": return `Raiders and escorts speed +${pct(value)}`;
    case "closestToWind": return `Closest-to-wind angle ${value}° tighter`;
    case "sight": return effect.hook ? `Station keeping in the dark at greater distance` : `Daytime sight +${pct(value)}`;
    case "nightSight": return `Night sight +${pct(value)}`;
    case "groundingDamage": return `Grounding damage -${pct(value)} and stuck ships freed faster`;
    case "reload": return `Reload time -${pct(value)}`;
    case "hitChance": return `Hit chance x${value.toFixed(2)}`;
    case "chainGrape": return `Chain and grape damage x${value.toFixed(1)}`;
    case "grapeRange": return `Grape range ${Math.round(value)} m`;
    case "fireShipUnlock": return `Unlocks fire ships`;
    case "ignitionRange": return `Ignition range +${Math.round(effectValue(effect, 0))} m`;
    case "fireShipSpot": return value < 1 ? `Fire ships spotted at ${pct(1 - value)} shorter range` : `Fire ship spotting unchanged`;
    case "fireShipPrice": return value < 1 ? `Fire ship price -${pct(1 - value)}` : `Fire ship price unchanged`;
    case "hotShotUnlock": return `Unlocks hot shot for port batteries`;
    case "hotShotChance": return `Port hot-shot fire chance 1 in ${Math.round(1 / value)}`;
    case "supplies": return effect.hook ? `Far-south supplies +${Math.round(value)} days` : `Supplies last +${pct(value)} longer`;
    case "seaRepair": return `Repairs at sea +${pct(value)} faster`;
    case "hull": return `Hull points +${pct(value)}`;
    case "cargo": return `Cargo capacity +${pct(value)}`;
    case "draught": return `Draught ${value.toFixed(1)} m less`;
    case "lightning": return `Lightning fire and explosion chances -${pct(value)}`;
    case "storm": return `Storm damage -${pct(value)}`;
    case "formationRotation": return `Formation rotation +${pct(value)} faster`;
    case "boardingStrength": return `Attacker strength x${value.toFixed(2)}`;
    case "prizeCrew": return `Prize crew join share +${pct(value)}`;
    case "portShipPrice": return `Ship prices -${pct(value)}`;
    case "portRepairTime": return `Repair time -${pct(value)}`;
    case "portRepairCost": return `Repair costs -${pct(value)}`;
    case "portUpgradeCost": return `Ship upgrade costs -${pct(value)}`;
    case "portStorage": return `Port storage +${pct(value)}`;
    case "portRepairSpeed": return `Repairs ${pct(value)} faster`;
    case "portResupplySpeed": return `Resupply ${pct(value)} faster`;
    case "portIncome": return `Port income +${pct(value)}`;
    case "portHealing": return `Healing costs -${pct(value)}`;
    case "portFortCost": return `Fortification costs -${pct(value)}`;
    case "portFortHealth": return `Port fortification health +${pct(value)}`;
    case "portLookout": return `Port lookout and log range +${pct(value)}`;
    case "portOutput": return `Regional port output +${pct(value)}`;
    case "portRegionalIncome": return `Regional port income +${pct(value)}`;
    case "tradeIncome": return `Trade route income ${pct(value)}`;
    case "resupplyPrice": return `Allied resupply price -${pct(value)}`;
    case "silverShare": return `Silver share of the hold ${pct(value)}`;
    default: return effect.kind;
  }
}

export function effectTextForLevel(upgrade: ResearchUpgradeDef, level: number): string {
  const def = upgrade.levels[level - 1];
  if (!def) return "";
  return def.effects.map((effect) => effectText(effect, level - 1)).join(" · ");
}

export function hookTextForLevel(upgrade: ResearchUpgradeDef, level: number): string | null {
  const def = upgrade.levels[level - 1];
  if (!def) return null;
  const hook = def.effects.find((effect) => !effect.active && effect.hook);
  return hook ? `Takes effect when ${hook.hook} arrives` : null;
}

export function upgradeStateLabel(
  state: Pick<NavyResearch, "levels">,
  upgradeId: string,
): "owned" | "available" | "locked" {
  const current = ownedLevel(state, upgradeId);
  const def = researchUpgrade(upgradeId);
  if (!def) return "locked";
  return current >= def.levels.length ? "owned" : current === 0 ? "locked" : "available";
}

/** Regional output multiplier for one port, from active output upgrades only. */
export function portOutputMultiplier(
  port: { region: string; good: string },
  levels: ReadonlyMap<string, number>,
): number {
  let multiplier = 1;
  const value = (id: string): number => {
    const def = researchUpgrade(id);
    const level = Math.min(levels.get(id) ?? 0, def?.levels.length ?? 0);
    if (!def || level <= 0) return 0;
    const effect = def.levels[level - 1]?.effects.find((entry) => entry.active && entry.kind === "portOutput");
    return effect ? effectValue(effect, level - 1) : 0;
  };
  const region = port.region;
  if (region === "Central America") multiplier *= 1 + value("hondurasMosquito");
  if (region === "Greater Antilles" || region === "Lesser Antilles") multiplier *= 1 + value("caribbeanPlanters");
  if ((region === "Gulf of Mexico" || region === "Pacific coast") && port.good === "silver") multiplier *= 1 + value("silverPeruMexico");
  if (region === "River Plate" && port.good === "hides") multiplier *= 1 + value("riverPlateHides");
  if (region === "Guianas/Amazon") multiplier *= 1 + value("guianasRiver");
  return multiplier;
}

export interface FirstHourSimulation {
  foundPortPoints: number;
  blockPoints: number;
  capturePoints: number;
  totalPoints: number;
  units: number;
  blocks: number;
  portsFound: string[];
  capturedPort: PortSize;
}

/** The requested printout: three ports, some blocks and one small capture. */
export function firstHourSimulation(): FirstHourSimulation {
  const first = settings.research.firstHour;
  const foundPortPoints = first.foundPortSizes.reduce(
    (total, size) => total + settings.research.foundPortPoints[size],
    0,
  );
  const blockPoints = first.discoveredBlocks * settings.research.blockPoints;
  const capturePoints = settings.research.capturedPortPoints[first.capturedPortSize];
  const totalPoints = foundPortPoints + blockPoints + capturePoints;
  return {
    foundPortPoints,
    blockPoints,
    capturePoints,
    totalPoints,
    units: researchUnits(totalPoints),
    blocks: first.discoveredBlocks,
    portsFound: [...first.foundPortSizes],
    capturedPort: first.capturedPortSize,
  };
}

export interface BalanceLevel {
  level: number;
  units: number;
  points: number;
  effects: string;
  hook: string | null;
  frigate: {
    speedKnots: number;
    reloadGameMinutes: number;
    hitChance: number;
    sightKm: number;
    chainGrape: number;
    grapeRangeM: number;
    hull: number;
    cargoTonnes: number;
    boardingStrength: number;
    prizeJoin: number;
    pricePieces: number;
  };
}

export interface BalanceRow {
  id: string;
  name: string;
  branch: string;
  active: boolean;
  hook: string | null;
  levels: BalanceLevel[];
}

/** A printable numeric balance table, one row per upgrade and level. */
export function balanceReport(): BalanceRow[] {
  const frigate = shipTypeFor("British", "frigate");
  const basePrice = shipPrice("frigate") ?? 0;
  return RESEARCH_UPGRADES.map((upgrade) => {
    let active = false;
    let hook: string | null = null;
    for (const level of upgrade.levels) {
      for (const effect of level.effects) {
        if (effect.active) active = true;
        else if (effect.hook) hook ??= effect.hook;
      }
    }
    return {
      id: upgrade.id,
      name: upgrade.name,
      branch: upgrade.branch,
      active,
      hook,
      levels: upgrade.levels.map((_, index) => {
        const level = index + 1;
        const modifiers = computeResearchModifiers(new Map([[upgrade.id, level]]));
        return {
          level,
          units: researchLevelCostUnits(upgrade, level),
          points: researchCostPoints(upgrade.id, level),
          effects: effectTextForLevel(upgrade, level),
          hook: hookTextForLevel(upgrade, level),
          frigate: {
            speedKnots: frigate.cruiseKnots * modifiers.speed,
            reloadGameMinutes: frigate.reloadGameMinutes * modifiers.reload,
            hitChance: 0.5 * modifiers.hitChance,
            sightKm: perShipSightKm("frigate", modifiers),
            chainGrape: modifiers.chainGrape,
            grapeRangeM: modifiers.grapeRangeM,
            hull: frigate.hull * modifiers.hull,
            cargoTonnes: frigate.cargoTonnes * modifiers.cargo,
            boardingStrength: modifiers.boardingStrength,
            prizeJoin: modifiers.prizeJoin,
            pricePieces: Math.round(basePrice * modifiers.port.shipPrice),
          },
        };
      }),
    };
  });
}

export function researchRowsForNavy(navy: NavyId): Array<{
  upgrade: ResearchUpgradeDef;
  levels: Array<{ level: number; units: number; points: number; effects: string; hook: string | null }>;
}> {
  return researchLevelsForNavy(navy).map((upgrade) => ({
    upgrade,
    levels: upgrade.levels.map((_, index) => ({
      level: index + 1,
      units: researchLevelCostUnits(upgrade, index + 1),
      points: researchCostPoints(upgrade.id, index + 1),
      effects: effectTextForLevel(upgrade, index + 1),
      hook: hookTextForLevel(upgrade, index + 1),
    })),
  }));
}
