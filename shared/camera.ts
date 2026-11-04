// The one camera transform for the map, ports, ships, labels and routes.
// Screen positions are always derived from the same view state and size.

import type { MapPoint } from "./map.js";

export interface CameraView {
  x: number;
  y: number;
  kmAcross: number;
}

export function cameraScale(
  width: number,
  height: number,
  kmAcross: number,
): number {
  const span = Math.min(width, height);
  return kmAcross > 0 ? span / kmAcross : 0;
}

export function worldToScreen(
  point: MapPoint,
  view: CameraView,
  width: number,
  height: number,
): { x: number; y: number } {
  const scale = cameraScale(width, height, view.kmAcross);
  return {
    x: width / 2 + (point.x - view.x) * scale,
    y: height / 2 + (point.y - view.y) * scale,
  };
}

export function screenToWorld(
  x: number,
  y: number,
  view: CameraView,
  width: number,
  height: number,
): MapPoint {
  const scale = cameraScale(width, height, view.kmAcross);
  if (scale <= 0) return { x: view.x, y: view.y };
  return {
    x: view.x + (x - width / 2) / scale,
    y: view.y + (y - height / 2) / scale,
  };
}
