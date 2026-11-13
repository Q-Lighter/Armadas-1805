// How an engaged ship or fleet fights. Stand and fire is the default.

export type FightingStyle = "standAndFire" | "alongside";

export const FIGHTING_STYLES: readonly FightingStyle[] = ["standAndFire", "alongside"];

export const DEFAULT_FIGHTING_STYLE: FightingStyle = "standAndFire";

export const FIGHTING_STYLE_LABELS: Record<FightingStyle, string> = {
  standAndFire: "Stand and fire",
  alongside: "Alongside",
};
