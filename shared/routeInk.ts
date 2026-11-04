// Dots are placed in screen pixels along the route polyline. A route is
// therefore equally readable at every zoom instead of using map distances.

export interface ScreenPoint {
  x: number;
  y: number;
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
