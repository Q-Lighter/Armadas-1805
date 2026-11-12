// 3D: boarding, crew transfer, abandoned ships, fire, explosion, friendly
// fire and sinking. Everything here is pure and uses the caller's seeded
// random number generator. The server owns the ship state; these functions
// only decide what one order or one tick does.
//
// Later prompts plug in through named neutral hooks: crew quality, morale,
// crew health, sea state and the allies list. All default to neutral here.

import { settings } from "./settings.js";
import type { SeededRandom } from "./combat.js";

export interface CrewShip {
  crew: number;
  fullCrew: number;
}

export type TransferProblem =
  | "donor is not yours"
  | "receiver is not yours"
  | "out of range"
  | "donor keeps at least 10% crew"
  | "receiver would exceed full crew"
  | "amount must be a whole sailor count"
  | "no crew transferred";

export interface TransferResult {
  ok: boolean;
  problem: TransferProblem | null;
  donorCrew: number;
  receiverCrew: number;
}

/** The 10% minimum, rounded up and at least one sailor. */
export function minimumCrewFor(fullCrew: number): number {
  return Math.max(1, Math.ceil(Math.max(0, fullCrew) * settings.ships.minimumCrewShare));
}

/**
 * Move crew between two of the same player's ships. The caller has already
 * checked ownership and range; the limits are enforced here.
 */
export function transferCrew(
  donor: CrewShip,
  receiver: CrewShip,
  amount: number,
): TransferResult {
  const wanted = Math.floor(Number.isFinite(amount) ? amount : 0);
  const minimum = minimumCrewFor(donor.fullCrew);
  const room = Math.max(0, Math.floor(receiver.fullCrew - receiver.crew));
  if (wanted < 1) {
    return { ok: false, problem: "amount must be a whole sailor count", donorCrew: donor.crew, receiverCrew: receiver.crew };
  }
  if (donor.crew - wanted < minimum) {
    return { ok: false, problem: "donor keeps at least 10% crew", donorCrew: donor.crew, receiverCrew: receiver.crew };
  }
  if (wanted > room) {
    return { ok: false, problem: "receiver would exceed full crew", donorCrew: donor.crew, receiverCrew: receiver.crew };
  }
  if (wanted < 1) {
    return { ok: false, problem: "no crew transferred", donorCrew: donor.crew, receiverCrew: receiver.crew };
  }
  return {
    ok: true,
    problem: null,
    donorCrew: donor.crew - wanted,
    receiverCrew: receiver.crew + wanted,
  };
}

export function withinRange(
  a: { x: number; y: number },
  b: { x: number; y: number },
  metres: number,
): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) * 1_000 <= metres + 1e-9;
}

// --- Abandoned ships ------------------------------------------------------

export interface AbandonableShip extends CrewShip {
  /** True once the ship has ever had its 10% minimum crew. */
  hadMinimumCrew: boolean;
  abandoned: boolean;
}

/**
 * AGREED: only a ship that once had the minimum and then fell below it can be
 * abandoned. A new purchase or a prize whose crew were all killed is never
 * abandoned; its owner keeps it and sees "needs crew".
 */
export function shouldAbandon(ship: AbandonableShip): boolean {
  if (ship.abandoned) return false;
  if (!ship.hadMinimumCrew) return false;
  return ship.crew < minimumCrewFor(ship.fullCrew);
}

export interface AbandonedState {
  abandoned: true;
  ownerId: null;
  hadMinimumCrew: true;
}

export function abandonShip<T extends { abandoned: boolean }>(ship: T): T {
  return { ...ship, abandoned: true };
}

/** Draft: 1.5% of hull each game hour until claimed or sunk. */
export function abandonedHullAfter(hull: number, maxHull: number, gameHours: number): number {
  if (!(gameHours > 0) || !(maxHull > 0)) return Math.max(0, hull);
  return Math.max(0, hull - maxHull * settings.combat.abandonedDecayPerHour * gameHours);
}

export type ClaimProblem =
  | "not abandoned"
  | "fleet full (30 ships)"
  | "out of range"
  | "not enough crew to claim"
  | "donor keeps at least 10% crew";

/**
 * A claim moves enough crew from one of the claimer's ships to bring the
 * abandoned hull back to the 10% minimum. The donor still keeps 10%.
 */
export function claimCrewNeeded(prize: CrewShip): number {
  return Math.max(0, minimumCrewFor(prize.fullCrew) - Math.floor(prize.crew));
}

