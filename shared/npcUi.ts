// Browser-free plans for the 3H-d neutral contact, loot, privateer and escort
// screens. The client and tests share these labels, colours and layout numbers.

import { goodName, type GoodId } from "./data/goods.js";
import { settings } from "./settings.js";

export type NpcKindId = "merchant" | "whaler" | "privateer";
export type NpcModeId = "patrol" | "escort" | "raid";

export interface NpcKindStyle {
  kind: NpcKindId;
  label: string;
  short: string;
  fill: number;
  stroke: number;
  marker: "circle" | "diamond" | "triangle";
}

/**
 * Neutral ink is its own palette. A neutral hull never borrows the British,
 * French, Spanish or Dutch navy colour, so the chart reads friend/foe at once.
 */
export const NPC_KIND_STYLES: Record<NpcKindId, NpcKindStyle> = {
  merchant: {
    kind: "merchant",
    label: "Merchant",
    short: "M",
    fill: 0xb3834f,
    stroke: 0x4a3220,
    marker: "circle",
  },
  whaler: {
    kind: "whaler",
    label: "Whaler",
    short: "W",
    fill: 0x66877f,
    stroke: 0x2f4a44,
    marker: "diamond",
  },
  privateer: {
    kind: "privateer",
    label: "Privateer",
    short: "P",
    fill: 0x98513f,
    stroke: 0x5b2a24,
    marker: "triangle",
  },
};

export interface NeutralHullStyle {
  fill: number;
  stroke: number;
  hired: boolean;
}

export function neutralHullStyle(kind: NpcKindId, hired = false): NeutralHullStyle {
  const style = NPC_KIND_STYLES[kind] ?? NPC_KIND_STYLES.merchant;
  return {
    fill: hired ? 0x7d6b3a : style.fill,
    stroke: hired ? 0xd6b45a : style.stroke,
    hired,
  };
}

export interface NeutralMarkerPlan {
  kind: NpcKindId;
  shape: NpcKindStyle["marker"];
  label: string;
  short: string;
  fill: number;
  stroke: number;
  sizePx: number;
  /** A thin gold ring marks a privateer under the player's contract. */
  hiredRing: boolean;
}

export function neutralMarker(kind: NpcKindId, hired = false): NeutralMarkerPlan {
  const style = NPC_KIND_STYLES[kind] ?? NPC_KIND_STYLES.merchant;
  return {
    kind: style.kind,
    shape: style.marker,
    label: style.label,
    short: style.short,
    fill: style.fill,
    stroke: style.stroke,
    sizePx: 7,
    hiredRing: hired,
  };
}

export function npcKindLabel(kind: NpcKindId): string {
  return (NPC_KIND_STYLES[kind] ?? NPC_KIND_STYLES.merchant).label;
}

export function npcModeLabel(mode: NpcModeId): string {
  return mode === "escort" ? "Escort" : mode === "raid" ? "Raid" : "Patrol";
}

