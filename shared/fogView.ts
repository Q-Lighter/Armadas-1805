// Small pure helpers for the fog view. Keeping these out of the Pixi code makes
// the paper-cover rule and the TEMP-DEBUG readout testable without a browser.

import {
  chartCellKm,
  chartColumns,
  chartRows,
  type RoomKind,
} from "./fog.js";
import { settings } from "./settings.js";

export interface SightCentre {
  x: number;
  y: number;
}

/** Values the temporary readout may show. Missing values are left out. */
export interface FogDebugInfo {
  buildCommit?: string;
  ships?: number;
  worldHz?: number;
  gapAvgMs?: number;
  gapMaxMs?: number;
  bytesAvg?: number;
  bytesMax?: number;
  receivedHz?: number;
  receivedGapMaxMs?: number;
}

/** How many cells the player knows, with dev rooms counting the whole chart. */
export function discoveredCellCount(
  all: boolean,
  discovered: ReadonlySet<number>,
): number {
  return all ? chartColumns * chartRows : discovered.size;
}

/** The short line shown in test and dev rooms only. */
export function fogDebugLine(
  kind: RoomKind,
  all: boolean,
  discovered: ReadonlySet<number>,
  blockCount: number,
  info: FogDebugInfo = {},
): string | null {
  if (kind === "normal") return null;

  const parts = [
    "TEMP-DEBUG",
    `room type ${kind}`,
    `${discoveredCellCount(all, discovered)} discovered cells`,
    `${blockCount} map blocks received`,
    `sight ${settings.fog.sightRangeKm} km`,
    `build ${(info.buildCommit ?? "unknown").slice(0, 12)}`,
  ];

  // The load-test counters are only meaningful in a dev room.
  if (kind === "dev") {
    if (info.ships !== undefined) parts.push(`${info.ships} ships`);
    if (info.worldHz !== undefined) parts.push(`${info.worldHz.toFixed(1)} world/s`);
    if (info.gapAvgMs !== undefined) parts.push(`gap avg ${Math.round(info.gapAvgMs)} ms`);
    if (info.gapMaxMs !== undefined) parts.push(`worst ${Math.round(info.gapMaxMs)} ms`);
    if (info.bytesAvg !== undefined) parts.push(`${Math.round(info.bytesAvg)} B/s avg/player`);
    if (info.bytesMax !== undefined) parts.push(`${Math.round(info.bytesMax)} B/s worst/player`);
    if (info.receivedHz !== undefined) parts.push(`${info.receivedHz.toFixed(1)} updates/s received`);
    if (info.receivedGapMaxMs !== undefined) {
      parts.push(`worst receive gap ${Math.round(info.receivedGapMaxMs)} ms`);
    }
  }

  return parts.join(" · ");
}

/** True when no part of a discovery cell is inside a live sight circle. */
export function cellIsOutsideSight(
  index: number,
  centres: readonly SightCentre[],
): boolean {
  const column = index % chartColumns;
  const row = Math.floor(index / chartColumns);
  const minX = column * chartCellKm;
  const maxX = minX + chartCellKm;
  const minY = row * chartCellKm;
  const maxY = minY + chartCellKm;
  const radiusSq = settings.fog.sightRangeKm ** 2;

  for (const centre of centres) {
    const nearestX = Math.max(minX, Math.min(maxX, centre.x));
    const nearestY = Math.max(minY, Math.min(maxY, centre.y));
    if ((nearestX - centre.x) ** 2 + (nearestY - centre.y) ** 2 <= radiusSq) {
      return false;
    }
  }
  return true;
}

/**
 * A cell needs its paper cover only when it has never been discovered. The
 * bright live layer is drawn above that paper, so sight circles never need a
 * cell-shaped hole in the cover.
 */
export function cellNeedsPaper(
  index: number,
  all: boolean,
  discovered: ReadonlySet<number>,
): boolean {
  return !all && !discovered.has(index);
}
