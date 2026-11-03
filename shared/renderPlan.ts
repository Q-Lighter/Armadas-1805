// A browser-free description of the ship-view paint layers. The actual Pixi
// objects use the same order and settings; tests can then catch a missing,
// transparent or misordered layer without a graphics context.

import {
  chartCellKm,
  chartColumns,
  chartRows,
  type ChartBlock,
} from "./fog.js";
import { settings } from "./settings.js";

export type RenderLayerName =
  | "paper"
  | "dimSea"
  | "dimLand"
  | "dimWater"
  | "dimCoast"
  | "liveSea"
  | "liveLand"
  | "liveWater"
  | "liveCoast"
  | "ships"
  | "weather";

export interface RenderBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderLayer {
  name: RenderLayerName;
  visible: boolean;
  alpha: number;
  bounds: RenderBounds | null;
  /** The live sight mask's extent; dim layers need no mask. */
  mask: RenderBounds | null;
  items: number;
}

export interface ShipRenderPlanInput {
  width: number;
  height: number;
  view: { x: number; y: number; kmAcross: number };
  blocks: readonly ChartBlock[];
  all: boolean;
  discovered: ReadonlySet<number>;
  sight: readonly { x: number; y: number; radiusKm: number }[];
  ships: readonly { x: number; y: number }[];
}

export interface ShipRenderPlan {
  layers: RenderLayer[];
  activeBlocks: number;
}

function union(a: RenderBounds | null, b: RenderBounds): RenderBounds {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function intersect(a: RenderBounds, b: RenderBounds): RenderBounds | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function overlaps(a: RenderBounds, b: RenderBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function layer(
  name: RenderLayerName,
  visible: boolean,
  bounds: RenderBounds | null,
  items: number,
  mask: RenderBounds | null = null,
): RenderLayer {
  return { name, visible, alpha: 1, bounds: visible ? bounds : null, mask, items };
}

export function buildShipRenderPlan(input: ShipRenderPlanInput): ShipRenderPlan {
  const screen: RenderBounds = {
    x: 0,
    y: 0,
    width: input.width,
    height: input.height,
  };
  const scale = Math.min(input.width, input.height) / input.view.kmAcross;
  const toScreen = (x: number, y: number): { x: number; y: number } => ({
    x: input.width / 2 + (x - input.view.x) * scale,
    y: input.height / 2 + (y - input.view.y) * scale,
  });
  const blockBounds = (block: ChartBlock): RenderBounds => {
    const topLeft = toScreen(block.x, block.y);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: block.km * scale,
      height: block.km * scale,
    };
  };

  // The client draws blocks in the screen plus a margin. Keep this list in the
  // plan so the test sees the same subset the paint pass uses.
  const margin = settings.view.blockMarginScreens;
  const screenWithMargin: RenderBounds = {
    x: -input.width * margin,
    y: -input.height * margin,
    width: input.width * (1 + margin * 2),
    height: input.height * (1 + margin * 2),
  };
  let active = input.blocks.filter((block) =>
    overlaps(blockBounds(block), screenWithMargin),
  );
  if (active.length > settings.view.maxLiveBlockGraphics) {
    const centre = toScreen(input.view.x, input.view.y);
    active = [...active]
      .sort((a, b) => {
        const aa = blockBounds(a);
        const bb = blockBounds(b);
        const da = Math.hypot(aa.x + aa.width / 2 - centre.x, aa.y + aa.height / 2 - centre.y);
        const db = Math.hypot(bb.x + bb.width / 2 - centre.x, bb.y + bb.height / 2 - centre.y);
        return da - db || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      })
      .slice(0, settings.view.maxLiveBlockGraphics);
  }

  let dimSea: RenderBounds | null = null;
  let dimSeaItems = 0;
  if (input.all) {
    dimSea = { ...screen };
    dimSeaItems = chartColumns * chartRows;
  } else {
    for (const index of input.discovered) {
      const column = index % chartColumns;
      const row = Math.floor(index / chartColumns);
      if (column < 0 || column >= chartColumns || row < 0 || row >= chartRows) continue;
      const topLeft = toScreen(column * chartCellKm, row * chartCellKm);
      const cell = {
        x: topLeft.x,
        y: topLeft.y,
        width: chartCellKm * scale,
        height: chartCellKm * scale,
      };
      const visible = intersect(cell, screen);
      if (visible) {
        dimSea = union(dimSea, visible);
        dimSeaItems += 1;
      }
    }
  }

  let dimLand: RenderBounds | null = null;
  let dimCoast: RenderBounds | null = null;
  let landItems = 0;
  let coastItems = 0;
  for (const block of active) {
    const bounds = blockBounds(block);
    if (block.fill.length > 0) {
      const visible = intersect(bounds, screen);
      if (visible) {
        dimLand = union(dimLand, visible);
        landItems += 1;
      }
    }
    if (block.coast.length > 0) {
      const visible = intersect(bounds, screen);
      if (visible) {
        dimCoast = union(dimCoast, visible);
        coastItems += 1;
      }
    }
  }

  let sightExtent: RenderBounds | null = null;
  for (const sight of input.sight) {
    const centre = toScreen(sight.x, sight.y);
    const radius = sight.radiusKm * scale;
    sightExtent = union(sightExtent, {
      x: centre.x - radius,
      y: centre.y - radius,
      width: radius * 2,
      height: radius * 2,
    });
  }

  let liveLand: RenderBounds | null = null;
  let liveCoast: RenderBounds | null = null;
  let liveLandItems = 0;
  let liveCoastItems = 0;
  if (sightExtent) {
    for (const block of active) {
      const bounds = blockBounds(block);
      if (!overlaps(bounds, sightExtent)) continue;
      if (block.fill.length > 0) {
        const clipped = intersect(union(liveLand ?? bounds, bounds), sightExtent);
        if (clipped) {
          liveLand = clipped;
          liveLandItems += 1;
        }
      }
      if (block.coast.length > 0) {
        const clipped = intersect(union(liveCoast ?? bounds, bounds), sightExtent);
        if (clipped) {
          liveCoast = clipped;
          liveCoastItems += 1;
        }
      }
    }
  }

  let shipBounds: RenderBounds | null = null;
  let shipItems = 0;
  for (const ship of input.ships) {
    const point = toScreen(ship.x, ship.y);
    const hull = { x: point.x - 20, y: point.y - 20, width: 40, height: 40 };
    if (intersect(hull, screen)) {
      shipBounds = union(shipBounds, hull);
      shipItems += 1;
    }
  }

  const liveVisible = sightExtent !== null && sightExtent.width > 0 && sightExtent.height > 0;
  return {
    activeBlocks: active.length,
    layers: [
      layer("paper", true, screen, 1),
      layer("dimSea", dimSea !== null, dimSea, dimSeaItems),
      layer("dimLand", dimLand !== null, dimLand, landItems),
      layer("dimWater", dimCoast !== null, dimCoast, coastItems),
      layer("dimCoast", dimCoast !== null, dimCoast, coastItems),
      layer("liveSea", liveVisible, sightExtent, liveVisible ? 1 : 0, sightExtent),
      layer("liveLand", liveVisible && liveLand !== null, liveLand, liveLandItems, sightExtent),
      layer("liveWater", liveVisible && liveCoast !== null, liveCoast, liveCoastItems, sightExtent),
      layer("liveCoast", liveVisible && liveCoast !== null, liveCoast, liveCoastItems, sightExtent),
      layer("ships", shipBounds !== null, shipBounds, shipItems),
      layer("weather", true, screen, settings.view.windStreakCount),
    ],
  };
}
