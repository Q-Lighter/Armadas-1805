// Part B port battle rules. Everything here is pure and takes seeded random
// numbers from the caller, so the server and the balance script share one set
// of AGREED numbers.

import { settings } from "./settings.js";
import type { PortSize } from "./data/ports.js";

export type PortTier = 0 | 1 | 2 | 3;
export type PortCondition = "Healthy" | "Damaged" | "Heavily damaged" | "Silenced";

export interface PortBattlePort {
  id: string;
  name: string;
  size: PortSize;
  npc: boolean;
  /** Optional world position; pure tests can use the centre hook instead. */
  x?: number;
  y?: number;
}

export interface PortBuild {
  toTier: PortTier;
  startedGameMs: number;
  endsGameMs: number;
}

export interface PortStock {
  timber: number;
  repairMaterials: number;
}

export interface PortBattle {
  size: PortSize;
  ownerId: string | null;
  health: number;
  tier: PortTier;
  build: PortBuild | null;
  /** Owner id to the real second when their aggressor status expires. */
  aggressors: Map<string, number>;
  lastAttackedRealSeconds: number;
  capture: { sideId: string; seconds: number } | null;
  stock: PortStock;
  /** Hook for later upgrades; no upgrades are built in 3F. */
  upgradesUnlockedFor: string | null;
}

export interface ArmedShip {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  guns: number;
  ammunition: number;
  crewShare: number;
  abandoned?: boolean;
  surrendered?: boolean;
  drifting?: boolean;
  grappled?: boolean;
  dockedPortId?: string | null;
}

export interface CaptureContext {
  paused: boolean;
  gameHour: number;
  mist?: boolean;
  thickFog?: boolean;
  /** Weather phase hook; 1 leaves the agreed ranges unchanged. */
  weatherMultiplier?: number;
  sameSide?: (a: string, b: string) => boolean;
}

export interface CaptureStatus {
  rangeKm: number;
  sides: string[];
  sideId: string | null;
  reason: string | null;
  seconds: number;
  requiredSeconds: number;
  capturedBy: string | null;
}

export interface PortShot {
  shipId: string;
  ownerId: string;
  distanceKm: number;
  hit: boolean;
  pounds: number;
}

const B = settings.ports.battle;

export function portMaxHealth(size: PortSize, tier: PortTier): number {
  return B.health[size] * (1 + B.tierHealthBonus * tier);
}

export function newPortBattle(port: PortBattlePort, stock?: Partial<PortStock>): PortBattle {
  return {
    size: port.size,
    ownerId: null,
    health: portMaxHealth(port.size, 0),
    tier: 0,
    build: null,
    aggressors: new Map(),
    lastAttackedRealSeconds: Number.NEGATIVE_INFINITY,
    capture: null,
    stock: { timber: stock?.timber ?? 0, repairMaterials: stock?.repairMaterials ?? 0 },
    upgradesUnlockedFor: null,
  };
}

export function portGuns(size: PortSize, tier: PortTier): { heavy: number; medium: number; light: number } {
  const counts = B.guns[size];
  const factor = 1 + B.tierGunBonus * tier;
  return {
    heavy: Math.round(counts.heavy * factor),
    medium: Math.round(counts.medium * factor),
    light: Math.round(counts.light * factor),
  };
}

export function portGunPounds(size: PortSize, tier: PortTier): number {
  const guns = portGuns(size, tier);
  return guns.heavy * B.gunPounds.heavy + guns.medium * B.gunPounds.medium +
    guns.light * B.gunPounds.light;
}

export function portBatteryRangeKm(size: PortSize, tier: PortTier): number {
  return B.rangeKm + B.tierRangeBonusKm * tier;
}

export function portBatteryShare(state: PortBattle): number {
  return Math.max(0, Math.min(1, state.health / portMaxHealthFor(state)));
}

export function portMaxHealthFor(state: PortBattle): number {
  return B.health[state.size as PortSize] ?? 1;
}

