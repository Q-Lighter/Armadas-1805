// Guns, damage, repairs and the sailing effects of damage.
//
// Everything here is pure and seeded. The server owns the state; this module
// only says what a shot, a repair or a damaged sail plan does. Later weather,
// crew-skill and morale systems can pass multipliers in without changing the
// formulas below.

import { settings } from "./settings.js";
import type { ShipClassId, ShipType } from "./data/ships.js";

const DEG = Math.PI / 180;
const COM = settings.combat;

export type CombatObjective = "sink" | "capture";
export type DamageArea = "hull" | "sails" | "masts" | "rudder" | "guns" | "crew";
export type GunClass = "heavy" | "medium" | "light";
export type GunMount = "broadside" | "bow" | "stern";
export type BroadsideSide = "port" | "starboard";
export type ShotType = "round" | "chain" | "grape";

export const DAMAGE_AREAS: readonly DamageArea[] = [
  "hull",
  "sails",
  "masts",
  "rudder",
  "guns",
  "crew",
];

/** Mutable-in-copy state used by the world and the duels. */
export interface ShipDamage {
  /** Hull points remaining. */
  hull: number;
  /** Sails, masts, rudder and guns, in their own damage points. */
  sails: number;
  masts: number;
  rudder: number;
  guns: number;
  /** Living crew. */
  crew: number;
}

/** The maximum points in each area. Crew is a count, the rest are points. */
export interface DamageCapacities {
  hull: number;
  sails: number;
  masts: number;
  rudder: number;
  guns: number;
  crew: number;
}

export interface DamagePercents {
  hull: number;
  sails: number;
  masts: number;
  rudder: number;
  guns: number;
  crew: number;
}

export type SeededRandom = () => number;

/** Small deterministic generator; the tests use the same seed every run. */
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** One full set of damage capacities from the ship table. */
export function damageCapacities(spec: ShipType): DamageCapacities {
  return {
    hull: spec.hull,
    sails: spec.hull * COM.damageAreaShareOfHull.sails,
    masts: spec.hull * COM.damageAreaShareOfHull.masts,
    rudder: spec.hull * COM.damageAreaShareOfHull.rudder,
    guns: spec.hull * COM.damageAreaShareOfHull.guns,
    crew: spec.crew,
  };
}

export function createShipDamage(spec: ShipType, crew: number = spec.crew): ShipDamage {
  const capacities = damageCapacities(spec);
  return {
    hull: capacities.hull,
    sails: capacities.sails,
    masts: capacities.masts,
    rudder: capacities.rudder,
    guns: capacities.guns,
    crew: Math.max(0, Math.min(capacities.crew, crew)),
  };
}

function capacityFor(capacities: DamageCapacities, area: DamageArea): number {
  return capacities[area];
}

/** 0..100 for one area. */
export function damageAreaPercent(
  damage: ShipDamage,
  capacities: DamageCapacities,
  area: DamageArea,
): number {
  const maximum = capacityFor(capacities, area);
  if (!(maximum > 0)) return 0;
  return Math.max(0, Math.min(100, (damage[area] / maximum) * 100));
}

export function damagePercents(
  damage: ShipDamage,
  capacities: DamageCapacities,
): DamagePercents {
  return {
    hull: damageAreaPercent(damage, capacities, "hull"),
    sails: damageAreaPercent(damage, capacities, "sails"),
    masts: damageAreaPercent(damage, capacities, "masts"),
    rudder: damageAreaPercent(damage, capacities, "rudder"),
    guns: damageAreaPercent(damage, capacities, "guns"),
    crew: damageAreaPercent(damage, capacities, "crew"),
  };
}

/** Cause damage in one area. Returns a new state; the input is untouched. */
export function applyAreaDamage(
  damage: ShipDamage,
  capacities: DamageCapacities,
  area: DamageArea,
  pounds: number,
): ShipDamage {
  if (!(pounds > 0) || !Number.isFinite(pounds)) return { ...damage };
  const pointsLost = area === "crew" ? pounds / COM.crewKillPounds : pounds;
  return {
    ...damage,
    [area]: Math.max(0, damage[area] - pointsLost),
  };
}