function pieces(value: number): string {
  return Math.max(0, Math.round(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Six game days read as "6d 0h"; short contracts still show hours. */
export function contractRemainingText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  if (whole <= 0) return "contract ended";
  const hours = Math.ceil(whole / 3_600);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${days}d ${rest}h left`;
}


export type NpcBattleActionId = "manageContract" | "hirePrivateer" | "loot" | "claim" | "board";

export interface NpcBattleAction {
  id: NpcBattleActionId;
  label: string;
  seal: boolean;
}

/** The battle-bar actions for a selected neutral hull, in reading order. */
export function npcBattleActions(options: {
  kind: NpcKindId | null;
  hiredByMe?: boolean;
  hiredByOther?: boolean;
  abandoned?: boolean;
  surrendered?: boolean;
}): NpcBattleAction[] {
  if (!options.kind) return [];
  const actions: NpcBattleAction[] = [];
  if (options.kind === "privateer") {
    if (options.hiredByMe) {
      actions.push({ id: "manageContract", label: "Manage contract", seal: false });
    } else if (!options.hiredByOther) {
      actions.push({ id: "hirePrivateer", label: "Hire privateer", seal: false });
    }
  }
  const lootable = options.abandoned === true || options.surrendered === true;
  if (lootable) actions.push({ id: "loot", label: "Loot & leave", seal: true });
  if (options.abandoned) actions.push({ id: "claim", label: "Claim", seal: false });
  if (!lootable && !options.hiredByMe) {
    actions.push({ id: "board", label: "Board", seal: true });
  }
  return actions;
}

export interface NpcLootCargoRow {
  good: GoodId;
  name: string;
  tonnes: number;
}

export interface NpcLootSheet {
  title: string;
  detail: string;
  showCargo: boolean;
  cargoRows: NpcLootCargoRow[];
  totalTonnes: number;
  freeTonnes: number;
  freeText: string;
  looted: boolean;
  canLoot: boolean;
  actionLabel: string;
  reason: string | null;
}

/**
 * The loot sheet is deliberately gated on eligibility. Even if a caller hands
 * it cargo for an unboarded hull, `showCargo` stays false and no row leaves.
 */
export function npcLootSheet(options: {
  name: string;
  kind: NpcKindId;
  eligible: boolean;
  lootCargo?: ReadonlyArray<{ good: GoodId; tonnes: number }> | null;
  looted?: boolean;
  freeTonnes: number;
  alongside?: boolean;
}): NpcLootSheet {
  const freeTonnes = Math.max(0, options.freeTonnes);
  const alongside = options.alongside !== false;
  const rows = options.eligible && Array.isArray(options.lootCargo)
    ? options.lootCargo
      .filter((row) => row && typeof row.good === "string" && Number.isFinite(row.tonnes))
      .map((row) => ({
        good: row.good,
        name: goodName(row.good),
        tonnes: Math.max(0, Math.round(row.tonnes * 10) / 10),
      }))
      .filter((row) => row.tonnes > 0)
    : [];
  const totalTonnes = Math.round(rows.reduce((sum, row) => sum + row.tonnes, 0) * 10) / 10;
  const looted = options.eligible === true && options.looted === true;
  const showCargo = options.eligible === true && Array.isArray(options.lootCargo);
  const reason = !options.eligible
    ? "Board or accept the surrender before looting."
    : looted
      ? "That prize has already been looted."
      : rows.length === 0
        ? "The prize hold is empty."
        : freeTonnes <= 0
          ? "Your hold is full."
          : !alongside
            ? "Move alongside to loot."
            : null;
  return {
    title: options.name,
    detail: `${npcKindLabel(options.kind)} prize · left afloat after looting`,
    showCargo,
    cargoRows: rows,
    totalTonnes,
    freeTonnes,
    freeText: `Free in your hold: ${freeTonnes.toFixed(1)} t`,
    looted,
    canLoot: showCargo && reason === null,
    actionLabel: looted ? "Already looted" : "Loot & leave",
    reason,
  };
}

export interface PrivateerModeOption {
  id: NpcModeId;
  label: string;
  active: boolean;
  disabled: boolean;
}

export interface PrivateerSheet {
  title: string;
  detail: string;
  contractText: string;
  feeText: string;
  hiredByMe: boolean;
  hiredByOther: boolean;
  visible: boolean;
  modes: PrivateerModeOption[];
  hireLabel: string;
  escortLabel: string;
  canHire: boolean;
  reason: string | null;
}

export function privateerSheet(options: {
  name: string;
  hiredByMe: boolean;
  hiredByOther?: boolean;
  visible?: boolean;
  mode: NpcModeId;
  fee: number;
  remainingGameSeconds: number;
  money: number;
}): PrivateerSheet {
  const hiredByOther = options.hiredByOther === true;
  const visible = options.visible !== false;
  const fee = Math.max(0, Math.round(options.fee || settings.npcs.privateerFee));
  const escortFee = Math.max(0, Math.round(settings.npcs.escortFee));
  const canAfford = options.money >= fee;
  const canHire = !options.hiredByMe && !hiredByOther && visible && canAfford;
  const reason = options.hiredByMe
    ? null
    : hiredByOther
      ? "That privateer is under another contract."
      : !visible
        ? "Sail within sight of the privateer to hire her."
        : !canAfford
          ? "Not enough money for that contract."
          : null;
  return {
    title: options.name,
    detail: `Neutral privateer raider · ${npcModeLabel(options.mode)}`,
    contractText: options.hiredByMe
      ? `${contractRemainingText(options.remainingGameSeconds)} on a six-game-day contract`
      : "Six game days from the day of hire",
    feeText: `Privateer ${pieces(fee)} pieces · escort ${pieces(escortFee)} pieces`,
    hiredByMe: options.hiredByMe,
    hiredByOther,
    visible,
    modes: (["patrol", "escort", "raid"] as const).map((mode) => ({
      id: mode,
      label: npcModeLabel(mode),
      active: options.mode === mode,
      disabled: !options.hiredByMe,
    })),
    hireLabel: `Hire privateer · ${pieces(fee)} pieces`,
    escortLabel: `Hire as escort · ${pieces(escortFee)} pieces`,
    canHire,
    reason,
  };
}

export interface EscortTargetRow {
  id: string;
  name: string;
  classId: string;
  selected: boolean;
}

export interface EscortSheet {
  title: string;
  hint: string;
  feeText: string;
  targets: EscortTargetRow[];
  selectedTargetId: string | null;
  confirmLabel: string;
  canConfirm: boolean;
  reason: string | null;
}

export function escortSheet(options: {
  privateerName: string;
  hiredByMe: boolean;
  fee: number;
  money: number;
  targets: ReadonlyArray<{ id: string; name: string; classId: string }>;
  selectedTargetId?: string | null;
}): EscortSheet {
  const targets = options.targets
    .filter((target) => target && typeof target.id === "string")
    .map((target) => ({
      id: target.id,
      name: target.name || "Your ship",
      classId: target.classId,
      selected: target.id === options.selectedTargetId,
    }));
  const selected = targets.find((target) => target.selected) ?? targets[0] ?? null;
  const fee = Math.max(0, Math.round(options.fee || settings.npcs.escortFee));
  const canAfford = options.money >= fee;
  const canConfirm = selected !== null && (options.hiredByMe || canAfford);
  return {
    title: `Escort with ${options.privateerName}`,
    hint: `The privateer follows your chosen ship at ${settings.npcs.escortOffsetKm} km.`,
    feeText: options.hiredByMe
      ? "Included in the active contract"
      : `Escort fee: ${pieces(fee)} pieces`,
    targets: targets.map((target) => ({
      ...target,
      selected: target.id === selected?.id,
    })),
    selectedTargetId: selected?.id ?? null,
    confirmLabel: options.hiredByMe ? "Set escort" : `Hire escort · ${pieces(fee)} pieces`,
    canConfirm,
    reason: selected === null
      ? "You need a ship to escort."
      : !options.hiredByMe && !canAfford
        ? "Not enough money for an escort contract."
        : null,
  };
}

export interface EscortStripItem {
  id: string;
  text: string;
}

export interface EscortStripPlan {
  shown: boolean;
  text: string;
  items: EscortStripItem[];
}

/** A compact HUD strip for every privateer the player has under contract. */
export function escortStrip(entries: ReadonlyArray<{
  id: string;
  name: string;
  mode: NpcModeId;
  targetName?: string | null;
  contractRemainingGameSeconds: number;
}>): EscortStripPlan {
  const items = entries.map((entry) => {
    const action = entry.mode === "escort"
      ? `escorts ${entry.targetName ?? "your ship"}`
      : entry.mode === "raid" ? "raids neutral trade" : "patrols";
    return {
      id: entry.id,
      text: `${entry.name} ${action} · ${contractRemainingText(entry.contractRemainingGameSeconds)}`,
    };
  });
  return {
    shown: items.length > 0,
    text: items.map((item) => item.text).join(" · "),
    items,
  };
}

export interface NpcSheetLayout {
  sheet: boolean;
  minTargetPx: number;
  contentWidth: number;
  maxHeight: number;
  columns: 1 | 2;
  margin: number;
  scrolls: true;
}

/** Same 640 px breakpoint and 44 px target floor as the other paper sheets. */
export function npcSheetLayout(width: number, height: number): NpcSheetLayout {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  const phone = safeWidth <= 640;
  const margin = phone ? 8 : 16;
  const available = Math.max(0, safeWidth - margin * 2);
  return {
    sheet: phone,
    minTargetPx: 44,
    contentWidth: Math.min(phone ? available : 448, available),
    maxHeight: Math.max(0, safeHeight - margin * 2),
    columns: safeWidth >= 740 ? 2 : 1,
    margin,
    scrolls: true,
  };
}
