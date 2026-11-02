// Build the chart data from Natural Earth 1:10m land.
//
// Run: npm run build-map
//
// It reads node_modules/world-atlas/land-10m.json, clips the land to the map
// frame, and writes:
//   client/public/tiles/          drawing tiles, about five zoom levels
//   client/public/tiles/index.json  which tiles exist and how many points
//   shared/data/landMask.ts       the server's one-kilometre land lookup
//
// Nothing is drawn by hand. Invented land can be added later through
// shared/data/inventedFeatures.ts and is merged in exactly like real coast.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { feature } from "topojson-client";

import { settings } from "../shared/settings.js";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM, lonLatToMap } from "../shared/map.js";
import { inventedFeatures } from "../shared/data/inventedFeatures.js";

type Point = [number, number];

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LandPolygon {
  outer: Point[];
  holes: Point[][];
  bounds: Bounds;
}

interface TileLevel {
  z: number;
  tileKm: number;
  toleranceKm: number;
  polygons: LandPolygon[];
  columns: number;
  rows: number;
}

interface TileBody {
  z: number;
  x: number;
  y: number;
  km: number;
  fill: number[][];
  coast: number[][];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "node_modules/world-atlas/land-10m.json");
const tileRoot = path.join(root, "client/public/tiles");
const landMaskPath = path.join(root, "shared/data/landMask.ts");
const expandKm = 0.75;

const FRAME: Bounds = { minX: 0, minY: 0, maxX: MAP_WIDTH_KM, maxY: MAP_HEIGHT_KM };
const CELL_KM = settings.map.landCellKm;
const GRID_WIDTH = Math.ceil(MAP_WIDTH_KM / CELL_KM);
const GRID_HEIGHT = Math.ceil(MAP_HEIGHT_KM / CELL_KM);

/** Strip a repeated closing point and neighbouring duplicates. */
function normaliseRing(ring: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - point[0]) < 1e-9 && Math.abs(last[1] - point[1]) < 1e-9) {
      continue;
    }
    out.push(point);
  }
  if (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
      out.pop();
    }
  }
  return out;
}

/** Clip a closed ring to an axis-aligned rectangle (Sutherland-Hodgman). */
function clipRing(ring: Point[], rect: Bounds): Point[] {
  let out = ring;

  const clip = (
    inside: (point: Point) => boolean,
    intersect: (a: Point, b: Point) => Point,
  ): void => {
    if (out.length === 0) return;
    const input = out;
    out = [];
    let previous = input[input.length - 1]!;
    let previousInside = inside(previous);

    for (const current of input) {
      const currentInside = inside(current);
      if (currentInside) {
        if (!previousInside) out.push(intersect(previous, current));
        out.push(current);
      } else if (previousInside) {
        out.push(intersect(previous, current));
      }
      previous = current;
      previousInside = currentInside;
    }
  };

  clip(
    (point) => point[0] >= rect.minX,
    (a, b) => {
      if (Math.abs(b[0] - a[0]) < 1e-12) return [rect.minX, (a[1] + b[1]) / 2];
      const t = (rect.minX - a[0]) / (b[0] - a[0]);
      return [rect.minX, a[1] + (b[1] - a[1]) * t];
    },
  );
  clip(
    (point) => point[0] <= rect.maxX,
    (a, b) => {
      if (Math.abs(b[0] - a[0]) < 1e-12) return [rect.maxX, (a[1] + b[1]) / 2];
      const t = (rect.maxX - a[0]) / (b[0] - a[0]);
      return [rect.maxX, a[1] + (b[1] - a[1]) * t];
    },
  );
  clip(
    (point) => point[1] >= rect.minY,
    (a, b) => {
      if (Math.abs(b[1] - a[1]) < 1e-12) return [(a[0] + b[0]) / 2, rect.minY];
      const t = (rect.minY - a[1]) / (b[1] - a[1]);
      return [a[0] + (b[0] - a[0]) * t, rect.minY];
    },
  );
  clip(
    (point) => point[1] <= rect.maxY,
    (a, b) => {
      if (Math.abs(b[1] - a[1]) < 1e-12) return [(a[0] + b[0]) / 2, rect.maxY];
      const t = (rect.maxY - a[1]) / (b[1] - a[1]);
      return [a[0] + (b[0] - a[0]) * t, rect.maxY];
    },
  );

  return normaliseRing(out);
}

