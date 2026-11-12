// Browser-free plans for the 3D boarding, crew, fire and abandoned screens.
// The client uses these labels; tests check odds, limits and five viewports
// without needing a browser.

import { settings } from "./settings.js";
import { minimumCrewFor, prisonerLimit, roundedBoardingOdds } from "./boarding.js";

export function boardingOddsText(chance: number): string {
  return `Odds: about ${roundedBoardingOdds(chance)}%`;
}

export interface BoardSheetPlan {
  title: string;
  detail: string;
  odds: number;
  oddsText: string;
  boardLabel: string;
  cancelLabel: string;
  canBoard: boolean;
}

/** The small Board sheet: odds are always rounded to the nearest 5%. */
export function boardSheet(options: {
  targetName: string;
  targetClass: string;
  chance: number | null;
  refused?: string | null;
}): BoardSheetPlan {
  const chance = options.chance === null ? 0 : Math.max(0, Math.min(1, options.chance));
  return {
    title: `Board ${options.targetName}`,
    detail: `${options.targetClass} · grapples at ${settings.combat.boardingRangeM} m`,
    odds: chance,
    oddsText: options.chance === null ? "Odds: unavailable" : boardingOddsText(chance),
    boardLabel: "Board",
    cancelLabel: "Cancel",
    canBoard: options.chance !== null && options.refused == null,
  };
}

export interface QuickCrewAmount {
  id: "minimum" | "half" | "full";
  label: string;
  amount: number;
}

/** Minimum, Half and Full keep the donor at 10% and the receiver at full. */
export function crewQuickAmounts(
  donorCrew: number,
  receiverCrew: number,
  receiverFullCrew: number,
): QuickCrewAmount[] {
  const donorMinimum = Math.ceil(donorCrew * settings.ships.minimumCrewShare);
  const transferable = Math.max(0, donorCrew - donorMinimum);
  const room = Math.max(0, receiverFullCrew - receiverCrew);
  const full = Math.min(transferable, room);
  return [
    {
      id: "minimum",
      label: "Minimum (10%)",
      amount: Math.min(transferable, Math.max(1, minimumCrewFor(receiverFullCrew) - receiverCrew)),
    },
    { id: "half", label: "Half", amount: Math.floor(full / 2) },
    { id: "full", label: "Full", amount: full },
  ];
}

export interface CrewTransferPlan {
  title: string;
  hint: string;
  minimum: number;
  quick: QuickCrewAmount[];
  receiverRoom: number;
}

export function crewTransferSheet(options: {
  donorName: string;
  receiverName: string;
  donorCrew: number;
  receiverCrew: number;
  receiverFullCrew: number;
  claim?: boolean;
}): CrewTransferPlan {
  const minimum = options.claim
    ? Math.max(0, minimumCrewFor(options.receiverFullCrew) - options.receiverCrew)
    : Math.max(1, Math.ceil(options.donorCrew * settings.ships.minimumCrewShare));
  return {
    title: options.claim ? `Claim ${options.receiverName}` : "Transfer crew",
    hint: options.claim
      ? `At least ${minimum} crew are needed to claim this hull.`
      : `${options.donorName} keeps at least ${minimum} crew.`,
    minimum,
    quick: crewQuickAmounts(options.donorCrew, options.receiverCrew, options.receiverFullCrew),
    receiverRoom: Math.max(0, options.receiverFullCrew - options.receiverCrew),
  };
}

export interface CapturedCrewPlanView {
  title: string;
  captured: number;
  joinLabel: string;
  killLabel: string;
  prisonerLabel: string;
  limit: number;
  overflowRule: string;
  defaultText: string;
}

export function capturedCrewSheet(options: {
  captured: number;
  fullCrew: number;
  secondsLeft?: number;
}): CapturedCrewPlanView {
  const captured = Math.max(0, Math.floor(options.captured));
  const limit = prisonerLimit(options.fullCrew);
  const left = Math.max(0, Math.ceil(options.secondsLeft ?? settings.combat.capturedChoiceSeconds));
  return {
    title: "Captured crew",
    captured,
    joinLabel: `Join (${captured} stay aboard)`,
    killLabel: `Kill (${captured} removed)`,
    prisonerLabel: `Take prisoners (up to ${limit})`,
    limit,
    overflowRule: `Only ${limit} may be prisoners; the overflow joins or is killed.`,
    defaultText: `No choice in ${left}s means they join.`,
  };
}

/** The port panel's prisoner row and total before confirming. */
export function prisonerHandoverRow(prisoners: number): {
  shown: boolean;
  label: string;
  count: number;
  total: number;
} {
  const count = Math.max(0, Math.floor(prisoners));
  return {
    shown: count > 0,
    label: `Hand over prisoners (${settings.combat.prisonerBounty} each)`,
    count,
    total: count * settings.combat.prisonerBounty,
  };
}

export interface FireRowPlan {
  label: string;
  strength: number;
  status: string;
  shown: boolean;
}

export function fireRow(burning: boolean, strength: number): FireRowPlan {
  const value = burning ? Math.max(0, Math.min(100, strength)) : 0;
  return {
    label: "Fire",
    strength: value,
    status: burning ? "Fighting fire" : "No fire",
    shown: burning,
  };
}

export interface BoardingProgressPlan {
  shown: boolean;
  label: string;
  progress: number;
  secondsLeft: number;
}

export function boardingProgress(
  progress: number | undefined,
  secondsLeft: number | undefined,
): BoardingProgressPlan {
  const shown = progress !== undefined && secondsLeft !== undefined;
  return {
    shown,
    label: shown ? `Boarding · ${Math.ceil(secondsLeft!)}s` : "Boarding",
    progress: Math.max(0, Math.min(1, progress ?? 0)),
    secondsLeft: Math.max(0, Math.ceil(secondsLeft ?? 0)),
  };
}

/** A broken-mast marker stays cheap and scales gently with zoom. */
export function abandonedMarkerSize(viewKmAcross: number): number {
  return Math.max(8, Math.min(22, 26 - Math.log2(Math.max(5, viewKmAcross))));
}

export interface CrewLayout {
  sheet: boolean;
  minTargetPx: number;
  contentWidth: number;
  maxHeight: number;
  columns: 1 | 2;
  /** The sheet content sits inside the viewport with at least this margin. */
  margin: number;
  scrolls: boolean;
}

/** Same 640 px breakpoint as the paper style sheet. */
export function crewSheetLayout(width: number, height: number): CrewLayout {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const phone = safeWidth <= 640;
  const margin = phone ? 8 : 16;
  return {
    sheet: phone,
    minTargetPx: 44,
    contentWidth: Math.max(0, safeWidth - margin * 2),
    maxHeight: Math.max(0, safeHeight - margin * 2),
    columns: safeWidth >= 740 ? 2 : 1,
    margin,
    scrolls: true,
  };
}

/** Effects are drawn only for ships or events the player can see. */
export function visibleCrewEffects<T extends { x: number; y: number }>(
  effects: readonly T[],
  ownShips: readonly { x: number; y: number }[],
  sightRangeKm = settings.fog.sightRangeKm,
): T[] {
  const rangeSq = Math.max(0, sightRangeKm) ** 2;
  return effects.filter((effect) =>
    ownShips.some((ship) => (ship.x - effect.x) ** 2 + (ship.y - effect.y) ** 2 <= rangeSq),
  );
}
