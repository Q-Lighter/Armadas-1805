// TEMP-DEBUG: measurements for the built-in dev-room load test.
//
// Cloudflare coarsens clocks during pure computation, so this deliberately
// measures wall-clock gaps between real timer callbacks, not time spent inside
// a function. Byte counts come from the full state a fake player would receive.

export const DEBUG_WINDOW_MS = 10_000;
const WORLD_STEP_WINDOW_MS = 5_000;

/**
 * [total ships, bot ships, world updates per second, average gap ms,
 *  worst gap ms, average bytes/second per fake player, worst bytes in one
 *  second for a player]
 */
export type DebugStats = [number, number, number, number, number, number, number];

interface Gap {
  at: number;
  ms: number;
}

interface ByteSample {
  at: number;
  owner: string;
  bytes: number;
}

interface WorldStepSample {
  at: number;
  ms: number;
}

export class LoadMetrics {
  private gaps: Gap[] = [];
  private bytes: ByteSample[] = [];
  private worldSteps: WorldStepSample[] = [];
  private lastTickAt: number | null = null;
  private startedAt = 0;

  reset(at = 0): void {
    this.gaps = [];
    this.bytes = [];
    this.worldSteps = [];
    this.lastTickAt = null;
    this.startedAt = at;
  }

  /** Record one actual world-loop callback. */
  noteTick(at: number): void {
    if (this.startedAt === 0) this.startedAt = at;
    if (this.lastTickAt !== null && at >= this.lastTickAt) {
      this.gaps.push({ at, ms: at - this.lastTickAt });
    }
    this.lastTickAt = at;
    this.trim(at);
  }

  /** Record one full fake-player update that was built and discarded. */
  notePlayerUpdate(owner: string, bytes: number, at: number): void {
    this.bytes.push({ at, owner, bytes });
    this.trim(at);
  }

  /** Record the measured shared-world step duration. */
  noteWorldStep(ms: number, at: number): void {
    this.worldSteps.push({ at, ms: Math.max(0, ms) });
    this.trim(at);
  }

  /** Average world-step time over the last five seconds. */
  worldStepAverage(at: number): number {
    this.trim(at);
    const samples = this.worldSteps.filter((sample) => sample.at >= at - WORLD_STEP_WINDOW_MS);
    if (samples.length === 0) return 0;
    const total = samples.reduce((sum, sample) => sum + sample.ms, 0);
    return Math.round((total / samples.length) * 100) / 100;
  }

  snapshot(ships: number, bots: number, at: number): DebugStats {
    this.trim(at);
    const elapsedSeconds = Math.max(0.001, (at - Math.max(this.startedAt, at - DEBUG_WINDOW_MS)) / 1000);
    const gaps = this.gaps;

    const averageGap = gaps.length === 0
      ? 0
      : gaps.reduce((sum, gap) => sum + gap.ms, 0) / gaps.length;
    const worstGap = gaps.reduce((worst, gap) => Math.max(worst, gap.ms), 0);
    const updatesPerSecond = gaps.length / elapsedSeconds;

    // Per fake player, averaged over the window, and the worst one-second
    // slice any single fake player produced.
    const byOwner = new Map<string, { total: number; buckets: Map<number, number> }>();
    for (const sample of this.bytes) {
      let owner = byOwner.get(sample.owner);
      if (!owner) {
        owner = { total: 0, buckets: new Map() };
        byOwner.set(sample.owner, owner);
      }
      owner.total += sample.bytes;
      const second = Math.floor(sample.at / 1000);
      owner.buckets.set(second, (owner.buckets.get(second) ?? 0) + sample.bytes);
    }

    let bytesPerSecondAverage = 0;
    let bytesPerSecondWorst = 0;
    if (byOwner.size > 0) {
      let sum = 0;
      for (const owner of byOwner.values()) {
        sum += owner.total;
        for (const bytes of owner.buckets.values()) {
          bytesPerSecondWorst = Math.max(bytesPerSecondWorst, bytes);
        }
      }
      bytesPerSecondAverage = sum / byOwner.size / elapsedSeconds;
    }

    return [
      ships,
      bots,
      Math.round(updatesPerSecond * 10) / 10,
      Math.round(averageGap * 10) / 10,
      Math.round(worstGap),
      Math.round(bytesPerSecondAverage),
      Math.round(bytesPerSecondWorst),
    ];
  }

  private trim(at: number): void {
    const cutoff = at - DEBUG_WINDOW_MS;
    while (this.gaps.length > 0 && this.gaps[0]!.at < cutoff) this.gaps.shift();
    while (this.bytes.length > 0 && this.bytes[0]!.at < cutoff) this.bytes.shift();
    while (this.worldSteps.length > 0 && this.worldSteps[0]!.at < cutoff) this.worldSteps.shift();
  }
}
