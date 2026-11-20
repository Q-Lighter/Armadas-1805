// Pure chart camera helpers for the Sailor's Log chart. They keep the whole
// paper inside the pane and put every discovered block in view on demand.

export interface ChartViewport {
  x: number;
  y: number;
  kmAcross: number;
}

export interface ChartFit {
  x: number;
  y: number;
  kmAcross: number;
}

/** Fit the discovered cells, with a little paper margin around them. */
export function fitDiscoveredChart(
  discovered: ReadonlySet<number>,
  columns: number,
  rows: number,
  cellKm: number,
  paneWidth: number,
  paneHeight: number,
  margin = 1.12,
): ChartFit | null {
  if (discovered.size === 0 || columns <= 0 || rows <= 0 || paneWidth <= 0 || paneHeight <= 0) {
    return null;
  }
  let minColumn = Infinity;
  let maxColumn = -1;
  let minRow = Infinity;
  let maxRow = -1;
  for (const index of discovered) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
    minColumn = Math.min(minColumn, column);
    maxColumn = Math.max(maxColumn, column);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }
  if (!Number.isFinite(minColumn) || maxColumn < 0) return null;
  const widthKm = (maxColumn - minColumn + 1) * cellKm;
  const heightKm = (maxRow - minRow + 1) * cellKm;
  const aspect = paneHeight / paneWidth;
  return {
    x: (minColumn + (maxColumn - minColumn + 1) / 2) * cellKm,
    y: (minRow + (maxRow - minRow + 1) / 2) * cellKm,
    kmAcross: Math.max(widthKm, heightKm / aspect) * margin,
  };
}

/** Keep the view over the paper, even when the pane is wider than the map. */
export function clampChartView(
  view: ChartViewport,
  mapWidthKm: number,
  mapHeightKm: number,
  paneWidth: number,
  paneHeight: number,
  minKmAcross: number,
): ChartViewport {
  const kmAcross = Math.max(minKmAcross, view.kmAcross);
  const halfWidth = kmAcross / 2;
  const halfHeight = (kmAcross * paneHeight) / Math.max(1, paneWidth) / 2;
  const clampAxis = (value: number, half: number, size: number): number => {
    if (half * 2 >= size) return size / 2;
    return Math.min(size - half, Math.max(half, value));
  };
  return {
    x: clampAxis(view.x, halfWidth, mapWidthKm),
    y: clampAxis(view.y, halfHeight, mapHeightKm),
    kmAcross,
  };
}
