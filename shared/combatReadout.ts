// Why a ship is or is not firing. Used only by test and dev room snapshots.

export type FiringPhase =
  | "closing"
  | "in range"
  | "hove"
  | "boarding approach"
  | "grappled"
  | "sailing"
  | "holding";

export interface FiringReadoutInput {
  order: "capture" | "sink" | "run" | "surrender" | "board" | null;
  phase: FiringPhase;
  distanceM?: number;
  bearingOffBeamDeg?: number;
  reloadSeconds?: number;
  ammunitionBroadsides?: number;
  crewTooLow?: boolean;
  gunsPercent?: number;
  hasTarget?: boolean;
  gunsBear?: boolean;
  /** A more specific boarding phase, if the approach has one. */
  boardingStep?: string;
}

function rounded(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : fallback;
}

/** One line for the ship panel and the damage sheet. */
export function firingReadout(input: FiringReadoutInput): string {
  const order = input.order === "capture" ? "Capture"
    : input.order === "sink" ? "Sink"
    : input.order === "run" ? "Run"
    : input.order === "surrender" ? "Surrender"
    : input.order === "board" ? "Board"
    : "None";
  const distance = rounded(input.distanceM);
  const bearing = rounded(input.bearingOffBeamDeg);
  const step = input.boardingStep ?? (input.phase === "closing" ? `closing (distance ${distance} m)`
    : input.phase === "in range" ? `in range (distance ${distance} m)`
    : input.phase === "hove" ? `hove to, pivoting (bearing ${bearing} degrees off beam)`
    : input.phase === "boarding approach" ? `boarding approach (distance ${distance} m)`
    : input.phase);
  const parts = [`Order: ${order}. Step: ${step}`];

  const ammo = Math.floor(input.ammunitionBroadsides ?? 0);
  if (input.phase === "grappled") parts.push("Not firing: grappled");
  else if (!input.hasTarget) parts.push("Not firing: no target");
  else if (input.crewTooLow) parts.push("Not firing: crew too low");
  else if ((input.gunsPercent ?? 100) <= 0) parts.push("Not firing: guns 0%");
  else if (ammo < 1) parts.push("Not firing: no ammunition");
  else if ((input.reloadSeconds ?? 0) > 0.05) {
    parts.push(`Not firing: reloading (${Math.max(1, Math.ceil(input.reloadSeconds ?? 0))} s)`);
  } else if (distance > 1_000) parts.push("Not firing: out of range");
  else if (input.gunsBear === false) parts.push("Not firing: out of arc");
  else parts.push("Guns ready");
  return `${parts.join(". ")}.`;
}

/** Hove to / In irons / Drifting / Sailing, from the ship's real state. */
export function sailingStateLabel(input: {
  hoveTo?: boolean;
  hasOrder?: boolean;
  speedKnots: number;
  effectiveSailPercent: number;
  driftSpeedKnots: number;
}): "Hove to" | "In irons" | "Drifting" | "Sailing" {
  if (input.hoveTo) return "Hove to";
  if (input.effectiveSailPercent <= 0 && input.driftSpeedKnots > 0) return "Drifting";
  if (input.hasOrder === true && input.speedKnots < 0.2) return "In irons";
  return "Sailing";
}