function maxHealth(state: PortBattle, port: PortBattlePort): number {
  return portMaxHealth(port.size, state.tier);
}

export function portCondition(state: PortBattle, port: PortBattlePort): PortCondition {
  if (state.health <= 0) return "Silenced";
  const share = state.health / maxHealth(state, port);
  if (share >= 0.75) return "Healthy";
  if (share >= 0.4) return "Damaged";
  return "Heavily damaged";
}

export function portValue(port: PortBattlePort, tier: PortTier): number {
  return B.value[port.size] * (1 + B.valueTierBonus * tier);
}

export function isNpcPort(port: { npc: boolean }): boolean {
  return port.npc;
}

/** Why an attack is refused, or null when it is allowed. */
export function portAttackProblem(
  port: PortBattlePort,
  state: PortBattle,
  attackerOwnerId: string,
  sameSide: (a: string, b: string) => boolean = (a, b) => a === b,
): string | null {
  if (port.npc) return "Neutral ground";
  if (state.ownerId === attackerOwnerId) return "That is your own port";
  if (state.ownerId && sameSide(state.ownerId, attackerOwnerId)) return "That is a friendly port";
  return null;
}

export function markPortAttacked(
  state: PortBattle,
  ownerId: string,
  realSeconds: number,
): void {
  state.lastAttackedRealSeconds = Math.max(state.lastAttackedRealSeconds, realSeconds);
  state.aggressors.set(ownerId, realSeconds + B.aggressorRealSeconds);
}

export function activeAggressors(state: PortBattle, realSeconds: number): string[] {
  for (const [ownerId, expiry] of state.aggressors) {
    if (expiry <= realSeconds) state.aggressors.delete(ownerId);
  }
  return [...state.aggressors.keys()];
}

/** A landed shot does its pounds of damage. The caller reports only hits. */
export function damagePort(
  state: PortBattle,
  port: PortBattlePort,
  ownerId: string,
  pounds: number,
  realSeconds: number,
): number {
  const dealt = Math.max(0, pounds);
  state.health = Math.max(0, state.health - dealt);
  markPortAttacked(state, ownerId, realSeconds);
  return dealt;
}

export function hitChanceAt(distanceKm: number): number {
  for (const band of B.hitBands) {
    if (distanceKm <= band.maxKm) return band.chance;
  }
  return 0;
}

/**
 * One battery volley. Only active aggressors are targets, the owner's side is
 * never hit, and docked ships are sheltered and not passed in by the caller.
 */
export function firePortBatteries(
  state: PortBattle,
  port: PortBattlePort,
  targets: readonly ArmedShip[],
  realSeconds: number,
  random: () => number,
  sameSide: (a: string, b: string) => boolean = (a, b) => a === b,
): PortShot[] {
  const aggressors = activeAggressors(state, realSeconds);
  if (aggressors.length === 0 || state.health <= 0) return [];
  const range = portBatteryRangeKm(port.size, state.tier);
  const share = Math.max(0, Math.min(1, state.health / maxHealth(state, port)));
  const guns = portGuns(port.size, state.tier);
  const barrels = [
    { count: guns.heavy, pounds: B.gunPounds.heavy },
    { count: guns.medium, pounds: B.gunPounds.medium },
    { count: guns.light, pounds: B.gunPounds.light },
  ];
  const choices: Array<{ ship: ArmedShip; distanceKm: number }> = [];
  for (const ship of targets) {
    if (ship.dockedPortId === port.id) continue;
    if (state.ownerId && sameSide(ship.ownerId, state.ownerId)) continue;
    if (!aggressors.some((ownerId) => sameSide(ownerId, ship.ownerId))) continue;
    const distanceKm = Math.hypot(ship.x - portCentre(port).x, ship.y - portCentre(port).y);
    if (distanceKm > range) continue;
    choices.push({ ship, distanceKm });
  }
  if (choices.length === 0) return [];
  const shots: PortShot[] = [];
  for (const barrel of barrels) {
    for (let index = 0; index < barrel.count; index += 1) {
      if (random() >= share) continue;
      const target = choices[Math.floor(random() * choices.length)]!;
      shots.push({
        shipId: target.ship.id,
        ownerId: target.ship.ownerId,
        distanceKm: target.distanceKm,
        hit: random() < hitChanceAt(target.distanceKm),
        pounds: barrel.pounds,
      });
    }
  }
  return shots;
}