export function claimProblem(options: {
  abandoned: boolean;
  fleetCount: number;
  maxShips?: number;
  inRange: boolean;
  donor: CrewShip;
  prize: CrewShip;
}): ClaimProblem | null {
  if (!options.abandoned) return "not abandoned";
  const maxShips = options.maxShips ?? settings.ships.maxShipsPerPlayer;
  if (options.fleetCount >= maxShips) return "fleet full (30 ships)";
  if (!options.inRange) return "out of range";
  const needed = claimCrewNeeded(options.prize);
  if (needed < 1) return null;
  if (options.donor.crew - needed < minimumCrewFor(options.donor.fullCrew)) {
    return "donor keeps at least 10% crew";
  }
  return null;
}

export interface ClaimResult {
  ok: boolean;
  problem: ClaimProblem | null;
  donorCrew: number;
  prizeCrew: number;
}

/** Claiming stops decay and changes owner; damage already done is kept. */
export function claimAbandoned(options: {
  abandoned: boolean;
  fleetCount: number;
  maxShips?: number;
  inRange: boolean;
  donor: CrewShip;
  prize: CrewShip;
}): ClaimResult {
  const problem = claimProblem(options);
  if (problem) {
    return {
      ok: false,
      problem,
      donorCrew: options.donor.crew,
      prizeCrew: options.prize.crew,
    };
  }
  const needed = claimCrewNeeded(options.prize);
  return {
    ok: true,
    problem: null,
    donorCrew: options.donor.crew - needed,
    prizeCrew: options.prize.crew + needed,
  };
}

// --- Boarding -------------------------------------------------------------

export interface BoardingModifiers {
  /** 1.0 until the Boarding drill research arrives in a later prompt. */
  quality?: number;
  /** 1.0 until morale is built in a later prompt. */
  morale?: number;
  /** 1.0 until crew healing is built in a later prompt. */
  health?: number;
  /** Calm/default hook until weather is built in a later prompt. */
  seaState?: number;
}

export function boardingSeaStateModifier(seaState: number): number {
  if (seaState >= settings.combat.boardingMaxSeaState) return 0;
  return settings.combat.boardingSeaStateModifier;
}

/** Surviving crew x quality x morale x crew health. */
export function boardingStrength(
  crew: number,
  modifiers: BoardingModifiers = {},
): number {
  const sea = boardingSeaStateModifier(modifiers.seaState ?? 0);
  return Math.max(0, crew) *
    (modifiers.quality ?? settings.combat.boardingCrewQuality) *
    (modifiers.morale ?? settings.combat.boardingMorale) *
    (modifiers.health ?? settings.combat.boardingCrewHealth) *
    sea;
}

/** Attacker chance A^2 / (A^2 + D^2). */
export function boardingOdds(
  attackerStrength: number,
  defenderStrength: number,
  seaState = 0,
): number {
  if (boardingSeaStateModifier(seaState) <= 0) return 0;
  const a = Math.max(0, attackerStrength);
  const d = Math.max(0, defenderStrength);
  if (a <= 0) return 0;
  if (d <= 0) return 1;
  const exponent = settings.combat.boardingExponent;
  const ap = Math.pow(a, exponent);
  const dp = Math.pow(d, exponent);
  return Math.max(0, Math.min(1, ap / (ap + dp)));
}

/** Odds shown to the player are rounded to the nearest 5%. */
export function roundedBoardingOdds(chance: number): number {
  return Math.round(Math.max(0, Math.min(1, chance)) * 20) * 5;
}

export type BoardingRefusal =
  | "target surrendered"
  | "target abandoned"
  | "target sinking"
  | "out of range"
  | "speed must match within 3 knots"
  | "attacker cannot board"
  | "rough seas";

export function boardingProblem(options: {
  distanceM: number;
  speedDifferenceKnots: number;
  targetSurrendered?: boolean;
  targetAbandoned?: boolean;
  targetSinking?: boolean;
  attackerCrew: number;
  attackerFullCrew: number;
  attackerSinking?: boolean;
  seaState?: number;
}): BoardingRefusal | null {
  if (options.targetSurrendered) return "target surrendered";
  if (options.targetAbandoned) return "target abandoned";
  if (options.targetSinking) return "target sinking";
  if (options.attackerSinking) return "attacker cannot board";
  if (boardingSeaStateModifier(options.seaState ?? 0) <= 0) return "rough seas";
  if (options.distanceM > settings.combat.boardingRangeM + 1e-9) return "out of range";
  if (Math.abs(options.speedDifferenceKnots) > settings.combat.boardingSpeedMatchKnots + 1e-9) {
    return "speed must match within 3 knots";
  }
  if (options.attackerCrew < minimumCrewFor(options.attackerFullCrew)) return "attacker cannot board";
  return null;
}

