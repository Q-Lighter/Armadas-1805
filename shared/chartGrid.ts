// 3K-c: chart grid geometry and the scale ruler, kept pure so the projection
// and the discovered-ground rule are tested without a browser.

import { MAP_HEIGHT_KM, MAP_WIDTH_KM, lonLatToMap, mapToLonLat } from "./map.js";
import { settings } from "./settings.js";

export const GRID_STEPS_DEG = [10, 5, 2, 1, 0.5] as const;

/** The largest step that still gives at least two lines across the view. */
export function gridStepDegrees(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): number {
  const spanLon = Math.abs(xMax - xMin) / settings.map.kmPerLonDegree;
  const spanLat = Math.abs(yMax - yMin) / settings.map.kmPerLatDegree;
  const span = Math.max(spanLon, spanLat);
  // Aim for roughly a dozen lines across the pane, then snap to the agreed
  // 10 / 5 / 2 / 1 / 0.5 degree ladder.
  const target = span / 12;
  for (const step of [...GRID_STEPS_DEG].reverse()) {
    if (step >= target) return step;
  }
  return GRID_STEPS_DEG[0]!;
}

export interface GridSegment {
  /** Start and end along the line, in map kilometres. */
  from: number;
  to: number;
}

export interface ChartGridLine {
  axis: "lon" | "lat";
  /** Longitude or latitude of the line, in degrees. */
  deg: number;
  label: string;
  /** Map-kilometre position of the line on its perpendicular axis. */
  at: number;
  segments: GridSegment[];
}

function lonLabel(deg: number): string {
  return `${Math.abs(deg).toFixed(deg % 1 === 0 ? 0 : 1)}° ${deg < 0 ? "W" : "E"}`;
}

function latLabel(deg: number): string {
  return `${Math.abs(deg).toFixed(deg % 1 === 0 ? 0 : 1)}° ${deg < 0 ? "S" : "N"}`;
}

/**
 * Lines and labels only where the player has discovered ground. The world
 * edge therefore never appears through an undiscovered margin.
 */
export function chartGridLines(input: {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  isDiscovered: (xKm: number, yKm: number) => boolean;
  step?: number;
}): ChartGridLine[] {
  const xMin = Math.max(0, Math.min(MAP_WIDTH_KM, input.xMin));
  const xMax = Math.max(0, Math.min(MAP_WIDTH_KM, input.xMax));
  const yMin = Math.max(0, Math.min(MAP_HEIGHT_KM, input.yMin));
  const yMax = Math.max(0, Math.min(MAP_HEIGHT_KM, input.yMax));
  if (xMax <= xMin || yMax <= yMin) return [];
  const step = input.step ?? gridStepDegrees(xMin, xMax, yMin, yMax);
  const out: ChartGridLine[] = [];
  const cell = 5;

  const runs = (
    from: number,
    to: number,
    at: number,
    axis: "lon" | "lat",
  ): GridSegment[] => {
    const segments: GridSegment[] = [];
    let start: number | null = null;
    for (let value = from; value <= to; value += cell) {
      const x = axis === "lon" ? at : value;
      const y = axis === "lon" ? value : at;
      const found = input.isDiscovered(x, y);
      if (found && start === null) start = value;
      if (!found && start !== null) {
        segments.push({ from: start, to: value });
        start = null;
      }
    }
    if (start !== null) segments.push({ from: start, to });
    return segments;
  };

  const lonStart = Math.ceil(mapToLonLat(xMin, 0).lonDeg / step) * step;
  const lonEnd = mapToLonLat(xMax, 0).lonDeg;
  for (let lon = lonStart; lon <= lonEnd + 1e-9; lon += step) {
    const at = lonLatToMap(lon, 0).x;
    if (at < xMin || at > xMax) continue;
    const segments = runs(yMin, yMax, at, "lon");
    if (segments.length === 0) continue;
    out.push({ axis: "lon", deg: lon, label: lonLabel(lon), at, segments });
  }

  // Latitude falls as map y rises, so step up from the southern edge.
  const latStart = Math.floor(mapToLonLat(0, yMax).latDeg / step) * step;
  const latEnd = mapToLonLat(0, yMin).latDeg;
  for (let lat = latStart; lat <= latEnd + 1e-9; lat += step) {
    const at = lonLatToMap(0, lat).y;
    if (at < yMin || at > yMax) continue;
    const segments = runs(xMin, xMax, at, "lat");
    if (segments.length === 0) continue;
    out.push({ axis: "lat", deg: lat, label: latLabel(lat), at, segments });
  }
  return out;
}

/** True bearing from a to b, clockwise from north. */
export function bearingDegrees(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const deg = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export interface RulerResult {
  bearingDeg: number;
  distanceKm: number;
}

export function scaleRuler(
  a: { x: number; y: number },
  b: { x: number; y: number },
): RulerResult {
  return {
    bearingDeg: bearingDegrees(a, b),
    distanceKm: Math.hypot(b.x - a.x, b.y - a.y),
  };
}

/** A point on a fixed map rose; the chart itself never rotates. */
export function compassRose(): Array<{ label: string; deg: number }> {
  return [
    { label: "N", deg: 0 },
    { label: "E", deg: 90 },
    { label: "S", deg: 180 },
    { label: "W", deg: 270 },
  ];
}
