// The discovered-sea wash is one screen-sized paint with one alpha value,
// clipped by a mask. Painting each cell separately with transparency made a
// faint grid where cell edges overlapped.
//
// This pure plan is shared with the tests; the client only turns the plan into
// Pixi rectangles.

import { chartColumns } from "./fog.js";
import { settings } from "./settings.js";

export interface CellRange {
  firstColumn: number;
  lastColumn: number;
  firstRow: number;
  lastRow: number;
}

export interface FogRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FogPaintPlan {
  /** One opaque paper rectangle, or null in chart mode. */
  paper: FogRect | null;
  /** One alpha for the whole discovered layer. */
  seaAlpha: number | null;
  /** Opaque mask cells. They may touch but never need an overlap. */
  mask: FogRect[];
}

export function fogPaintPlan(
  width: number,
  height: number,
  chartMode: boolean,
  all: boolean,
  discovered: ReadonlySet<number>,
  range: CellRange,
  cellRect: (column: number, row: number) => FogRect,
): FogPaintPlan {
  if (chartMode || width <= 0 || height <= 0) {
    return { paper: null, seaAlpha: null, mask: [] };
  }

  const paper = { x: 0, y: 0, width, height };
  const seaAlpha = settings.view.fogDimAlpha + 0.22;
  if (all) {
    return { paper, seaAlpha, mask: [paper] };
  }

  const mask: FogRect[] = [];
  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
      if (discovered.has(row * chartColumns + column)) {
        mask.push(cellRect(column, row));
      }
    }
  }

  return { paper, seaAlpha, mask };
}