export function isShipSunk(damage: ShipDamage): boolean {
  return damage.hull <= 0;
}

export function crewPercent(damage: ShipDamage, capacities: DamageCapacities): number {
  return damageAreaPercent(damage, capacities, "crew");
}

/** AGREED: below this share of full crew the ship stops and cannot fight. */
export function crewTooLow(damage: ShipDamage, capacities: DamageCapacities): boolean {
  return crewPercent(damage, capacities) < settings.ships.minimumCrewShare * 100;
}

/**
 * Reload-time multiplier in a straight line from x1 at full crew to x3 at the
 * minimum useful crew. Below that the ship cannot fire at all anyway.
 */
export function crewReloadMultiplier(crewPercentValue: number): number {
  const minimum = settings.ships.minimumCrewShare * 100;
  const pct = Math.max(minimum, Math.min(100, crewPercentValue));
  const share = (pct - minimum) / Math.max(1e-9, 100 - minimum);
  return COM.reloadMultiplierAtMinimumCrew +
    (COM.reloadMultiplierAtFullCrew - COM.reloadMultiplierAtMinimumCrew) * share;
}

export function crewRepairMultiplier(crewPercentValue: number): number {
  return Math.max(0, Math.min(1, crewPercentValue / 100));
}

/** Real seconds for one reload, including crew quality for a later prompt. */
export function reloadRealSeconds(
  spec: ShipType,
  crewPercentValue: number,
  crewSkillMultiplier: number = COM.crewSkillReloadMultiplier,
): number {
  return spec.reloadGameMinutes * COM.battleSecondsPerGameMinute *
    crewReloadMultiplier(crewPercentValue) * crewSkillMultiplier;
}

/** How many complete broadsides are left in the ammunition store. */
export function ammunitionBroadsideCount(spec: ShipType, ammunitionTonnes: number): number {
  const perBroadside = spec.broadsideLb / settings.ships.stores.poundsPerTonne;
  if (!(perBroadside > 0)) return 0;
  return Math.max(0, ammunitionTonnes) / perBroadside;
}

/** Signed shortest turn from a to b, in degrees. */
export function shortestAngleDegrees(fromRad: number, toRad: number): number {
  let degrees = ((toRad - fromRad) / DEG) % 360;
  if (degrees > 180) degrees -= 360;
  if (degrees <= -180) degrees += 360;
  return degrees;
}

export function angleBetweenDegrees(aRad: number, bRad: number): number {
  return Math.abs(shortestAngleDegrees(aRad, bRad));
}

/** Bearing from one point to another, 0 = north, clockwise. */
export function bearingRad(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  return Math.atan2(to.x - from.x, -(to.y - from.y));
}

export function broadsideSide(
  headingRad: number,
  targetBearingRad: number,
): BroadsideSide | null {
  const relative = shortestAngleDegrees(headingRad, targetBearingRad);
  if (Math.abs(relative - 90) <= COM.broadsideArcDeg) return "starboard";
  if (Math.abs(relative + 90) <= COM.broadsideArcDeg) return "port";
  return null;
}

export function bowBears(headingRad: number, targetBearingRad: number): boolean {
  return angleBetweenDegrees(headingRad, targetBearingRad) <= COM.bowSternArcDeg;
}

export function sternBears(headingRad: number, targetBearingRad: number): boolean {
  return Math.abs(angleBetweenDegrees(headingRad, targetBearingRad) - 180) <=
    COM.bowSternArcDeg;
}

export interface BearingGunGroup {
  mount: GunMount;
  side: BroadsideSide | null;
  gunClass: GunClass;
  baseGuns: number;
}