/** Ports do not store coordinates in the rules type; the server passes them. */
let portCentreHook: (port: PortBattlePort) => { x: number; y: number } = () => ({ x: 0, y: 0 });
export function setPortCentreHook(hook: (port: PortBattlePort) => { x: number; y: number }): void {
  portCentreHook = hook;
}
function portCentre(port: PortBattlePort): { x: number; y: number } {
  if (port.x !== undefined && port.y !== undefined) return { x: port.x, y: port.y };
  return portCentreHook(port);
}

export function captureRangeKm(
  port: PortBattlePort,
  tier: PortTier,
  context: Pick<CaptureContext, "gameHour" | "mist" | "thickFog" | "weatherMultiplier">,
): number {
  let range = B.captureRangeKm[port.size];
  const night = context.gameHour < B.nightStartGameHour || context.gameHour >= B.nightEndGameHour;
  if (night) range *= 0.5;
  if (context.mist) range *= 0.5;
  if (context.thickFog) range *= 0.25;
  range *= context.weatherMultiplier ?? 1;
  return Math.max(0, range + B.tierRangeBonusKm * 0); // tier does not change capture range
}

export function captureShipsInRange(
  port: PortBattlePort,
  state: PortBattle,
  ships: readonly ArmedShip[],
  context: CaptureContext,
): ArmedShip[] {
  const range = captureRangeKm(port, state.tier, context);
  const centre = portCentre(port);
  return ships.filter((ship) => {
    if (ship.dockedPortId === port.id) return false;
    if (ship.abandoned || ship.surrendered || ship.drifting || ship.grappled) return false;
    if (ship.guns <= 0 || ship.ammunition <= 0 || ship.crewShare < 0.1) return false;
    return Math.hypot(ship.x - centre.x, ship.y - centre.y) <= range;
  });
}

function sideFor(ownerId: string, others: readonly string[], sameSide: (a: string, b: string) => boolean): string {
  return [ownerId, ...others].find((candidate) => sameSide(candidate, ownerId)) ?? ownerId;
}

export function captureStatus(
  port: PortBattlePort,
  state: PortBattle,
  ships: readonly ArmedShip[],
  context: CaptureContext,
): CaptureStatus {
  const inRange = captureShipsInRange(port, state, ships, context);
  const sameSide = context.sameSide ?? ((a: string, b: string) => a === b);
  const ownerSide = state.ownerId;
  const enemyOwners = [...new Set(inRange.map((ship) => ship.ownerId))]
    .filter((ownerId) => !ownerSide || !sameSide(ownerId, ownerSide));
  const sides: string[] = [];
  for (const ownerId of enemyOwners) {
    const side = sideFor(ownerId, enemyOwners, sameSide);
    if (!sides.includes(side)) sides.push(side);
  }
  const requiredSeconds = settings.ports.battle.captureHoldRealSeconds;
  if (state.health > 0) {
    return { rangeKm: captureRangeKm(port, state.tier, context), sides, sideId: null, reason: "Batteries still firing", seconds: 0, requiredSeconds, capturedBy: null };
  }
  if (ownerSide && inRange.some((ship) => sameSide(ship.ownerId, ownerSide))) {
    return { rangeKm: captureRangeKm(port, state.tier, context), sides, sideId: null, reason: "Port owner's ships in range", seconds: 0, requiredSeconds, capturedBy: null };
  }
  if (sides.length === 0) {
    return { rangeKm: captureRangeKm(port, state.tier, context), sides, sideId: null, reason: "No capturing ships", seconds: 0, requiredSeconds, capturedBy: null };
  }
  if (sides.length > 1) {
    return { rangeKm: captureRangeKm(port, state.tier, context), sides, sideId: null, reason: "Two sides in range", seconds: 0, requiredSeconds, capturedBy: null };
  }
  const sideId = sides[0]!;
  const seconds = state.capture?.sideId === sideId ? state.capture.seconds : 0;
  return { rangeKm: captureRangeKm(port, state.tier, context), sides, sideId, reason: null, seconds, requiredSeconds, capturedBy: null };
}

