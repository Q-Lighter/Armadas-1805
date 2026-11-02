// The chart frame. Plain TypeScript: no browser code and no server code.
//
// The map is flat, at half real-life scale. x grows east and y grows south,
// both in map kilometres. A degree of longitude is 52.93 map km and a degree
// of latitude is 55.3 map km, so the whole chart is about 3,811 km wide and
// 5,641 km tall.

import { settings } from "./settings.js";

const frame = settings.map.frame;

/** Width of the whole chart, in map kilometres. */
export const MAP_WIDTH_KM =
  (frame.lonMaxDeg - frame.lonMinDeg) * settings.map.kmPerLonDegree;

/** Height of the whole chart, in map kilometres. */
export const MAP_HEIGHT_KM =
  (frame.latMaxDeg - frame.latMinDeg) * settings.map.kmPerLatDegree;

export interface MapPoint {
  x: number;
  y: number;
}

export interface LonLat {
  lonDeg: number;
  latDeg: number;
}

/** Longitude and latitude to map kilometres. */
export function lonLatToMap(lonDeg: number, latDeg: number): MapPoint {
  return {
    x: (lonDeg - frame.lonMinDeg) * settings.map.kmPerLonDegree,
    y: (frame.latMaxDeg - latDeg) * settings.map.kmPerLatDegree,
  };
}

/** Map kilometres back to longitude and latitude. */
export function mapToLonLat(xKm: number, yKm: number): LonLat {
  return {
    lonDeg: frame.lonMinDeg + xKm / settings.map.kmPerLonDegree,
    latDeg: frame.latMaxDeg - yKm / settings.map.kmPerLatDegree,
  };
}

/** True when a map point lies inside the chart frame. */
export function isInsideMapFrame(xKm: number, yKm: number): boolean {
  return xKm >= 0 && xKm <= MAP_WIDTH_KM && yKm >= 0 && yKm <= MAP_HEIGHT_KM;
}