/** Every gun group that can see a target at this bearing. */
export function bearingGunGroups(
  spec: ShipType,
  headingRad: number,
  targetBearingRad: number,
): BearingGunGroup[] {
  const groups: BearingGunGroup[] = [];
  const side = broadsideSide(headingRad, targetBearingRad);
  if (side) {
    for (const [gunClass, count] of [
      ["heavy", spec.heavyGuns],
      ["medium", spec.mediumGuns],
      ["light", spec.lightGuns],
    ] as const) {
      if (count > 0) groups.push({ mount: "broadside", side, gunClass, baseGuns: count });
    }
  }
  const endGuns = COM.bowSternGunsByClass[spec.classId];
  if (bowBears(headingRad, targetBearingRad) && endGuns.bow > 0) {
    groups.push({ mount: "bow", side: null, gunClass: "light", baseGuns: endGuns.bow });
  }
  if (sternBears(headingRad, targetBearingRad) && endGuns.stern > 0) {
    groups.push({ mount: "stern", side: null, gunClass: "light", baseGuns: endGuns.stern });
  }
  return groups;
}

/**
 * Pounds carried by one gun of each class. The table's broadside weight is the
 * truth, so the nominal 14/7/3 weights are scaled until their total matches it.
 */
export function gunPounds(spec: ShipType): Record<GunClass, number> {
  const nominal =
    spec.heavyGuns * COM.gunWeightLb.heavy +
    spec.mediumGuns * COM.gunWeightLb.medium +
    spec.lightGuns * COM.gunWeightLb.light;
  const scale = nominal > 0 ? spec.broadsideLb / nominal : 0;
  return {
    heavy: COM.gunWeightLb.heavy * scale,
    medium: COM.gunWeightLb.medium * scale,
    light: COM.gunWeightLb.light * scale,
  };
}

export interface HitChanceModifiers {
  /** Neutral until weather arrives in a later prompt. */
  seaState?: number;
  /** Neutral until crew skill arrives in a later prompt. */
  crewAccuracy?: number;
  /** Neutral until morale arrives in a later prompt. */
  morale?: number;
}

/** The firing ship is upwind when the target lies in the downwind half. */
export function isUpwind(bearingToTargetRad: number, windFromDeg: number): boolean {
  const downwindRad = (windFromDeg + 180) * DEG;
  return Math.cos(shortestAngleDegrees(downwindRad, bearingToTargetRad) * DEG) > 1e-9;
}

/** AGREED range bands, with the upwind and later-system multipliers. */
export function hitChanceAtRange(
  distanceKm: number,
  upwind = false,
  modifiers: HitChanceModifiers = {},
): number {
  let base = 0;
  for (let index = 0; index < COM.hitChanceBands.length; index += 1) {
    const band = COM.hitChanceBands[index]!;
    const inBand = index === COM.hitChanceBands.length - 1
      ? distanceKm <= band.maxKm
      : distanceKm < band.maxKm;
    if (inBand) {
      base = band.chance;
      break;
    }
  }
  if (base <= 0) return 0;
  const multiplier =
    (upwind ? COM.upwindHitMultiplier : 1) *
    (modifiers.seaState ?? COM.seaStateHitMultiplier) *
    (modifiers.crewAccuracy ?? COM.crewAccuracyMultiplier) *
    (modifiers.morale ?? COM.moraleHitMultiplier);
  return clamp01(base * multiplier);
}

export function isSmallClass(classId: ShipClassId): boolean {
  return (COM.smallClasses as readonly string[]).includes(classId);
}

export function isBigClass(classId: ShipClassId): boolean {
  return (COM.bigClasses as readonly string[]).includes(classId);
}

/** Draft class-vs-size damage modifiers. */
export function gunClassDamageMultiplier(
  gunClass: GunClass,
  targetClass: ShipClassId,
): number {
  if (gunClass === "light" && isBigClass(targetClass)) {
    return COM.lightGunVsBigMultiplier;
  }
  if (gunClass === "heavy" && isSmallClass(targetClass)) {
    return COM.heavyGunVsSmallMultiplier;
  }
  return 1;
}

