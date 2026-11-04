// Browser-free port presentation. The ship view, chart and tests all use this
// layout, so discovered-only markers, zoom labels and panel buttons agree.

import { settings } from "./settings.js";
import type { PortSize } from "./data/ports.js";
import type { GoodId } from "./data/goods.js";

export interface PortInfo {
  id: string;
  name: string;
  size: PortSize;
  npc: boolean;
  x: number;
  y: number;
  region: string;
  good: string;
  /** Guards the hidden-until-discovered rule at the layout boundary. */
  found?: boolean;
  /** Present only when one of this player's ships is docked there. */
  freePlaces?: number;
  /** True when this player may open the shipyard here. */
  buyable?: boolean;
  /** Sailors currently in the shared pool. */
  crewAvailable?: number;
  /** Posted prices, only when this player may know them. */
  prices?: Partial<Record<GoodId, number>>;
  /** Usable port storage, all goods together. */
  storage?: Partial<Record<GoodId, number>>;
  storageLimit?: number;
  /** NPC resources for sale, only while docked there. */
  npcStock?: Partial<Record<GoodId, number>>;
}

export interface PortViewport {
  x: number;
  y: number;
  kmAcross: number;
}

export interface PortSight {
  x: number;
  y: number;
  radiusKm: number;
}

export interface PortLabelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PortMarkerPlan {
  id: string;
  name: string;
  size: PortSize;
  screenX: number;
  screenY: number;
  radiusPx: number;
  hitRadiusPx: number;
  insideSight: boolean;
  dimmed: boolean;
  labelVisible: boolean;
  labelX: number;
  labelY: number;
  labelBounds: PortLabelBounds | null;
}

export interface PortLayoutInput {
  width: number;
  height: number;
  view: PortViewport;
  /** Only found ports belong here. */
  ports: readonly PortInfo[];
  sight: readonly PortSight[];
}