/** Squared distance from a point to a straight segment. */
function distanceSqToSegment(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    const px = point[0] - a[0];
    const py = point[1] - a[1];
    return px * px + py * py;
  }

  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const x = point[0] - (a[0] + t * dx);
  const y = point[1] - (a[1] + t * dy);
  return x * x + y * y;
}

/** Douglas-Peucker simplification of an open line. */
function simplifyLine(points: Point[], toleranceKm: number): Point[] {
  if (toleranceKm <= 0 || points.length < 3) return [...points];

  const toleranceSq = toleranceKm * toleranceKm;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = toleranceSq;

    for (let i = start + 1; i < end; i += 1) {
      const distance = distanceSqToSegment(points[i]!, points[start]!, points[end]!);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

/** Simplify a closed ring, keeping it closed and dropping collapsed rings. */
function simplifyRing(ring: Point[], toleranceKm: number): Point[] {
  if (ring.length < 4 || toleranceKm <= 0) return [...ring];
  const closed = [...ring, ring[0]!];
  const simplified = simplifyLine(closed, toleranceKm);
  simplified.pop();
  return normaliseRing(simplified);
}

/** Simplify an outer ring and its holes. */
function simplifyPolygon(polygon: LandPolygon, toleranceKm: number): LandPolygon | null {
  const outer = simplifyRing(polygon.outer, toleranceKm);
  if (outer.length < 3) return null;
  const holes = polygon.holes
    .map((hole) => simplifyRing(hole, toleranceKm))
    .filter((hole) => hole.length >= 3);
  return { outer, holes, bounds: boundsOf(outer) };
}

function boundsOf(ring: Point[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return { minX, minY, maxX, maxY };
}

function areaOf(ring: Point[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area / 2);
}

/** Read Natural Earth through world-atlas and project it into map km. */
function loadLand(): LandPolygon[] {
  if (!existsSync(sourcePath)) {
    throw new Error(
      `Missing ${sourcePath}. Run npm install first (world-atlas is a dev dependency).`,
    );
  }

  const topology = JSON.parse(readFileSync(sourcePath, "utf8")) as {
    objects: { land: unknown };
  };
  const collection = feature(topology as never, topology.objects.land as never) as unknown as {
    type: string;
    features?: Array<{ geometry: { type: string; coordinates: unknown } }>;
    geometry?: { type: string; coordinates: unknown };
  };

  const features =
    collection.type === "FeatureCollection" && collection.features
      ? collection.features
      : [{ geometry: collection.geometry! }];

  const polygons: LandPolygon[] = [];

  for (const item of features) {
    const geometry = item.geometry;
    if (!geometry) continue;

    const groups: number[][][][] =
      geometry.type === "Polygon"
        ? [geometry.coordinates as number[][][]]
        : (geometry.coordinates as number[][][][]);

    for (const group of groups) {
      const projected = group.map((ring) =>
        normaliseRing(
          ring.map((pair) => {
            const mapped = lonLatToMap(pair[0]!, pair[1]!);
            return [mapped.x, mapped.y] as Point;
          }),
        ),
      );
      const sourceOuter = projected[0];
      if (!sourceOuter || sourceOuter.length < 3) continue;

      const outer = clipRing(sourceOuter, FRAME);
      if (outer.length < 3 || areaOf(outer) < 1e-9) continue;

      const holes = projected
        .slice(1)
        .map((hole) => clipRing(hole, FRAME))
        .filter((hole) => hole.length >= 3 && areaOf(hole) > 1e-9);

      polygons.push({ outer, holes, bounds: boundsOf(outer) });
    }
  }

  // Merge invented features exactly like real land. The list is empty today.
  for (const invented of inventedFeatures) {
    for (const group of invented.polygons) {
      const rings = group.map((ring) =>
        normaliseRing(ring.map((point) => [point.x, point.y] as Point)),
      );
      const outer = rings[0] ? clipRing(rings[0], FRAME) : [];
      if (outer.length < 3 || areaOf(outer) < 1e-9) continue;
      const holes = rings
        .slice(1)
        .map((hole) => clipRing(hole, FRAME))
        .filter((hole) => hole.length >= 3 && areaOf(hole) > 1e-9);
      polygons.push({ outer, holes, bounds: boundsOf(outer) });
    }
  }

  return polygons;
}

/** Liang-Barsky clip of one coast segment to a rectangle. */
function clipSegment(a: Point, b: Point, rect: Bounds): [Point, Point] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;

  const checks: Array<[number, number]> = [
    [-dx, a[0] - rect.minX],
    [dx, rect.maxX - a[0]],
    [-dy, a[1] - rect.minY],
    [dy, rect.maxY - a[1]],
  ];

  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }

  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

/** Clip a ring's edges to a tile, without adding ink along the tile cut. */
function coastLines(ring: Point[], rect: Bounds, toleranceKm: number): Point[][] {
  const lines: Point[][] = [];
  let current: Point[] = [];

  const flush = (): void => {
    if (current.length >= 2) {
      const simplified = simplifyLine(current, toleranceKm);
      if (simplified.length >= 2) lines.push(simplified);
    }
    current = [];
  };

  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]!;
    const b = ring[(index + 1) % ring.length]!;
    const clipped = clipSegment(a, b, rect);
    if (!clipped) {
      flush();
      continue;
    }

    const [start, end] = clipped;
    if (current.length === 0) {
      current = [start, end];
    } else {
      const last = current[current.length - 1]!;
      if (samePoint(last, start)) current.push(end);
      else {
        flush();
        current = [start, end];
      }
    }

    // A segment that ended on the tile edge breaks the line; the next tile
    // continues it from the same point.
    if (!samePoint(end, b)) flush();
  }

  flush();
  return lines;
}