export function objectiveAreaWeights(
  objective: CombatObjective,
): Record<DamageArea, number> {
  const weights = COM.objectiveAreaWeights[objective];
  return {
    hull: weights.hull,
    sails: weights.sails,
    masts: weights.masts,
    rudder: weights.rudder,
    guns: weights.guns,
    crew: weights.crew,
  };
}

/** Pick a hit area with the objective weights. */
export function pickDamageArea(
  objective: CombatObjective,
  random: SeededRandom,
): DamageArea {
  const weights = objectiveAreaWeights(objective);
  const total = DAMAGE_AREAS.reduce((sum, area) => sum + weights[area], 0);
  let roll = random() * total;
  for (const area of DAMAGE_AREAS) {
    roll -= weights[area];
    if (roll < 0) return area;
  }
  return "crew";
}

/** Ammunition chosen for an area, including the 300 m grape limit. */
export function shotTypeForArea(area: DamageArea, distanceKm: number): ShotType {
  if (area === "sails" || area === "masts") return "chain";
  if (area === "crew") return distanceKm <= COM.grapeRangeKm ? "grape" : "round";
  return "round";
}

/** Damage multiplier from the ammunition chosen for the area. */
export function shotDamageMultiplier(area: DamageArea, distanceKm: number): number {
  if (area === "sails" || area === "masts") return COM.chainDamageMultiplier;
  if (area === "crew" && distanceKm <= COM.grapeRangeKm) return COM.grapeDamageMultiplier;
  return 1;
}

/** Round a fractional gun count with the seeded generator. */
export function seededGunCount(exact: number, random: SeededRandom): number {
  if (!(exact > 0)) return 0;
  const whole = Math.floor(exact);
  return whole + (random() < exact - whole ? 1 : 0);
}

export interface FiringInput {
  spec: ShipType;
  damage: ShipDamage;
  targetClass: ShipClassId;
  distanceKm: number;
  targetBearingRad: number;
  headingRad: number;
  windFromDeg?: number;
  ammunitionTonnes: number;
  objective: CombatObjective;
  random: SeededRandom;
  modifiers?: HitChanceModifiers;
}

export interface FiringGroupResult {
  mount: GunMount;
  side: BroadsideSide | null;
  gunClass: GunClass;
  guns: number;
  hits: number;
  pounds: number;
}

export interface FiringResult {
  fired: boolean;
  groups: FiringGroupResult[];
  gunsFired: number;
  hits: number;
  misses: number;
  pounds: number;
  ammunitionUsed: number;
  hitChance: number;
  upwind: boolean;
  areaHits: Record<DamageArea, number>;
  damageByArea: Partial<Record<DamageArea, number>>;
  shotTypes: Record<ShotType, number>;
  damage: ShipDamage;
  sunk: boolean;
}

function emptyAreaHits(): Record<DamageArea, number> {
  return { hull: 0, sails: 0, masts: 0, rudder: 0, guns: 0, crew: 0 };
}

function emptyResult(damage: ShipDamage, hitChance: number, upwind: boolean): FiringResult {
  return {
    fired: false,
    groups: [],
    gunsFired: 0,
    hits: 0,
    misses: 0,
    pounds: 0,
    ammunitionUsed: 0,
    hitChance,
    upwind,
    areaHits: emptyAreaHits(),
    damageByArea: {},
    shotTypes: { round: 0, chain: 0, grape: 0 },
    damage: { ...damage },
    sunk: isShipSunk(damage),
  };
}

/**
 * Resolve one ship's firing at a target. The caller decides whether the ship
 * may fire (reload, orders, visibility); this function resolves every bearing
 * gun group once.
 */