/**
 * Advance the 300-second hold. Pause freezes it; a different side resets it;
 * leaving the range or any healing resets it.
 */
export function tickPortCapture(
  port: PortBattlePort,
  state: PortBattle,
  ships: readonly ArmedShip[],
  context: CaptureContext,
  dtRealSeconds: number,
  requiredHoldSeconds: number = B.captureHoldRealSeconds,
): CaptureStatus {
  const status = captureStatus(port, state, ships, context);
  if (status.reason) {
    state.capture = null;
    return status;
  }
  if (!status.sideId) return status;
  if (context.paused) {
    return { ...status, seconds: state.capture?.sideId === status.sideId ? state.capture.seconds : 0 };
  }
  if (state.capture?.sideId !== status.sideId) state.capture = { sideId: status.sideId, seconds: 0 };
  state.capture.seconds += Math.max(0, dtRealSeconds);
  const held = state.capture.seconds;
  if (held < requiredHoldSeconds) {
    return { ...status, seconds: held };
  }
  state.ownerId = status.sideId;
  state.health = maxHealth(state, port) * B.captureHealthShare;
  state.capture = null;
  state.upgradesUnlockedFor = status.sideId;
  return { ...status, seconds: held, requiredSeconds: requiredHoldSeconds, capturedBy: status.sideId };
}

export interface DockedShip {
  id: string;
  ownerId: string;
  fightBack: boolean;
  flagship: boolean;
}

export interface CaptureDockedResult {
  captured: DockedShip[];
  pushedOut: DockedShip[];
}

/** Docked ships after a capture. A flagship is never captured. */
export function resolveDockedShips(
  docked: readonly DockedShip[],
  capturedBy: string,
): CaptureDockedResult {
  const captured: DockedShip[] = [];
  const pushedOut: DockedShip[] = [];
  for (const ship of docked) {
    if (ship.ownerId === capturedBy) continue;
    if (ship.flagship || ship.fightBack) pushedOut.push(ship);
    else captured.push({ ...ship, ownerId: capturedBy });
  }
  return { captured, pushedOut };
}

export function canDockAtPort(
  state: PortBattle,
  playerId: string,
  sameSide: (a: string, b: string) => boolean = (a, b) => a === b,
): boolean {
  return !state.ownerId || state.ownerId === playerId || sameSide(state.ownerId, playerId);
}

/** Build cost for the next tier, scaled by port size. */
export function portBuildCost(port: PortBattlePort, toTier: number): PortStock {
  const tier = Math.max(1, Math.min(3, toTier)) as 1 | 2 | 3;
  const scale = B.sizeBuildMultiplier[port.size];
  const cost = B.buildCost[tier];
  return {
    timber: Math.ceil(cost.timber * scale),
    repairMaterials: Math.ceil(cost.repairMaterials * scale),
  };
}

export function buildTimeGameMs(toTier: number): number {
  const days = B.buildGameDays[Math.max(1, Math.min(3, toTier)) - 1] ?? 1;
  return days * 24 * 3600 * 1000;
}

export type BuildProblem = "No build needed" | "Build already running" | "Not enough timber" | "Not enough repair materials" | "Needs research" | null;

