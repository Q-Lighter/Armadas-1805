// The chart has two levels of detail. Far out it uses the cached low-resolution
// texture; close in it paints only the blocks and discovered cells that touch
// the viewport. This module is pure so the switch can be tested without Pixi.

import {
  chartCellKm,
  chartColumns,
  chartRows,
  type ChartBlock,
} from "./fog.js";

export type ChartDetailLevel = "texture" | "vector";

export interface ChartViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ChartDetailPlan {
  level: ChartDetailLevel;
  /** Blocks that intersect the viewport, capped and ordered by id. */
  blocks: ChartBlock[];
  /** Discovered cell indices inside the viewport, in row-major order. */
  cells: number[];
  /** One sea Graphics plus one Graphics per block. */
  graphicsCount: number;
  capped: boolean;
}

export function chartDetailLevel(
  kmAcross: number,
  thresholdKm: number,
): ChartDetailLevel {
  return kmAcross < thresholdKm ? "vector" : "texture";
}

/** 0 at the texture threshold, 1 well inside the vector range. */
export function chartDetailBlend(
  kmAcross: number,
  thresholdKm: number,
  fadeKm: number,
): number {
  if (fadeKm <= 0) return kmAcross < thresholdKm ? 1 : 0;
  return Math.max(0, Math.min(1, (thresholdKm - kmAcross) / fadeKm));
}

/**
 * A settled chart texture is view-sized and device-pixel sharp, but never
 * bigger than the screen times the device ratio or the hard cache ceiling.
 */
export function chartTextureSize(
  width: number,
  height: number,
  devicePixelRatio: number,
  maxPx: number,
): { width: number; height: number } {
  const dpr = Math.max(1, devicePixelRatio);
  const sourceWidth = Math.max(1, width * dpr);
  const sourceHeight = Math.max(1, height * dpr);
  const scale = Math.min(1, maxPx / sourceWidth, maxPx / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function intersects(block: ChartBlock, view: ChartViewport): boolean {
  return !(
    block.x + block.km < view.left ||
    block.x > view.right ||
    block.y + block.km < view.top ||
    block.y > view.bottom
  );
}

/**
 * Plan the visible chart content. The same blocks and cells are returned for
 * both detail levels, so switching the drawing mode cannot change what the
 * stored chart means; only the way it is painted changes.
 */
export function planChartDetail(input: {
  blocks: ReadonlyMap<string, ChartBlock>;
  discovered: ReadonlySet<number>;
  viewport: ChartViewport;
  kmAcross: number;
  thresholdKm: number;
  chartAll: boolean;
  maxBlocks: number;
}): ChartDetailPlan {
  const level = chartDetailLevel(input.kmAcross, input.thresholdKm);
  const visible = [...input.blocks.values()]
    .filter((block) => intersects(block, input.viewport))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const centerX = (input.viewport.left + input.viewport.right) / 2;
  const centerY = (input.viewport.top + input.viewport.bottom) / 2;
  let chosen = visible;
  let capped = false;
  if (visible.length > input.maxBlocks) {
    capped = true;
    chosen = [...visible]
      .sort((a, b) => {
        const da = Math.hypot(a.x + a.km / 2 - centerX, a.y + a.km / 2 - centerY);
        const db = Math.hypot(b.x + b.km / 2 - centerX, b.y + b.km / 2 - centerY);
        return da - db || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      })
      .slice(0, Math.max(0, input.maxBlocks))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const cells: number[] = [];
  if (!input.chartAll) {
    const firstColumn = Math.max(
      0,
      Math.floor(input.viewport.left / chartCellKm),
    );
    const lastColumn = Math.min(
      chartColumns - 1,
      Math.floor(input.viewport.right / chartCellKm),
    );
    const firstRow = Math.max(0, Math.floor(input.viewport.top / chartCellKm));
    const lastRow = Math.min(
      chartRows - 1,
      Math.floor(input.viewport.bottom / chartCellKm),
    );
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const index = row * chartColumns + column;
        if (input.discovered.has(index)) cells.push(index);
      }
    }
  }

  return {
    level,
    blocks: chosen,
    cells,
    graphicsCount: 1 + chosen.length,
    capped,
  };
}