/** Draft: a fixed default fight, clamped to the agreed 60-120 range. */
export function boardingDurationSeconds(random: SeededRandom): number {
  const min = settings.combat.boardingMinSeconds;
  const max = settings.combat.boardingMaxSeconds;
  return min + (max - min) * random();
}

export interface BoardingCasualties {
  winner: "attacker" | "defender";
  /** Losses as whole sailors, capped at the survivors present. */
  attackerLost: number;
  defenderLost: number;
  /** Survivors stay aboard as captured crew when the attacker wins. */
  capturedCrew: number;
}

/**
 * Decide the winner from the pre-fight odds, then take casualties in
 * proportion to closeness. The loss is immediate for the pure rule; the
 * server spreads it over the fight.
 */
export function boardingCasualties(options: {
  attackerCrew: number;
  defenderCrew: number;
  attackerStrength: number;
  defenderStrength: number;
  random: SeededRandom;
}): BoardingCasualties {
  const chance = boardingOdds(options.attackerStrength, options.defenderStrength);
  const attackerWins = options.random() < chance;
  const winnerStrength = attackerWins ? options.attackerStrength : options.defenderStrength;
  const loserStrength = attackerWins ? options.defenderStrength : options.attackerStrength;
  const closeness = winnerStrength > 0
    ? Math.min(1, Math.max(0, loserStrength / winnerStrength))
    : 0;
  const loserLost = Math.round(
    Math.max(0, attackerWins ? options.defenderCrew : options.attackerCrew) *
    settings.combat.boardingLoserCrewLossShare,
  );
  const winnerLost = Math.round(
    Math.max(0, attackerWins ? options.attackerCrew : options.defenderCrew) *
    settings.combat.boardingWinnerMaxLoss * closeness,
  );
  const attackerLost = attackerWins ? winnerLost : loserLost;
  const defenderLost = attackerWins ? loserLost : winnerLost;
  return {
    winner: attackerWins ? "attacker" : "defender",
    attackerLost: Math.min(options.attackerCrew, attackerLost),
    defenderLost: Math.min(options.defenderCrew, defenderLost),
    capturedCrew: attackerWins
      ? Math.max(0, Math.min(options.defenderCrew, defenderLost === options.defenderCrew
          ? 0
          : options.defenderCrew - defenderLost))
      : 0,
  };
}

/** The strength ratio that ends a boarding at once. */
export function outnumberedBoarding(
  attackerStrength: number,
  defenderStrength: number,
): "attacker" | "defender" | null {
  const ratio = settings.combat.boardingOutnumberRatio;
  if (attackerStrength >= defenderStrength * ratio) return "attacker";
  if (defenderStrength >= attackerStrength * ratio) return "defender";
  return null;
}

export function autoBoardingAllowed(options: {
  objective: string | undefined;
  odds: number;
  targetCrewShare: number;
  targetSailsShare: number;
  targetMastsShare: number;
  autoBoard: boolean;
}): boolean {
  if (!options.autoBoard) return false;
  if (options.objective !== "capture") return false;
  if (options.odds < settings.combat.boardingAutoOdds - 1e-9) return false;
  return options.targetCrewShare < settings.combat.boardingWeakenedCrewShare ||
    (options.targetSailsShare < settings.combat.boardingWeakenedRigShare &&
      options.targetMastsShare < settings.combat.boardingWeakenedRigShare);
}

// --- Captured crew and prisoners -----------------------------------------

export type CapturedChoice = "join" | "kill" | "prisoners";

export function capturedChoiceAfterTimeout(choice: CapturedChoice | null): CapturedChoice {
  // Draft: if the player has not chosen within 120 real seconds, they join.
  return choice ?? "join";
}

/** Draft: prisoners are capped at 20% of the prize's full crew. */
export function prisonerLimit(fullCrew: number): number {
  return Math.max(0, Math.floor(fullCrew * settings.combat.capturedPrisonerMaxShare));
}

export interface CapturedCrewPlan {
  crew: number;
  prisoners: number;
  join: number;
  kill: number;
  problem: string | null;
}

/**
 * Apply Join, Kill or Take prisoners to the prize's captured crew. The player
 * may take at most the prisoner limit; the overflow must join or be killed.
 */