function roundPoint(point: Point): Point {
  return [Math.round(point[0] * 100) / 100, Math.round(point[1] * 100) / 100];
}

/** Flatten points to [x,y,...] and drop repeated points after rounding. */
function flatten(points: Point[]): number[] {
  const out: number[] = [];
  let lastX = Number.NaN;
  let lastY = Number.NaN;

  for (const point of points) {
    const [x, y] = roundPoint(point);
    if (x === lastX && y === lastY) continue;
    out.push(x, y);
    lastX = x;
    lastY = y;
  }

  return out;
}

interface TileGeometry {
  fill: number[][];
  coast: number[][];
  points: number;
}

function buildTileGeometry(
  polygons: LandPolygon[],
  indices: number[],
  rect: Bounds,
  toleranceKm: number,
): TileGeometry {
  const fill: number[][] = [];
  const coast: number[][] = [];
  let points = 0;

  for (const index of indices) {
    const polygon = polygons[index]!;

    const clippedOuter = clipRing(polygon.outer, rect);
    if (clippedOuter.length >= 3) {
      const land = simplifyRing(clippedOuter, toleranceKm);
      if (land.length >= 3) {
        const flat = flatten(land);
        if (flat.length >= 6) {
          fill.push(flat);
          points += flat.length / 2;
        }
      }
    }

    for (const line of coastLines(polygon.outer, rect, toleranceKm)) {
      const flat = flatten(line);
      if (flat.length >= 4) {
        coast.push(flat);
        points += flat.length / 2;
      }
    }
  }

  return { fill, coast, points };
}

function tileName(z: number, x: number, y: number): string {
  return path.join(String(z), `${x}_${y}.json`);
}

interface TileRecord {
  index: [number, number, number];
  bytes: number;
}