export function resolveFiring(input: FiringInput): FiringResult {
  const capacities = damageCapacities(input.spec);
  const bearing = input.targetBearingRad;
  const upwind = isUpwind(bearing, input.windFromDeg ?? settings.weather.windFromDeg);
  const chance = hitChanceAtRange(input.distanceKm, upwind, input.modifiers);
  if (
    chance <= 0 ||
    input.ammunitionTonnes <= 0 ||
    crewTooLow(input.damage, capacities) ||
    isShipSunk(input.damage)
  ) {
    return emptyResult(input.damage, chance, upwind);
  }

  const groups = bearingGunGroups(input.spec, input.headingRad, bearing);
  if (groups.length === 0) return emptyResult(input.damage, chance, upwind);

  const gunPercent = damageAreaPercent(input.damage, capacities, "guns") / 100;
  if (gunPercent <= 0) return emptyResult(input.damage, chance, upwind);

  const poundsPerGun = gunPounds(input.spec);
  const requestedPounds = groups.reduce(
    (sum, group) => sum + group.baseGuns * gunPercent * poundsPerGun[group.gunClass],
    0,
  );
  const requestedCost = requestedPounds / settings.ships.stores.poundsPerTonne;
  const ammoScale = requestedCost > 0
    ? Math.min(1, Math.max(0, input.ammunitionTonnes) / requestedCost)
    : 0;
  if (ammoScale <= 0) return emptyResult(input.damage, chance, upwind);

  let damage = { ...input.damage };
  const resultGroups: FiringGroupResult[] = [];
  const areaHits = emptyAreaHits();
  const areaPounds: Partial<Record<DamageArea, number>> = {};
  const areaBefore = damagePercents(damage, capacities);
  const shotTypes: Record<ShotType, number> = { round: 0, chain: 0, grape: 0 };
  let gunsFired = 0;
  let hits = 0;
  let poundsFired = 0;
  let landedPounds = 0;

  for (const group of groups) {
    const guns = seededGunCount(group.baseGuns * gunPercent * ammoScale, input.random);
    let groupHits = 0;
    let groupPounds = 0;
    for (let gun = 0; gun < guns; gun += 1) {
      const basePounds = poundsPerGun[group.gunClass];
      poundsFired += basePounds;
      if (input.random() >= chance) continue;
      const area = pickDamageArea(input.objective, input.random);
      const shot = shotTypeForArea(area, input.distanceKm);
      const delivered = basePounds *
        gunClassDamageMultiplier(group.gunClass, input.targetClass) *
        shotDamageMultiplier(area, input.distanceKm);
      damage = applyAreaDamage(damage, capacities, area, delivered);
      areaHits[area] += 1;
      areaPounds[area] = (areaPounds[area] ?? 0) + delivered;
      shotTypes[shot] += 1;
      groupHits += 1;
      groupPounds += delivered;
      hits += 1;
      landedPounds += delivered;
    }
    gunsFired += guns;
    if (guns > 0) {
      resultGroups.push({
        mount: group.mount,
        side: group.side,
        gunClass: group.gunClass,
        guns,
        hits: groupHits,
        pounds: groupPounds,
      });
    }
  }

  const ammunitionUsed = Math.min(
    input.ammunitionTonnes,
    poundsFired / settings.ships.stores.poundsPerTonne,
  );
  const after = damagePercents(damage, capacities);
  const damageByArea: Partial<Record<DamageArea, number>> = {};
  for (const area of DAMAGE_AREAS) {
    const lost = areaBefore[area] - after[area];
    if (lost > 1e-9) damageByArea[area] = lost;
  }
  return {
    fired: gunsFired > 0,
    groups: resultGroups,
    gunsFired,
    hits,
    misses: gunsFired - hits,
    pounds: landedPounds,
    ammunitionUsed,
    hitChance: chance,
    upwind,
    areaHits,
    damageByArea,
    shotTypes,
    damage,
    sunk: isShipSunk(damage),
  };
}

/** The cost to repair one area from 0 to 100, in tonnes. */
export function repairCostForArea(
  spec: ShipType,
  area: Exclude<DamageArea, "crew">,
  materialCapacityTonnes: number,
): number {
  const capacities = damageCapacities(spec);
  const totalPoints =
    capacities.hull + capacities.sails + capacities.masts + capacities.rudder + capacities.guns;
  const areaPoints = capacities[area];
  return materialCapacityTonnes * COM.repairMaterialShareForFullRestore *
    (areaPoints / totalPoints);
}

