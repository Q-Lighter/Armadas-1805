// Build private 25 km chart blocks from the fine drawing tiles.
//
// Run: node scripts/build-chart-blocks.mjs
//
// The source tiles are development/map data only. The generated TypeScript is
// imported by the Worker so geometry never sits in the public asset folder.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { settings } from "../shared/dist/settings.js";
import { isLandAt } from "../shared/dist/land.js";

const root = process.cwd();
const sourceRoot = path.join(root, "map-data/tiles");
const output = path.join(root, "shared/data/chartBlocks.ts");
const blockKm = settings.fog.chartBlockKm;
const mapWidth = 3810.96;
const mapHeight = 5640.6;
const blockColumns = Math.ceil(mapWidth / blockKm);
const blockRows = Math.ceil(mapHeight / blockKm);

function clipRing(ring, rect) {
  let out = ring;
  const clip = (inside, intersect) => {
    if (!out.length) return;
    const input = out;
    out = [];
    let previous = input[input.length - 1];
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
  clip((p) => p[0] >= rect.minX, (a, b) => {
    const t = (rect.minX - a[0]) / (b[0] - a[0]);
    return [rect.minX, a[1] + (b[1] - a[1]) * t];
  });
  clip((p) => p[0] <= rect.maxX, (a, b) => {
    const t = (rect.maxX - a[0]) / (b[0] - a[0]);
    return [rect.maxX, a[1] + (b[1] - a[1]) * t];
  });
  clip((p) => p[1] >= rect.minY, (a, b) => {
    const t = (rect.minY - a[1]) / (b[1] - a[1]);
    return [a[0] + (b[0] - a[0]) * t, rect.minY];
  });
  clip((p) => p[1] <= rect.maxY, (a, b) => {
    const t = (rect.maxY - a[1]) / (b[1] - a[1]);
    return [a[0] + (b[0] - a[0]) * t, rect.maxY];
  });
  return out;
}

function clipSegment(a, b, rect) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a[0] - rect.minX],
    [dx, rect.maxX - a[0]],
    [-dy, a[1] - rect.minY],
    [dy, rect.maxY - a[1]],
  ]) {
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

function same(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

function clipLine(points, rect) {
  const lines = [];
  let current = [];
  const flush = () => {
    if (current.length >= 4) lines.push(current);
    current = [];
  };
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const clipped = clipSegment(a, b, rect);
    if (!clipped) {
      flush();
      continue;
    }
    const [start, end] = clipped;
    if (!current.length) current = [...start, ...end];
    else if (same([current[current.length - 2], current[current.length - 1]], start)) {
      current.push(end[0], end[1]);
    } else {
      flush();
      current = [...start, ...end];
    }
    if (!same(end, b)) flush();
  }
  flush();
  return lines;
}

function flat(ring) {
  return ring.flatMap(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    sum += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  return Math.abs(sum / 2);
}

function cleanRing(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i];
    const y = ring[i + 1];
    const lastX = out[out.length - 2];
    const lastY = out[out.length - 1];
    if (lastX !== undefined && Math.abs(x - lastX) < 0.01 && Math.abs(y - lastY) < 0.01) {
      continue;
    }
    out.push(x, y);
  }
  if (
    out.length >= 2 &&
    Math.abs(out[0] - out[out.length - 2]) < 0.01 &&
    Math.abs(out[1] - out[out.length - 1]) < 0.01
  ) {
    out.splice(out.length - 2, 2);
  }
  return out.length >= 6 && ringArea(out) > 0.05 ? out : null;
}

/** True when a segment lies along the chart frame or the block's own edge. */
function onRectEdge(a, b, rect) {
  const sameX = Math.abs(a[0] - b[0]) < 0.01;
  const sameY = Math.abs(a[1] - b[1]) < 0.01;
  if (sameX) {
    const x = a[0];
    if (
      Math.abs(x - rect.minX) < 0.01 ||
      Math.abs(x - rect.maxX) < 0.01 ||
      Math.abs(x - 0) < 0.01 ||
      Math.abs(x - mapWidth) < 0.01
    ) return true;
  }
  if (sameY) {
    const y = a[1];
    if (
      Math.abs(y - rect.minY) < 0.01 ||
      Math.abs(y - rect.maxY) < 0.01 ||
      Math.abs(y - 0) < 0.01 ||
      Math.abs(y - mapHeight) < 0.01
    ) return true;
  }
  return false;
}

/**
 * Keep only a segment that has the 1 km land lookup on both sides within
 * about a kilometre. This removes source-tile clip edges and ink that runs
 * through the middle of land, while keeping the island and coast detail.
 */
function isCoastSegment(a, b) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // Search in every direction, not only across the segment. A short segment
  // in a bay can be tangent to the raster boundary.
  for (let direction = 0; direction < 16; direction += 1) {
    const angle = (direction / 16) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let previous = isLandAt(mx, my);
    for (let distance = 0.1; distance <= 1.2 + 1e-9; distance += 0.1) {
      const current = isLandAt(mx + dx * distance, my + dy * distance);
      if (current !== previous) return true;
      previous = current;
    }
  }
  return false;
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
}

function cleanCoastLine(line, rect) {
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length >= 4) runs.push(run);
    run = [];
  };

  for (let i = 0; i + 3 < line.length; i += 2) {
    const a = [line[i], line[i + 1]];
    const b = [line[i + 2], line[i + 3]];
    if (onRectEdge(a, b, rect) || !isCoastSegment(a, b)) {
      flush();
      continue;
    }
    if (run.length === 0) {
      run = [...a, ...b];
    } else if (samePoint([run[run.length - 2], run[run.length - 1]], a)) {
      run.push(...b);
    } else {
      flush();
      run = [...a, ...b];
    }
  }
  flush();
  return runs;
}