export function startPortBuild(
  port: PortBattlePort,
  state: PortBattle,
  playerId: string,
  gameMs: number,
  researchUnlocked: boolean,
): BuildProblem {
  if (state.ownerId !== playerId) return "No build needed";
  if (state.tier >= 3) return "No build needed";
  if (state.build) return "Build already running";
  if (!researchUnlocked) return "Needs research";
  const target = (state.tier + 1) as 1 | 2 | 3;
  const cost = portBuildCost(port, target);
  if (state.stock.timber < cost.timber) return "Not enough timber";
  if (state.stock.repairMaterials < cost.repairMaterials) return "Not enough repair materials";
  state.stock.timber -= cost.timber;
  state.stock.repairMaterials -= cost.repairMaterials;
  state.build = { toTier: target, startedGameMs: gameMs, endsGameMs: gameMs + buildTimeGameMs(target) };
  return null;
}

export function tickPortBuild(state: PortBattle, port: PortBattlePort, gameMs: number): boolean {
  if (!state.build || gameMs < state.build.endsGameMs) return false;
  const oldMax = maxHealth(state, port);
  state.tier = state.build.toTier;
  const newMax = maxHealth(state, port);
  if (oldMax > 0 && state.health > 0) state.health *= newMax / oldMax;
  state.build = null;
  return true;
}

export interface RepairResult {
  healed: number;
  materialsUsed: number;
}

/** Repairs are blocked for 120 real seconds after the last attack. */
export function repairPort(
  port: PortBattlePort,
  state: PortBattle,
  dtGameSeconds: number,
  realSeconds: number,
): RepairResult {
  if (state.health >= maxHealth(state, port)) return { healed: 0, materialsUsed: 0 };
  if (realSeconds - state.lastAttackedRealSeconds < B.repairBlockRealSeconds) {
    return { healed: 0, materialsUsed: 0 };
  }
  const hours = Math.max(0, dtGameSeconds) / 3600;
  const baseShare = state.ownerId
    ? B.ownedRepairSharePerGameHour
    : B.unownedRepairSharePerGameHour;
  let healed = maxHealth(state, port) * baseShare * hours;
  let materialsUsed = 0;
  if (state.ownerId && state.stock.repairMaterials > 0) {
    healed *= 2;
    const materialCost = (healed / maxHealth(state, port)) / 0.05 *
      B.repairMaterialTonnesPerFivePercent;
    materialsUsed = Math.min(state.stock.repairMaterials, materialCost);
    state.stock.repairMaterials -= materialsUsed;
  }
  const before = state.health;
  state.health = Math.min(maxHealth(state, port), state.health + healed);
  return { healed: state.health - before, materialsUsed };
}

export function silenced(state: PortBattle): boolean {
  return state.health <= 0;
}

export interface EliminationRecipient {
  playerId: string;
  value: number;
}

/**
 * Assign an eliminated player's ports. Teammates get them first; otherwise the
 * victors split them by value. With no defeater the ports become unowned.
 */
export function eliminatePorts(
  ports: ReadonlyArray<{ port: PortBattlePort; state: PortBattle }>,
  teammate: string | null,
  victors: readonly string[],
): Array<{ portId: string; ownerId: string | null }> {
  if (teammate) return ports.map(({ port }) => ({ portId: port.id, ownerId: teammate }));
  if (victors.length === 0) return ports.map(({ port }) => ({ portId: port.id, ownerId: null }));
  const sorted = [...ports].sort((a, b) => portValue(b.port, b.state.tier) - portValue(a.port, a.state.tier));
  const load = new Map(victors.map((id) => [id, 0]));
  return sorted.map(({ port, state }) => {
    const value = portValue(port, state.tier);
    const chosen = [...victors].sort((a, b) => (load.get(a)! - load.get(b)!))[0]!;
    load.set(chosen, load.get(chosen)! + value);
    return { portId: port.id, ownerId: chosen };
  });
}
