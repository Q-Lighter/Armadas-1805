// Fog of war and the per-player chart.
//
// Discovery is remembered on a small grid (five kilometres by default). The
// server sends only newly discovered cells and the map blocks they touch. A
// block is a private piece of geometry; it is never put in the public page.
//
// All of this is plain TypeScript so the server and tests share it.

import { settings } from "./settings.js";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM } from "./map.js";

export type RoomKind = "normal" | "test" | "dev";

export function roomKindForCode(roomCode: string): RoomKind {
  if (roomCode.startsWith("dev-")) return "dev";
  if (roomCode.startsWith("test")) return "test";
  return "normal";
}

export const chartCellKm = settings.fog.discoveryCellKm;
export const chartBlockKm = settings.fog.chartBlockKm;

export const chartColumns = Math.ceil(MAP_WIDTH_KM / chartCellKm);
export const chartRows = Math.ceil(MAP_HEIGHT_KM / chartCellKm);
export const blockColumns = Math.ceil(MAP_WIDTH_KM / chartBlockKm);
export const blockRows = Math.ceil(MAP_HEIGHT_KM / chartBlockKm);

const cellsPerBlock = Math.round(chartBlockKm / chartCellKm);

/** A small piece of private land geometry, in map kilometres. */
export interface ChartBlock {
  id: string;
  x: number;
  y: number;
  km: number;
  fill: number[][];
  coast: number[][];
}

export interface SeenShip {
  classId: string;
  navy: string;
  x: number;
  y: number;
  atGameSeconds: number;
}

export interface ChartState {
  /** One bit per discovery cell, row by row. */
  bits: Uint8Array;
  /** Cells discovered since the last state message. */
  pendingCells: number[];
  /** Blocks touched by discovered ground but not sent yet. */
  pendingBlocks: Set<string>;
  /** Blocks already sent, so geometry is never repeated. */
  sentBlocks: Set<string>;
  /** Dev rooms start with the whole chart discovered. */
  all: boolean;
  /** Foreign ships this player has seen, including ones now out of sight. */
  seen: Map<string, SeenShip>;
  /** Ports this player has found. Never sent anywhere before discovery. */
  foundPorts: Set<string>;
  /** Last visible combat event delivered to this player. */
  combatCursor?: number;
  /** Per-ship visible fire-effect budget for the current second. */
  fireBudget?: Map<string, { second: number; count: number }>;
  /** A new socket must receive the whole record before normal changes. */
  resume?: boolean;
}

export interface ChartUpdate {
  /** Cells discovered since the last update. Empty on a resumed record. */
  cells: number[];
  blocks: ChartBlock[];
  all: boolean;
  /**
   * Alternating zero/one run lengths for the whole discovery grid. Present
   * when a new socket attaches, so a refreshed page can rebuild its chart.
   */
  snapshotRuns?: number[];
  /** Private blocks still queued after this batch. */
  remaining: number;
}

export function blockIdAt(xKm: number, yKm: number): string {
  const column = Math.max(0, Math.min(blockColumns - 1, Math.floor(xKm / chartBlockKm)));
  const row = Math.max(0, Math.min(blockRows - 1, Math.floor(yKm / chartBlockKm)));
  return `${column}_${row}`;
}

export function blockIdForCell(index: number): string {
  const column = index % chartColumns;
  const row = Math.floor(index / chartColumns);
  return `${Math.floor(column / cellsPerBlock)}_${Math.floor(row / cellsPerBlock)}`;
}

export function createChart(kind: RoomKind): ChartState {
  const chart: ChartState = {
    bits: new Uint8Array(Math.ceil((chartColumns * chartRows) / 8)),
    pendingCells: [],
    pendingBlocks: new Set(),
    sentBlocks: new Set(),
    all: kind === "dev",
    seen: new Map(),
    foundPorts: new Set(),
    combatCursor: 0,
    resume: false,
  };

  if (kind === "dev") {
    // The debug room is fully explored. Mark every block as pending; the
    // server will attach geometry in small batches.
    for (let row = 0; row < blockRows; row += 1) {
      for (let column = 0; column < blockColumns; column += 1) {
        chart.pendingBlocks.add(`${column}_${row}`);
      }
    }
  }

  return chart;
}

export function isCellDiscovered(chart: ChartState, xKm: number, yKm: number): boolean {
  if (chart.all) return true;
  const column = Math.floor(xKm / chartCellKm);
  const row = Math.floor(yKm / chartCellKm);
  if (column < 0 || column >= chartColumns || row < 0 || row >= chartRows) return false;
  const index = row * chartColumns + column;
  return (chart.bits[index >> 3]! & (1 << (index & 7))) !== 0;
}

