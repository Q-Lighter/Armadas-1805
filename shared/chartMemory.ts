// The client's remembered chart is plain data: discovered cell indexes and the
// private map blocks received from the server. It is deliberately independent
// of the live ship-view graphics, so culling, the graphics cap or a lost WebGL
// context can never delete chart content.

import {
  blockIdForCell,
  chartColumns,
  chartRows,
  decodeChartRuns,
  type ChartBlock,
  type ChartUpdate,
} from "./fog.js";
import { orderedChartBlocks } from "./chartDraw.js";

export interface ChartMemory {
  /** Dev rooms know every cell; normal rooms use the discovered set. */
  all: boolean;
  /** Discovered 5 km cell indexes, row by row. Never removed. */
  discovered: Set<number>;
  /** Received block geometry, keyed by block id. */
  blocks: Map<string, ChartBlock>;
}

export interface ChartApplyResult {
  changed: boolean;
  addedCells: number[];
  changedBlocks: string[];
}

export function createChartMemory(): ChartMemory {
  return { all: false, discovered: new Set(), blocks: new Map() };
}

/**
 * Apply one server chart update. A resumed snapshot adds to the existing
 * record rather than replacing it: discovered ground is permanent for the
 * life of the game, even if a stale status message arrives late.
 */
export function applyChartUpdate(
  memory: ChartMemory,
  update: Pick<ChartUpdate, "cells" | "blocks" | "all" | "snapshotRuns">,
): ChartApplyResult {
  const addedCells: number[] = [];
  const changedBlocks: string[] = [];
  const cellCount = chartColumns * chartRows;

  const addCell = (index: number): void => {
    if (!Number.isInteger(index) || index < 0 || index >= cellCount) return;
    if (memory.discovered.has(index)) return;
    memory.discovered.add(index);
    addedCells.push(index);
  };

  if (Array.isArray(update.snapshotRuns) && !memory.all) {
    for (const index of decodeChartRuns(update.snapshotRuns, cellCount)) addCell(index);
  }
  if (Array.isArray(update.cells)) {
    for (const index of update.cells) addCell(index);
  }
  const allChanged = update.all === true && !memory.all;
  if (update.all === true) memory.all = true;

  if (Array.isArray(update.blocks)) {
    for (const block of update.blocks) {
      if (
        !block ||
        typeof block.id !== "string" ||
        !Number.isFinite(block.x) ||
        !Number.isFinite(block.y) ||
        !Number.isFinite(block.km) ||
        !Array.isArray(block.fill) ||
        !Array.isArray(block.coast)
      ) continue;
      const existing = memory.blocks.get(block.id);
      memory.blocks.set(block.id, block);
      if (existing !== block) changedBlocks.push(block.id);
    }
  }

  return {
    changed: addedCells.length > 0 || changedBlocks.length > 0 || allChanged,
    addedCells,
    changedBlocks,
  };
}

export interface ChartContent {
  all: boolean;
  /** Sorted discovered cell indexes; empty when the whole chart is known. */
  cells: number[];
  /** Block geometry sorted by id, independent of arrival order. */
  blocks: ChartBlock[];
}

/** The entire paint input, as a deterministic pure function of the store. */
export function chartContent(memory: ChartMemory): ChartContent {
  return {
    all: memory.all,
    cells: memory.all ? [] : [...memory.discovered].sort((a, b) => a - b),
    blocks: orderedChartBlocks(memory.blocks).map((block) => ({
      id: block.id,
      x: block.x,
      y: block.y,
      km: block.km,
      fill: block.fill,
      coast: block.coast,
    })),
  };
}

export type ChartRenderLayerName = "paper" | "sea" | "land" | "water" | "coast";

export interface ChartRenderLayer {
  name: ChartRenderLayerName;
  visible: boolean;
  alpha: number;
  items: number;
}

export interface ChartRenderPlan {
  layers: ChartRenderLayer[];
  /** Discovered cells putting pale sea wash on the chart. */
  seaCells: number;
  /** Blocks touched by a discovered cell, even when they have no land. */
  seaBlocks: string[];
  landBlocks: string[];
  coastBlocks: string[];
  /** True while the server still has private blocks queued for this client. */
  charting: boolean;
}

/**
 * A pure paint plan for the remembered chart. The client turns these layers
 * into its cached image; tests can prove the discovered sea is never omitted.
 */
export function buildChartRenderPlan(
  memory: ChartMemory,
  remainingBlocks = 0,
): ChartRenderPlan {
  const seaBlocks = new Set<string>();
  if (!memory.all) {
    for (const cell of memory.discovered) seaBlocks.add(blockIdForCell(cell));
  }

  const landBlocks: string[] = [];
  const coastBlocks: string[] = [];
  for (const block of orderedChartBlocks(memory.blocks)) {
    if (block.fill.length > 0) landBlocks.push(block.id);
    if (block.coast.length > 0) coastBlocks.push(block.id);
  }

  const seaCount = memory.all ? chartColumns * chartRows : memory.discovered.size;
  const seaIds = [...seaBlocks].sort();
  return {
    seaCells: seaCount,
    seaBlocks: seaIds,
    landBlocks,
    coastBlocks,
    charting: remainingBlocks > 0,
    layers: [
      { name: "paper", visible: true, alpha: 1, items: 1 },
      { name: "sea", visible: seaCount > 0, alpha: 1, items: seaCount },
      {
        name: "land",
        visible: seaCount > 0 && landBlocks.length > 0,
        alpha: 1,
        items: landBlocks.length,
      },
      {
        name: "water",
        visible: seaCount > 0 && coastBlocks.length > 0,
        alpha: 1,
        items: coastBlocks.length,
      },
      {
        name: "coast",
        visible: seaCount > 0 && coastBlocks.length > 0,
        alpha: 1,
        items: coastBlocks.length,
      },
    ],
  };
}

export interface ChartRepaintInput {
  initialized: boolean;
  dirtyBlockIds: readonly string[];
  now: number;
  lastPaintAt: number;
  throttleMs: number;
}

export interface ChartRepaintPlan {
  paint: boolean;
  /** Paint the paper base before the dirty blocks. */
  base: boolean;
  blockIds: string[];
}

/**
 * Decide whether a chart texture repaint may run now. Dirty ids are never
 * consumed here, so a throttled repaint is always offered again later.
 */
export function nextChartRepaint(input: ChartRepaintInput): ChartRepaintPlan {
  const ids = [...new Set(input.dirtyBlockIds)].sort();
  if (!input.initialized) return { paint: true, base: true, blockIds: ids };
  if (ids.length === 0) return { paint: false, base: false, blockIds: [] };
  if (input.now - input.lastPaintAt < input.throttleMs) {
    return { paint: false, base: false, blockIds: [] };
  }
  return { paint: true, base: false, blockIds: ids };
}
