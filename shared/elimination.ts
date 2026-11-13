// Pure elimination, credit, inheritance and victory rules.
//
// The world owns ships and money; this module decides who is credited, how an
// eliminated player's property is divided, and which navy has won. It never
// looks at a socket, so the server and the tests share exactly these rules.

import { settings } from "./settings.js";
import type { NavyId } from "./navies.js";

export type EliminationReason =
  | "sunk"
  | "blewUp"
  | "captured"
  | "surrendered"
  | "abandoned"
  | "resigned"
  | "weather";

export interface DamageCredit {
  playerId: string;
  navy: NavyId;
  atRealMs: number;
}

/** One ship or other valuable unit in an inheritance. */
export interface AssetUnit {
  id: string;
  value: number;
}

export interface PlayerStanding {
  id: string;
  navy: NavyId;
  /** True while this player still owns their flagship. */
  hasFlagship: boolean;
}

export interface SimpleStats {
  shipsSunk: number;
  shipsCaptured: number;
  shipsLost: number;
  flagshipsDestroyed: number;
  shotsFired: number;
  shotsHit: number;
  damageDealtPounds: number;
  crewKilled: number;
  prisonersTaken: number;
  shipsBought: number;
  moneyEarned: number;
  moneySpent: number;
  distanceSailedKm: number;
  gameDaysPlayed: number;
  flagshipSurvivedRealSeconds: number;
}

export function emptyStats(): SimpleStats {
  return {
    shipsSunk: 0,
    shipsCaptured: 0,
    shipsLost: 0,
    flagshipsDestroyed: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealtPounds: 0,
    crewKilled: 0,
    prisonersTaken: 0,
    shipsBought: 0,
    moneyEarned: 0,
    moneySpent: 0,
    distanceSailedKm: 0,
    gameDaysPlayed: 0,
    flagshipSurvivedRealSeconds: 0,
  };
}

/**
 * Who defeated a flagship lost to damage. Only the last damage inside the
 * credit window counts, friendly fire and the owner's own navy never count,
 * and an ally hook can widen one credited player to an alliance.
 */
export function damageCredit(
  input: {
    ownerId: string;
    ownerNavy: NavyId;
    credits: readonly DamageCredit[];
    nowRealMs: number;
    windowSeconds?: number;
    alliesOf?: (playerId: string) => readonly string[];
  },
): string[] {
  const windowMs = (input.windowSeconds ?? settings.elimination.creditSeconds) * 1000;
  let last: DamageCredit | null = null;
  for (const credit of input.credits) {
    if (credit.playerId === input.ownerId) continue;
    if (credit.navy === input.ownerNavy) continue;
    if (input.nowRealMs - credit.atRealMs > windowMs) continue;
    if (!last || credit.atRealMs >= last.atRealMs) last = credit;
  }
  if (!last) return [];
  const allies = input.alliesOf?.(last.playerId) ?? [];
  return [last.playerId, ...allies.filter((id) => id !== last.playerId)];
}

/** Resign, capture and surrender choose their victor directly. */
export function directCredit(playerId: string | null): string[] {
  return playerId ? [playerId] : [];
}

/** The surviving teammate who inherits first, if there is one. */
export function survivingTeammate(
  ownerId: string,
  ownerNavy: NavyId,
  standings: readonly PlayerStanding[],
): string | null {
  return standings.find((player) =>
    player.id !== ownerId && player.navy === ownerNavy && player.hasFlagship
  )?.id ?? null;
}

/**
 * Split ship units by value: highest unit to the recipient with the lowest
 * running total, repeating. Ties go to the earlier recipient. This is the
 * AGREED "as evenly as possible by value" algorithm.
 */
export function distributeByValue(
  units: readonly AssetUnit[],
  recipientIds: readonly string[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of recipientIds) out.set(id, []);
  if (recipientIds.length === 0) return out;
  const totals = new Map<string, number>(recipientIds.map((id) => [id, 0]));
  const sorted = [...units].sort((left, right) =>
    right.value - left.value || left.id.localeCompare(right.id)
  );
  for (const unit of sorted) {
    let chosen = recipientIds[0]!;
    for (const id of recipientIds) {
      if ((totals.get(id) ?? 0) < (totals.get(chosen) ?? 0)) chosen = id;
    }
    out.get(chosen)!.push(unit.id);
    totals.set(chosen, (totals.get(chosen) ?? 0) + unit.value);
  }
  return out;
}

/** Money is split equally; remainders go to the first recipients. */
export function splitMoney(total: number, recipientIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (recipientIds.length === 0) return out;
  const whole = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  const each = Math.floor(whole / recipientIds.length);
  let remainder = whole - each * recipientIds.length;
  for (const id of recipientIds) {
    out.set(id, each + (remainder > 0 ? 1 : 0));
    remainder = Math.max(0, remainder - 1);
  }
  return out;
}

export function naviesWithFlagships(standings: readonly PlayerStanding[]): NavyId[] {
  return [...new Set(standings.filter((player) => player.hasFlagship).map((player) => player.navy))];
}

/**
 * Victory is checked only after an elimination. A room that never had two
 * navies with flagships never ends, and an empty navy never wins.
 */
export function victoryFor(
  standings: readonly PlayerStanding[],
  startedNavies: number,
): { navy: NavyId; playerIds: string[] } | null {
  if (startedNavies < 2) return null;
  const alive = naviesWithFlagships(standings);
  if (alive.length !== 1) return null;
  const navy = alive[0]!;
  return {
    navy,
    playerIds: standings
      .filter((player) => player.navy === navy && player.hasFlagship)
      .map((player) => player.id),
  };
}

/** Readable reason for the eliminated screen and notices. */
export function reasonText(reason: EliminationReason): string {
  switch (reason) {
    case "sunk": return "sunk";
    case "blewUp": return "blown up";
    case "captured": return "captured by boarding";
    case "surrendered": return "handed over by surrender";
    case "abandoned": return "abandoned";
    case "resigned": return "resigned";
    case "weather": return "lost to weather";
  }
}

/** True when a loss should ask the damage ledger who was responsible. */
export function isDamageLoss(reason: EliminationReason): boolean {
  return reason === "sunk" || reason === "blewUp" || reason === "abandoned";
}

/** One player on the final victory table. */
export interface GameOverPlayer {
  id: string;
  name: string;
  navy: NavyId;
  flagshipName: string | null;
  /** How they left: an elimination reason, or "won" for the survivors. */
  left: string;
  stats: SimpleStats;
  winner: boolean;
}

export interface GameOverState {
  navy: NavyId;
  winnerIds: string[];
  players: GameOverPlayer[];
  atGameMs: number;
}