function overlaps(a: PortLabelBounds, b: PortLabelBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function labelAllowed(size: PortSize, kmAcross: number): boolean {
  if (size === "L") return true;
  if (size === "M") return kmAcross <= settings.view.mediumPortLabelMaxKm;
  return kmAcross <= settings.view.smallPortLabelMaxKm;
}

function sizeRank(size: PortSize): number {
  return size === "L" ? 0 : size === "M" ? 1 : 2;
}

/** Screen positions and readable, non-overlapping labels for found ports. */
export function layoutPortMarkers(input: PortLayoutInput): PortMarkerPlan[] {
  const scale = Math.min(input.width, input.height) / input.view.kmAcross;
  const screenX = (x: number): number =>
    input.width / 2 + (x - input.view.x) * scale;
  const screenY = (y: number): number =>
    input.height / 2 + (y - input.view.y) * scale;
  const font = settings.view.portLabelFontPx;
  const labelHeight = font + 4;
  const markers: PortMarkerPlan[] = [];

  for (const port of input.ports) {
    if (port.found === false) continue;
    const x = screenX(port.x);
    const y = screenY(port.y);
    const radiusPx = settings.view.portMarkerRadiusPx[port.size];
    const hitRadiusPx = radiusPx + settings.view.portMarkerHitPadPx;
    if (
      x < -hitRadiusPx ||
      x > input.width + hitRadiusPx ||
      y < -hitRadiusPx ||
      y > input.height + hitRadiusPx
    ) {
      continue;
    }

    const insideSight = input.sight.some(
      (sight) =>
        (port.x - sight.x) ** 2 + (port.y - sight.y) ** 2 <= sight.radiusKm ** 2,
    );

    markers.push({
      id: port.id,
      name: port.name,
      size: port.size,
      screenX: x,
      screenY: y,
      radiusPx,
      hitRadiusPx,
      insideSight,
      dimmed: !insideSight,
      labelVisible: false,
      labelX: x,
      labelY: y,
      labelBounds: null,
    });
  }

  // Large ports get first choice of label space, then medium, then small.
  const byId = new Map(markers.map((marker) => [marker.id, marker]));
  const ordered = [...markers].sort(
    (a, b) => sizeRank(a.size) - sizeRank(b.size) || (a.name < b.name ? -1 : 1),
  );
  const placed: PortLabelBounds[] = [];

  for (const marker of ordered) {
    if (!labelAllowed(marker.size, input.view.kmAcross)) continue;
    const width = Math.max(26, marker.name.length * font * 0.54 + 4);
    const gap = marker.radiusPx + 4;
    const candidates: PortLabelBounds[] = [
      { x: marker.screenX + gap, y: marker.screenY - labelHeight / 2, width, height: labelHeight },
      { x: marker.screenX - gap - width, y: marker.screenY - labelHeight / 2, width, height: labelHeight },
      { x: marker.screenX - width / 2, y: marker.screenY - gap - labelHeight, width, height: labelHeight },
      { x: marker.screenX - width / 2, y: marker.screenY + gap, width, height: labelHeight },
    ];

    const chosen = candidates.find(
      (candidate) =>
        candidate.x >= 2 &&
        candidate.y >= 2 &&
        candidate.x + candidate.width <= input.width - 2 &&
        candidate.y + candidate.height <= input.height - 2 &&
        placed.every((other) => !overlaps(candidate, other)),
    );
    if (!chosen) continue;

    marker.labelVisible = true;
    marker.labelX = chosen.x;
    marker.labelY = chosen.y;
    marker.labelBounds = chosen;
    placed.push(chosen);
  }

  // Keep marker order stable for painting and hit testing.
  for (const marker of markers) {
    byId.set(marker.id, marker);
  }
  return markers;
}

/** Found ports nearest to a ship, for the chart's Known ports list. */
export function knownPortsNearest(
  ports: readonly PortInfo[],
  from: { x: number; y: number } | null,
): PortInfo[] {
  if (!from) return [];
  return [...ports]
    .map((port) => ({
      port,
      distance: Math.hypot(port.x - from.x, port.y - from.y),
    }))
    .sort((a, b) => a.distance - b.distance || (a.port.name < b.port.name ? -1 : 1))
    .map((entry) => entry.port);
}

export type PortPanelButton = "sail" | "undock" | "trade" | "shipyard" | "hire";

export interface PortPanelModel {
  title: string;
  sizeLabel: string;
  status: string;
  region: string;
  good: string;
  capacityText: string;
  freeText: string | null;
  distanceText: string;
  buttons: PortPanelButton[];
}

/** Text and actions for the paper panel. Hidden free places stay out. */
export function buildPortPanelModel(input: {
  port: PortInfo;
  distanceKm: number | null;
  dockedHere: boolean;
  hasShip: boolean;
  canBuy?: boolean;
  canTrade?: boolean;
  hasDockedShip?: boolean;
}): PortPanelModel {
  const { port } = input;
  const capacity = settings.ports.sizes[port.size].dockingCapacity;
  const sizeLabel = port.size === "S" ? "Small port" : port.size === "M" ? "Medium port" : "Large port";
  const buttons: PortPanelButton[] = [];
  if (input.hasShip) buttons.push(input.dockedHere ? "undock" : "sail");
  if (input.canTrade) buttons.push("trade");
  if (input.canBuy ?? port.buyable) buttons.push("shipyard");
  if (input.hasDockedShip) buttons.push("hire");

  let freeText: string | null = null;
  if (input.dockedHere && port.freePlaces !== undefined) {
    const free = Math.max(0, port.freePlaces);
    freeText = `${free} ${free === 1 ? "place" : "places"} free of ${capacity}`;
  }

  return {
    title: port.name,
    sizeLabel,
    status: port.npc ? "Neutral port: anyone may dock" : "Unclaimed",
    region: port.region,
    good: port.good,
    capacityText: `${capacity} docking places`,
    freeText,
    distanceText:
      input.distanceKm === null ? "Distance unknown" : `${Math.round(input.distanceKm)} km from your ship`,
    buttons,
  };
}
