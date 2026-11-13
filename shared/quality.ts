// Client-side quality governor. Frame cost decides which optional effects are
// drawn; the render resolution is the last thing to drop and the first to
// return. Kept pure so the order can be tested without a browser.

export type QualityPreference = "auto" | "high" | "low";
export type QualityLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface QualityFeatures {
  /** Fire smoke and splash rings. */
  smoke: boolean;
  /** Wind streaks. */
  wind: boolean;
  /** Full route dot detail. */
  routeDetail: boolean;
  /** The static burning-ship glow. */
  fireGlow: boolean;
  /** Full device-pixel render resolution. */
  fullResolution: boolean;
}

export const QUALITY_STEP_MS = 40;
export const QUALITY_STEP_HOLD_MS = 3_000;
export const QUALITY_RECOVER_MS = 10_000;

export function qualityPreference(value: unknown): QualityPreference {
  return value === "high" || value === "low" ? value : "auto";
}

/** Features are dropped in the required order as the level rises. */
export function qualityFeatures(level: QualityLevel): QualityFeatures {
  return {
    smoke: level < 1,
    wind: level < 2,
    routeDetail: level < 3,
    fireGlow: level < 4,
    fullResolution: level < 5,
  };
}

export function qualityLevelForPreference(
  preference: QualityPreference,
  autoLevel: QualityLevel,
): QualityLevel {
  if (preference === "high") return 0;
  if (preference === "low") return 5;
  return autoLevel;
}

/**
 * Steps one level down after 3 s of frames over 40 ms, then one more level for
 * each further 3 s. Recovers one level after 10 s of good frames. A single
 * good frame breaks the bad run, so a one-off spike does not lower quality.
 */
export class QualityGovernor {
  level: QualityLevel = 0;
  private overSince: number | null = null;
  private goodSince: number | null = null;

  reset(): void {
    this.level = 0;
    this.overSince = null;
    this.goodSince = null;
  }

  sample(frameMs: number, now: number): QualityLevel {
    if (frameMs > QUALITY_STEP_MS) {
      this.goodSince = null;
      if (this.overSince === null) this.overSince = now;
      if (now - this.overSince >= QUALITY_STEP_HOLD_MS && this.level < 5) {
        this.level = (this.level + 1) as QualityLevel;
        this.overSince = now;
      }
    } else {
      this.overSince = null;
      if (this.goodSince === null) this.goodSince = now;
      if (now - this.goodSince >= QUALITY_RECOVER_MS && this.level > 0) {
        this.level = (this.level - 1) as QualityLevel;
        this.goodSince = now;
      }
    }
    return this.level;
  }
}
