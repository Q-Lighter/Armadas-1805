// Dots are placed in screen pixels along the route polyline. A route is
// therefore equally readable at every zoom instead of using map distances.

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Smooth a screen-space polyline with a Catmull-Rom spline. */
export function catmullRomPath(points: readonly ScreenPoint[], samplesPerSegment = 8): ScreenPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));
  const samples = Math.max(2, Math.floor(samplesPerSegment));
  const out: ScreenPoint[] = [];
  for (let index = 0; index + 1 < points.length; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    for (let sample = 0; sample < samples; sample += 1) {
      const t = sample / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push({ ...points[points.length - 1]! });
  return out;
}

export function dotsAlongPath(
  points: readonly ScreenPoint[],
  spacingPx: number,
): ScreenPoint[] {
  if (points.length < 2 || spacingPx <= 0) return [];
  const dots: ScreenPoint[] = [];
  let nextAt = 0;

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;

    for (let at = nextAt; at < length; at += spacingPx) {
      const share = at / length;
      dots.push({ x: from.x + dx * share, y: from.y + dy * share });
    }
    nextAt -= length;
    if (nextAt < 0) nextAt += Math.ceil(-nextAt / spacingPx) * spacingPx;
  }
  return dots;
}
