// Smooth outline of the discovered-cell union.
//
// Each discovered cell contributes the grid edges that face undiscovered sea
// or the chart border. The resulting rectilinear loops are closed, two rounds
// of Chaikin are applied, and the loops are returned in map kilometres. The
// client fills the positive (outer) loops with sea wash and punches holes with
// paper, so a smooth outline never invents discovered ground.

export interface OutlineRing {
  /** Flat x, y pairs in map kilometres. */
  points: number[];
  /** Shoelace area; positive outer loops, negative holes. */
  area: number;
}

export interface DiscoveredOutline {
  rings: OutlineRing[];
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function pointFor(keyText: string): { x: number; y: number } {
  const [x, y] = keyText.split(",").map(Number);
  return { x: x!, y: y! };
}

/** Trace directed boundary edges into closed loops. */
function traceLoops(
  edges: Array<[number, number, number, number]>,
): Array<Array<{ x: number; y: number }>> {
  const starts = new Map<string, Array<[number, number, number, number]>>();
  for (const edge of edges) {
    const start = key(edge[0], edge[1]);
    const list = starts.get(start);
    if (list) list.push(edge);
    else starts.set(start, [edge]);
  }

  const loops: Array<Array<{ x: number; y: number }>> = [];
  while (starts.size > 0) {
    const firstStart = starts.keys().next().value as string;
    let current = starts.get(firstStart)![0]!;
    const startKey = firstStart;
    const points: Array<{ x: number; y: number }> = [];
    let guard = edges.length + 2;

    while (guard-- > 0) {
      points.push({ x: current[0], y: current[1] });
      const endKey = key(current[2], current[3]);
      const candidates = starts.get(key(current[0], current[1]));
      if (candidates) {
        candidates.shift();
        if (candidates.length === 0) starts.delete(key(current[0], current[1]));
      }
      if (endKey === startKey) break;
      const next = starts.get(endKey);
      if (!next || next.length === 0) break;
      current = next[0]!;
    }

    if (points.length >= 4) loops.push(points);
    // A broken chain must not trap the remaining edges forever.
    if (guard <= 0) break;
  }
  return loops;
}

function chaikin(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;
  const out: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    out.push(
      { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
      { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
    );
  }
  return out;
}

function area(points: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function buildDiscoveredOutline(
  discovered: ReadonlySet<number>,
  columns: number,
  rows: number,
  cellKm: number,
  smoothingRounds = 2,
): DiscoveredOutline {
  if (columns <= 0 || rows <= 0 || discovered.size === 0) return { rings: [] };

  const edges: Array<[number, number, number, number]> = [];
  const has = (column: number, row: number): boolean =>
    column >= 0 &&
    column < columns &&
    row >= 0 &&
    row < rows &&
    discovered.has(row * columns + column);

  for (const index of discovered) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
    if (!has(column, row - 1)) edges.push([column, row, column + 1, row]);
    if (!has(column + 1, row)) edges.push([column + 1, row, column + 1, row + 1]);
    if (!has(column, row + 1)) edges.push([column + 1, row + 1, column, row + 1]);
    if (!has(column - 1, row)) edges.push([column, row + 1, column, row]);
  }

  const rings: OutlineRing[] = [];
  for (const loop of traceLoops(edges)) {
    let smoothed = loop;
    for (let round = 0; round < smoothingRounds; round += 1) {
      smoothed = chaikin(smoothed);
    }
    const points: number[] = [];
    for (const point of smoothed) {
      points.push(point.x * cellKm, point.y * cellKm);
    }
    const ringArea = area(smoothed) * cellKm * cellKm;
    if (Math.abs(ringArea) > 1e-6) rings.push({ points, area: ringArea });
  }
  // Paint large outer rings first, then smaller holes, so a hole can never be
  // covered by a later outer polygon.
  rings.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  return { rings };
}