export interface RepairResult {
  damage: ShipDamage;
  materialsUsed: number;
  materialsLeft: number;
  repaired: Partial<Record<Exclude<DamageArea, "crew">, number>>;
}

/**
 * Repair the most damaged area first until the time or materials run out.
 * The caller must already have checked `canRepair`.
 */
export function repairShip(
  damage: ShipDamage,
  spec: ShipType,
  materialsTonnes: number,
  materialCapacityTonnes: number,
  dtGameHours: number,
): RepairResult {
  const capacities = damageCapacities(spec);
  let next = { ...damage };
  let materials = Math.max(0, materialsTonnes);
  let hours = Math.max(0, dtGameHours);
  let materialsUsed = 0;
  const repaired: Partial<Record<Exclude<DamageArea, "crew">, number>> = {};
  const crewPct = crewPercent(damage, capacities);
  const repairScale = crewRepairMultiplier(crewPct);
  if (materials <= 0 || hours <= 0 || repairScale <= 0) {
    return { damage: next, materialsUsed: 0, materialsLeft: materials, repaired };
  }

  const areas: Array<Exclude<DamageArea, "crew">> = ["hull", "sails", "masts", "rudder", "guns"];
  for (let pass = 0; pass < 8 && hours > 1e-12 && materials > 1e-12; pass += 1) {
    let best: Exclude<DamageArea, "crew"> | null = null;
    let bestPct = 101;
    for (const area of areas) {
      const pct = damageAreaPercent(next, capacities, area);
      if (pct < bestPct - 1e-9) {
        best = area;
        bestPct = pct;
      }
    }
    if (!best || bestPct >= 100) break;

    const rate = COM.repairRatePctPerGameHour[best] * repairScale;
    const fullCost = repairCostForArea(spec, best, materialCapacityTonnes);
    const costPerPct = fullCost / 100;
    if (!(rate > 0) || !(costPerPct > 0)) break;

    const missingPct = 100 - bestPct;
    const byTime = rate * hours;
    const byMaterials = materials / costPerPct;
    const amount = Math.min(missingPct, byTime, byMaterials);
    if (amount <= 1e-12) break;

    const capacity = capacities[best];
    next = {
      ...next,
      [best]: Math.min(capacity, next[best] + (amount / 100) * capacity),
    };
    const used = amount * costPerPct;
    materials -= used;
    materialsUsed += used;
    repaired[best] = (repaired[best] ?? 0) + amount;
    hours -= amount / rate;
  }
  return { damage: next, materialsUsed, materialsLeft: Math.max(0, materials), repaired };
}

export type PortRepairMode = "stores" | "pay";

export interface PortRepairQuote {
  /** Full missing repair work, in tonnes of repair materials. */
  materialsTonnes: number;
  /** What the locals charge for the same work. Zero for the stores choice. */
  money: number;
  rateMultiplier: number;
}

/**
 * Price a full repair of the five non-crew areas at a port. The stores choice
 * uses the ship's own materials; the pay choice costs twice their posted value
 * and never touches that stock. Both are Draft numbers from settings.
 */
export function portRepairQuote(
  damage: ShipDamage,
  spec: ShipType,
  materialCapacityTonnes: number,
  repairMaterialsPrice: number,
  mode: PortRepairMode,
): PortRepairQuote {
  const capacities = damageCapacities(spec);
  let materialsTonnes = 0;
  const areas: Array<Exclude<DamageArea, "crew">> = ["hull", "sails", "masts", "rudder", "guns"];
  for (const area of areas) {
    const missing = 1 - damageAreaPercent(damage, capacities, area) / 100;
    if (missing <= 0) continue;
    materialsTonnes += repairCostForArea(spec, area, materialCapacityTonnes) * missing;
  }
  const price = Math.max(0, repairMaterialsPrice);
  const money = mode === "pay"
    ? Math.ceil(materialsTonnes * price * COM.portRepairPayMultiplier)
    : 0;
  return {
    materialsTonnes,
    money,
    rateMultiplier: COM.portRepairRateMultiplier[mode],
  };
}