/** Mark covered cells around a sight circle, queueing only new ground. */
export function revealCircle(
  chart: ChartState,
  centreX: number,
  centreY: number,
  radiusKm = settings.fog.sightRangeKm,
): void {
  if (chart.all) return;

  const radiusSq = radiusKm * radiusKm;
  const firstColumn = Math.max(0, Math.floor((centreX - radiusKm) / chartCellKm));
  const lastColumn = Math.min(
    chartColumns - 1,
    Math.floor((centreX + radiusKm) / chartCellKm),
  );
  const firstRow = Math.max(0, Math.floor((centreY - radiusKm) / chartCellKm));
  const lastRow = Math.min(chartRows - 1, Math.floor((centreY + radiusKm) / chartCellKm));

  for (let row = firstRow; row <= lastRow; row += 1) {
    const cellY = (row + 0.5) * chartCellKm;
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cellX = (column + 0.5) * chartCellKm;
      if ((cellX - centreX) ** 2 + (cellY - centreY) ** 2 > radiusSq) continue;

      const index = row * chartColumns + column;
      const byte = index >> 3;
      const bit = 1 << (index & 7);
      if ((chart.bits[byte]! & bit) !== 0) continue;

      chart.bits[byte]! |= bit;
      chart.pendingCells.push(index);
      chart.pendingBlocks.add(blockIdForCell(index));
    }
  }
}

/**
 * Encode the discovered bits as alternating zero/one run lengths. This is the
 * compact record sent when a page attaches. A fully explored dev chart uses
 * the `all` flag instead of a run list.
 */
export function encodeChartRuns(chart: ChartState): number[] {
  if (chart.all) return [];
  const cellCount = chartColumns * chartRows;
  const runs: number[] = [];
  let value = 0;
  let run = 0;
  for (let index = 0; index < cellCount; index += 1) {
    const bit = (chart.bits[index >> 3]! & (1 << (index & 7))) !== 0 ? 1 : 0;
    if (bit !== value) {
      runs.push(run);
      value = bit;
      run = 0;
    }
    run += 1;
  }
  if (run > 0 && value === 1) runs.push(run);
  return runs;
}

/** Decode the compact discovery record defensively. */
export function decodeChartRuns(
  runs: readonly number[],
  cellCount: number = chartColumns * chartRows,
): Set<number> {
  const cells = new Set<number>();
  let index = 0;
  let value = false;
  for (const raw of runs) {
    const run = Math.floor(raw);
    if (!Number.isFinite(run) || run < 0) break;
    if (value) {
      const end = Math.min(cellCount, index + run);
      for (let cell = index; cell < end; cell += 1) cells.add(cell);
    }
    index += run;
    value = !value;
    if (index >= cellCount) break;
  }
  return cells;
}

/** Queue the full discovered record for the next state sent to this player. */
export function requestChartResume(chart: ChartState): void {
  chart.resume = true;
}

/** Add the block ids touched by every discovered cell to the send queue. */
function queueAllDiscoveredBlocks(chart: ChartState): void {
  chart.pendingBlocks.clear();
  if (chart.all) {
    for (let row = 0; row < blockRows; row += 1) {
      for (let column = 0; column < blockColumns; column += 1) {
        chart.pendingBlocks.add(`${column}_${row}`);
      }
    }
    return;
  }

  const cellCount = chartColumns * chartRows;
  for (let index = 0; index < cellCount; index += 1) {
    if ((chart.bits[index >> 3]! & (1 << (index & 7))) !== 0) {
      chart.pendingBlocks.add(blockIdForCell(index));
    }
  }
}

/** Move queued chart data into a websocket message. */
export function takeChartUpdate(
  chart: ChartState,
  blocks: ReadonlyMap<string, ChartBlock> | undefined,
  maxBlocks: number = settings.fog.maxBlocksPerMessage,
  near?: { x: number; y: number },
): ChartUpdate {
  let snapshotRuns: number[] | undefined;
  if (chart.resume) {
    chart.resume = false;
    chart.pendingCells.length = 0;
    chart.sentBlocks.clear();
    queueAllDiscoveredBlocks(chart);
    if (!chart.all) snapshotRuns = encodeChartRuns(chart);
  }

  const cells = chart.pendingCells.splice(0, chart.pendingCells.length);
  const updateBlocks: ChartBlock[] = [];

  if (blocks && maxBlocks > 0) {
    const pending = [...chart.pendingBlocks].filter((id) => !chart.sentBlocks.has(id));
    if (near) {
      // A dev room starts (or resumes) with every block queued. Send the
      // blocks around the player first, so useful chart arrives first.
      pending.sort((a, b) => {
        const blockA = blocks.get(a);
        const blockB = blocks.get(b);
        const distanceA = blockA
          ? (blockA.x + blockA.km / 2 - near.x) ** 2 + (blockA.y + blockA.km / 2 - near.y) ** 2
          : Number.POSITIVE_INFINITY;
        const distanceB = blockB
          ? (blockB.x + blockB.km / 2 - near.x) ** 2 + (blockB.y + blockB.km / 2 - near.y) ** 2
          : Number.POSITIVE_INFINITY;
        return distanceA - distanceB || (a < b ? -1 : a > b ? 1 : 0);
      });
    } else {
      pending.sort();
    }

    for (const id of pending) {
      if (updateBlocks.length >= maxBlocks) break;
      const block = blocks.get(id);
      chart.pendingBlocks.delete(id);
      chart.sentBlocks.add(id);
      if (block) updateBlocks.push(block);
    }
  }

  return {
    cells,
    blocks: updateBlocks,
    all: chart.all,
    snapshotRuns,
    remaining: [...chart.pendingBlocks].filter((id) => !chart.sentBlocks.has(id)).length,
  };
}
