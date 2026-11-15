// 3J-fix-b: network rates, entity level of detail and the poor-connection
// governor. These are pure so the server, client and tests all use the same
// rules.

import { settings } from "./settings.js";
import type { ShipSnapshot } from "./world.js";

export type NetworkPreference = "auto" | "saver" | "full";

export interface ConnectionSample {
  pingMs: number;
  snapshotAgeMs: number;
}

/** True on the ticks at which a stream at `rateHz` should send. */
export function dueAtRate(ticks: number, rateHz: number, tickHz: number): boolean {
  if (!(rateHz > 0) || !(tickHz > 0)) return false;
  return Math.floor(ticks * rateHz / tickHz) !==
    Math.floor((ticks - 1) * rateHz / tickHz);
}

/** The battle-zone send rate for this player. */
export function battleRateFor(mode: NetworkPreference): number {
  return mode === "saver"
    ? settings.network.dataSaverBattleHz
    : settings.combat.battleSendRate;
}

/** Far ships are held between these ticks. Full detail never holds them. */
export function farEntityIntervalTicks(mode: NetworkPreference, tickHz: number): number {
  if (mode === "full") return 1;
  const hz = mode === "saver" ? settings.network.farEntitySaverHz : settings.network.farEntityHz;
  return Math.max(1, Math.round(tickHz / Math.max(0.1, hz)));
}

/** Hold unchanged far ships between their low-rate updates. */
export function holdFarShips(
  previous: readonly ShipSnapshot[],
  current: readonly ShipSnapshot[],
  ownIds: ReadonlySet<string>,
  focus: { x: number; y: number } | null,
  mode: NetworkPreference,
  ticks: number,
  tickHz: number,
  includeCode = true,
): ShipSnapshot[] {
  if (!includeCode || mode === "full" || !focus) return [...current];
  const interval = farEntityIntervalTicks(mode, tickHz);
  if (interval <= 1 || ticks % interval === 0) return [...current];
  const byId = new Map(previous.map((ship) => [ship[0], ship]));
  const farKm = settings.network.farEntityKm;
  return current.map((ship) => {
    if (ownIds.has(ship[0])) return ship;
    const x = Number(ship[2]);
    const y = Number(ship[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return ship;
    if (Math.hypot(x - focus.x, y - focus.y) <= farKm) return ship;
    return byId.get(ship[0]) ?? ship;
  });
}

/**
 * Poor-connection hysteresis. Bad samples for 5 seconds turn data saver on;
 * good samples for 15 seconds turn it off again. A single slow packet never
 * changes the mode.
 */
export class DataSaverGovernor {
  active = false;
  private badSince: number | null = null;
  private goodSince: number | null = null;

  constructor(
    private readonly badAfterMs = settings.network.poorForSeconds * 1_000,
    private readonly goodAfterMs = settings.network.recoverAfterSeconds * 1_000,
    private readonly badPingMs = settings.network.poorPingMs,
    private readonly badSnapshotAgeMs = settings.network.poorSnapshotAgeMs,
  ) {}

  update(nowMs: number, sample: ConnectionSample): { active: boolean; changed: boolean } {
    const bad = sample.pingMs > this.badPingMs ||
      sample.snapshotAgeMs > this.badSnapshotAgeMs;
    const before = this.active;
    if (this.active) {
      if (bad) {
        this.goodSince = null;
      } else {
        this.goodSince ??= nowMs;
        if (nowMs - this.goodSince >= this.goodAfterMs) {
          this.active = false;
          this.goodSince = null;
          this.badSince = null;
        }
      }
    } else if (bad) {
      this.badSince ??= nowMs;
      if (nowMs - this.badSince >= this.badAfterMs) {
        this.active = true;
        this.badSince = null;
        this.goodSince = null;
      }
    } else {
      this.badSince = null;
    }
    return { active: this.active, changed: this.active !== before };
  }

  /** A manual Data saver/Full choice bypasses the automatic state. */
  effective(preference: NetworkPreference): NetworkPreference {
    if (preference === "full") return "full";
    if (preference === "saver") return "saver";
    return this.active ? "saver" : "auto";
  }
}

export function parseNetworkPreference(value: unknown): NetworkPreference | null {
  return value === "auto" || value === "saver" || value === "full" ? value : null;
}