export function capturedCrewPlan(
  captured: number,
  fullCrew: number,
  choice: CapturedChoice,
  prisonerCount = 0,
): CapturedCrewPlan {
  const total = Math.max(0, Math.floor(captured));
  const limit = prisonerLimit(fullCrew);
  if (choice === "join") return { crew: total, prisoners: 0, join: total, kill: 0, problem: null };
  if (choice === "kill") return { crew: 0, prisoners: 0, join: 0, kill: total, problem: null };
  const wanted = Math.max(0, Math.floor(prisonerCount));
  const taken = Math.min(limit, total, wanted);
  const overflow = total - taken;
  return {
    crew: overflow,
    prisoners: taken,
    join: overflow,
    kill: 0,
    problem: wanted > limit
      ? "prisoner limit exceeded; overflow must join or be killed"
      : null,
  };
}

export function prisonerBounty(count: number): number {
  return Math.max(0, Math.floor(count)) * settings.combat.prisonerBounty;
}

/** Prisoners use half a crewman's provisions. */
export function provisionCrewEquivalent(crew: number, prisoners: number): number {
  return Math.max(0, crew) + Math.max(0, prisoners) * settings.combat.prisonerProvisionShare;
}

// --- Fire and explosions -------------------------------------------------

export interface FireState {
  burning: boolean;
  strength: number;
}

export function createFire(): FireState {
  return { burning: false, strength: 0 };
}

/** Start a fire, or add 10 to an existing one. */
export function igniteFire(fire: FireState, random: SeededRandom, chance?: number): FireState {
  if (fire.burning) {
    return {
      burning: true,
      strength: Math.min(settings.combat.fireMaxStrength, fire.strength + settings.combat.fireAddStrength),
    };
  }
  if (random() >= (chance ?? settings.combat.fireIgniteChance)) return { ...fire };
  return { burning: true, strength: settings.combat.fireStartStrength };
}

export function growFire(fire: FireState, seconds: number): FireState {
  if (!fire.burning || seconds <= 0) return { ...fire };
  return {
    burning: true,
    strength: Math.min(
      settings.combat.fireMaxStrength,
      fire.strength + settings.combat.fireGrowthPerSecond * seconds,
    ),
  };
}

export interface FireFightResult extends FireState {
  materialsUsed: number;
  out: boolean;
}

/**
 * AGREED: crew fight a fire with repair materials and time. Without materials
 * the reduction is only 30%.
 */
export function fightFire(
  fire: FireState,
  crewPercentValue: number,
  materialsTonnes: number,
  seconds: number,
): FireFightResult {
  if (!fire.burning || seconds <= 0) {
    return { ...fire, materialsUsed: 0, out: !fire.burning };
  }
  const hasMaterials = materialsTonnes > 0;
  const rate = settings.combat.fireFightStrengthPerSecond *
    Math.max(0, Math.min(100, crewPercentValue)) / 100 *
    (hasMaterials ? 1 : settings.combat.fireFightNoMaterialsShare);
  const strength = Math.max(0, fire.strength - rate * seconds);
  const wantedMaterials = settings.combat.fireFightMaterialsPerSecond * seconds;
  const materialsUsed = hasMaterials ? Math.min(materialsTonnes, wantedMaterials) : 0;
  return {
    burning: strength > 0,
    strength,
    materialsUsed,
    out: strength <= 0,
  };
}

export interface FireDamage {
  hullLoss: number;
  crewLoss: number;
}

export function fireDamage(
  strength: number,
  maxHull: number,
  fullCrew: number,
  seconds: number,
): FireDamage {
  const s = Math.max(0, Math.min(settings.combat.fireMaxStrength, strength));
  return {
    hullLoss: maxHull * settings.combat.fireHullDamagePerStrengthSecond * s * Math.max(0, seconds),
    crewLoss: fullCrew * settings.combat.fireCrewDamagePerStrengthSecond * s * Math.max(0, seconds),
  };
}

/**
 * Chance per second that one burning ship ignites a target. Downwind targets
 * are 2.5 times as likely, upwind targets 0.3 times. A burning target is not
 * re-ignited.
 */
