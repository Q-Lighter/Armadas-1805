// Pure chart drawing commands and a drawing audit.
//
// The Pixi renderer turns these commands into Graphics calls. Tests build the
// same commands from the real block data, so a stitched coast, a block-sized
// fill or a sea fill can be found without a browser.

import type { ChartBlock } from "./fog.js";

export interface ChartFillCommand {
  kind: "fill";
  blockId: string;
  ring: number[];
}

export interface ChartStrokeCommand {
  kind: "stroke";
  blockId: string;
  line: number[];
  layer: "water" | "coast";
  widthPx: number;
}

export interface ChartCommands {
  fills: ChartFillCommand[];
  strokes: ChartStrokeCommand[];
}

export interface ChartBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MAX_COAST_SEGMENT_KM = 6;

function signedArea(ring: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 2) {
    const next = (index + 2) % ring.length;
    sum += ring[index]! * ring[next + 1]! - ring[next]! * ring[index + 1]!;
  }
  return sum / 2;
}

/** Remove repeated points and make one closed ring with positive winding. */
export function normaliseFillRing(ring: readonly number[]): number[] | null {
  const out: number[] = [];
  for (let index = 0; index + 1 < ring.length; index += 2) {
    const x = ring[index]!;
    const y = ring[index + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const lastX = out[out.length - 2];
    const lastY = out[out.length - 1];
    if (
      lastX !== undefined &&
      lastY !== undefined &&
      Math.abs(x - lastX) < 1e-7 &&
      Math.abs(y - lastY) < 1e-7
    ) {
      continue;
    }
    out.push(x, y);
  }
  if (out.length >= 2) {
    const firstX = out[0]!;
    const firstY = out[1]!;
    const lastX = out[out.length - 2]!;
    const lastY = out[out.length - 1]!;
    if (Math.abs(firstX - lastX) < 1e-7 && Math.abs(firstY - lastY) < 1e-7) {
      out.splice(out.length - 2, 2);
    }
  }
  if (out.length < 6) return null;
  if (Math.abs(signedArea(out)) < 1e-5) return null;
  if (signedArea(out) < 0) {
    const reversed: number[] = [];
    for (let index = out.length - 2; index >= 0; index -= 2) {
      reversed.push(out[index]!, out[index + 1]!);
    }
    return reversed;
  }
  return out;
}

/**
 * Split a long straight segment without changing the drawn path. The six
 * kilometre audit is about a stitch between unrelated chains, but splitting
 * also makes the audit's sample spacing independent of source detail.
 */
export function splitLongLine(line: readonly number[]): number[] {
  if (line.length < 4) return [...line];
  const out: number[] = [];
  for (let index = 0; index + 3 < line.length; index += 2) {
    const ax = line[index]!;
    const ay = line[index + 1]!;
    const bx = line[index + 2]!;
    const by = line[index + 3]!;
    if (index === 0) out.push(ax, ay);
    const length = Math.hypot(bx - ax, by - ay);
    const pieces = Math.max(1, Math.ceil(length / MAX_COAST_SEGMENT_KM));
    for (let piece = 1; piece <= pieces; piece += 1) {
      const t = piece / pieces;
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

/** The exact commands for one private block. */
export function buildBlockCommands(
  block: ChartBlock,
  waterWidthPx: number,
  coastWidthPx: number,
): ChartCommands {
  const fills: ChartFillCommand[] = [];
  for (const raw of block.fill) {
    const ring = normaliseFillRing(raw);
    if (!ring) continue;
    fills.push({ kind: "fill", blockId: block.id, ring });
  }

  const strokes: ChartStrokeCommand[] = [];
  for (const raw of block.coast) {
    if (raw.length < 4) continue;
    const line = splitLongLine(raw);
    if (line.length < 4) continue;
    strokes.push({
      kind: "stroke",
      blockId: block.id,
      line,
      layer: "water",
      widthPx: waterWidthPx,
    });
    strokes.push({
      kind: "stroke",
      blockId: block.id,
      line,
      layer: "coast",
      widthPx: coastWidthPx,
    });
  }
  return { fills, strokes };
}

/** Every command for a set of blocks, in deterministic block order. */
export function buildChartCommands(
  blocks: readonly ChartBlock[],
  waterWidthPx: number,
  coastWidthPx: number,
): ChartCommands {
  const fills: ChartFillCommand[] = [];
  const strokes: ChartStrokeCommand[] = [];
  for (const block of [...blocks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const commands = buildBlockCommands(block, waterWidthPx, coastWidthPx);
    fills.push(...commands.fills);
    strokes.push(...commands.strokes);
  }
  return { fills, strokes };
}

export function commandsInBounds(
  commands: ChartCommands,
  blocks: readonly ChartBlock[],
  bounds: ChartBounds,
): ChartCommands {
  const blockIds = new Set(
    blocks
      .filter((block) =>
        !(
          block.x + block.km < bounds.minX ||
          block.x > bounds.maxX ||
          block.y + block.km < bounds.minY ||
          block.y > bounds.maxY
        ),
      )
      .map((block) => block.id),
  );
  return {
    fills: commands.fills.filter((command) => blockIds.has(command.blockId)),
    strokes: commands.strokes.filter((command) => blockIds.has(command.blockId)),
  };
}

export interface ChartSuspect {
  blockId: string;
  kind: "stitch" | "full-block-fill" | "border-fill";
  line?: number[];
  ring?: number[];
}

/** Geometry-only suspects for the bright magenta debug overlay. */
export function findChartSuspects(
  blocks: readonly ChartBlock[],
  isLandAt?: (x: number, y: number) => boolean,
): ChartSuspect[] {
  const suspects: ChartSuspect[] = [];
  const present = new Set(blocks.map((block) => block.id));
  for (const block of blocks) {
    const { fills, strokes } = buildBlockCommands(block, 1, 1);
    for (const stroke of strokes) {
      if (stroke.layer !== "coast") continue;
      for (let index = 0; index + 3 < stroke.line.length; index += 2) {
        const dx = stroke.line[index + 2]! - stroke.line[index]!;
        const dy = stroke.line[index + 3]! - stroke.line[index + 1]!;
        if (Math.hypot(dx, dy) > MAX_COAST_SEGMENT_KM) {
          suspects.push({
            blockId: block.id,
            kind: "stitch",
            line: stroke.line.slice(index, index + 4),
          });
        }
      }
    }

    for (const fill of fills) {
      const ring = fill.ring;
      if (hasAllBlockCorners(ring, block)) {
        // A whole-block ring is only a defect when the lookup says that block
        // has sea in it. All-land blocks are legitimately one full square.
        if (!isLandAt || !blockAllLand(block, isLandAt)) {
          suspects.push({
            blockId: block.id,
            kind: "full-block-fill",
            ring,
          });
        }
      } else if (hasBlockBorderEdge(ring, block)) {
        const exposed = ring.some((value, index) => {
          if (index % 2 !== 0) return false;
          const next = (index + 2) % ring.length;
          const ax = ring[index]!;
          const ay = ring[index + 1]!;
          const bx = ring[next]!;
          const by = ring[next + 1]!;
          const bothX = Math.abs(ax - bx) < 0.01;
          const bothY = Math.abs(ay - by) < 0.01;
          if (
            !(
              (bothX && onBorder(ax, block.x, block.x + block.km)) ||
              (bothY && onBorder(ay, block.y, block.y + block.km))
            )
          ) return false;
          const neighbours = neighbourBlockIds(block, (ax + bx) / 2, (ay + by) / 2);
          return neighbours.length > 0 && neighbours.every((id) => !present.has(id));
        });
        if (exposed) {
          suspects.push({ blockId: block.id, kind: "border-fill", ring });
        }
      }
    }
  }
  return suspects;
}

function onBorder(value: number, low: number, high: number): boolean {
  return Math.abs(value - low) <= 0.01 || Math.abs(value - high) <= 0.01;
}

function hasBlockBorderEdge(ring: readonly number[], block: ChartBlock): boolean {
  const x0 = block.x;
  const x1 = block.x + block.km;
  const y0 = block.y;
  const y1 = block.y + block.km;
  for (let index = 0; index < ring.length; index += 2) {
    const next = (index + 2) % ring.length;
    const ax = ring[index]!;
    const ay = ring[index + 1]!;
    const bx = ring[next]!;
    const by = ring[next + 1]!;
    const bothX = Math.abs(ax - bx) < 0.01;
    const bothY = Math.abs(ay - by) < 0.01;
    if (
      (bothX && onBorder(ax, x0, x1)) ||
      (bothY && onBorder(ay, y0, y1))
    ) return true;
  }
  return false;
}

function blockAllLand(
  block: ChartBlock,
  isLandAt: (x: number, y: number) => boolean,
): boolean {
  for (let y = block.y + 0.5; y < block.y + block.km; y += 1) {
    for (let x = block.x + 0.5; x < block.x + block.km; x += 1) {
      if (!isLandAt(x, y)) return false;
    }
  }
  return true;
}

function hasAllBlockCorners(ring: readonly number[], block: ChartBlock): boolean {
  const x0 = block.x;
  const x1 = block.x + block.km;
  const y0 = block.y;
  const y1 = block.y + block.km;
  const has = (x: number, y: number): boolean => {
    for (let index = 0; index < ring.length; index += 2) {
      if (Math.abs(ring[index]! - x) <= 0.01 && Math.abs(ring[index + 1]! - y) <= 0.01) {
        return true;
      }
    }
    return false;
  };
  return has(x0, y0) && has(x1, y0) && has(x1, y1) && has(x0, y1);
}

function pointInRing(x: number, y: number, ring: readonly number[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 2; index < ring.length; previous = index, index += 2) {
    const xi = ring[index]!;
    const yi = ring[index + 1]!;
    const xj = ring[previous]!;
    const yj = ring[previous + 1]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when a 1.5 km search finds the land/sea lookup boundary. */
export function isNearLandBoundary(
  isLandAt: (x: number, y: number) => boolean,
  x: number,
  y: number,
  radiusKm = 1.5,
): boolean {
  for (let direction = 0; direction < 16; direction += 1) {
    const angle = (direction / 16) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let previous = isLandAt(x, y);
    for (let distance = 0.1; distance <= radiusKm + 1e-9; distance += 0.1) {
      const current = isLandAt(x + dx * distance, y + dy * distance);
      if (current !== previous) return true;
      previous = current;
    }
  }
  return false;
}

export interface ChartAuditOptions {
  blocks: readonly ChartBlock[];
  isLandAt: (x: number, y: number) => boolean;
  /** Blocks in the same paint pass. Missing neighbours expose a fill edge. */
  presentBlockIds?: ReadonlySet<string>;
  /** How far a stroke point may be from the lookup boundary. */
  boundaryKm?: number;
  /** Sampling step along a stroke. */
  sampleKm?: number;
  /** Sea cells allowed inside one fill ring because of raster rounding. */
  seaCellTolerance?: number;
}

export interface ChartAuditExample {
  blockId: string;
  detail: string;
}

export interface ChartAuditReport {
  fills: number;
  strokes: number;
  stitches: number;
  awayFromBoundary: number;
  borderFillEdges: number;
  exposedBorderFillEdges: number;
  fullBlockFills: number;
  fillSeaCells: number;
  fillSeaRings: number;
  wrongWinding: number;
  examples: ChartAuditExample[];
}

function neighbourBlockIds(block: ChartBlock, x: number, y: number): string[] {
  const column = Math.floor(block.x / block.km);
  const row = Math.floor(block.y / block.km);
  const ids: string[] = [];
  if (Math.abs(x - block.x) <= 0.01) ids.push(`${column - 1}_${row}`);
  if (Math.abs(x - (block.x + block.km)) <= 0.01) ids.push(`${column + 1}_${row}`);
  if (Math.abs(y - block.y) <= 0.01) ids.push(`${column}_${row - 1}`);
  if (Math.abs(y - (block.y + block.km)) <= 0.01) ids.push(`${column}_${row + 1}`);
  return ids;
}

/**
 * Audit the draw commands, not the intention. A stitch is a straight jump over
 * six kilometres; a whole-block fill is a rectangle that does not follow the
 * coast; a fill sea cell is land paint over water in the real lookup.
 */
export function auditChartCommands(
  commands: ChartCommands,
  options: ChartAuditOptions,
): ChartAuditReport {
  const blockMap = new Map(options.blocks.map((block) => [block.id, block]));
  const present = options.presentBlockIds ?? new Set(blockMap.keys());
  const boundaryKm = options.boundaryKm ?? 1.5;
  const sampleKm = options.sampleKm ?? 1;
  const seaTolerance = options.seaCellTolerance ?? 0;
  const report: ChartAuditReport = {
    fills: commands.fills.length,
    strokes: commands.strokes.length,
    stitches: 0,
    awayFromBoundary: 0,
    borderFillEdges: 0,
    exposedBorderFillEdges: 0,
    fullBlockFills: 0,
    fillSeaCells: 0,
    fillSeaRings: 0,
    wrongWinding: 0,
    examples: [],
  };
  const example = (blockId: string, detail: string): void => {
    if (report.examples.length < 12) report.examples.push({ blockId, detail });
  };

  for (const stroke of commands.strokes) {
    for (let index = 0; index + 3 < stroke.line.length; index += 2) {
      const ax = stroke.line[index]!;
      const ay = stroke.line[index + 1]!;
      const bx = stroke.line[index + 2]!;
      const by = stroke.line[index + 3]!;
      const length = Math.hypot(bx - ax, by - ay);
      if (length <= 0.01) continue;
      if (length > MAX_COAST_SEGMENT_KM) {
        report.stitches += 1;
        example(stroke.blockId, `stitch ${length.toFixed(1)} km at ${ax.toFixed(1)},${ay.toFixed(1)}`);
      }
      const samples = Math.max(1, Math.ceil(length / sampleKm));
      let away = false;
      for (let sample = 1; sample < samples; sample += 1) {
        const t = sample / samples;
        if (!isNearLandBoundary(options.isLandAt, ax + (bx - ax) * t, ay + (by - ay) * t, boundaryKm)) {
          away = true;
          break;
        }
      }
      if (away) {
        report.awayFromBoundary += 1;
        example(stroke.blockId, `stroke away from boundary at ${((ax + bx) / 2).toFixed(1)},${((ay + by) / 2).toFixed(1)}`);
      }
    }
  }

  for (const fill of commands.fills) {
    const block = blockMap.get(fill.blockId);
    if (!block) continue;
    const ring = fill.ring;
    let area = 0;
    let borderEdge = false;
    let exposedBorder = false;
    for (let index = 0; index < ring.length; index += 2) {
      const next = (index + 2) % ring.length;
      const ax = ring[index]!;
      const ay = ring[index + 1]!;
      const bx = ring[next]!;
      const by = ring[next + 1]!;
      area += ax * by - bx * ay;
      const bothX = Math.abs(ax - bx) < 0.01;
      const bothY = Math.abs(ay - by) < 0.01;
      if (
        (bothX && onBorder(ax, block.x, block.x + block.km)) ||
        (bothY && onBorder(ay, block.y, block.y + block.km))
      ) {
        borderEdge = true;
        const neighbours = neighbourBlockIds(block, (ax + bx) / 2, (ay + by) / 2);
        if (neighbours.length > 0 && neighbours.every((id) => !present.has(id))) {
          exposedBorder = true;
        }
      }
    }
    if (area < 0) {
      report.wrongWinding += 1;
      example(fill.blockId, "clockwise fill ring");
    }
    if (borderEdge) {
      report.borderFillEdges += 1;
    }
    if (exposedBorder) {
      report.exposedBorderFillEdges += 1;
      example(fill.blockId, "fill edge exposed at a missing neighbour");
    }

    if (hasAllBlockCorners(ring, block)) {
      let land = 0;
      let total = 0;
      for (let y = block.y + 0.5; y < block.y + block.km; y += 1) {
        for (let x = block.x + 0.5; x < block.x + block.km; x += 1) {
          total += 1;
          if (options.isLandAt(x, y)) land += 1;
        }
      }
      if (total === 0 || land < total) {
        report.fullBlockFills += 1;
        example(fill.blockId, `whole-block fill, ${land}/${total} lookup samples land`);
      }
    }

    let sea = 0;
    let total = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < ring.length; index += 2) {
      minX = Math.min(minX, ring[index]!);
      maxX = Math.max(maxX, ring[index]!);
      minY = Math.min(minY, ring[index + 1]!);
      maxY = Math.max(maxY, ring[index + 1]!);
    }
    for (let y = minY + 0.5; y < maxY; y += 1) {
      for (let x = minX + 0.5; x < maxX; x += 1) {
        if (!pointInRing(x, y, ring)) continue;
        total += 1;
        if (!options.isLandAt(x, y)) sea += 1;
      }
    }
    report.fillSeaCells += sea;
    if (sea > seaTolerance) {
      report.fillSeaRings += 1;
      example(fill.blockId, `${sea} sea cells inside ${total} fill cells`);
    }
  }

  return report;
}
