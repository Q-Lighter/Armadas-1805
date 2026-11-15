// Smooth motion for ships between server snapshots.
//
// 3J-fix-a: the old fixed-delay sampler interpolated between old packets. On a
// slow link it ran past the newest packet, held the heading still, then snapped
// back when the next packet arrived. This track dead-reckons from the newest
// position and turn rate for at most 400 ms, then blends any error from the
// next authoritative snapshot with a critically damped correction. The blended
// path is continuous at every packet boundary, so there is no visible snap.

export interface MotionSample {
  /** Performance clock in seconds. */
  time: number;
  x: number;
  y: number;
  /** Heading in radians. */
  heading: number;
}

export interface SampledMotion {
  x: number;
  y: number;
  heading: number;
}

interface TrackedSample extends MotionSample {
  /** Velocity from the previous authoritative sample, km per second. */
  vx: number;
  vy: number;
  /** Short-way turn rate from the previous sample, radians per second. */
  turnRate: number;
}

interface Correction {
  x: number;
  y: number;
  heading: number;
  time: number;
}

const TWO_PI = Math.PI * 2;

function wrapAngle(angle: number): number {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

/** The signed turn from `from` to `to`, always the short way round. */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

/**
 * Critically damped error decay. It starts at 1 with zero slope, so the drawn
 * position is continuous when a correction starts, and settles without
 * overshoot. The rate is the natural frequency in radians per second.
 */
export function criticallyDampedDecay(ageSeconds: number, rate: number): number {
  if (!(ageSeconds > 0)) return 1;
  if (!(rate > 0)) return 0;
  return (1 + rate * ageSeconds) * Math.exp(-rate * ageSeconds);
}

export class MotionTrack {
  private readonly samples: TrackedSample[] = [];
  private correction: Correction = { x: 0, y: 0, heading: 0, time: 0 };
  /** Most recent correction size in km, for the performance panel. */
  lastCorrectionKm = 0;

  constructor(
    private readonly maxSamples = 12,
    private readonly maxExtrapolationSeconds = 0.4,
    private readonly correctionRate = 9,
  ) {}

  get size(): number {
    return this.samples.length;
  }

  /** Newest authoritative snapshot time, or 0 before the first sample. */
  get latestTime(): number {
    return this.samples[this.samples.length - 1]?.time ?? 0;
  }

  /** Time since the newest snapshot at a render time, in milliseconds. */
  snapshotAgeMs(at: number): number {
    const latest = this.samples[this.samples.length - 1];
    return latest ? Math.max(0, (at - latest.time) * 1_000) : 0;
  }

  reset(time: number, x: number, y: number, heading: number): void {
    this.samples.length = 0;
    this.correction = { x: 0, y: 0, heading: 0, time };
    this.lastCorrectionKm = 0;
    this.push(time, x, y, heading);
  }

  push(time: number, x: number, y: number, heading: number): void {
    if (
      !Number.isFinite(time) || !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(heading)
    ) return;
    const sample = { time, x, y, heading: wrapAngle(heading) };
    const last = this.samples[this.samples.length - 1];
    if (last && Math.abs(last.time - time) < 1e-9) {
      // Two updates can arrive in one display frame. Keep the newest position
      // but do not add a zero-length velocity sample.
      last.x = sample.x;
      last.y = sample.y;
      last.heading = sample.heading;
      return;
    }
    if (last && time < last.time) {
      // A delayed/coalesced message must never rewind the track.
      return;
    }

    const previous = last;
    if (!last) {
      this.samples.push({ ...sample, vx: 0, vy: 0, turnRate: 0 });
      this.correction = { x: 0, y: 0, heading: 0, time };
      return;
    }

    const dt = time - last.time;
    const vx = dt > 1e-9 ? (x - last.x) / dt : last.vx;
    const vy = dt > 1e-9 ? (y - last.y) / dt : last.vy;
    const turnRate = dt > 1e-9
      ? shortestAngleDelta(last.heading, sample.heading) / dt
      : last.turnRate;

    // Keep the drawn point where it was at the instant this snapshot arrived,
    // then relax it onto the authoritative position. This is what stops the
    // visible snap after a dropped packet or a late packet.
    const predicted = this.deadReckon(last, time);
    const oldCorrection = this.correctionAt(time);
    const displayedX = predicted.x + oldCorrection.x;
    const displayedY = predicted.y + oldCorrection.y;
    const displayedHeading = predicted.heading + oldCorrection.heading;
    this.correction = {
      x: displayedX - x,
      y: displayedY - y,
      heading: shortestAngleDelta(sample.heading, displayedHeading),
      time,
    };
    this.lastCorrectionKm = Math.hypot(this.correction.x, this.correction.y);

    this.samples.push({ ...sample, vx, vy, turnRate });
    while (this.samples.length > this.maxSamples) this.samples.shift();
    void previous;
  }

  /** Position and heading at a render time, with no visible step at packets. */
  sample(at: number): SampledMotion | null {
    const first = this.samples[0];
    if (!first) return null;
    if (at <= first.time) return { x: first.x, y: first.y, heading: first.heading };

    const last = this.samples[this.samples.length - 1]!;
    if (at >= last.time) {
      const predicted = this.deadReckon(last, at);
      const correction = this.correctionAt(at);
      return {
        x: predicted.x + correction.x,
        y: predicted.y + correction.y,
        heading: wrapAngle(predicted.heading + correction.heading),
      };
    }

    for (let index = 0; index + 1 < this.samples.length; index += 1) {
      const a = this.samples[index]!;
      const b = this.samples[index + 1]!;
      if (at < a.time || at > b.time) continue;
      const span = b.time - a.time;
      if (span <= 1e-9) return { x: b.x, y: b.y, heading: b.heading };
      const alpha = (at - a.time) / span;
      return {
        x: a.x + (b.x - a.x) * alpha,
        y: a.y + (b.y - a.y) * alpha,
        heading: wrapAngle(a.heading + shortestAngleDelta(a.heading, b.heading) * alpha),
      };
    }
    return { x: last.x, y: last.y, heading: last.heading };
  }

  private deadReckon(sample: TrackedSample, at: number): SampledMotion {
    const extra = Math.min(Math.max(0, at - sample.time), this.maxExtrapolationSeconds);
    return {
      x: sample.x + sample.vx * extra,
      y: sample.y + sample.vy * extra,
      heading: wrapAngle(sample.heading + sample.turnRate * extra),
    };
  }

  private correctionAt(at: number): Correction {
    const age = Math.max(0, at - this.correction.time);
    const decay = criticallyDampedDecay(age, this.correctionRate);
    return {
      x: this.correction.x * decay,
      y: this.correction.y * decay,
      heading: this.correction.heading * decay,
      time: at,
    };
  }
}
