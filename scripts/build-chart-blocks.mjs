// Build private 25 km chart blocks from the fine drawing tiles.
//
// Run: node scripts/build-chart-blocks.mjs
//
// The source tiles are development/map data only. The generated TypeScript is
// imported by the Worker so geometry never sits in the public asset folder.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { settings } from "../shared/dist/settings.js";

const root = process.cwd();
const sourceRoot = path.join(root, "map-data/tiles");
const output = path.join(root, "server/src/chartBlocks.ts");
const blockKm = settings.fog.chartBlockKm;
const overlapKm = settings.map.tileOverlapKm;
const blockColumns = Math.ceil(3810.96 / blockKm);
const blockRows = Math.ceil(5640.6 / blockKm);

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
    const firstCol = Math.max(0, Math.floor((bounds.minX - overlapKm) / blockKm));
    const lastCol = Math.min(blockColumns - 1, Math.floor((bounds.maxX + overlapKm) / blockKm));
    const firstRow = Math.max(0, Math.floor((bounds.minY - overlapKm) / blockKm));
    const lastRow = Math.min(blockRows - 1, Math.floor((bounds.maxY + overlapKm) / blockKm));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const rect = {
          minX: Math.max(0, col * blockKm - overlapKm),
          minY: Math.max(0, row * blockKm - overlapKm),
          maxX: Math.min(3810.96, (col + 1) * blockKm + overlapKm),
          maxY: Math.min(5640.6, (row + 1) * blockKm + overlapKm),
        };
        const clipped = clipRing(points, rect);
        if (clipped.length >= 3) {
          const block = addBlock(blocks, col, row);
          const ring = flat(clipped);
          if (ring.length >= 6) {
            block.fill.push(ring);
            block.points += ring.length / 2;
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
    const firstCol = Math.max(0, Math.floor((bounds.minX - overlapKm) / blockKm));
    const lastCol = Math.min(blockColumns - 1, Math.floor((bounds.maxX + overlapKm) / blockKm));
    const firstRow = Math.max(0, Math.floor((bounds.minY - overlapKm) / blockKm));
    const lastRow = Math.min(blockRows - 1, Math.floor((bounds.maxY + overlapKm) / blockKm));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const rect = {
          minX: Math.max(0, col * blockKm - overlapKm),
          minY: Math.max(0, row * blockKm - overlapKm),
          maxX: Math.min(3810.96, (col + 1) * blockKm + overlapKm),
          maxY: Math.min(5640.6, (row + 1) * blockKm + overlapKm),
        };
        const lines = clipLine(points, rect);
        if (lines.length) {
          const block = addBlock(blocks, col, row);
          for (const line of lines) {
            if (line.length >= 4) {
              block.coast.push(line);
              block.points += line.length / 2;
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

import type { ChartBlock } from "@naval/shared/fog";

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
