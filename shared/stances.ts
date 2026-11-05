// The four stances every ship and fleet carries. They have no combat effect
// yet; keeping the names in one place means the client and server cannot drift.

export type Stance = "engage" | "fightIfAttacked" | "avoid" | "stealth";

export const STANCES: readonly Stance[] = [
  "engage",
  "fightIfAttacked",
  "avoid",
  "stealth",
];

export const DEFAULT_STANCE: Stance = "fightIfAttacked";

export const STANCE_LABELS: Record<Stance, string> = {
  engage: "Engage anything",
  fightIfAttacked: "Fight only if attacked",
  avoid: "Avoid combat",
  stealth: "Stealth",
};
