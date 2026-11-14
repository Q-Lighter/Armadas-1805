// Fixed-delay interpolation for remote ships.
//
// Snapshots arrive at 5 Hz outside battle and 10 Hz inside it, with jitter and
// occasional drops. Drawing the newest snapshot directly would make every
// packet boundary a visible jump. This track keeps a short history and answers
// where a ship was at `now - renderDelayMs`, interpolating between the two
// surrounding snapshots. If the reader is briefly past the newest sample (a
// dropped packet), it continues on the last known velocity for a bounded time.

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

export class MotionTrack {
  private readonly samples: MotionSample[] = [];

  constructor(
    private readonly maxSamples = 12,
    private readonly maxExtrapolationSeconds = 0.4,
  ) {}

  get size(): number {
    return this.samples.length;
  }

  reset(time: number, x: number, y: number, heading: number): void {
    this.samples.length = 0;
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
      this.samples[this.samples.length - 1] = sample;
      return;
    }
    if (last && time < last.time) {
      // A delayed/coalesced message must never rewind the track.
      return;
    }
    this.samples.push(sample);
    while (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** Position and heading at a render time, with no visible step at packets. */
  sample(at: number): SampledMotion | null {
    const first = this.samples[0];
    if (!first) return null;
    if (this.samples.length === 1 || at <= first.time) {
      return { x: first.x, y: first.y, heading: first.heading };
    }
    const last = this.samples[this.samples.length - 1]!;
    if (at >= last.time) {
      const previous = this.samples[this.samples.length - 2];
      if (!previous || last.time <= previous.time) {
        return { x: last.x, y: last.y, heading: last.heading };
      }
      const extra = Math.min(at - last.time, this.maxExtrapolationSeconds);
      const vx = (last.x - previous.x) / (last.time - previous.time);
      const vy = (last.y - previous.y) / (last.time - previous.time);
      return {
        x: last.x + vx * extra,
        y: last.y + vy * extra,
        heading: last.heading,
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
}