function addBlock(blocks, col, row) {
  const key = `${col}_${row}`;
  let block = blocks.get(key);
  if (!block) {
    block = {
      id: key,
      x: col * blockKm,
      y: row * blockKm,
      km: blockKm,
      fill: [],
      coast: [],
      fillKeys: new Set(),
      coastKeys: new Set(),
      points: 0,
    };
    blocks.set(key, block);
  }
  return block;
}

const manifest = JSON.parse(readFileSync(path.join(sourceRoot, "index.json"), "utf8"));
const level = manifest.levels.find((item) => item.z === 4);
if (!level) throw new Error("level 4 tile manifest missing");

const blocks = new Map();
let sourceTiles = 0;

for (const [tx, ty] of level.tiles) {
  const data = JSON.parse(
    readFileSync(path.join(sourceRoot, "4", `${tx}_${ty}.json`), "utf8"),
  );
  sourceTiles += 1;

  for (const rawRing of data.fill ?? []) {
    const points = [];
    for (let i = 0; i < rawRing.length; i += 2) points.push([rawRing[i], rawRing[i + 1]]);
    const bounds = points.reduce(
      (b, p) => ({
        minX: Math.min(b.minX, p[0]),
        minY: Math.min(b.minY, p[1]),
        maxX: Math.max(b.maxX, p[0]),
        maxY: Math.max(b.maxY, p[1]),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const firstCol = Math.max(0, Math.floor(bounds.minX / blockKm));
    const lastCol = Math.min(blockColumns - 1, Math.floor(bounds.maxX / blockKm));
    const firstRow = Math.max(0, Math.floor(bounds.minY / blockKm));
    const lastRow = Math.min(blockRows - 1, Math.floor(bounds.maxY / blockKm));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const rect = {
          minX: col * blockKm,
          minY: row * blockKm,
          maxX: Math.min(mapWidth, (col + 1) * blockKm),
          maxY: Math.min(mapHeight, (row + 1) * blockKm),
        };
        const clipped = clipRing(points, rect);
        if (clipped.length >= 3) {
          const block = addBlock(blocks, col, row);
          const ring = cleanRing(flat(clipped));
          if (ring) {
            const key = JSON.stringify(ring);
            if (!block.fillKeys.has(key)) {
              block.fillKeys.add(key);
              block.fill.push(ring);
              block.points += ring.length / 2;
            }
          }
        }
      }
    }
  }

  for (const rawLine of data.coast ?? []) {
    const points = [];
    for (let i = 0; i < rawLine.length; i += 2) points.push([rawLine[i], rawLine[i + 1]]);
    if (points.length < 2) continue;
    const bounds = points.reduce(
      (b, p) => ({
        minX: Math.min(b.minX, p[0]),
        minY: Math.min(b.minY, p[1]),
        maxX: Math.max(b.maxX, p[0]),
        maxY: Math.max(b.maxY, p[1]),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const firstCol = Math.max(0, Math.floor(bounds.minX / blockKm));
    const lastCol = Math.min(blockColumns - 1, Math.floor(bounds.maxX / blockKm));
    const firstRow = Math.max(0, Math.floor(bounds.minY / blockKm));
    const lastRow = Math.min(blockRows - 1, Math.floor(bounds.maxY / blockKm));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const rect = {
          minX: col * blockKm,
          minY: row * blockKm,
          maxX: Math.min(mapWidth, (col + 1) * blockKm),
          maxY: Math.min(mapHeight, (row + 1) * blockKm),
        };
        const lines = clipLine(points, rect);
        if (lines.length) {
          const block = addBlock(blocks, col, row);
          for (const clipped of lines) {
            for (const line of cleanCoastLine(clipped, rect)) {
              const key = JSON.stringify(line);
              if (!block.coastKeys.has(key)) {
                block.coastKeys.add(key);
                block.coast.push(line);
                block.points += line.length / 2;
              }
            }
          }
        }
      }
    }
  }
}

const records = [...blocks.values()]
  .filter((block) => block.fill.length || block.coast.length)
  .sort((a, b) => a.y - b.y || a.x - b.x);

const body = records
  .map((block) =>
    `  [${JSON.stringify(block.id)}, { id: ${JSON.stringify(block.id)}, x: ${block.x}, y: ${block.y}, km: ${block.km}, fill: ${JSON.stringify(block.fill)}, coast: ${JSON.stringify(block.coast)} }],`,
  )
  .join("\n");

const generated = `// Generated by \`node scripts/build-chart-blocks.mjs\`. Do not edit by hand.
// Private chart geometry. It is bundled into the Worker, never served as a
// public asset; visibleStateFor() releases a block only after discovery.

import type { ChartBlock } from "../fog.js";

export const CHART_BLOCKS: ReadonlyMap<string, ChartBlock> = new Map<string, ChartBlock>([
${body}
]);
`;

writeFileSync(output, generated);

const bytes = statSync(output).size;
const maxPoints = Math.max(...records.map((b) => b.points));
const maxBytes = Math.max(
  ...records.map((b) => JSON.stringify({ fill: b.fill, coast: b.coast }).length),
);
console.log(
  JSON.stringify(
    {
      blockKm,
      blockColumns,
      blockRows,
      sourceTiles,
      blocks: records.length,
      generatedBytes: bytes,
      maxBlockPoints: maxPoints,
      maxBlockGeometryBytes: maxBytes,
      totalFillRings: records.reduce((n, b) => n + b.fill.length, 0),
      totalCoastLines: records.reduce((n, b) => n + b.coast.length, 0),
    },
    null,
    2,
  ),
);