function main(): void {
  console.log("Reading Natural Earth 1:10m land...");
  const framePolygons = loadLand();
  console.log(`  ${framePolygons.length} land polygons inside the frame`);

  const levelTolerance = settings.map.levelToleranceKm;
  const levels: TileLevel[] = [];

  for (let z = 0; z < settings.map.tileLevels; z += 1) {
    const tileKm = settings.map.finestTileKm * 2 ** (settings.map.tileLevels - 1 - z);
    const toleranceKm = levelTolerance[z] ?? 0.01;
    const polygons = framePolygons
      .map((polygon) => simplifyPolygon(polygon, toleranceKm))
      .filter((polygon): polygon is LandPolygon => polygon !== null);

    levels.push({
      z,
      tileKm,
      toleranceKm,
      polygons,
      columns: Math.ceil(MAP_WIDTH_KM / tileKm),
      rows: Math.ceil(MAP_HEIGHT_KM / tileKm),
    });
    console.log(
      `  level ${z}: ${tileKm} km tiles, ${toleranceKm} km tolerance, ` +
        `${polygons.length} polygons`,
    );
  }

  rmSync(tileRoot, { recursive: true, force: true });
  mkdirSync(tileRoot, { recursive: true });

  const manifestLevels: Array<{
    z: number;
    km: number;
    tiles: Array<[number, number, number]>;
  }> = [];

  let tileCount = 0;
  let tileBytes = 0;
  let maxTileBytes = 0;
  let maxTilePoints = 0;
  let maxTileLabel = "";

  for (const level of levels) {
    const buckets = new Map<string, number[]>();

    for (let index = 0; index < level.polygons.length; index += 1) {
      const bounds = level.polygons[index]!.bounds;
      const firstColumn = Math.max(
        0,
        Math.floor((bounds.minX - expandKm) / level.tileKm),
      );
      const lastColumn = Math.min(
        level.columns - 1,
        Math.floor((bounds.maxX + expandKm) / level.tileKm),
      );
      const firstRow = Math.max(0, Math.floor((bounds.minY - expandKm) / level.tileKm));
      const lastRow = Math.min(
        level.rows - 1,
        Math.floor((bounds.maxY + expandKm) / level.tileKm),
      );

      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const key = `${column}_${row}`;
          const bucket = buckets.get(key);
          if (bucket) bucket.push(index);
          else buckets.set(key, [index]);
        }
      }
    }

    const records: TileRecord[] = [];
    const sortedKeys = [...buckets.keys()].sort((a, b) => {
      const [ax, ay] = a.split("_").map(Number);
      const [bx, by] = b.split("_").map(Number);
      return ay! - by! || ax! - bx!;
    });

    for (const key of sortedKeys) {
      const [column, row] = key.split("_").map(Number) as [number, number];
      const indices = buckets.get(key)!;
      const minX = column * level.tileKm;
      const minY = row * level.tileKm;
      const rect: Bounds = {
        minX: Math.max(0, minX - expandKm),
        minY: Math.max(0, minY - expandKm),
        maxX: Math.min(MAP_WIDTH_KM, minX + level.tileKm + expandKm),
        maxY: Math.min(MAP_HEIGHT_KM, minY + level.tileKm + expandKm),
      };

      let extraTolerance = 0;
      let body: TileBody | null = null;
      let json = "";
      let bytes = 0;

      for (let attempt = 0; attempt < 14; attempt += 1) {
        const geometry = buildTileGeometry(
          level.polygons,
          indices,
          rect,
          extraTolerance,
        );
        body = {
          z: level.z,
          x: column,
          y: row,
          km: level.tileKm,
          fill: geometry.fill,
          coast: geometry.coast,
        };
        json = JSON.stringify(body);
        bytes = Buffer.byteLength(json, "utf8");

        if (
          bytes <= settings.map.tileFileBudgetBytes &&
          geometry.points <= settings.map.tilePointsBudget
        ) {
          break;
        }

        extraTolerance =
          extraTolerance === 0
            ? Math.max(level.toleranceKm * 0.5, 0.01)
            : extraTolerance * 1.8;
      }

      if (!body) continue;
      if (bytes > settings.map.tileFileBudgetBytes) {
        throw new Error(
          `Tile ${level.z}/${key} is ${bytes} bytes after simplification; ` +
            `raise the simplification or the tile budget.`,
        );
      }

      const file = path.join(tileRoot, tileName(level.z, column, row));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, json);

      const points = body.fill.reduce((total, ring) => total + ring.length / 2, 0) +
        body.coast.reduce((total, line) => total + line.length / 2, 0);

      tileCount += 1;
      tileBytes += bytes;
      maxTilePoints = Math.max(maxTilePoints, points);
      records.push({ index: [column, row, Math.round(points)], bytes });
      if (bytes > maxTileBytes) {
        maxTileBytes = bytes;
        maxTileLabel = `${level.z}/${column}_${row}`;
      }

      if (tileCount >= settings.map.maxTileFiles) {
        throw new Error(
          `More than ${settings.map.maxTileFiles} tile files would be written.`,
        );
      }
      if (tileBytes >= settings.map.maxTileSetBytes) {
        throw new Error(
          `Tile set would pass ${settings.map.maxTileSetBytes} bytes.`,
        );
      }
    }

    records.sort((a, b) => a.index[1] - b.index[1] || a.index[0] - b.index[0]);
    manifestLevels.push({
      z: level.z,
      km: level.tileKm,
      tiles: records.map((record) => record.index),
    });
    console.log(`  level ${level.z}: wrote ${records.length} tiles`);
  }

  writeFileSync(
    path.join(tileRoot, "index.json"),
    JSON.stringify({ levels: manifestLevels }),
  );

  // --- Server land lookup --------------------------------------------------

  console.log("Rasterising the land lookup...");
  const bits = new Uint8Array(Math.ceil((GRID_WIDTH * GRID_HEIGHT) / 8));

  const setCell = (x: number, y: number, value: boolean): void => {
    const index = y * GRID_WIDTH + x;
    if (value) bits[index >> 3]! |= 1 << (index & 7);
    else bits[index >> 3]! &= ~(1 << (index & 7));
  };

  const rasterize = (ring: Point[], value: boolean): void => {
    if (ring.length < 3) return;

    const minX = Math.min(...ring.map((point) => point[0]));
    const maxX = Math.max(...ring.map((point) => point[0]));
    const minY = Math.min(...ring.map((point) => point[1]));
    const maxY = Math.max(...ring.map((point) => point[1]));

    const firstRow = Math.max(0, Math.floor(minY / CELL_KM) - 1);
    const lastRow = Math.min(GRID_HEIGHT - 1, Math.ceil(maxY / CELL_KM) + 1);
    const firstColumn = Math.max(0, Math.floor(minX / CELL_KM) - 1);
    const lastColumn = Math.min(GRID_WIDTH - 1, Math.ceil(maxX / CELL_KM) + 1);

    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = (row + 0.5) * CELL_KM;
      const crossingX: number[] = [];

      for (let index = 0; index < ring.length; index += 1) {
        const a = ring[index]!;
        const b = ring[(index + 1) % ring.length]!;
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          crossingX.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }

      if (crossingX.length < 2) continue;
      crossingX.sort((a, b) => a - b);

      for (let pair = 0; pair + 1 < crossingX.length; pair += 2) {
        const left = crossingX[pair]!;
        const right = crossingX[pair + 1]!;
        if (right <= left) continue;

        let start = Math.max(firstColumn, Math.ceil(left / CELL_KM - 0.5));
        let end = Math.min(lastColumn, Math.ceil(right / CELL_KM - 0.5) - 1);
        start = Math.max(0, start);
        end = Math.min(GRID_WIDTH - 1, end);

        for (let column = start; column <= end; column += 1) {
          setCell(column, row, value);
        }
      }
    }
  };

  for (const polygon of framePolygons) {
    rasterize(polygon.outer, true);
    for (const hole of polygon.holes) rasterize(hole, false);
  }

  const cellIsLand = (xKm: number, yKm: number): boolean => {
    const x = Math.floor(xKm / CELL_KM);
    const y = Math.floor(yKm / CELL_KM);
    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) return false;
    const index = y * GRID_WIDTH + x;
    return (bits[index >> 3]! & (1 << (index & 7))) !== 0;
  };

  // Alternate sea/land runs. Cell 0 is sea in this data, so the first run is
  // a sea run (possibly zero long).
  const runs: number[] = [];
  let runValue = false;
  let runLength = 0;
  let landCells = 0;

  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const index = y * GRID_WIDTH + x;
      const value = (bits[index >> 3]! & (1 << (index & 7))) !== 0;
      if (value) landCells += 1;
      if (value === runValue) runLength += 1;
      else {
        runs.push(runLength);
        runValue = value;
        runLength = 1;
      }
    }
  }
  runs.push(runLength);

  const runBytes: number[] = [];
  for (const run of runs) {
    let value = run;
    while (value >= 0x80) {
      runBytes.push((value % 0x80) | 0x80);
      value = Math.floor(value / 0x80);
    }
    runBytes.push(value);
  }

  const base64 = Buffer.from(Uint8Array.from(runBytes)).toString("base64");
  const chunks: string[] = [];
  for (let offset = 0; offset < base64.length; offset += 120) {
    chunks.push(base64.slice(offset, offset + 120));
  }

  const generated = `// Generated by \`npm run build-map\` from Natural Earth 1:10m land.
// Do not edit by hand. The map frame comes from shared/settings.ts.
//
// One bit per ${CELL_KM} km cell, row by row, run-length encoded as alternating
// sea/land lengths and then base64 text. shared/land.ts decodes it once.

export const LAND_MASK = {
  width: ${GRID_WIDTH},
  height: ${GRID_HEIGHT},
  cellKm: ${CELL_KM},
  runsBase64: [
${chunks.map((chunk) => `    "${chunk}",`).join("\n")}
  ].join(""),
};
`;

  writeFileSync(landMaskPath, generated);

  const landMaskBytes = Buffer.byteLength(generated, "utf8");
  const landMaskGzipBytes = gzipSync(Buffer.from(generated, "utf8"), { level: 9 }).length;

  // --- Report --------------------------------------------------------------

  const pointInRing = (point: Point, ring: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (
        (a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        inside = !inside;
      }
    }
    return inside;
  };

  const sourceHasLand = (lonDeg: number, latDeg: number): boolean => {
    const mapped = lonLatToMap(lonDeg, latDeg);
    const point: Point = [mapped.x, mapped.y];
    return framePolygons.some(
      (polygon) =>
        pointInRing(point, polygon.outer) &&
        !polygon.holes.some((hole) => pointInRing(point, hole)),
    );
  };

  const islandChecks = [
    { name: "Cuba", lon: -79.0, lat: 21.8 },
    { name: "Jamaica", lon: -77.3, lat: 18.1 },
    { name: "Hispaniola", lon: -71.5, lat: 19.0 },
    { name: "Puerto Rico", lon: -66.5, lat: 18.2 },
    { name: "Trinidad", lon: -61.3, lat: 10.5 },
    { name: "Guadeloupe", lon: -61.65, lat: 16.15 },
    { name: "Martinique", lon: -61.0, lat: 14.64 },
    { name: "Saint Lucia", lon: -60.98, lat: 13.9 },
    { name: "Barbados", lon: -59.55, lat: 13.15 },
    { name: "Galapagos", lon: -90.4, lat: -0.6 },
    { name: "Falkland Islands", lon: -59.0, lat: -51.7 },
    { name: "Tierra del Fuego", lon: -68.5, lat: -54.0 },
    { name: "Chiloe", lon: -73.9, lat: -42.5 },
    { name: "Trindade", lon: -29.33, lat: -20.57 },
    { name: "South Georgia", lon: -36.7, lat: -54.4 },
  ].map((check) => {
    const map = lonLatToMap(check.lon, check.lat);
    return {
      name: check.name,
      inSourceData: sourceHasLand(check.lon, check.lat),
      inServerLookup: cellIsLand(map.x, map.y),
    };
  });

  const missingFromData = islandChecks.filter((check) => !check.inSourceData).map((c) => c.name);
  const missingFromLookup = islandChecks
    .filter((check) => !check.inServerLookup)
    .map((c) => c.name);

  const start = lonLatToMap(-79.5, 13);
  const summary = {
    tiles: {
      files: tileCount,
      bytes: tileBytes,
      megabytes: Number((tileBytes / (1024 * 1024)).toFixed(2)),
      maxTileBytes,
      maxTileLabel,
      maxTilePoints,
      levels: manifestLevels.map((level) => ({
        z: level.z,
        km: level.km,
        files: level.tiles.length,
      })),
    },
    lookup: {
      fileBytes: landMaskBytes,
      gzipBytes: landMaskGzipBytes,
      rawMaskBytes: Math.ceil((GRID_WIDTH * GRID_HEIGHT) / 8),
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      cellKm: CELL_KM,
      landShare: Number((landCells / (GRID_WIDTH * GRID_HEIGHT)).toFixed(3)),
      underCompressedLimit: landMaskGzipBytes <= settings.map.maxLookupCompressedBytes,
    },
    islands: {
      checks: islandChecks,
      missingFromData,
      missingFromLookup,
    },
    startIsSea: !cellIsLand(start.x, start.y),
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log("MAP BUILD PASSED");
}

main();