export function fireSpreadChance(options: {
  strength: number;
  seconds: number;
  bearingRad: number;
  windFromDeg: number;
  targetBurning: boolean;
  inRange: boolean;
  coneDeg?: number;
}): number {
  if (options.targetBurning || !options.inRange) return 0;
  const strength = Math.max(0, Math.min(settings.combat.fireMaxStrength, options.strength));
  if (strength <= 0) return 0;
  const cone = options.coneDeg ?? settings.combat.fireSpreadConeDeg;
  const downwind = (options.windFromDeg + 180) * Math.PI / 180;
  let angle = Math.abs(((options.bearingRad - downwind + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  angle = Math.min(angle, Math.PI * 2 - angle);
  const degrees = angle * 180 / Math.PI;
  let multiplier = 1;
  if (degrees <= cone) multiplier = settings.combat.fireSpreadDownwindMultiplier;
  else if (degrees >= 180 - cone) multiplier = settings.combat.fireSpreadUpwindMultiplier;
  return Math.min(1,
    settings.combat.fireSpreadChancePerStrengthSecond * strength *
    Math.max(0, options.seconds) * multiplier,
  );
}

export function explosionChance(maxHull: number, hull: number, seconds: number): number {
  if (maxHull <= 0 || hull / maxHull >= settings.combat.explosionHullShare) return 0;
  // 4% a real minute, checked each second.
  const perSecond = 1 - Math.pow(1 - settings.combat.explosionChancePerMinute, 1 / 60);
  return 1 - Math.pow(1 - perSecond, Math.max(0, seconds));
}

export interface BlastResult {
  hullLoss: number;
  crewLoss: number;
}

export function explosionBlast(maxHull: number, fullCrew: number, inRange: boolean): BlastResult {
  if (!inRange) return { hullLoss: 0, crewLoss: 0 };
  return {
    hullLoss: maxHull * settings.combat.blastHullShare,
    crewLoss: fullCrew * settings.combat.blastCrewShare,
  };
}

// --- Friendly fire -------------------------------------------------------

export interface FriendlyCandidate {
  id: string;
  ownerId: string;
  navy: string;
  x: number;
  y: number;
  friendly: boolean;
}

/** Same player or same navy; allies hook is empty until Phase 4. */
export function isFriendly(
  shooterOwnerId: string,
  shooterNavy: string,
  otherOwnerId: string,
  otherNavy: string,
  allies: readonly string[] = settings.combat.allies,
): boolean {
  if (shooterOwnerId === otherOwnerId) return true;
  if (shooterNavy === otherNavy) return true;
  return allies.includes(otherOwnerId);
}

/**
 * A miss may hit the nearest friendly ship inside a 12 degree cone behind the
 * target. The caller supplies only candidates within 100 m of the target.
 */
export function friendlyFireTarget(options: {
  shooter: { x: number; y: number };
  target: { x: number; y: number };
  candidates: readonly FriendlyCandidate[];
  random: SeededRandom;
  chance?: number;
  addresseeOwnerId: string;
  addresseeNavy: string;
}): FriendlyCandidate | null {
  if (options.random() >= (options.chance ?? settings.combat.friendlyFireChance)) return null;
  const line = Math.atan2(options.target.x - options.shooter.x, -(options.target.y - options.shooter.y));
  let best: FriendlyCandidate | null = null;
  let bestDistance = Infinity;
  for (const candidate of options.candidates) {
    if (!candidate.friendly) continue;
    if (!isFriendly(
      options.addresseeOwnerId,
      options.addresseeNavy,
      candidate.ownerId,
      candidate.navy,
    )) continue;
    const distance = Math.hypot(candidate.x - options.target.x, candidate.y - options.target.y);
    if (distance * 1_000 > settings.combat.friendlyFireRangeM + 1e-9) continue;
    const bearing = Math.atan2(candidate.x - options.shooter.x, -(candidate.y - options.shooter.y));
    let diff = Math.abs(((bearing - line + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    diff = Math.min(diff, Math.PI * 2 - diff) * 180 / Math.PI;
    if (diff > settings.combat.friendlyFireConeDeg + 1e-9) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

// --- Sinking -------------------------------------------------------------

export interface SinkingState {
  sinking: boolean;
  sinceRealMs: number | null;
  remainingSeconds: number;
}

export function startSinking(nowRealMs: number): SinkingState {
  return { sinking: true, sinceRealMs: nowRealMs, remainingSeconds: settings.combat.sinkSeconds };
}

export function sinkingComplete(state: SinkingState, nowRealMs: number): boolean {
  if (!state.sinking || state.sinceRealMs === null) return false;
  return nowRealMs - state.sinceRealMs >= settings.combat.sinkSeconds * 1_000;
}

export function canActWhileSinking(state: SinkingState): boolean {
  return !state.sinking;
}