/** A repairing ship is in combat for 30 real seconds after the last shot. */
export function isInCombat(lastCombatRealMs: number | null, nowRealMs: number): boolean {
  if (lastCombatRealMs === null || !Number.isFinite(lastCombatRealMs)) return false;
  return nowRealMs - lastCombatRealMs < COM.combatSeconds * 1_000;
}

export function canRepair(lastCombatRealMs: number | null, nowRealMs: number): boolean {
  return !isInCombat(lastCombatRealMs, nowRealMs);
}

/** Drifting damage once the repair materials are gone. */
export function applyDriftingHullDamage(
  damage: ShipDamage,
  spec: ShipType,
  dtGameHours: number,
): ShipDamage {
  if (!(dtGameHours > 0)) return { ...damage };
  const loss = spec.hull * COM.driftHullDamageSharePerGameHour * dtGameHours;
  return { ...damage, hull: Math.max(0, damage.hull - loss) };
}

export interface ShipPerformance {
  crewPercent: number;
  sailsPercent: number;
  mastsPercent: number;
  rudderPercent: number;
  gunsPercent: number;
  effectiveSailPercent: number;
  speedFactor: number;
  /** Extra speed when there is no effective sail. */
  driftSpeedKnots: number;
  driftHeadingRad: number;
  turnRateFactor: number;
  turnRateDegPerSecond: number;
  wantsDownwind: boolean;
  canSail: boolean;
  canFight: boolean;
  crewTooLow: boolean;
}

export interface SailingModifiers {
  seaState?: number;
  crewSkill?: number;
  morale?: number;
}

/**
 * The one place sailing code should read damaged speed, steering and drift.
 * Later weather and crew systems plug into the modifiers with neutral defaults.
 */
export function shipPerformance(
  spec: ShipType,
  damage: ShipDamage,
  windFromDeg: number = settings.weather.windFromDeg,
  modifiers: SailingModifiers = {},
): ShipPerformance {
  const capacities = damageCapacities(spec);
  const percents = damagePercents(damage, capacities);
  const effective = (percents.sails * percents.masts) / 100;
  const tooLow = crewTooLow(damage, capacities);
  const seaState = modifiers.seaState ?? COM.seaStateSpeedMultiplier;
  const crewSkill = modifiers.crewSkill ?? COM.crewSkillSpeedMultiplier;
  const morale = modifiers.morale ?? COM.moraleSpeedMultiplier;
  const speedFactor = tooLow ? 0 : (effective / 100) * seaState * crewSkill * morale;
  const driftSpeedKnots = tooLow
    ? 0
    : effective <= 0
      ? settings.weather.windStrengthKnots * COM.driftWindSpeedShare
      : 0;
  const turnRateFactor = tooLow
    ? 0
    : COM.zeroRudderTurnShare +
      (1 - COM.zeroRudderTurnShare) * (percents.rudder / 100);
  const baseTurn = 90 / (spec.turn90GameMinutes * 60);
  const driftHeadingRad = (windFromDeg + 180) * DEG;
  return {
    crewPercent: percents.crew,
    sailsPercent: percents.sails,
    mastsPercent: percents.masts,
    rudderPercent: percents.rudder,
    gunsPercent: percents.guns,
    effectiveSailPercent: effective,
    speedFactor,
    driftSpeedKnots,
    driftHeadingRad,
    turnRateFactor,
    turnRateDegPerSecond: baseTurn * turnRateFactor,
    wantsDownwind: percents.rudder <= 0 || effective <= 0,
    canSail: !tooLow && (speedFactor > 0 || driftSpeedKnots > 0),
    canFight: !tooLow,
    crewTooLow: tooLow,
  };
}
