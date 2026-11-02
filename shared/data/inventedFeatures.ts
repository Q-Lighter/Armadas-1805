// Empty extension point for invented land, such as the Phantom's island.
//
// The map is built from Natural Earth only, and nothing here is drawn by hand.
// Later phases can add invented features to this list; `npm run build-map`
// merges them into the drawing tiles and the server land lookup exactly like
// real coast. Rings are in map kilometres (x east, y south), with the outer
// ring first and any holes after it.

import type { MapPoint } from "../map.js";

export interface InventedFeature {
  /** A name for credits and debugging. */
  name: string;
  /** One or more polygons. The first ring is land, later rings are holes. */
  polygons: MapPoint[][][];
}

/** No invented features yet. */
export const inventedFeatures: InventedFeature[] = [];
