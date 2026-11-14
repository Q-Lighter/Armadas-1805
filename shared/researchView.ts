// 3I-c: browser-free research and ship-upgrade presentation. The client and
// the layout tests read this one model, so the five review viewports agree.

import { settings } from "./settings.js";
import type { NavyId } from "./navies.js";
import {
  RESEARCH_BRANCHES,
  isShipUpgrade,
  researchTreeFor,
  researchLevelCostUnits,
  type ResearchBranchId,
  type ResearchUpgradeDef,
} from "./data/research.js";
import {
  effectTextForLevel,
  hookTextForLevel,
  researchCostPoints,
} from "./research.js";

export type ResearchRowState = "locked" | "available" | "owned";

export interface ResearchRow {
  id: string;
  name: string;
  branch: ResearchBranchId;
  level: number;
  levels: number;
  pips: boolean[];
  state: ResearchRowState;
  nextLevel: number | null;
  costUnits: number;
  costPoints: number;
  effect: string;
  hook: string | null;
  buttonText: string;
  disabled: boolean;
  reason: string | null;
}

export interface ResearchBranchView {
  id: ResearchBranchId;
  name: string;
  description: string;
  rows: ResearchRow[];
}

export interface ResearchScreenView {
  navy: NavyId;
  points: number;
  units: number;
  branches: ResearchBranchView[];
  totalLevels: number;
  ownedLevels: number;
}

export interface ResearchScreenInput {
  navy: NavyId;
  points: number;
  levels: ReadonlyMap<string, number>;
}

function branchName(id: ResearchBranchId, navy: NavyId): string {
  if (id === "unique") return `${navy} unique`;
  return RESEARCH_BRANCHES.find((branch) => branch.id === id)?.name ?? `Branch ${id}`;
}

function rowFor(upgrade: ResearchUpgradeDef, level: number, points: number): ResearchRow {
  const levels = upgrade.levels.length;
  const current = Math.max(0, Math.min(levels, level));
  const nextLevel = current < levels ? current + 1 : null;
  const state: ResearchRowState = current >= levels ? "owned" : current === 0 ? "locked" : "available";
  const costUnits = nextLevel ? researchLevelCostUnits(upgrade, nextLevel) : 0;
  const costPoints = nextLevel ? researchCostPoints(upgrade.id, nextLevel) : 0;
  let reason: string | null = null;
  if (nextLevel === null) reason = "Fully researched";
  else if (nextLevel > current + 1) reason = `Level ${current + 1} first`;
  else if (points + 1e-9 < costPoints) reason = "Not enough points";
  return {
    id: upgrade.id,
    name: upgrade.name,
    branch: upgrade.branch,
    level: current,
    levels,
    pips: Array.from({ length: levels }, (_, index) => index < current),
    state,
    nextLevel,
    costUnits,
    costPoints,
    effect: upgrade.fortification
      ? `Build port fortifications up to tier ${nextLevel ?? levels}`
      : nextLevel ? effectTextForLevel(upgrade, nextLevel) : effectTextForLevel(upgrade, levels),
    hook: nextLevel ? hookTextForLevel(upgrade, nextLevel) : null,
    buttonText: nextLevel === null
      ? "Owned"
      : `Buy L${nextLevel} · ${costUnits} ${costUnits === 1 ? "unit" : "units"}`,
    disabled: reason !== null,
    reason,
  };
}

/** The whole Research screen model. Only this navy's tree is ever returned. */
export function researchScreenView(input: ResearchScreenInput): ResearchScreenView {
  const tree = researchTreeFor(input.navy);
  const groups = new Map<ResearchBranchId, ResearchRow[]>();
  for (const upgrade of tree) {
    const rows = groups.get(upgrade.branch) ?? [];
    rows.push(rowFor(upgrade, input.levels.get(upgrade.id) ?? 0, input.points));
    groups.set(upgrade.branch, rows);
  }
  const order: ResearchBranchId[] = ["A", "B", "C", "D", "E", "unique"];
  const branches = order
    .filter((id) => (groups.get(id)?.length ?? 0) > 0)
    .map((id) => ({
      id,
      name: branchName(id, input.navy),
      description: RESEARCH_BRANCHES.find((branch) => branch.id === id)?.description ?? "",
      rows: groups.get(id) ?? [],
    }));
  const totalLevels = tree.reduce((sum, upgrade) => sum + upgrade.levels.length, 0);
  const ownedLevels = tree.reduce(
    (sum, upgrade) => sum + Math.min(upgrade.levels.length, input.levels.get(upgrade.id) ?? 0),
    0,
  );
  return {
    navy: input.navy,
    points: Math.max(0, input.points),
    units: Math.floor(Math.max(0, input.points) / settings.research.pointsPerUnit),
    branches,
    totalLevels,
    ownedLevels,
  };
}

export interface ShipUpgradeRow {
  id: string;
  name: string;
  fitted: number;
  unlocked: number;
  levels: number;
  effect: string;
  hook: string | null;
}

/** Fitted versus unlocked for the selected ship's Upgrades tab. */
export function shipUpgradeRows(
  navy: NavyId,
  fitted: Readonly<Record<string, number>>,
  unlocked: Readonly<Record<string, number>>,
): ShipUpgradeRow[] {
  return researchTreeFor(navy)
    .filter(isShipUpgrade)
    .map((upgrade) => {
      const fittedLevel = Math.min(upgrade.levels.length, fitted[upgrade.id] ?? 0);
      const unlockedLevel = Math.min(upgrade.levels.length, unlocked[upgrade.id] ?? 0);
      return {
        id: upgrade.id,
        name: upgrade.name,
        fitted: fittedLevel,
        unlocked: unlockedLevel,
        levels: upgrade.levels.length,
        effect: effectTextForLevel(upgrade, Math.max(1, unlockedLevel)),
        hook: hookTextForLevel(upgrade, Math.max(1, unlockedLevel)),
      };
    });
}

export type ResearchLayoutBand = "phonePortrait" | "phoneLandscape" | "desktop";

export interface ResearchLayoutPlan {
  band: ResearchLayoutBand;
  columns: 1 | 2;
  scroll: boolean;
  minTargetPx: number;
  panelMaxHeightShare: number;
  panelMaxWidthPx: number;
}

/** Five review viewports collapse to these three bands, as in 3I-layout. */
export function researchLayoutPlan(width: number, height: number): ResearchLayoutPlan {
  if (width >= 700 && height >= 600) {
    return {
      band: "desktop",
      columns: 2,
      scroll: true,
      minTargetPx: 44,
      panelMaxHeightShare: 0.92,
      panelMaxWidthPx: 720,
    };
  }
  if (height < 500) {
    return {
      band: "phoneLandscape",
      columns: 2,
      scroll: true,
      minTargetPx: 44,
      panelMaxHeightShare: 0.9,
      panelMaxWidthPx: 720,
    };
  }
  return {
    band: "phonePortrait",
    columns: 1,
    scroll: true,
    minTargetPx: 44,
    panelMaxHeightShare: 0.88,
    panelMaxWidthPx: 560,
  };
}
