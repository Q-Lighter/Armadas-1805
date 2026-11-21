// Armada's 1805 browser client.
//
// The server owns the world and the private chart. This client only draws what
// visibleStateFor() sends: the ship view, the remembered chart, live sight
// circles and short-lived last-seen markers. It never predicts the world.

import { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture } from "pixi.js";
import { settings } from "@naval/shared/settings";
import { MotionTrack } from "@naval/shared/render-motion";
import {
  DataSaverGovernor,
  parseNetworkPreference,
  type NetworkPreference,
} from "@naval/shared/net-rate";
import {
  fireVisualPlan,
  galleryFrame,
  lightsRingPlan,
  type FireShape,
} from "@naval/shared/fire-visuals";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM, lonLatToMap } from "@naval/shared/map";
import { clampChartView, fitDiscoveredChart } from "@naval/shared/chart-view";
import {
  blockIdForCell,
  chartBlockKm,
  chartCellKm,
  chartColumns,
  chartRows,
  roomKindForCode,
  type ChartBlock,
  type RoomKind,
} from "@naval/shared/fog";
import {
  applyChartUpdate,
  buildChartRenderPlan,
  createChartMemory,
  nextChartRepaint,
} from "@naval/shared/chart-memory";
import {
  resolvePlayerIdentity,
  type PlayerIdentity,
  type StorageLike,
} from "@naval/shared/player-identity";
import { TAKEN_OVER_CLOSE_CODE } from "@naval/shared/player-sessions";
import { createAccountUi, type AccountApi, type AccountSession } from "./account.js";
import { createLobbyUi, type LobbyUiOptions } from "./lobby.js";
import { createSupabaseAccountApi, loadAccountConfig } from "./supabaseAccount.js";
import type {
  EscortSnapshot,
  FleetMemberSnapshot,
  FleetSnapshot,
  LastSeenSnapshot,
  NpcContactSnapshot,
  OrderLineSnapshot,
  ScenarioStatus,
  OwnShipSnapshot,
  ShipSnapshot,
  PortIncomeSnapshot,
  StateMessage,
  TradeRouteSnapshot,
} from "@naval/shared/world";
import type { FleetOrder } from "@naval/shared/fleet-orders";
import {
  FORMATION_OPTIONS,
  controlGroupSlotForKey,
  fleetMemberStateText,
  orderMenuItems,
  responsiveFleetLayout,
  selectedShipIdsInBox,
  stanceLabel,
  stanceOptionIds,
} from "@naval/shared/fleet-ui";
import { headingTarget } from "@naval/shared/fleet-orders";
import { formationSlots } from "@naval/shared/fleets";
import { orderedChartBlocks } from "@naval/shared/chart-draw";
import { chartTextureSize, planChartDetail } from "@naval/shared/chart-detail";
import {
  contextStripVisible,
  layoutElement,
  resolveLayoutMode,
  type LayoutModalId,
  type LayoutPanelId,
  type LayoutPreference,
  type LayoutState,
} from "@naval/shared/screen-layout";
import { buildBlockCommands, findChartSuspects } from "@naval/shared/chart-paint";
import { researchScreenView, shipUpgradeRows } from "@naval/shared/research-view";
import { isShipUpgrade, researchUpgrade } from "@naval/shared/research-data";
import { SCENARIOS, type ScenarioDefinition } from "@naval/shared/scenarios";
import { isLandAt } from "@naval/shared/land";
import { cameraScale, screenToWorld, worldToScreen } from "@naval/shared/camera";
import { buildDiscoveredOutline, type OutlineRing } from "@naval/shared/discovered-outline";
import { catmullRomPath, dotsAlongPath } from "@naval/shared/route-ink";
import { trailIdsForMode, type ChartTrailMode } from "@naval/shared/journey";
import { flagshipPennantVisible } from "@naval/shared/flagship-marker";
import {
  discoveredCellCount,
  fogDebugLine,
  type FogDebugInfo,
} from "@naval/shared/fog-view";
import { GRAPHICS_RESET_NOTICE, GraphicsRecovery } from "@naval/shared/graphics-safety";
import { runDrawLayer } from "@naval/shared/draw-layer";
import { applyStateDelta, decodeStateDelta, newestStateWithEvents } from "@naval/shared/state-delta";
import { DomThrottle } from "@naval/shared/dom-throttle";
import { selectVisibleEffects } from "@naval/shared/effect-budget";
import { REMOVED_3K_IDS, auditMeasuredSlots, fixedGameSlots, type MeasuredSlot, type SlotAuditIssue } from "@naval/shared/screen-3k";
import {
  CONTROL_HINTS,
  CONTROL_GROUP_NAMES,
  CONTROL_ORDERS,
  controlHintAt,
  controlOrdersInGroup,
  type ControlOrder,
} from "@naval/shared/controls-3j";
import { groupFleetMarkers } from "@naval/shared/fleet-markers";
import {
  qualityFeatures,
  qualityLevelForPreference,
  qualityPreference as parseQualityPreference,
  QualityGovernor,
  type QualityFeatures,
  type QualityLevel,
  type QualityPreference,
} from "@naval/shared/quality";
import { formatGameClock, gameClockAt, moonPhase } from "@naval/shared/time";
import { sightRangeKm, targetInSight } from "@naval/shared/sight";
import { bearingDegrees, chartGridLines, scaleRuler, type ChartGridLine } from "@naval/shared/chart-grid";
import { navyColorNumber, parseNavy, type NavyId } from "@naval/shared/navies";
import {
  inviteSecondDeviceLink,
  otherNavy,
  parseDummyBehaviour,
  testJoinQuery,
} from "@naval/shared/test-setup";
import {
  battleBarItems,
  battleBarVisible,
  surrenderOffer,
  whiteFlagVisible,
} from "@naval/shared/combat-ui";
import {
  eliminatedAssetsText,
  eliminatedByText,
  eliminatedTitle,
  resignRecipients,
  statsRows,
  victoryRows,
} from "@naval/shared/status-ui";
import {
  neutralHullStyle,
  neutralMarker,
  npcBattleActions,
  npcKindLabel,
  npcLootSheet,
  privateerSheet,
  escortSheet,
  escortStrip,
  type NpcKindId,
  type NpcModeId,
} from "@naval/shared/npc-ui";
import {
  abandonedMarkerSize,
  boardSheet,
  boardingProgress,
  capturedCrewSheet,
  crewQuickAmounts,
  crewTransferSheet,
  fireRow,
  prisonerHandoverRow,
} from "@naval/shared/crew-ui";
import {
  shipTypeFor,
  type BuyableShipClassId,
} from "@naval/shared/ships";
import {
  fireShipCardActions,
  fireShipStatusText,
  type FireShipActionId,
} from "@naval/shared/fire-ship-ui";
import { cleanShipName, suggestShipName } from "@naval/shared/ship-rules";
import {
  buildFleetRow,
  buildShipStoreBars,
  crewQuickTargets,
  crewQuote,
  fleetCountText,
  formatDuration,
  formatMoney,
  shipyardCards,
} from "@naval/shared/fleet-view";
import { formatCrew, formatKnots, formatWhole } from "@naval/shared/format";
import {
  buildBuyRows,
  buildSellRows,
  buildStorageRows,
  formatPrice,
  formatTonnes,
  formatTonnesWithUnit,
  freeSpaceText,
  priceBookRows,
  regionalGoodNote,
} from "@naval/shared/trade-view";
import {
  CARGO_GOOD_IDS,
  GOOD_IDS,
  goodName,
  type GoodId,
} from "@naval/shared/goods";
import type { ShipStoreCapacities, ShipStores } from "@naval/shared/trade";
import {
  buildPortPanelModel,
  captureStripText,
  knownPortsNearest,
  layoutPortMarkers,
  type PortInfo,
  type PortMarkerPlan,
} from "@naval/shared/port-view";

// ---------------------------------------------------------------------------
// Chart look.
// ---------------------------------------------------------------------------

const SEA_COLOR = 0x7c948a;
const NIGHT_DISC_COLOR = 0x17312f;
const WARM_SIGHT_COLOR = 0x8a9c5e;
const LAND_COLOR = 0xefe3c8;
const INK_COLOR = 0x2a1c10;
const WATERLINE_COLOR = 0xb79b6b;
const PAPER_COLOR = 0xe8dbbd;
const PAPER_INK = 0x5b4631;
const WIND_COLOR = 0xf3e7cb;
const NIGHT_COLOR = 0x0a1b33;

const WHOLE_MAP_MARGIN = 1.03;

/** Mix one colour towards another; the result is opaque. */
function mixedColor(from: number, to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const mix = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}

// Remembered colours are pre-mixed with paper, so they can be painted opaque.
// Nothing overlaps with alpha, and adjacent blocks cannot show seams.
const DIM_SEA_COLOR = mixedColor(PAPER_COLOR, SEA_COLOR, settings.view.dimSeaBlend);
const DIM_LAND_COLOR = mixedColor(DIM_SEA_COLOR, LAND_COLOR, settings.view.fogDimAlpha);
const DIM_WATERLINE_COLOR = mixedColor(DIM_LAND_COLOR, WATERLINE_COLOR, settings.view.dimWaterBlend);
const DIM_INK_COLOR = mixedColor(DIM_LAND_COLOR, INK_COLOR, settings.view.dimInkBlend);

// ---------------------------------------------------------------------------
// UI size, remembered between visits.
// ---------------------------------------------------------------------------

type UiSize = "small" | "medium" | "large";

const UI_SIZE_KEY = "armadas.uiSize";

function readSavedSize(): UiSize {
  try {
    const saved = localStorage.getItem(UI_SIZE_KEY);
    if (saved === "small" || saved === "medium" || saved === "large") return saved;
  } catch {
    // Storage may be blocked; medium is the fallback.
  }
  return "medium";
}

function setUiSize(size: UiSize): void {
  document.documentElement.dataset.uiSize = size;
  try {
    localStorage.setItem(UI_SIZE_KEY, size);
  } catch {
    // Remembering the choice is optional.
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
    button.setAttribute("aria-pressed", String(button.dataset.size === size));
  }
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------



function element<T extends Element>(id: string): T {
  const node = document.getElementById(id);
  if (node) return node as unknown as T;
  if (!REMOVED_3K_IDS.has(id)) throw new Error(`Missing element #${id}`);
  // The 3K shell deleted the old toolbar and dock. Keep their wiring inert
  // until the replacement sheet owns the action, instead of crashing boot.
  const tag = id.includes("btn") ? "button" : id.includes("label") ? "span" : "div";
  return document.createElement(tag) as unknown as T;
}

type ArmadasErrorWindow = Window & {
  reportArmadasError?: (message: string, where: string) => void;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

const clientErrorLog: Array<{ at: number; text: string }> = [];
const pendingClientErrors: Array<{ text: string; where: string }> = [];

/** Report a client failure to the readable banner, console and debug log. */
function reportClientError(error: unknown, where: string): void {
  const message = errorText(error);
  clientErrorLog.push({ at: Date.now(), text: `${message} (${where})` });
  if (clientErrorLog.length > 10) clientErrorLog.shift();
  pendingClientErrors.push({ text: message.slice(0, 180), where });
  while (pendingClientErrors.length > 5) pendingClientErrors.shift();
  const reporter = (window as ArmadasErrorWindow).reportArmadasError;
  if (reporter) {
    reporter(message, where);
    return;
  }
  console.error("Armadas error:", message, where);
  const box = document.getElementById("client-error");
  if (box) {
    box.textContent = `Something went wrong: ${message} (${where})`;
    box.hidden = false;
  }
}

const FLAGSHIP_PENNANT_KEY = "armadas.flagshipPennant";
const ROUTE_LINE_KEY = "armadas.routeLine";

function readSavedRouteLine(): boolean {
  try {
    return localStorage.getItem(ROUTE_LINE_KEY) !== "0";
  } catch {
    return true;
  }
}

function readSavedFlagshipPennant(): boolean {
  try {
    return localStorage.getItem(FLAGSHIP_PENNANT_KEY) === "1";
  } catch {
    return settings.flagshipMarker.pennantDefaultVisible;
  }
}

function makePlayerId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Accessing the storage property itself can throw, so do that safely too. */
function browserStorage(name: "localStorage" | "sessionStorage"): StorageLike | null {
  try {
    return window[name];
  } catch {
    return null;
  }
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

function compassPoint(degrees: number): string {
  const wrapped = ((degrees % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(wrapped / 22.5) % 16] ?? "N";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function validRoomKind(value: unknown): value is RoomKind {
  return value === "normal" || value === "test" || value === "dev";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read only the goods actually sent; a missing good stays missing. */
function numericGoods(raw: unknown): Partial<Record<GoodId, number>> | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const out: Partial<Record<GoodId, number>> = {};
  let found = 0;
  for (const good of GOOD_IDS) {
    const value = finiteNumber(source[good]);
    if (value === null) continue;
    out[good] = Math.max(0, value);
    found += 1;
  }
  return found > 0 ? out : null;
}

function parseStores(raw: unknown): ShipStores | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const provisions = finiteNumber(source.provisions);
  const ammunition = finiteNumber(source.ammunition);
  const repairMaterials = finiteNumber(source.repairMaterials);
  if (provisions === null || ammunition === null || repairMaterials === null) {
    return null;
  }
  const rawCargo = source.cargo;
  if (!rawCargo || typeof rawCargo !== "object") return null;
  const cargoSource = rawCargo as Record<string, unknown>;
  const cargo = {} as ShipStores["cargo"];
  for (const good of CARGO_GOOD_IDS) {
    const amount = finiteNumber(cargoSource[good]);
    if (amount === null) return null;
    cargo[good] = Math.max(0, amount);
  }
  return {
    provisions: Math.max(0, provisions),
    ammunition: Math.max(0, ammunition),
    repairMaterials: Math.max(0, repairMaterials),
    cargo,
  };
}

function parseCapacities(raw: unknown): ShipStoreCapacities | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const provisions = finiteNumber(source.provisions);
  const ammunition = finiteNumber(source.ammunition);
  const repairMaterials = finiteNumber(source.repairMaterials);
  const cargo = finiteNumber(source.cargo);
  if (
    provisions === null ||
    ammunition === null ||
    repairMaterials === null ||
    cargo === null
  ) return null;
  return { provisions, ammunition, repairMaterials, cargo };
}

function parseOrderLines(raw: unknown): OrderLineSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const lines: OrderLineSnapshot[] = [];
  for (const entry of raw.slice(0, 12)) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    if (typeof source.kind !== "string" || !Array.isArray(source.points)) continue;
    const points: Array<[number, number]> = [];
    for (const point of source.points.slice(0, 200)) {
      if (!Array.isArray(point) || point.length !== 2) continue;
      const x = finiteNumber(point[0]);
      const y = finiteNumber(point[1]);
      if (x !== null && y !== null) points.push([x, y]);
    }
    if (points.length > 0) {
      lines.push({
        kind: source.kind as OrderLineSnapshot["kind"],
        points,
        label: typeof source.label === "string" ? source.label.slice(0, 80) : "",
        queueNumber: finiteNumber(source.queueNumber) ?? undefined,
      });
    }
  }
  return lines;
}

/** Validate a private fleet card without trusting the socket. */
function parseFleet(raw: unknown): FleetSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (
    typeof source.id !== "string" ||
    typeof source.name !== "string" ||
    typeof source.leaderId !== "string" ||
    !Array.isArray(source.members) ||
    source.members.length === 0
  ) return null;
  const members: FleetMemberSnapshot[] = [];
  for (const entry of source.members.slice(0, settings.fleets.maxShipsPerFleet)) {
    if (!entry || typeof entry !== "object") continue;
    const member = entry as Record<string, unknown>;
    if (typeof member.id !== "string" || typeof member.state !== "string") continue;
    members.push({
      id: member.id,
      state: member.state as FleetMemberSnapshot["state"],
    });
  }
  if (members.length === 0) return null;
  const rawStation = source.station && typeof source.station === "object"
    ? source.station as Record<string, unknown>
    : {};
  const out: Array<{ id: string; reason: string }> = [];
  if (Array.isArray(rawStation.out)) {
    for (const entry of rawStation.out.slice(0, settings.fleets.maxShipsPerFleet)) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.id === "string" && typeof row.reason === "string") {
        out.push({ id: row.id, reason: row.reason.slice(0, 40) });
      }
    }
  }
  const stationTotal = Math.max(members.length, finiteNumber(rawStation.total) ?? members.length);
  const stationIn = Math.max(0, Math.min(stationTotal, finiteNumber(rawStation.inStation) ??
    members.filter((member) => member.state === "leader" || member.state === "inStation").length));
  return {
    id: source.id,
    name: source.name.slice(0, 80),
    leaderId: source.leaderId,
    formation: (typeof source.formation === "string" ? source.formation : "lineAhead") as FleetSnapshot["formation"],
    stance: (typeof source.stance === "string" ? source.stance : "fightIfAttacked") as FleetSnapshot["stance"],
    members,
    station: { inStation: stationIn, total: stationTotal, out },
  };
}

function parseDamagePercents(raw: unknown): OwnShipSnapshot["damage"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const hull = finiteNumber(source.hull);
  const sails = finiteNumber(source.sails);
  const masts = finiteNumber(source.masts);
  const rudder = finiteNumber(source.rudder);
  const guns = finiteNumber(source.guns);
  const crew = finiteNumber(source.crew);
  if ([hull, sails, masts, rudder, guns, crew].some((value) => value === null)) return undefined;
  return {
    hull: Math.max(0, Math.min(100, hull!)),
    sails: Math.max(0, Math.min(100, sails!)),
    masts: Math.max(0, Math.min(100, masts!)),
    rudder: Math.max(0, Math.min(100, rudder!)),
    guns: Math.max(0, Math.min(100, guns!)),
    crew: Math.max(0, Math.min(100, crew!)),
  };
}

/** Validate one private fleet row without trusting the socket. */
function parseOwnShip(raw: unknown): OwnShipSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const id = source.id;
  const name = source.name;
  const classId = source.classId;
  const crew = finiteNumber(source.crew);
  const fullCrew = finiteNumber(source.fullCrew);
  const deliveryLeftMs = finiteNumber(source.deliveryLeftMs);
  const x = finiteNumber(source.x);
  const y = finiteNumber(source.y);
  const cargoUsed = finiteNumber(source.cargoUsed);
  const provisionsDays = finiteNumber(source.provisionsDays);
  const status = source.status;
  const navy = typeof source.navy === "string" ? parseNavy(source.navy) : null;
  const stores = parseStores(source.stores);
  const capacities = parseCapacities(source.capacities);
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof classId !== "string" ||
    crew === null ||
    fullCrew === null ||
    deliveryLeftMs === null ||
    x === null ||
    y === null ||
    cargoUsed === null ||
    provisionsDays === null ||
    (status !== "sailing" && status !== "docked" &&
      status !== "waiting" && status !== "delivery") ||
    !navy ||
    !stores ||
    !capacities
  ) return null;
  return {
    id,
    name,
    isFlagship: source.isFlagship === true,
    research: (() => {
      const raw = source.research;
      if (!raw || typeof raw !== "object") return undefined;
      const row = raw as Record<string, unknown>;
      const fitted: Record<string, number> = {};
      const unlocked: Record<string, number> = {};
      for (const [key, value] of Object.entries(row.fitted ?? {})) {
        if (Number.isFinite(value) && value >= 0) fitted[key] = Math.floor(value);
      }
      for (const [key, value] of Object.entries(row.unlocked ?? {})) {
        if (Number.isFinite(value) && value >= 0) unlocked[key] = Math.floor(value);
      }
      const cost = finiteNumber(row.cost) ?? 0;
      const gameDays = finiteNumber(row.gameDays) ?? 0;
      return {
        fitted,
        unlocked,
        dockUntilGameMs: Math.max(0, finiteNumber(row.dockUntilGameMs) ?? 0),
        fitting: row.fitting === true,
        missingLevels: Math.max(0, Math.floor(finiteNumber(row.missingLevels) ?? 0)),
        cost: Math.max(0, Math.floor(cost)),
        gameDays: Math.max(0, gameDays),
        canFit: row.canFit === true,
        reason: typeof row.reason === "string" ? row.reason : null,
      };
    })(),
    classId: classId as OwnShipSnapshot["classId"],
    navy,
    crew,
    fullCrew,
    status,
    portId: typeof source.portId === "string" ? source.portId : null,
    deliveryLeftMs,
    x,
    y,
    stores,
    capacities,
    cargoUsed,
    provisionsDays,
    starving: source.starving === true,
    route: (() => {
      if (!Array.isArray(source.route)) return null;
      const points: Array<[number, number]> = [];
      for (const rawPoint of source.route) {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2) return null;
        const px = finiteNumber(rawPoint[0]);
        const py = finiteNumber(rawPoint[1]);
        if (px === null || py === null) return null;
        points.push([px, py]);
      }
      return points.length > 0 && points.length <= settings.route.maxWaypoints
        ? points
        : null;
    })(),
    predictedPath: (() => {
      if (!Array.isArray(source.predictedPath)) return null;
      const points: Array<[number, number]> = [];
      for (const rawPoint of source.predictedPath) {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2) return null;
        const px = finiteNumber(rawPoint[0]);
        const py = finiteNumber(rawPoint[1]);
        if (px === null || py === null) return null;
        points.push([px, py]);
      }
      return points.length > 0 && points.length <= settings.route.predictionMaxPoints
        ? points
        : null;
    })(),
    trail: (() => {
      if (!Array.isArray(source.trail)) return null;
      const points: Array<[number, number]> = [];
      for (const rawPoint of source.trail) {
        if (!Array.isArray(rawPoint) || rawPoint.length !== 2) return null;
        const px = finiteNumber(rawPoint[0]);
        const py = finiteNumber(rawPoint[1]);
        if (px === null || py === null) return null;
        points.push([px, py]);
      }
      return points.length > 0 && points.length <= settings.journey.maxSentPoints
        ? points
        : null;
    })(),
    journey: (() => {
      const raw = source.journey;
      if (!raw || typeof raw !== "object") return null;
      const row = raw as unknown as Record<string, unknown>;
      const distanceKm = finiteNumber(row.distanceKm);
      const startedGameMs = finiteNumber(row.startedGameMs);
      return distanceKm === null || startedGameMs === null
        ? null
        : { distanceKm: Math.max(0, distanceKm), startedGameMs: Math.max(0, startedGameMs) };
    })(),
    fleetId: typeof source.fleetId === "string" ? source.fleetId : null,
    detached: source.detached === true,
    stance: typeof source.stance === "string"
      ? source.stance as OwnShipSnapshot["stance"]
      : undefined,
    orderLines: parseOrderLines(source.orderLines),
    damage: parseDamagePercents(source.damage),
    ammunitionBroadsides: finiteNumber(source.ammunitionBroadsides) ?? undefined,
    reloadProgress: finiteNumber(source.reloadProgress) ?? undefined,
    reloadLeftSeconds: finiteNumber(source.reloadLeftSeconds) ?? undefined,
    inCombat: source.inCombat === true,
    canRepair: source.canRepair === true,
    battleOrder: source.battleOrder === "capture" || source.battleOrder === "sink"
      ? source.battleOrder
      : undefined,
    surrendered: source.surrendered === true,
    running: source.running === true,
    abandoned: source.abandoned === true,
    burning: source.burning === true,
    fireStrength: finiteNumber(source.fireStrength) ?? 0,
    fireShipIgnited: source.fireShipIgnited === true,
    fireShipMode: source.fireShipMode === "contact" || source.fireShipMode === "now"
      ? source.fireShipMode
      : undefined,
    fireShipTargetId: typeof source.fireShipTargetId === "string"
      ? source.fireShipTargetId
      : null,
    towedBy: typeof source.towedBy === "string" ? source.towedBy : null,
    towingId: typeof source.towingId === "string" ? source.towingId : null,
    lightsOn: source.lightsOn !== false,
    prisoners: finiteNumber(source.prisoners) ?? 0,
    capturedCrew: finiteNumber(source.capturedCrew) ?? 0,
    capturedChoiceSeconds: finiteNumber(source.capturedChoiceSeconds) ?? 0,
    autoBoard: source.autoBoard !== false,
    boardingProgress: finiteNumber(source.boardingProgress) ?? undefined,
    boardingSecondsLeft: finiteNumber(source.boardingSecondsLeft) ?? undefined,
    stateLabel: typeof source.stateLabel === "string" ? source.stateLabel : undefined,
    anchored: source.anchored === true,
    weighingAnchor: source.weighingAnchor === true,
    debugCombat: typeof source.debugCombat === "string" ? source.debugCombat : undefined,
    repairEnabled: source.repairEnabled !== false,
    crewTooLow: source.crewTooLow === true,
    effectiveSpeedKnots: finiteNumber(source.effectiveSpeedKnots) ?? undefined,
    normalSpeedKnots: finiteNumber(source.normalSpeedKnots) ?? undefined,
    effectiveTurnDegPerSecond: finiteNumber(source.effectiveTurnDegPerSecond) ?? undefined,
    normalTurnDegPerSecond: finiteNumber(source.normalTurnDegPerSecond) ?? undefined,
    portRepair: (() => {
      const rawRepair = source.portRepair;
      if (!rawRepair || typeof rawRepair !== "object") return undefined;
      const repair = rawRepair as Record<string, unknown>;
      const materials = finiteNumber(repair.materials);
      const money = finiteNumber(repair.money);
      const rate = finiteNumber(repair.rateMultiplier);
      if (
        (repair.mode !== "stores" && repair.mode !== "pay") ||
        materials === null || money === null || rate === null
      ) return undefined;
      return {
        mode: repair.mode,
        materials,
        money,
        rateMultiplier: rate,
        active: repair.active === true,
      };
    })(),
    engagement: (() => {
      const rawEngagement = source.engagement;
      if (!rawEngagement || typeof rawEngagement !== "object") return null;
      const engagement = rawEngagement as Record<string, unknown>;
      if (typeof engagement.targetId !== "string") return null;
      if (engagement.objective !== "sink" && engagement.objective !== "capture") return null;
      return { targetId: engagement.targetId, objective: engagement.objective };
    })(),
  };
}

// ---------------------------------------------------------------------------
// Game screen.
// ---------------------------------------------------------------------------

interface ShipView {
  id: string;
  hull: Graphics;
  ring: Graphics;
  flag: Graphics;
  flagshipInk: Graphics;
  runInk: Graphics;
  runLabel: Text;
  own: boolean;
  classId: string;
  navy: string;
  x: number;
  y: number;
  heading: number;
  motion: MotionTrack;
  dockedPortId: string | null;
  waitingPortId: string | null;
  surrendered: boolean;
  running: boolean;
  abandoned: boolean;
  burning: boolean;
  fireStrength: number;
  ignitionAt: number | null;
  sinking: boolean;
  lantern: boolean;
  lightsOff: boolean;
  isFlagship: boolean;
  statusInk: Graphics;
  statusLabel: Text;
  lightsLabel: Text;
  npcKind: NpcKindId | null;
  npcHired: boolean;
  reconInk: Graphics;
  reconLabel: Text;
  statusKey: string;
}

interface Camera {
  x: number;
  y: number;
  kmAcross: number;
  follow: boolean;
}

type ViewMode = "ship" | "chart";

async function start(): Promise<void> {
  const root = element<HTMLDivElement>("game-root");
  const status = element<HTMLParagraphElement>("status");
  const speedOut = element<HTMLElement>("speed");
  const headingOut = element<HTMLElement>("heading");
  const windLabel = element<HTMLElement>("wind-label");
  const windArrow = element<SVGGElement>("wind-arrow");
  const compassNeedle = element<SVGGElement>("compass-needle");
  const followButton = element<HTMLButtonElement>("follow-btn");
  const chartButton = element<HTMLButtonElement>("chart-btn");
  const knownPortsButton = element<HTMLButtonElement>("known-ports-btn");
  const portPanel = element<HTMLElement>("port-panel");
  const portSize = element<HTMLElement>("port-size");
  const portTitle = element<HTMLElement>("port-title");
  const portStatus = element<HTMLElement>("port-status");
  const portRegion = element<HTMLElement>("port-region");
  const portGood = element<HTMLElement>("port-good");
  const portCapacity = element<HTMLElement>("port-capacity");
  const portFree = element<HTMLElement>("port-free");
  const portDistance = element<HTMLElement>("port-distance");
  const portNpcNote = element<HTMLElement>("port-npc-note");
  const portOwnerOut = element<HTMLElement>("port-owner");
  const portHealthOut = element<HTMLElement>("port-health");
  const portHealthFill = element<HTMLElement>("port-health-fill");
  const portHealthText = element<HTMLElement>("port-health-text");
  const portBatteryOut = element<HTMLElement>("port-battery");
  const portTierOut = element<HTMLElement>("port-tier");
  const portCaptureRangeOut = element<HTMLElement>("port-capture-range");
  const portBuildOut = element<HTMLElement>("port-build");
  const portBuildText = element<HTMLElement>("port-build-text");
  const portBuildFill = element<HTMLElement>("port-build-fill");
  const portBuildButton = element<HTMLButtonElement>("port-build-btn");
  const portAttackButton = element<HTMLButtonElement>("port-attack");
  const captureStrip = element<HTMLElement>("capture-strip");
  const portSail = element<HTMLButtonElement>("port-sail");
  const portUndock = element<HTMLButtonElement>("port-undock");
  const portTrade = element<HTMLButtonElement>("port-trade");
  const portShipyard = element<HTMLButtonElement>("port-shipyard");
  const portHire = element<HTMLButtonElement>("port-hire");
  const portClose = element<HTMLButtonElement>("port-close");
  const tradePanel = element<HTMLElement>("trade-panel");
  const tradePort = element<HTMLElement>("trade-port");
  const tradeTitle = element<HTMLElement>("trade-title");
  const tradeMeta = element<HTMLElement>("trade-meta");
  const tradeFree = element<HTMLElement>("trade-free");
  const tradeBody = element<HTMLElement>("trade-body");
  const tradeNotice = element<HTMLElement>("trade-notice");
  const tradeClose = element<HTMLButtonElement>("trade-close");
  const tradeResupply = element<HTMLButtonElement>("trade-resupply");
  const tradeResupplyHint = element<HTMLElement>("trade-resupply-hint");
  const shipStoresOut = element<HTMLElement>("ship-stores");
  const shipStarvingOut = element<HTMLElement>("ship-starving");
  const moneyOut = element<HTMLElement>("money");
  const fleetCountOut = element<HTMLElement>("fleet-count");
  const fleetButton = element<HTMLButtonElement>("fleet-btn");
  const fleetPanel = element<HTMLElement>("fleet-panel");
  const fleetSummary = element<HTMLElement>("fleet-summary");
  const fleetList = element<HTMLUListElement>("fleet-list");
  const fleetCards = element<HTMLElement>("fleet-cards");
  const fleetCreate = element<HTMLButtonElement>("fleet-create");
  const fleetQueue = element<HTMLButtonElement>("fleet-queue");
  const fleetSaveGroup = element<HTMLButtonElement>("fleet-save-group");
  const fleetEmpty = element<HTMLElement>("fleet-empty");
  const orderMenu = element<HTMLElement>("order-menu");
  const orderMenuTitle = element<HTMLElement>("order-menu-title");
  const orderMenuWhere = element<HTMLElement>("order-menu-where");
  const orderMenuActions = element<HTMLElement>("order-menu-actions");
  const orderMenuClose = element<HTMLButtonElement>("order-menu-close");
  const ordersListBtn = element<HTMLButtonElement>("orders-list-btn");
  const backToShipBtn = element<HTMLButtonElement>("back-to-ship-btn");
  const armedOrderBar = element<HTMLElement>("armed-order");
  const armedOrderText = element<HTMLElement>("armed-order-text");
  const armedOrderCancel = element<HTMLButtonElement>("armed-order-cancel");
  const attackNearestBtn = element<HTMLButtonElement>("attack-nearest-btn");
  const controlsHelpBtn = element<HTMLButtonElement>("controls-help-btn");
  const controlsHelp = element<HTMLElement>("controls-help");
  const controlsHint = element<HTMLElement>("controls-hint");
  const controlsHintText = element<HTMLElement>("controls-hint-text");
  const controlsHintNext = element<HTMLButtonElement>("controls-hint-next");
  const controlsHintClose = element<HTMLButtonElement>("controls-hint-close");
  const fleetSelectNearby = element<HTMLButtonElement>("fleet-select-nearby");
  const fleetSelectFrigate = element<HTMLButtonElement>("fleet-select-frigate");
  const fleetSelectLine = element<HTMLButtonElement>("fleet-select-line");
  const headingSheet = element<HTMLElement>("heading-sheet");
  const headingDegrees = element<HTMLInputElement>("heading-degrees");
  const headingDial = element<HTMLInputElement>("heading-dial");
  const headingDistance = element<HTMLInputElement>("heading-distance");
  const headingPreview = element<HTMLElement>("heading-preview");
  const headingClose = element<HTMLButtonElement>("heading-close");
  const headingCancel = element<HTMLButtonElement>("heading-cancel");
  const headingConfirm = element<HTMLButtonElement>("heading-confirm");
  const groupBar = element<HTMLElement>("group-bar");
  const fleetClose = element<HTMLButtonElement>("fleet-close");
  const multiButton = element<HTMLButtonElement>("multi-btn");
  const multiCount = element<HTMLElement>("multi-count");
  const fleetSelectAll = element<HTMLButtonElement>("fleet-select-all");
  const fleetUndock = element<HTMLButtonElement>("fleet-undock");
  const fleetUpgradeAll = element<HTMLButtonElement>("fleet-upgrade-all");
  const fleetClear = element<HTMLButtonElement>("fleet-clear");
  const fleetSelectedCount = element<HTMLElement>("fleet-selected-count");
  const shipUndock = element<HTMLButtonElement>("ship-undock");
  const shipDamage = element<HTMLButtonElement>("ship-damage");
  const shipTabOverview = element<HTMLButtonElement>("ship-tab-overview");
  const shipTabUpgrades = element<HTMLButtonElement>("ship-tab-upgrades");
  const shipUpgradesOut = element<HTMLElement>("ship-upgrades");
  const shipUpgradesSummary = element<HTMLElement>("ship-upgrades-summary");
  const shipUpgradeList = element<HTMLElement>("ship-upgrade-list");
  const shipUpgradeButton = element<HTMLButtonElement>("ship-upgrade-btn");
  const fireShipActionsOut = element<HTMLElement>("fire-ship-actions");
  const fireShipStatusOut = element<HTMLElement>("fire-ship-status");
  const fireShipButtonsOut = element<HTMLElement>("fire-ship-buttons");
  const shipLightsOut = element<HTMLElement>("ship-lights");
  const shipLightsText = element<HTMLElement>("ship-lights-text");
  const shipAnchorActions = element<HTMLElement>("ship-anchor-actions");
  const shipDropAnchor = element<HTMLButtonElement>("ship-drop-anchor");
  const shipWeighAnchor = element<HTMLButtonElement>("ship-weigh-anchor");
  const effectGalleryButton = element<HTMLButtonElement>("effect-gallery");
  const debugLogToggle = element<HTMLButtonElement>("debug-log-toggle");
  const debugLogLines = element<HTMLElement>("debug-log-lines");
  const fireTargetBox = element<HTMLElement>("fire-ship-target");
  const fireTargetText = element<HTMLElement>("fire-target-text");
  const fireTargetConfirm = element<HTMLButtonElement>("fire-target-confirm");
  const fireTargetCancel = element<HTMLButtonElement>("fire-target-cancel");
  const shipJourney = element<HTMLElement>("ship-journey");
  const shipEndJourney = element<HTMLButtonElement>("ship-end-journey");
  const damagePanel = element<HTMLElement>("damage-panel");
  const damageTitle = element<HTMLElement>("damage-title");
  const damageSummary = element<HTMLElement>("damage-summary");
  const damageBars = element<HTMLElement>("damage-bars");
  const damageAmmo = element<HTMLElement>("damage-ammo");
  const damageReload = element<HTMLElement>("damage-reload");
  const damageState = element<HTMLElement>("damage-state");
  const damageSpeed = element<HTMLElement>("damage-speed");
  const damageTurn = element<HTMLElement>("damage-turn");
  const damagePrisoners = element<HTMLElement>("damage-prisoners");
  const damageHurts = element<HTMLElement>("damage-hurts");
  const damageJourney = element<HTMLElement>("damage-journey");
  const damageEndJourney = element<HTMLButtonElement>("damage-end-journey");
  const chartTrails = element<HTMLElement>("chart-trails");
  const chartClearTrails = element<HTMLButtonElement>("chart-clear-trails");
  const damageCombatReadout = element<HTMLElement>("damage-combat-readout");
  const damageRepairToggle = element<HTMLInputElement>("damage-repair-toggle");
  const damageClose = element<HTMLButtonElement>("damage-close");
  const portRepairBox = element<HTMLElement>("port-repair");
  const portRepairQuote = element<HTMLElement>("port-repair-quote");
  const repairStores = element<HTMLButtonElement>("repair-stores");
  const repairPay = element<HTMLButtonElement>("repair-pay");
  const battleLog = element<HTMLElement>("battle-log");
  const battleLogToggle = element<HTMLButtonElement>("battle-log-toggle");
  const battleLogList = element<HTMLOListElement>("battle-log-list");
  const battleLogCount = element<HTMLElement>("battle-log-count");
  const battleLogClose = element<HTMLButtonElement>("battle-log-close");
  const battleBar = element<HTMLElement>("battle-bar");
  const battleBarTitle = element<HTMLElement>("battle-bar-title");
  const battleBarActions = element<HTMLElement>("battle-bar-actions");
  const surrenderConfirm = element<HTMLElement>("surrender-confirm");
  const surrenderConfirmText = element<HTMLElement>("surrender-confirm-text");
  const surrenderConfirmCancel = element<HTMLButtonElement>("surrender-confirm-cancel");
  const surrenderConfirmYes = element<HTMLButtonElement>("surrender-confirm-yes");
  const surrenderSheet = element<HTMLElement>("surrender-sheet");
  const surrenderOfferTitle = element<HTMLElement>("surrender-offer-title");
  const surrenderOfferDetail = element<HTMLElement>("surrender-offer-detail");
  const surrenderOfferFleet = element<HTMLElement>("surrender-offer-fleet");
  const surrenderOfferReason = element<HTMLElement>("surrender-offer-reason");
  const surrenderAccept = element<HTMLButtonElement>("surrender-accept");
  const surrenderSail = element<HTMLButtonElement>("surrender-sail");
  const surrenderKeep = element<HTMLButtonElement>("surrender-keep");
  const surrenderOfferClose = element<HTMLButtonElement>("surrender-offer-close");
  const damageBattle = element<HTMLElement>("damage-battle");
  const damageFire = element<HTMLElement>("damage-fire");
  const damageFireBar = element<HTMLElement>("damage-fire-bar");
  const damageFireStatus = element<HTMLElement>("damage-fire-status");
  const damageBoarding = element<HTMLElement>("damage-boarding");
  const damageBoardingLabel = element<HTMLElement>("damage-boarding-label");
  const damageBoardingFill = element<HTMLElement>("damage-boarding-fill");
  const damageCapturedRow = element<HTMLElement>("damage-captured-row");
  const damageCaptured = element<HTMLButtonElement>("damage-captured");
  const damageCrew = element<HTMLButtonElement>("damage-crew");
  const damageClaim = element<HTMLButtonElement>("damage-claim");
  const damageAutoBoard = element<HTMLInputElement>("damage-auto-board");
  const boardSheetPanel = element<HTMLElement>("board-sheet");
  const boardTitle = element<HTMLElement>("board-title");
  const boardDetail = element<HTMLElement>("board-detail");
  const boardOdds = element<HTMLElement>("board-odds");
  const boardConfirm = element<HTMLButtonElement>("board-confirm");
  const boardCancel = element<HTMLButtonElement>("board-cancel");
  const boardClose = element<HTMLButtonElement>("board-close");
  const crewSheetPanel = element<HTMLElement>("crew-sheet");
  const crewTitle = element<HTMLElement>("crew-title");
  const crewHint = element<HTMLElement>("crew-hint");
  const crewDonor = element<HTMLSelectElement>("crew-donor");
  const crewReceiver = element<HTMLSelectElement>("crew-receiver");
  const crewAmount = element<HTMLInputElement>("crew-amount");
  const crewPreview = element<HTMLElement>("crew-preview");
  const crewQuick = element<HTMLElement>("crew-quick");
  const crewConfirm = element<HTMLButtonElement>("crew-confirm");
  const crewCancel = element<HTMLButtonElement>("crew-cancel");
  const crewClose = element<HTMLButtonElement>("crew-close");
  const capturedSheetPanel = element<HTMLElement>("captured-sheet");
  const capturedTitle = element<HTMLElement>("captured-title");
  const capturedDetail = element<HTMLElement>("captured-detail");
  const capturedRule = element<HTMLElement>("captured-rule");
  const capturedJoin = element<HTMLButtonElement>("captured-join");
  const capturedKill = element<HTMLButtonElement>("captured-kill");
  const capturedPrisoners = element<HTMLButtonElement>("captured-prisoners");
  const capturedClose = element<HTMLButtonElement>("captured-close");
  const lootSheetPanel = element<HTMLElement>("loot-sheet");
  const lootTitle = element<HTMLElement>("loot-title");
  const lootDetail = element<HTMLElement>("loot-detail");
  const lootCargo = element<HTMLElement>("loot-cargo");
  const lootFree = element<HTMLElement>("loot-free");
  const lootNotice = element<HTMLElement>("loot-notice");
  const lootConfirm = element<HTMLButtonElement>("loot-confirm");
  const lootCancel = element<HTMLButtonElement>("loot-cancel");
  const lootClose = element<HTMLButtonElement>("loot-close");
  const privateerSheetPanel = element<HTMLElement>("privateer-sheet");
  const privateerTitle = element<HTMLElement>("privateer-title");
  const privateerDetail = element<HTMLElement>("privateer-detail");
  const privateerContract = element<HTMLElement>("privateer-contract");
  const privateerMode = element<HTMLElement>("privateer-mode");
  const privateerNotice = element<HTMLElement>("privateer-notice");
  const privateerActions = element<HTMLElement>("privateer-actions");
  const privateerClose = element<HTMLButtonElement>("privateer-close");
  const escortSheetPanel = element<HTMLElement>("escort-sheet");
  const escortTitle = element<HTMLElement>("escort-title");
  const escortDetail = element<HTMLElement>("escort-detail");
  const escortFee = element<HTMLElement>("escort-fee");
  const escortTarget = element<HTMLSelectElement>("escort-target");
  const escortNotice = element<HTMLElement>("escort-notice");
  const escortConfirm = element<HTMLButtonElement>("escort-confirm");
  const escortCancel = element<HTMLButtonElement>("escort-cancel");
  const escortClose = element<HTMLButtonElement>("escort-close");
  const escortStripPanel = element<HTMLElement>("escort-strip");
  const escortStripText = element<HTMLElement>("escort-strip-text");
  const escortStripOpen = element<HTMLButtonElement>("escort-open");
  const portPrisoners = element<HTMLElement>("port-prisoners");
  const portHandover = element<HTMLButtonElement>("port-handover");
  const portPrisonerTotal = element<HTMLElement>("port-prisoner-total");
  const actionSheet = element<HTMLElement>("ship-action");
  const actionTitle = element<HTMLElement>("action-title");
  const actionUndock = element<HTMLButtonElement>("action-undock");
  const actionPort = element<HTMLButtonElement>("action-port");
  const actionClose = element<HTMLButtonElement>("action-close");
  const shipNameOut = element<HTMLElement>("ship-name");
  const shipFlagshipTag = element<HTMLElement>("ship-flagship-tag");
  const shipTypeOut = element<HTMLElement>("ship-type");
  const shipCrewOut = element<HTMLElement>("ship-crew");
  const shipStateOut = element<HTMLElement>("ship-state");
  const shipCombatReadout = element<HTMLElement>("ship-combat-readout");
  const shipyardPanel = element<HTMLElement>("shipyard-panel");
  const shipyardPortOut = element<HTMLElement>("shipyard-port");
  const shipyardMoney = element<HTMLElement>("shipyard-money");
  const shipyardCount = element<HTMLElement>("shipyard-count");
  const shipyardCardsOut = element<HTMLElement>("shipyard-cards");
  const shipyardDelivery = element<HTMLElement>("shipyard-delivery");
  const shipyardDeliveryList = element<HTMLUListElement>("shipyard-delivery-list");
  const shipyardClose = element<HTMLButtonElement>("shipyard-close");
  const namingStep = element<HTMLElement>("naming-step");
  const namingType = element<HTMLElement>("naming-type");
  const namingName = element<HTMLInputElement>("naming-name");
  const namingRandom = element<HTMLButtonElement>("naming-random");
  const namingError = element<HTMLElement>("naming-error");
  const namingCost = element<HTMLElement>("naming-cost");
  const namingCancel = element<HTMLButtonElement>("naming-cancel");
  const namingConfirm = element<HTMLButtonElement>("naming-confirm");
  const hirePanel = element<HTMLElement>("hire-panel");
  const hirePortOut = element<HTMLElement>("hire-port");
  const hirePoolOut = element<HTMLElement>("hire-pool");
  const hireList = element<HTMLElement>("hire-list");
  const hireEmpty = element<HTMLElement>("hire-empty");
  const hireClose = element<HTMLButtonElement>("hire-close");
  const knownPortsPanel = element<HTMLElement>("known-ports-panel");
  const knownPortsList = element<HTMLUListElement>("known-ports-list");
  const knownPortsEmpty = element<HTMLElement>("known-ports-empty");
  const knownPortsClose = element<HTMLButtonElement>("known-ports-close");
  const bordersButton = element<HTMLButtonElement>("borders-btn");
  const flagshipPennantButton = element<HTMLButtonElement>("flagship-pennant-btn");
  const routeLineButton = element<HTMLButtonElement>("route-line-btn");
  const menuButton = element<HTMLButtonElement>("menu-btn");
  const menuPanel = element<HTMLElement>("menu-panel");
  const menuClose = element<HTMLButtonElement>("menu-close");
  const accountMenuButton = element<HTMLButtonElement>("account-menu-btn");
  const accountScreen = element<HTMLElement>("account-screen");
  const accountClose = element<HTMLButtonElement>("account-close");
  const resignButton = element<HTMLButtonElement>("resign-btn");
  const resignSheet = element<HTMLElement>("resign-sheet");
  const resignRecipientsOut = element<HTMLElement>("resign-recipients");
  const resignConfirm = element<HTMLButtonElement>("resign-confirm");
  const resignCancel = element<HTMLButtonElement>("resign-cancel");
  const eliminatedScreen = element<HTMLElement>("eliminated-screen");
  const eliminatedTitleOut = element<HTMLElement>("eliminated-title");
  const eliminatedReasonOut = element<HTMLElement>("eliminated-reason");
  const eliminatedByOut = element<HTMLElement>("eliminated-by");
  const eliminatedAssetsOut = element<HTMLElement>("eliminated-assets");
  const eliminatedStatsOut = element<HTMLElement>("eliminated-stats");
  const eliminatedClose = element<HTMLButtonElement>("eliminated-close");
  const victoryScreen = element<HTMLElement>("victory-screen");
  const victoryTitleOut = element<HTMLElement>("victory-title");
  const victoryWinnersOut = element<HTMLElement>("victory-winners");
  const victoryPlayersOut = element<HTMLElement>("victory-players");
  const victoryStatsOut = element<HTMLElement>("victory-stats");
  const victoryClose = element<HTMLButtonElement>("victory-close");
  const victoryReset = element<HTMLButtonElement>("victory-reset");
  const testToolsButton = element<HTMLButtonElement>("test-tools-btn");
  const testTools = element<HTMLElement>("test-tools");
  const testToolsClose = element<HTMLButtonElement>("test-tools-close");
  const testReportButton = element<HTMLButtonElement>("test-report");
  const testReportCopy = element<HTMLButtonElement>("test-report-copy");
  const testReportDownload = element<HTMLButtonElement>("test-report-download");
  const testReportText = element<HTMLElement>("test-report-text");
  const testClearRecorder = element<HTMLButtonElement>("test-clear-recorder");
  const testNoteButton = element<HTMLButtonElement>("test-note");
  const testNoteToggle = element<HTMLInputElement>("test-note-toggle");
  const scenarioList = element<HTMLElement>("scenario-list");
  const scenarioScoreboard = element<HTMLElement>("scenario-scoreboard");
  const scenarioName = element<HTMLElement>("scenario-name");
  const scenarioElapsed = element<HTMLElement>("scenario-elapsed");
  const scenarioMyLosses = element<HTMLElement>("scenario-my-losses");
  const scenarioTheirLosses = element<HTMLElement>("scenario-their-losses");
  const scenarioOutcome = element<HTMLElement>("scenario-outcome");
  const scenarioEnd = element<HTMLButtonElement>("scenario-end");
  const scenarioRating = element<HTMLElement>("scenario-rating");
  const scenarioRatingResult = element<HTMLElement>("scenario-rating-result");
  const scenarioRatingNote = element<HTMLInputElement>("scenario-rating-note");
  const scenarioRatingCancel = element<HTMLButtonElement>("scenario-rating-cancel");
  const noteFab = element<HTMLButtonElement>("note-fab");
  const noteSheet = element<HTMLElement>("note-sheet");
  const noteForm = element<HTMLFormElement>("note-form");
  const noteText = element<HTMLInputElement>("note-text");
  const noteCancel = element<HTMLButtonElement>("note-cancel");
  const testEnemyClass = element<HTMLSelectElement>("test-enemy-class");
  const testEnemyNavy = element<HTMLSelectElement>("test-enemy-navy");
  const testEnemyCount = element<HTMLInputElement>("test-enemy-count");
  const testDummyBehaviour = element<HTMLSelectElement>("test-dummy-behaviour");
  const testWindFrom = element<HTMLInputElement>("test-wind-from");
  const testWindSpeed = element<HTMLInputElement>("test-wind-speed");
  const testSetWind = element<HTMLButtonElement>("test-set-wind");
  const testSpawn = element<HTMLButtonElement>("test-spawn");
  const testAnchoredFleet = element<HTMLButtonElement>("test-anchored-fleet");
  const testAnchoredStance = element<HTMLSelectElement>("test-anchored-stance");
  const testTimeHour = element<HTMLInputElement>("test-time-hour");
  const testTimeSet = element<HTMLButtonElement>("test-time-set");
  const testRemove = element<HTMLButtonElement>("test-remove");
  const testRefill = element<HTMLButtonElement>("test-refill");
  const testSinkFlagship = element<HTMLButtonElement>("test-sink-flagship");
  const testSpareShips = element<HTMLButtonElement>("test-spare-ships");
  const testResetRoom = element<HTMLButtonElement>("test-reset-room");
  const testInviteLink = element<HTMLInputElement>("test-invite-link");
  const testCopyLink = element<HTMLButtonElement>("test-copy-link");
  const testShipsDrawn = element<HTMLElement>("test-ships-drawn");
  const perfPanel = element<HTMLElement>("perf-panel");
  const perfLines = element<HTMLElement>("perf-lines");
  const perfVisibleState = element<HTMLElement>("perf-visible-state");
  const perfToggle = element<HTMLButtonElement>("perf-toggle");
  const qualityNote = element<HTMLElement>("quality-note");
  const dataSaverNote = element<HTMLElement>("data-saver-note");
  const debugSection = element<HTMLDetailsElement>("debug-info");
  const shipPanel = element<HTMLElement>("ship-panel");
  const shipExpand = element<HTMLButtonElement>("ship-expand");
  const shipStripSpeed = element<HTMLElement>("ship-strip-speed");
  const shipStripHeading = element<HTMLElement>("ship-strip-heading");
  const shipStripCrew = element<HTMLElement>("ship-strip-crew");
  const shipStripProvisions = element<HTMLElement>("ship-strip-provisions");
  const clockPanel = element<HTMLElement>("game-clock-panel");
  const clockOut = element<HTMLElement>("game-clock");
  const windChip = element<HTMLElement>("wind-chip");
  const windChipLabel = element<HTMLElement>("wind-chip-label");
  const moonOut = element<HTMLElement>("moon-phase");
  const windSpeedLabel = element<HTMLElement>("wind-speed-label");
  const windDialArrow = element<SVGGElement>("wind-dial-arrow");
  const sailorsLogButton = element<HTMLButtonElement>("sailors-log-btn");
  const formationsButton = element<HTMLButtonElement>("formations-btn");
  const formationsSheet = element<HTMLElement>("formations-sheet");
  const formationsChoices = element<HTMLElement>("formations-choices");
  const formationsDetail = element<HTMLElement>("formations-detail");
  const formationsClose = element<HTMLButtonElement>("formations-close");
  const toolsButton = element<HTMLButtonElement>("tools-btn");
  const stanceButton = element<HTMLButtonElement>("stance-btn");
  const shipStripStance = element<HTMLElement>("ship-strip-stance");
  const shipStripLights = element<HTMLElement>("ship-strip-lights");
  const stanceSheetPanel = element<HTMLElement>("stance-sheet");
  const stanceClose = element<HTMLButtonElement>("stance-close");
  const stanceSelection = element<HTMLElement>("stance-selection");
  const stanceOptions = element<HTMLElement>("stance-options");
  const battleOrdersOut = element<HTMLElement>("battle-orders");
  const actionOrdersOut = element<HTMLElement>("action-orders");
  const lightsSwitch = element<HTMLInputElement>("lights-switch");
  const lightsSwitchLabel = element<HTMLElement>("lights-switch-label");
  const stanceNote = element<HTMLElement>("stance-note");
  const toolsSheet = element<HTMLElement>("tools-sheet");
  const toolsClose = element<HTMLButtonElement>("tools-close");
  const toolHeading = element<HTMLButtonElement>("tool-heading");
  const toolWind = element<HTMLButtonElement>("tool-wind");
  const toolRange = element<HTMLButtonElement>("tool-range");
  const toolScale = element<HTMLButtonElement>("tool-scale");
  const toolWindMarker = element<HTMLElement>("tool-wind-marker");
  const toolWindArrow = element<HTMLElement>("tool-wind-arrow");
  const toolWindText = element<HTMLElement>("tool-wind-text");
  const testMoonPhase = element<HTMLSelectElement>("test-moon-phase");
  const testMoonSet = element<HTMLButtonElement>("test-moon-set");
  const sailorsLogPanel = element<HTMLElement>("sailors-log");
  const logTabs = [...document.querySelectorAll<HTMLButtonElement>("[data-log-tab]")];
  const logPanelChart = element<HTMLElement>("log-panel-chart");
  const logPanelQueued = element<HTMLElement>("log-panel-queued");
  const logPanelFleets = element<HTMLElement>("log-panel-fleets");
  const logPanelTrade = element<HTMLElement>("log-panel-trade");
  const logPanelResearch = element<HTMLElement>("log-panel-research");
  const logShips = element<HTMLUListElement>("log-ships");
  const logPortsHost = element<HTMLElement>("log-ports-host");
  const logFleetsHost = element<HTMLElement>("log-fleets-host");
  const logTradeHost = element<HTMLElement>("log-trade-host");
  const logCargoList = element<HTMLUListElement>("log-cargo-list");
  const routeNew = element<HTMLButtonElement>("route-new");
  const routeFast = element<HTMLButtonElement>("route-fast");
  const routePayNow = element<HTMLButtonElement>("route-pay-now");
  const routeIncome = element<HTMLElement>("log-route-income");
  const routeList = element<HTMLUListElement>("log-route-list");
  const routeForm = element<HTMLFormElement>("log-route-form");
  const routeShip = element<HTMLSelectElement>("route-ship");
  const routePortA = element<HTMLSelectElement>("route-port-a");
  const routePortB = element<HTMLSelectElement>("route-port-b");
  const routeGood = element<HTMLSelectElement>("route-good");
  const routeTonnes = element<HTMLInputElement>("route-tonnes");
  const routeMinutes = element<HTMLInputElement>("route-minutes");
  const routeEstimate = element<HTMLElement>("route-estimate");
  const routeEditNote = element<HTMLElement>("route-edit-note");
  const routeSave = element<HTMLButtonElement>("route-save");
  const routeEditCancel = element<HTMLButtonElement>("route-edit-cancel");
  const routePickA = element<HTMLButtonElement>("route-pick-a");
  const routePickB = element<HTMLButtonElement>("route-pick-b");
  const testRouteFast = element<HTMLButtonElement>("test-route-fast");
  const testPortIncome = element<HTMLButtonElement>("test-port-income");
  const testKeepalive = element<HTMLButtonElement>("test-keepalive");
  const testKeepaliveResult = element<HTMLElement>("test-keepalive-result");
  const logGrid = element<HTMLElement>("log-grid");
  const logPickHint = element<HTMLElement>("log-pick-hint");
  const logRuler = element<HTMLElement>("log-ruler");
  const logRulerLine = element<HTMLElement>("log-ruler-line");
  const logRulerText = element<HTMLElement>("log-ruler-text");
  const logRulerButton = element<HTMLButtonElement>("log-ruler-btn");
  const logZoomOut = element<HTMLButtonElement>("log-zoom-out");
  const logZoomIn = element<HTMLButtonElement>("log-zoom-in");
  const logFitDiscovered = element<HTMLButtonElement>("log-fit-discovered");
  const logRulerUse = element<HTMLButtonElement>("log-ruler-use");
  const logPatrol = element<HTMLButtonElement>("log-patrol");
  const logRendezvous = element<HTMLButtonElement>("log-rendezvous");
  const logQueueNote = element<HTMLElement>("log-queue-note");
  const logQueueList = element<HTMLUListElement>("log-queue-list");
  const battleLogButton = element<HTMLButtonElement>("battle-log-btn");
  const battleLogButtonCount = element<HTMLElement>("battle-log-btn-count");
  const dockFrame = element<HTMLElement>("dock");
  const dockTabs = element<HTMLElement>("dock-tabs");
  const dockTabShip = element<HTMLButtonElement>("dock-tab-ship");
  const dockTabFleet = element<HTMLButtonElement>("dock-tab-fleet");
  const dockTabLog = element<HTMLButtonElement>("dock-tab-log");
  const dockTabPorts = element<HTMLButtonElement>("dock-tab-ports");
  const dockTabResearch = element<HTMLButtonElement>("dock-tab-research");
  const researchPanel = element<HTMLElement>("research-panel");
  const researchNavyOut = element<HTMLElement>("research-navy");
  const researchPointsOut = element<HTMLElement>("research-points");
  const researchUnitsOut = element<HTMLElement>("research-units");
  const researchOwnedOut = element<HTMLElement>("research-owned");
  const researchBranchesOut = element<HTMLElement>("research-branches");
  const researchHubNavy = element<HTMLElement>("research-hub-navy");
  const researchHubPoints = element<HTMLElement>("research-hub-points");
  const researchWebViewport = element<HTMLElement>("research-web-viewport");
  const researchWeb = element<HTMLElement>("research-web");
  const researchZoomOut = element<HTMLButtonElement>("research-zoom-out");
  const researchZoomIn = element<HTMLButtonElement>("research-zoom-in");
  const researchDetail = element<HTMLElement>("research-detail");
  const researchDetailName = element<HTMLElement>("research-detail-name");
  const researchDetailEffect = element<HTMLElement>("research-detail-effect");
  const researchDetailCost = element<HTMLElement>("research-detail-cost");
  const researchDetailCapture = element<HTMLElement>("research-detail-capture");
  const researchDetailStored = element<HTMLElement>("research-detail-stored");
  const researchDetailBuy = element<HTMLButtonElement>("research-detail-buy");
  const researchDetailFit = element<HTMLButtonElement>("research-detail-fit");
  const researchDetailClose = element<HTMLButtonElement>("research-detail-close");
  const logResearchHost = element<HTMLElement>("log-research-host");
  const researchButton = element<HTMLButtonElement>("research-btn");
  const researchClose = element<HTMLButtonElement>("research-close");
  const dockCollapseButton = element<HTMLButtonElement>("dock-collapse");
  const bottomDock = element<HTMLElement>("bottom-dock");
  const ordersButton = element<HTMLButtonElement>("orders-btn");
  const dockMenuButton = element<HTMLButtonElement>("dock-menu-btn");
  const ordersSheet = element<HTMLElement>("orders-sheet");
  const queueButton = element<HTMLButtonElement>("queue-btn");
  const noticeSecond = element<HTMLParagraphElement>("notice-2");
  const topRightSlot = element<HTMLElement>("top-right-slot");
  const bottomLeftSlot = element<HTMLElement>("bottom-left-slot");
  const wordmark = element<HTMLElement>("wordmark");
  const enemyChip = element<HTMLElement>("enemy-chip");
  const mapCompass = element<HTMLElement>("map-compass");
  const scaleBar = element<HTMLElement>("scale-bar");
  const scaleBarLabel = element<HTMLElement>("scale-bar-label");
  const chartBack = element<HTMLButtonElement>("chart-back");
  const compassRose = element<SVGSVGElement>("compass-rose");
  const shipChipHullFill = element<HTMLElement>("ship-chip-hull-fill");
  const layoutDebugLayer = element<HTMLElement>("layout-debug-layer");
  const developerButton = element<HTMLButtonElement>("developer-btn");
  const targetCard = element<HTMLElement>("target-card");
  const targetCardTitle = element<HTMLElement>("target-card-title");
  const targetCardDetail = element<HTMLElement>("target-card-detail");
  const targetCardClose = element<HTMLButtonElement>("target-card-close");
  const roomOut = element<HTMLElement>("room-code");
  const notice = element<HTMLParagraphElement>("notice");
  const versionNotice = element<HTMLButtonElement>("version-notice");
  const fogDebugOut = element<HTMLParagraphElement>("fog-debug");
  const layoutAudit = element<HTMLDetailsElement>("layout-audit");
  const layoutAuditSummary = element<HTMLElement>("layout-audit-summary");
  const layoutAuditList = element<HTMLUListElement>("layout-audit-list");
  const chartingOut = element<HTMLParagraphElement>("charting");
  const buildMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="armadas-build"]',
  );
  const commitMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="armadas-commit"]',
  );
  let pageBuildId = buildMeta?.content ?? "";
  let buildCommit = commitMeta?.content ?? "unknown";

  const query = new URLSearchParams(location.search);
  // No room means the main menu. A room in the address opens that room directly,
  // so every test and dev link keeps working exactly as before.
  let room = query.get("room") ?? "";
  const layoutDebug = query.get("layoutdebug") === "1";
  const layoutPreferenceKey = "armadas.layout";
  const layoutStorage = browserStorage("localStorage");
  function readLayoutPreference(): LayoutPreference {
    try {
      const stored = layoutStorage?.getItem(layoutPreferenceKey);
      return stored === "phone" || stored === "desktop" ? stored : "auto";
    } catch {
      return "auto";
    }
  }
  let layoutPreference = readLayoutPreference();
  let activeDockPanel: LayoutPanelId = "ship";
  let dockCollapsed = false;
  let ordersOpen = false;
  let lastLayoutApplyAt = 0;
  let lastLayoutStateKey = "";
  let layoutApplyFrame = 0;
  const UNPLACED_LAYOUT_IDS = new Set([
    "capture-strip", "escort-strip", "charting", "version-notice",
    "client-error", "quality-note", "data-saver-note", "armed-order", "undo-chip", "controls-hint", "layout-debug-layer",
  ]);
  const chartDebug = query.get("chartdebug") === "1";
  let perfVisible = query.get("perf") === "1";
  let perfAutoOpened = false;
  const qualityGovernor = new QualityGovernor();
  let qualityPreference: QualityPreference = parseQualityPreference(query.get("quality"));
  const NETWORK_KEY = "armada-network-mode";
  const networkStorage = browserStorage("localStorage");
  function readNetworkPreference(): NetworkPreference {
    try {
      return parseNetworkPreference(networkStorage?.getItem(NETWORK_KEY)) ?? "auto";
    } catch {
      return "auto";
    }
  }
  let networkPreference: NetworkPreference = readNetworkPreference();
  const dataSaverGovernor = new DataSaverGovernor();
  let lastNetworkModeSent = "";
  let lastConnectionSampleAt = 0;
  function effectiveNetworkMode(): NetworkPreference {
    return dataSaverGovernor.effective(networkPreference);
  }
  function syncNetworkMode(force = false): void {
    const mode = effectiveNetworkMode();
    dataSaverNote.hidden = !(networkPreference === "auto" && mode === "saver");
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-network]")) {
      button.setAttribute("aria-pressed", String(button.dataset.network === networkPreference));
    }
    if ((force || mode !== lastNetworkModeSent) && socket?.readyState === WebSocket.OPEN) {
      lastNetworkModeSent = mode;
      socket.send(JSON.stringify({ t: "networkMode", mode }));
    }
  }
  function setNetworkPreference(next: NetworkPreference): void {
    networkPreference = next;
    dataSaverGovernor.active = false;
    lastNetworkModeSent = "";
    try {
      networkStorage?.setItem(NETWORK_KEY, next);
    } catch {
      // Remembering the choice is optional.
    }
    syncNetworkMode(true);
  }
  let qualityLevel: QualityLevel = 0;
  let quality: QualityFeatures = qualityFeatures(0);
  const requestedBots = query.get("bots");
  const requestedNavy = query.get("navy");
  const requestedStart = query.get("start");
  const requestedShip = query.get("ship");
  const requestedCash = query.get("cash");
  let startPortName = requestedStart ?? "";
  const identity: PlayerIdentity = resolvePlayerIdentity(
    browserStorage("localStorage"),
    browserStorage("sessionStorage"),
    room ? roomKindForCode(room) : "normal",
    query.get("as"),
    makePlayerId,
  );
  const accountConfig = await loadAccountConfig();
  const accountApi: AccountApi | null = accountConfig
    ? createSupabaseAccountApi(accountConfig)
    : null;
  let accountSession: AccountSession | null = null;
  let connectedAccountId: string | null = null;
  let connectionAttempt = false;
  let lobbyUi: ReturnType<typeof createLobbyUi> | null = null;
  const accountUi = accountApi
    ? createAccountUi(document, accountApi, {
        room,
        onSession: (next) => {
          accountSession = next;
          refreshKeepaliveButton();
          lobbyUi?.refreshHome();
          if (!room || roomKindForCode(room) !== "normal") return;
          if (!next) {
            connectedAccountId = null;
            if (socket) {
              socket.close(1000, "logged out");
              socket = null;
            }
            setStatus("Log in to play online", true);
            return;
          }
          if (socket && connectedAccountId !== next.user.id) {
            socket.close(1000, "account changed");
            socket = null;
          }
          if (!socket) void connect();
        },
      })
    : null;
  /** Ask the Worker to reserve a code and open its lobby. */
  async function createOnlineGame(): Promise<{ code?: string; error?: string }> {
    const session = accountSession ?? await accountApi?.session().catch(() => null) ?? null;
    accountSession = session;
    if (!session) return { error: "Log in to create a game." };
    const response = await fetch("/api/lobby/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const data = await response.json().catch(() => ({})) as {
      code?: string; error?: string;
    };
    if (!response.ok || !data.code) {
      return { error: data.error || "That game could not be created. Try again." };
    }
    return { code: data.code };
  }

  /** Check a join code before opening its room. */
  async function lookupOnlineGame(code: string): Promise<{ status?: string; error?: string }> {
    const session = accountSession ?? await accountApi?.session().catch(() => null) ?? null;
    accountSession = session;
    if (!session) return { error: "Log in to join a game." };
    const response = await fetch(`/api/lobby/code?code=${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const data = await response.json().catch(() => ({})) as {
      ok?: boolean; found?: boolean; status?: string; error?: string;
    };
    if (!response.ok || !data.ok) {
      return { error: data.error || "Could not look up that code." };
    }
    if (!data.found) return {};
    return { status: data.status ?? "lobby" };
  }

  function enterRoom(code: string): void {
    const clean = code.trim().toUpperCase();
    if (!roomPattern.test(clean)) {
      lobbyUi?.showHome("Room code must be letters, numbers, dash or underscore.");
      return;
    }
    if (socket) {
      try {
        socket.close(1000, "changing room");
      } catch {
        // The old socket may already be closing.
      }
      socket = null;
    }
    retry = null;
    takenOver = false;
    connectionAttempt = false;
    cachedState = null;
    pendingStateMessages = [];
    room = clean;
    roomOut.textContent = room;
    roomKind = "normal";
    lobbyUi?.showLobbyConnecting(room);
    void connect();
  }

  function leaveRoom(): void {
    if (socket) {
      try {
        socket.close(1000, "left room");
      } catch {
        // The socket may already be closing.
      }
      socket = null;
    }
    if (retry !== null) {
      window.clearTimeout(retry);
      retry = null;
    }
    takenOver = false;
    connectionAttempt = false;
    connectedAccountId = null;
    cachedState = null;
    pendingStateMessages = [];
    room = "";
    roomOut.textContent = "—";
    roomKind = "normal";
  }

  lobbyUi = createLobbyUi(document, {
    signedIn: () => accountSession !== null,
    openAccount: () => accountUi?.open(),
    createGame: createOnlineGame,
    lookupGame: lookupOnlineGame,
    enterRoom,
    leaveRoom,
    send: (message) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  } satisfies LobbyUiOptions);

  accountMenuButton.disabled = !accountUi;
  accountMenuButton.title = accountUi ? "" : "Accounts are not configured.";
  if (accountUi) void accountUi.refresh().then(() => lobbyUi?.refreshHome());
  else {
    element<HTMLElement>("account-menu-name").textContent = "Account (unavailable)";
    testKeepalive.disabled = true;
    testKeepalive.title = "Accounts are not configured.";
    testKeepaliveResult.textContent = "Accounts are not configured.";
  }
  const roomPattern = new RegExp(`^[A-Za-z0-9_-]{1,${settings.server.maxRoomCodeLength}}$`);
  let homeStartMessage = "";
  if (room && !roomPattern.test(room)) {
    homeStartMessage = "Room code must be letters, numbers, dash or underscore.";
    room = "";
  }
  roomOut.textContent = room || "—";
  if (!room) lobbyUi.showHome(homeStartMessage);

  const baseResolution = Math.min(window.devicePixelRatio || 1, settings.client.maxDevicePixelRatio);
  let appliedResolution = baseResolution;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: PAPER_COLOR,
    antialias: true,
    autoDensity: true,
    resolution: baseResolution,
    preference: "webgl",
  });
  root.appendChild(app.canvas);

  function qualityLabel(): string {
    const mode = qualityPreference === "auto" ? "Auto" : qualityPreference === "high" ? "High" : "Low";
    return qualityPreference === "auto" ? `${mode} L${qualityLevel}` : mode;
  }

  function applyQuality(level: QualityLevel): void {
    qualityLevel = level;
    quality = qualityFeatures(level);
    qualityNote.hidden = level === 0;
    qualityNote.textContent = level > 0 ? "Reduced effects for speed" : "";
    const targetResolution = quality.fullResolution
      ? baseResolution
      : Math.max(0.5, baseResolution * settings.client.lowResolutionScale);
    if (Math.abs(targetResolution - appliedResolution) > 0.01) {
      appliedResolution = targetResolution;
      app.renderer.resize(app.screen.width, app.screen.height, targetResolution);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-quality]")) {
      button.setAttribute("aria-pressed", String(button.dataset.quality === qualityPreference));
    }
  }

  function setQualityPreference(next: QualityPreference): void {
    qualityPreference = next;
    qualityGovernor.reset();
    applyQuality(qualityLevelForPreference(next, 0));
  }

  // The screen layers are in screen pixels. Chart blocks are built for one
  // camera snapshot and shifted while the player pans. There are no screen
  // sized render textures and no alpha masks.
  const grainLayer = new Container();
  const grain = new Graphics();
  grainLayer.addChild(grain);

  // Blank paper, then opaque remembered sea and land. Opaque pre-mixed colours
  // mean neighbouring blocks cannot blend into block-sized rectangles.
  const unknownPaper = new Graphics();
  const dimSea = new Graphics();
  const dimBlockLayer = new Container();

  // The chart is a fixed low-resolution texture of the received blocks.
  const chartBlockLayer = new Container();
  const chartSprite = new Sprite();
  chartBlockLayer.addChild(chartSprite);
  chartBlockLayer.visible = false;

  // Close-in chart detail: remembered sea cells plus the real block geometry,
  // painted with the same dimmed palette as the ship view.
  const chartVectorLayer = new Container();
  const chartVectorSea = new Graphics();
  const chartVectorBlocks = new Container();
  chartVectorLayer.addChild(chartVectorSea, chartVectorBlocks);
  chartVectorLayer.visible = false;

  // The night wash sits above the chart but below live circles, ships and HUD.
  const nightTint = new Graphics();
  const liveHalo = new Graphics();

  const liveMapLayer = new Container();
  const liveSea = new Graphics();
  const liveBlockLayer = new Container();
  liveMapLayer.addChild(liveSea, liveBlockLayer);

  // A geometry mask made from one Graphics full of circles. It must stay
  // renderable: Pixi builds a stencil mask from the mask graphic's renderables.
  const liveMask = new Graphics();
  liveMapLayer.mask = liveMask;

  // Port markers and their labels live in screen pixels above the map but
  // below ships. Only ports already found by this player reach this layer.
  const portLayer = new Container();
  const portRangeInk = new Graphics();
  portLayer.addChild(portRangeInk);

  // The selected ship's planned route sits above the map and below ports.
  const routeLayer = new Container();
  const trailInk = new Graphics();
  const routeInk = new Graphics();
  const routeLabels = new Container();
  routeLayer.addChild(trailInk, routeInk, routeLabels);
  routeLayer.visible = false;

  const headingPreviewInk = new Graphics();
  routeLayer.addChild(headingPreviewInk);

  // A rubber-band box for multi-select drags, in screen pixels.
  const selectionBoxInk = new Graphics();
  selectionBoxInk.visible = false;

  const marker = new Graphics();
  marker.circle(0, 0, 9).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(-14, 0).lineTo(-7, 0).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(7, 0).lineTo(14, 0).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(0, -14).lineTo(0, -7).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(0, 7).lineTo(0, 14).stroke({ width: 2, color: INK_COLOR });
  marker.visible = false;

  const fleetLayer = new Container();
  // Fire and status ink sit above every hull, and their labels above the ink.
  // Keeping these as separate stage layers prevents a later hull from covering
  // a burning ship and guarantees labels stay readable.
  const shipFxLayer = new Container();
  const shipFxInk = new Graphics();
  shipFxLayer.addChild(shipFxInk);
  const shipLabelLayer = new Container();
  const galleryLayer = new Container();
  const galleryInk = new Graphics();
  const galleryLabel = new Text({
    text: "",
    style: { fontFamily: "Source Sans 3", fontSize: 16, fill: INK_COLOR },
  });
  galleryLabel.anchor.set(0.5, 0);
  galleryLayer.addChild(galleryInk, galleryLabel);
  galleryLayer.visible = false;
  const fleetGroupLayer = new Container();
  const fleetFormationInk = new Graphics();
  fleetGroupLayer.addChild(fleetFormationInk);
  const combatFxInk = new Graphics();
  const combatRangeInk = new Graphics();
  const rangeCheckLayer = new Container();
  const rangeCheckLabels = [0, 1, 2].map(() => new Text({
    text: "",
    style: { fontFamily: "Source Sans 3", fontSize: 11, fill: INK_COLOR, fontWeight: "700" },
  }));
  for (const label of rangeCheckLabels) {
    label.anchor.set(0.5, 0);
    rangeCheckLayer.addChild(label);
  }
  rangeCheckLayer.visible = false;
  const lastSeenLayer = new Container();
  const windLayer = new Graphics();
  const borderLayer = new Graphics();
  const rulerLayer = new Container();
  const rulerLine = new Graphics();
  const rulerText = new Text({
    text: "",
    style: { fontFamily: "Source Sans 3", fontSize: 12, fill: INK_COLOR },
  });
  rulerLayer.addChild(rulerLine, rulerText);
  rulerLayer.visible = false;

  app.stage.addChild(
    unknownPaper,
    dimSea,
    dimBlockLayer,
    chartBlockLayer,
    chartVectorLayer,
    nightTint,
    liveHalo,
    liveMapLayer,
    liveMask,
    selectionBoxInk,
    routeLayer,
    combatRangeInk,
    rangeCheckLayer,
    portLayer,
    lastSeenLayer,
    fleetLayer,
    shipFxLayer,
    shipLabelLayer,
    fleetGroupLayer,
    combatFxInk,
    galleryLayer,
    windLayer,
    borderLayer,
    grainLayer,
    marker,
    rulerLayer,
  );

  const startPoint = lonLatToMap(
    settings.navies.British.start.lonDeg,
    settings.navies.British.start.latDeg,
  );
  const view: Camera = {
    x: startPoint.x,
    y: startPoint.y,
    kmAcross: settings.view.startKmAcross,
    follow: true,
  };

  let mode: ViewMode = "ship";
  type LogTab = "chart" | "queued" | "fleets" | "trade" | "research";
  let sailorsLogOpen = false;
  let activeLogTab: LogTab = "chart";
  let logChartPick: { kind: "patrol"; fleetId: string; points: Array<{ x: number; y: number }> } |
    { kind: "rendezvous"; fleetId: string } | null = null;
  let logRulerPoints: Array<{ x: number; y: number }> = [];
  let logRulerArmed = false;
  let logChartCentred = false;
  let serverMoonPhase: number | null = null;
  let latestRoutes: TradeRouteSnapshot[] = [];
  let latestPortIncome: PortIncomeSnapshot | null = null;
  let editingRouteId: string | null = null;
  let routePick: "a" | "b" | null = null;
  let windToolOn = false;
  let rangeCheckOn = false;
  let showFlagshipPennant = readSavedFlagshipPennant();
  let showRouteLine = readSavedRouteLine();
  let chartTrailMode: ChartTrailMode = settings.journey.defaultChartTrail;
  const trailPoints = new Map<string, Array<[number, number]>>();
  let lostMarks: Array<[number, number]> = [];
  let savedShipView: Camera = { ...view };
  let builtView = { x: view.x, y: view.y };
  let builtScale = 0;
  let builtRevision = -1;
  let chartRevision = 0;
  let chartServerCells = 0;
  let lastMapBuild = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  const ships = new Map<string, ShipView>();
  const portData = new Map<string, PortInfo>();
  const portViews = new Map<string, {
    container: Container;
    mark: Graphics;
    label: Text;
    radius: number;
    styleKey: string;
  }>();
  let laidOutPorts: PortMarkerPlan[] = [];
  let ownSnapshot: ShipSnapshot | null = null;
  let fleetShips: OwnShipSnapshot[] = [];
  let playerFleets: FleetSnapshot[] = [];
  let controlGroups: Record<number, string[]> = {};
  let selectedShipId = "";
  let selectedFleetId: string | null = null;
  let multiSelect = false;
  let queueOrders = false;
  let orderMenuPoint: { x: number; y: number } | null = null;
  let orderMenuTarget: { kind: "ship" | "port"; id: string } | null = null;
  let armedOrder: ControlOrder | null = null;
  let controlsHintStage = 0;
  let pendingPatrolFrom: { x: number; y: number } | null = null;
  let pendingPatrolFleetId: string | null = null;
  let pendingRendezvous = false;
  let headingForFleet: string | null = null;
  let headingPreviewOn = false;
  let lastOwnTap = { id: "", at: 0 };
  let boxPointer: number | null = null;
  let boxStart = { x: 0, y: 0 };
  let boxCurrent = { x: 0, y: 0 };
  let boxDragged = false;
  let damageShipId: string | null = null;
  let battleLogKey = "";
  let selectedEnemyId: string | null = null;
  let surrenderFlags = new Set<string>();
  let abandonedFlags = new Set<string>();
  let burningFlags = new Set<string>();
  let burningStrength = new Map<string, number>();
  let nightLightsOff = new Set<string>();
  let sinkingFlags = new Set<string>();
  let grappledPairs: Array<[string, string]> = [];
  let effectGalleryOn = false;
  let effectGalleryStartedAt = 0;
  let surrenderConfirmShipId: string | null = null;
  let latestRoster: Array<{ id: string; name: string; navy: NavyId }> = [];
  let latestOut: StateMessage["out"] | null = null;
  let latestGo: StateMessage["go"] | null = null;
  let latestRoomKind: StateMessage["k"] = "normal";
  let resignSelection: string | "nobody" | null = null;
  let eliminatedClosed = false;
  let victoryClosed = false;
  let lastOutKey = "";
  let lastGoAt = -1;
  let surrenderOfferShipId: string | null = null;
  let surrenderOfferKey = "";
  const surrenderDismissed = new Set<string>();
  let battleBarKey = "";
  let boardTargetId: string | null = null;
  let npcContacts = new Map<string, NpcContactSnapshot>();
  let npcEscorts: EscortSnapshot[] = [];
  let lootTargetId: string | null = null;
  let privateerSheetId: string | null = null;
  let escortPrivateerId: string | null = null;
  let fireActionMode: "none" | "ignitePick" | "igniteConfirm" | "towPick" = "none";
  let fireActionShipId: string | null = null;
  let fireTargetId: string | null = null;
  let crewClaimPrizeId: string | null = null;
  let capturedShipId: string | null = null;
  let lastSunkAt: { x: number; y: number } | null = null;
  interface CombatFx {
    kind: "fire" | "hit" | "miss" | "sunk";
    x: number;
    y: number;
    side?: "port" | "starboard" | "bow" | "stern";
    shipId?: string;
    at: number;
  }
  const combatFx: CombatFx[] = [];
  const selectedShipIds = new Set<string>();
  let actionShipId: string | null = null;
  let actionPortId: string | null = null;
  let money = 0;
  let playerNavy: NavyId = "British";
  let latestResearch: NonNullable<StateMessage["research"]> | null = null;
  let researchRenderKey = "";
  let researchUnitsSeen = -1;
  let lastResearchNoticeAt = 0;
  const openResearchBranches = new Set<string>(["A"]);
  let researchDetailId: string | null = null;
  let researchZoom = 1;
  let researchPanX = 0;
  let researchPanY = 0;
  let selectedPortId: string | null = null;
  let attackedPortId: string | null = null;
  let shipyardPortId: string | null = null;

  /** One failed draw layer must not stop the rest of the scene. */
  function safeLayer(name: string, draw: () => void): void {
    runDrawLayer(draw, (error) => reportClientError(error, `draw layer: ${name}`));
  }
  let namingClass: BuyableShipClassId | null = null;
  let hirePortId: string | null = null;
  let tradePortId: string | null = null;
  let tradeShipId: string | null = null;
  let tradeTab: "buy" | "sell" | "storage" = "buy";
  let tradeRenderKey = "";
  let hungerMultiplier: number | undefined;
  const tradeAmounts = new Map<string, number>();
  let storeRenderKey = "";
  let lastSeen: LastSeenSnapshot[] = [];
  let lastSeenViews: Container[] = [];
  let lastRouteKey = "";
  let fleetPanelKey = "";

  interface BlockPaint {
    blockId: string;
    dim: Graphics;
    live: Graphics;
  }
  const blockPaints = new Map<string, BlockPaint>();

  const chartPaperGraphics = new Graphics();
  const chartPaperLayer = new Container();
  chartPaperLayer.addChild(chartPaperGraphics);
  const chartGraphics = new Graphics();
  const chartBuildLayer = new Container();
  chartBuildLayer.addChild(chartGraphics);
  let chartTexture: RenderTexture | null = null;
  let chartTextureScale = 1;
  let chartCacheInitialized = false;
  let lastChartBuild = 0;
  let liveBlockGraphics = 0;
  let discoveredOutline: OutlineRing[] = [];
  let outlineRevision = -1;
  let outlineCellCount = -1;
  let outlineBuiltAt = 0;

  interface ChartViewPose {
    x: number;
    y: number;
    kmAcross: number;
    width: number;
    height: number;
    scale: number;
  }
  const chartViewLayer = new Container();
  const chartViewPaper = new Graphics();
  const chartViewBlocks = new Container();
  chartViewLayer.addChild(chartViewPaper, chartViewBlocks);
  let chartViewTexture: RenderTexture | null = null;
  let chartViewPose: ChartViewPose | null = null;
  let chartViewPendingKey = "";
  let chartViewPendingRevision = -1;
  let chartViewDirty = true;
  let chartViewSettledAt = 0;

  const chartMemory = createChartMemory();
  const blocks = chartMemory.blocks;
  const discovered = chartMemory.discovered;
  const chartDirtyBlocks = new Set<string>();
  let chartBlocksRemaining = 0;

  let roomKind: RoomKind = "normal";
  let chartAll = false;
  let debugInfo: FogDebugInfo = {};
  const receivedAt: number[] = [];
  let receivedGapMaxMs = 0;
  let ownId = "";
  let socket: WebSocket | null = null;
  let target: { x: number; y: number } | null = null;
  let retry: number | null = null;
  let takenOver = false;
  let bordersVisible = layoutDebug;
  let layoutIssueCount = 0;
  let layoutAuditFrame = 0;
  const tapStorage = browserStorage("localStorage");
  let suspectSegments = 0;
  let noticeTimer = 0;
  let noticeHideTimer = 0;
  let windFrom: number = settings.weather.windFromDeg;
  const graphicsRecovery = new GraphicsRecovery();
  let graphicsResets = 0;
  let frameCount = 0;
  let fpsWindowAt = performance.now();
  let fps = 0;
  let lastDebugLineAt = 0;
  let lastShipsDrawnText = "";
  let lastFrameAt = 0;
  const frameDurations: Array<{ at: number; ms: number }> = [];
  // 3J-fix-a: screen-space movement of the drawn ships, sampled every frame.
  const drawnSteps: Array<{ at: number; own: number; otherMax: number }> = [];
  const lastDrawnPositions = new Map<string, { x: number; y: number }>();
  let lastStateReceivedAt = 0;
  let latestTick = 0;
  let cachedState: StateMessage | null = null;
  let pendingStateMessages: StateMessage[] = [];
  let nextOrderId = 0;
  let lastCommandSent: Record<string, unknown> = {};
  const pendingOrders = new Map<string, { at: number; label: string }>();
  interface OrderDebugEntry {
    at: number;
    command: string;
    ship: string;
    target: string;
    result: string;
    reason: string;
  }
  const orderDebugLog: OrderDebugEntry[] = [];
  let debugLogOpen = false;
  let pingAt = 0;
  let pingMs = 0;
  let lastPingSentAt = 0;
  let lastFocusSentAt = 0;
  let lastPerfRenderAt = 0;
  let serverWorldMs = 0;
  const inboundSamples: Array<{ at: number; bytes: number; messages: number }> = [];
  let domUpdateCount = 0;
  let domUpdateSamples: Array<{ at: number; count: number }> = [];
  let lastPassiveAt = 0;
  const domThrottle = new DomThrottle();

  // The server owns game time. The page predicts forward at the game rate and
  // gently settles onto each received value instead of jumping the display.
  let clockTargetMs = 0;
  let clockTargetAt = 0;
  let clockShownMs = 0;
  let clockStarted = false;
  let clockFrameAt = 0;
  let lastClockText = "";

  const scale = (): number =>
    cameraScale(app.screen.width, app.screen.height, view.kmAcross);

  function toScreen(x: number, y: number): { x: number; y: number } {
    return worldToScreen(
      { x, y },
      view,
      app.screen.width,
      app.screen.height,
    );
  }

  function toWorld(screenX: number, screenY: number): { x: number; y: number } {
    return screenToWorld(
      screenX,
      screenY,
      view,
      app.screen.width,
      app.screen.height,
    );
  }

  function builtScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: app.screen.width / 2 + (x - builtView.x) * builtScale,
      y: app.screen.height / 2 + (y - builtView.y) * builtScale,
    };
  }

  function wholeMapKmAcross(): number {
    if (app.screen.width <= 0 || app.screen.height <= 0) return MAP_WIDTH_KM;
    const kmPerPixel = Math.max(
      MAP_WIDTH_KM / app.screen.width,
      MAP_HEIGHT_KM / app.screen.height,
    );
    return kmPerPixel * Math.min(app.screen.width, app.screen.height) * WHOLE_MAP_MARGIN;
  }

  function maxViewKmAcross(): number {
    return mode === "chart" ? wholeMapKmAcross() : settings.view.shipMaxKmAcross;
  }

  function minViewKmAcross(): number {
    return mode === "chart"
      ? settings.view.chartMinKmAcross
      : settings.view.shipMinKmAcross;
  }

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.dataset.state = isError ? "error" : "ok";
  }

  function setFollow(on: boolean): void {
    view.follow = on;
  }

  let lastNoticeText = "";
  let lastNoticeAt = 0;
  function showNotice(
    text: string,
    options: { persistent?: boolean; reload?: boolean } = {},
  ): void {
    const now = performance.now();
    if (text === lastNoticeText && now - lastNoticeAt < 1_000) return;
    lastNoticeText = text;
    lastNoticeAt = now;
    window.clearTimeout(noticeTimer);
    window.clearTimeout(noticeHideTimer);
    if (!notice.hidden && notice.textContent && notice.textContent !== text) {
      noticeSecond.textContent = notice.textContent;
      noticeSecond.hidden = false;
    }
    if (text === lastNoticeText && !notice.hidden) {
      noticeSecond.textContent = text;
      noticeSecond.hidden = false;
    }
    notice.textContent = text;
    notice.hidden = false;
    notice.dataset.reload = options.reload ? "true" : "false";
    notice.setAttribute("role", options.reload ? "button" : "status");
    if (options.reload) notice.tabIndex = 0;
    else notice.removeAttribute("tabindex");
    requestAnimationFrame(() => notice.classList.add("is-visible"));

    if (options.persistent) return;

    noticeTimer = window.setTimeout(() => {
      notice.classList.remove("is-visible");
      noticeHideTimer = window.setTimeout(() => {
        notice.hidden = true;
        noticeSecond.hidden = true;
      }, 300);
    }, 3_500);
  }

  // ---- Paper and fog ------------------------------------------------------

  /** A few fixed fibres and stains, so blank areas read as old paper. */
  function drawGrain(): void {
    grain.clear();
    const width = app.screen.width;
    const height = app.screen.height;
    for (let index = 0; index < 90; index += 1) {
      const x = ((index * 79) % Math.max(1, width)) + ((index * 13) % 17) - 8;
      const y = ((index * 137) % Math.max(1, height)) + ((index * 7) % 11) - 5;
      const length = 5 + ((index * 11) % 22);
      const slant = ((index % 5) - 2) * 0.7;
      grain
        .moveTo(x, y)
        .lineTo(x + length, y + slant)
        .stroke({ width: 0.6, color: PAPER_INK, alpha: 0.1 });
    }
    for (let index = 0; index < 10; index += 1) {
      const x = (index * 211 + 37) % Math.max(1, width);
      const y = (index * 97 + 19) % Math.max(1, height);
      grain
        .ellipse(x, y, 16 + (index % 4) * 5, 9 + (index % 3) * 4)
        .fill({ color: PAPER_INK, alpha: 0.035 });
    }
  }

  /** Rebuild the outline only after cells change, at most every 200 ms. */
  function refreshDiscoveredOutline(now: number, force = false): void {
    if (chartAll) {
      discoveredOutline = [];
      outlineRevision = chartRevision;
      outlineCellCount = discovered.size;
      return;
    }
    if (
      !force &&
      outlineRevision === chartRevision &&
      outlineCellCount === discovered.size
    ) {
      return;
    }
    if (!force && now - outlineBuiltAt < 200) return;
    discoveredOutline = buildDiscoveredOutline(
      discovered,
      chartColumns,
      chartRows,
      chartCellKm,
    ).rings;
    outlineRevision = chartRevision;
    outlineCellCount = discovered.size;
    outlineBuiltAt = now;
  }

  function paintDiscoveredWash(graphics: Graphics, holeColor: number): void {
    for (const ring of discoveredOutline) {
      const points: number[] = [];
      for (let index = 0; index < ring.points.length; index += 2) {
        const point = toScreen(ring.points[index]!, ring.points[index + 1]!);
        points.push(point.x, point.y);
      }
      if (points.length < 6) continue;
      graphics.poly(points).fill(ring.area < 0 ? holeColor : DIM_SEA_COLOR);
    }
  }

  /** Paint stained paper, then the smooth discovered wash in opaque sea. */
  function refreshFogPaper(): void {
    unknownPaper.clear();
    dimSea.clear();

    if (mode === "chart" || app.screen.width <= 0) {
      unknownPaper.visible = false;
      dimSea.visible = false;
      return;
    }

    unknownPaper.visible = true;
    dimSea.visible = true;
    unknownPaper.rect(0, 0, app.screen.width, app.screen.height).fill(PAPER_COLOR);

    if (chartAll) {
      dimSea.rect(0, 0, app.screen.width, app.screen.height).fill(DIM_SEA_COLOR);
      return;
    }
    paintDiscoveredWash(dimSea, PAPER_COLOR);
  }

  // ---- Map geometry -------------------------------------------------------

  function blockInView(block: ChartBlock, left: number, top: number, right: number, bottom: number): boolean {
    return !(
      block.x + block.km < left ||
      block.x > right ||
      block.y + block.km < top ||
      block.y > bottom
    );
  }

  /** Draw the same pure command list the chart audit checks. */
  function drawBlockCommands(
    graphics: Graphics,
    block: ChartBlock,
    land: number,
    water: number,
    ink: number,
  ): void {
    const commands = buildBlockCommands(
      block,
      settings.view.waterLinePx,
      settings.view.coastLinePx,
    );
    for (const command of commands.fills) {
      const points: number[] = [];
      for (let index = 0; index < command.ring.length; index += 2) {
        const point = builtScreen(command.ring[index]!, command.ring[index + 1]!);
        points.push(point.x, point.y);
      }
      graphics.poly(points).fill(land);
    }
    for (const command of commands.strokes) {
      const line = command.line;
      const first = builtScreen(line[0]!, line[1]!);
      graphics.moveTo(first.x, first.y);
      for (let index = 2; index < line.length; index += 2) {
        const point = builtScreen(line[index]!, line[index + 1]!);
        graphics.lineTo(point.x, point.y);
      }
      graphics.stroke({
        width: command.widthPx,
        color: command.layer === "water" ? water : ink,
        alpha: 1,
        cap: "round",
        join: "round",
      });
    }
  }

  function paintBlock(
    graphics: Graphics,
    block: ChartBlock,
    land: number,
    water: number,
    ink: number,
  ): void {
    drawBlockCommands(graphics, block, land, water, ink);
  }

  function destroyBlockPaints(): void {
    for (const paint of blockPaints.values()) {
      dimBlockLayer.removeChild(paint.dim);
      liveBlockLayer.removeChild(paint.live);
      paint.dim.destroy();
      paint.live.destroy();
    }
    blockPaints.clear();
    liveBlockGraphics = 0;
  }

  function screenBlockList(): ChartBlock[] {
    const s = scale();
    const margin = settings.view.blockMarginScreens;
    const halfWidth = app.screen.width / (2 * s);
    const halfHeight = app.screen.height / (2 * s);
    const keep = 1 + margin * 2;
    const left = view.x - halfWidth * keep;
    const right = view.x + halfWidth * keep;
    const top = view.y - halfHeight * keep;
    const bottom = view.y + halfHeight * keep;

    const visible = orderedChartBlocks(blocks).filter((block) =>
      blockInView(block, left, top, right, bottom),
    );
    if (visible.length <= settings.view.maxLiveBlockGraphics) return visible;

    // Keep the nearest blocks when a huge dev chart is loaded. Sorting by id
    // afterwards keeps the paint order deterministic.
    return [...visible]
      .sort((a, b) => {
        const da = Math.hypot(a.x + a.km / 2 - view.x, a.y + a.km / 2 - view.y);
        const db = Math.hypot(b.x + b.km / 2 - view.x, b.y + b.km / 2 - view.y);
        return da - db || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      })
      .slice(0, settings.view.maxLiveBlockGraphics)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  function rebuildShipBlocks(): void {
    destroyBlockPaints();
    const visible = screenBlockList();
    for (const block of visible) {
      const dim = new Graphics();
      paintBlock(dim, block, DIM_LAND_COLOR, DIM_WATERLINE_COLOR, DIM_INK_COLOR);
      dimBlockLayer.addChild(dim);

      const live = new Graphics();
      paintBlock(live, block, LAND_COLOR, WATERLINE_COLOR, INK_COLOR);
      liveBlockLayer.addChild(live);

      blockPaints.set(block.id, { blockId: block.id, dim, live });
    }
    liveBlockGraphics = visible.length;
  }

  function chartTextureDimensions(): { width: number; height: number; scale: number } {
    const max = settings.view.chartCacheMaxPx;
    const scale = Math.min(max / MAP_WIDTH_KM, max / MAP_HEIGHT_KM);
    return {
      width: Math.max(1, Math.round(MAP_WIDTH_KM * scale)),
      height: Math.max(1, Math.round(MAP_HEIGHT_KM * scale)),
      scale,
    };
  }

  function markAllChartDirty(): void {
    chartDirtyBlocks.clear();
    if (!chartMemory.all) {
      for (const cell of discovered) chartDirtyBlocks.add(blockIdForCell(cell));
    }
    for (const id of blocks.keys()) chartDirtyBlocks.add(id);
  }

  function updateCharting(): void {
    const plan = buildChartRenderPlan(chartMemory, chartBlocksRemaining);
    chartingOut.hidden = !plan.charting;
  }

  function ensureChartTexture(): void {
    const dimensions = chartTextureDimensions();
    chartTextureScale = dimensions.scale;
    if (
      chartTexture &&
      chartTexture.width === dimensions.width &&
      chartTexture.height === dimensions.height
    ) {
      return;
    }

    chartTexture?.destroy(true);
    chartTexture = RenderTexture.create({
      width: dimensions.width,
      height: dimensions.height,
      resolution: 1,
      antialias: false,
    });
    chartSprite.texture = chartTexture;
    chartSprite.width = MAP_WIDTH_KM;
    chartSprite.height = MAP_HEIGHT_KM;
    chartCacheInitialized = false;
    markAllChartDirty();
  }

  function paintChartBase(): void {
    const width = chartTexture?.width ?? 0;
    const height = chartTexture?.height ?? 0;
    if (!chartTexture || width <= 0 || height <= 0) return;
    chartPaperGraphics.clear();
    chartPaperGraphics.rect(0, 0, width, height).fill(PAPER_COLOR);
    if (chartAll) chartPaperGraphics.rect(0, 0, width, height).fill(DIM_SEA_COLOR);
    app.renderer.render({
      container: chartPaperLayer,
      target: chartTexture,
      clear: true,
    });
    chartCacheInitialized = true;
  }

  function chartBlockArea(id: string): { x: number; y: number; km: number } {
    const block = blocks.get(id);
    if (block) return { x: block.x, y: block.y, km: block.km };
    const match = /^(\d+)_(\d+)$/.exec(id);
    const column = Number(match?.[1] ?? 0);
    const row = Number(match?.[2] ?? 0);
    return { x: column * chartBlockKm, y: row * chartBlockKm, km: chartBlockKm };
  }

  function paintChartDirtyBlocks(ids: readonly string[]): void {
    if (!chartTexture || ids.length === 0) return;
    const scale = chartTextureScale;
    chartGraphics.clear();

    for (const id of ids) {
      const area = chartBlockArea(id);
      const left = area.x * scale;
      const top = area.y * scale;
      const size = area.km * scale;
      chartGraphics.rect(left, top, size, size).fill(PAPER_COLOR);

      // &chartdebug=1 colors the real discovery cells: red for undiscovered,
      // green for discovered, with the paper/land drawn over them.
      if (chartDebug && (roomKind === "test" || roomKind === "dev")) {
        chartGraphics.rect(left, top, size, size).fill(0xc85a4a);
      }
      // A discovered cell gets the pale remembered-sea wash. The chart must
      // not rely on a land block being present: open ocean has no geometry.
      if (chartAll) {
        chartGraphics.rect(left, top, size, size).fill(DIM_SEA_COLOR);
      } else {
        const firstColumn = Math.max(0, Math.floor(area.x / chartCellKm));
        const lastColumn = Math.min(
          chartColumns - 1,
          Math.ceil((area.x + area.km) / chartCellKm) - 1,
        );
        const firstRow = Math.max(0, Math.floor(area.y / chartCellKm));
        const lastRow = Math.min(
          chartRows - 1,
          Math.ceil((area.y + area.km) / chartCellKm) - 1,
        );
        for (let row = firstRow; row <= lastRow; row += 1) {
          for (let column = firstColumn; column <= lastColumn; column += 1) {
            if (!discovered.has(row * chartColumns + column)) continue;
            chartGraphics
              .rect(column * chartCellKm * scale, row * chartCellKm * scale, chartCellKm * scale, chartCellKm * scale)
              .fill(chartDebug ? 0x4a8c5a : DIM_SEA_COLOR);
          }
        }
      }

      const block = blocks.get(id);
      if (!block) continue;
      const commands = buildBlockCommands(
        block,
        settings.view.waterLinePx,
        settings.view.coastLinePx,
      );
      for (const command of commands.fills) {
        const points: number[] = [];
        for (let index = 0; index < command.ring.length; index += 2) {
          points.push(command.ring[index]! * scale, command.ring[index + 1]! * scale);
        }
        chartGraphics.poly(points).fill(LAND_COLOR);
      }
      for (const command of commands.strokes) {
        const line = command.line;
        chartGraphics.moveTo(line[0]! * scale, line[1]! * scale);
        for (let index = 2; index < line.length; index += 2) {
          chartGraphics.lineTo(line[index]! * scale, line[index + 1]! * scale);
        }
        chartGraphics.stroke({
          width: command.widthPx,
          color: command.layer === "water" ? WATERLINE_COLOR : INK_COLOR,
          alpha: 1,
          cap: "round",
          join: "round",
        });
      }
    }

    app.renderer.render({
      container: chartBuildLayer,
      target: chartTexture,
      clear: false,
    });
  }

  /**
   * Repaint only dirty 25 km blocks into the cached chart texture. If the
   * throttle says wait, the dirty set stays intact and the next frame retries.
   */
  function repaintChartCache(now: number): boolean {
    if (chartCacheInitialized && chartDirtyBlocks.size === 0) return true;

    ensureChartTexture();
    const plan = nextChartRepaint({
      initialized: chartCacheInitialized,
      dirtyBlockIds: [...chartDirtyBlocks],
      now,
      lastPaintAt: lastChartBuild,
      throttleMs: settings.view.chartCacheRebuildMs,
    });
    if (!plan.paint) return false;
    if (plan.base) paintChartBase();

    const ids = plan.base ? [...chartDirtyBlocks].sort() : plan.blockIds;
    paintChartDirtyBlocks(ids);
    for (const id of ids) chartDirtyBlocks.delete(id);
    lastChartBuild = now;
    return chartDirtyBlocks.size === 0;
  }

  function drawChartVector(): void {
    chartVectorSea.clear();
    for (const child of [...chartVectorBlocks.children]) child.destroy();

    const s = scale();
    const halfW = app.screen.width / (2 * s);
    const halfH = app.screen.height / (2 * s);
    const plan = planChartDetail({
      blocks,
      discovered,
      viewport: {
        left: view.x - halfW,
        top: view.y - halfH,
        right: view.x + halfW,
        bottom: view.y + halfH,
      },
      kmAcross: view.kmAcross,
      thresholdKm: settings.view.chartDetailThresholdKm,
      chartAll,
      maxBlocks: settings.view.maxLiveBlockGraphics,
    });

    if (chartAll) {
      chartVectorSea
        .rect(0, 0, app.screen.width, app.screen.height)
        .fill(DIM_SEA_COLOR);
    } else {
      paintDiscoveredWash(chartVectorSea, PAPER_COLOR);
    }

    for (const block of plan.blocks) {
      const graphics = new Graphics();
      paintBlock(
        graphics,
        block,
        DIM_LAND_COLOR,
        DIM_WATERLINE_COLOR,
        DIM_INK_COLOR,
      );
      chartVectorBlocks.addChild(graphics);
    }
  }

  /** Render the settled view into a view-sized texture. The texture is
   *  transformed from the previous camera until the new one is ready. */
  function renderChartViewTexture(now: number): void {
    const width = app.screen.width;
    const height = app.screen.height;
    if (width <= 0 || height <= 0) return;
    const dimensions = chartTextureSize(
      width,
      height,
      window.devicePixelRatio || 1,
      settings.view.chartCacheMaxPx,
    );
    const textureWidth = dimensions.width;
    const textureHeight = dimensions.height;

    if (
      !chartViewTexture ||
      chartViewTexture.width !== textureWidth ||
      chartViewTexture.height !== textureHeight
    ) {
      chartViewTexture?.destroy(true);
      chartViewTexture = RenderTexture.create({
        width: textureWidth,
        height: textureHeight,
        resolution: 1,
        antialias: true,
      });
      chartSprite.texture = chartViewTexture;
    }

    chartViewPaper.clear();
    chartViewPaper.rect(0, 0, width, height).fill(PAPER_COLOR);
    if (chartAll) {
      chartViewPaper.rect(0, 0, width, height).fill(DIM_SEA_COLOR);
    } else {
      paintDiscoveredWash(chartViewPaper, PAPER_COLOR);
    }

    for (const child of [...chartViewBlocks.children]) child.destroy();
    const s = scale();
    const halfW = width / (2 * s);
    const halfH = height / (2 * s);
    const plan = planChartDetail({
      blocks,
      discovered,
      viewport: {
        left: view.x - halfW,
        top: view.y - halfH,
        right: view.x + halfW,
        bottom: view.y + halfH,
      },
      kmAcross: view.kmAcross,
      thresholdKm: settings.view.chartDetailThresholdKm,
      chartAll,
      maxBlocks: settings.view.maxLiveBlockGraphics,
    });
    for (const block of plan.blocks) {
      // A block smaller than a pixel cannot show a meaningful coast ring.
      if (block.km * s < 1) continue;
      const graphics = new Graphics();
      paintBlock(
        graphics,
        block,
        DIM_LAND_COLOR,
        DIM_WATERLINE_COLOR,
        DIM_INK_COLOR,
      );
      chartViewBlocks.addChild(graphics);
    }

    chartViewLayer.scale.set(textureWidth / width, textureHeight / height);
    app.renderer.render({
      container: chartViewLayer,
      target: chartViewTexture,
      clear: true,
    });
    chartViewLayer.scale.set(1, 1);

    chartViewPose = {
      x: view.x,
      y: view.y,
      kmAcross: view.kmAcross,
      width,
      height,
      scale: s,
    };
    chartViewPendingKey = [
      view.x,
      view.y,
      view.kmAcross,
      width,
      height,
    ].join("|");
    chartViewPendingRevision = chartRevision;
    chartViewDirty = false;
    chartViewSettledAt = now;
    chartSprite.visible = true;
  }

  function drawMap(now: number): void {
    const s = scale();
    builtView = { x: view.x, y: view.y };
    builtScale = s;

    if (app.screen.width <= 0) return;

    if (mode === "chart") {
      destroyBlockPaints();
      dimSea.clear();
      unknownPaper.clear();
      dimSea.visible = false;
      unknownPaper.visible = false;
      dimBlockLayer.visible = false;
      chartVectorLayer.visible = false;
      chartBlockLayer.visible = true;
      chartBlockLayer.alpha = 1;

      const poseKey = [view.x, view.y, view.kmAcross, app.screen.width, app.screen.height].join("|");
      if (poseKey !== chartViewPendingKey) {
        chartViewPendingKey = poseKey;
        chartViewDirty = true;
        chartViewSettledAt = now;
      }
      if (chartRevision !== chartViewPendingRevision) {
        chartViewPendingRevision = chartRevision;
        chartViewDirty = true;
        chartViewSettledAt = now;
      }
      if (!chartViewTexture || (chartViewDirty && now - chartViewSettledAt >= 200)) {
        renderChartViewTexture(now);
        builtRevision = chartRevision;
        lastMapBuild = now;
      }
      drawSuspects();
      return;
    }

    chartBlockLayer.visible = false;
    chartVectorLayer.visible = false;
    dimBlockLayer.visible = true;
    unknownPaper.visible = true;
    dimSea.visible = true;
    rebuildShipBlocks();
    builtRevision = chartRevision;
    lastMapBuild = now;
    drawSuspects();
  }

  /** The previous chart texture is transformed while a gesture is in flight. */
  function updateChartSpriteTransform(): void {
    if (!chartViewTexture || !chartViewPose) {
      chartSprite.visible = false;
      return;
    }
    const s1 = scale();
    const s0 = chartViewPose.scale;
    const worldLeft = chartViewPose.x - chartViewPose.width / (2 * s0);
    const worldTop = chartViewPose.y - chartViewPose.height / (2 * s0);
    const origin = toScreen(worldLeft, worldTop);
    const factor = s1 / s0;
    chartSprite.position.set(origin.x, origin.y);
    chartSprite.width = chartViewPose.width * factor;
    chartSprite.height = chartViewPose.height * factor;
    chartSprite.visible = true;
  }

  function updateLayerOffset(): void {
    const x = (builtView.x - view.x) * builtScale;
    const y = (builtView.y - view.y) * builtScale;
    dimBlockLayer.position.set(x, y);
    liveMapLayer.position.set(x, y);
    liveMask.position.set(x, y);

    chartBlockLayer.position.set(0, 0);
    chartBlockLayer.scale.set(1, 1);
    updateChartSpriteTransform();
  }

  function refreshMap(now: number, force = false): void {
    if (app.screen.width <= 0 || app.screen.height <= 0) return;

    const currentScale = scale();
    const zoomChanged = Math.abs(currentScale - builtScale) > 1e-9;
    const panLimit = mode === "chart" ? 1.5 : settings.view.blockMarginScreens * 0.8;
    const farPan =
      builtScale > 0 &&
      (Math.abs(view.x - builtView.x) * builtScale > app.screen.width * panLimit ||
        Math.abs(view.y - builtView.y) * builtScale > app.screen.height * panLimit);
    const dataChanged = builtRevision !== chartRevision;
    if (mode === "chart") {
      const poseKey = [
        view.x,
        view.y,
        view.kmAcross,
        app.screen.width,
        app.screen.height,
      ].join("|");
      if (poseKey !== chartViewPendingKey) {
        chartViewPendingKey = poseKey;
        chartViewDirty = true;
        chartViewSettledAt = now;
      }
      if (chartRevision !== chartViewPendingRevision) {
        chartViewPendingRevision = chartRevision;
        chartViewDirty = true;
        chartViewSettledAt = now;
      }
    }
    const chartWaiting =
      mode === "chart" && chartViewDirty && now - chartViewSettledAt >= 200;

    if (!force && !zoomChanged && !farPan && !dataChanged && !chartWaiting) {
      updateLayerOffset();
      return;
    }

    // A zoom changes the map's pixels, so rebuild it in this frame. Throttling
    // this was why ports and ships drifted away from the coast while zooming.
    drawMap(now);
    updateLayerOffset();
  }

  // ---- Live sight circles -------------------------------------------------

  function updateLiveCircles(): void {
    liveSea.clear();
    liveMask.clear();

    if (mode !== "ship" || builtScale <= 0) {
      liveMapLayer.visible = false;
      liveHalo.clear();
      return;
    }

    const own = activeOwnViews();
    if (own.length === 0) {
      liveMapLayer.visible = false;
      liveHalo.clear();
      return;
    }

    liveMapLayer.visible = true;
    liveBlockLayer.visible = true;
    liveHalo.clear();
    const rings = settings.view.sightFeatherRings;
    const featherPx = settings.fog.sightFeatherKm * builtScale;
    const light = sightLightNow();
    const dayAlpha = light.daylight;
    const nightAlpha = 1 - dayAlpha;
    const pxPerKm = scale();

    for (const ship of own) {
      const centre = builtScreen(ship.x, ship.y);
      const screenCentre = toScreen(ship.x, ship.y);
      const daySightKm = daySightKmForClass(ship.classId);
      const ownRangeKm = sightRangeKm(
        { daySightKm, lightsOn: false },
        light.daylight,
        light.moon,
        false,
      );
      const lit = ship.lightsOff !== true;

      // Day: one soft light disc at the full day radius.
      if (dayAlpha > 0.001) {
        const dayPx = daySightKm * pxPerKm;
        liveSea.circle(centre.x, centre.y, dayPx)
          .fill({ color: SEA_COLOR, alpha: dayAlpha });
        liveMask.circle(centre.x, centre.y, dayPx).fill(0xffffff);
        for (let ring = 1; ring <= rings; ring += 1) {
          const share = ring / rings;
          liveHalo
            .circle(screenCentre.x, screenCentre.y, dayPx + featherPx * share)
            .stroke({
              width: Math.max(1, featherPx / rings),
              color: SEA_COLOR,
              alpha: dayAlpha * settings.view.sightFeatherAlpha *
                (1 - share * settings.view.sightFeatherFade),
            });
        }
      }

      // Night: a small dark own-sight disc. Lit ships add the agreed 10 km
      // warm glow, with a crisp edge on the dark disc.
      if (nightAlpha > 0.001) {
        const ownPx = ownRangeKm * pxPerKm;
        if (lit) {
          liveHalo.circle(screenCentre.x, screenCentre.y, 10 * pxPerKm)
            .fill({ color: WARM_SIGHT_COLOR, alpha: 0.08 * nightAlpha });
        }
        liveSea.circle(centre.x, centre.y, ownPx)
          .fill({ color: NIGHT_DISC_COLOR, alpha: nightAlpha });
        liveMask.circle(centre.x, centre.y, ownPx).fill(0xffffff);
        liveHalo.circle(screenCentre.x, screenCentre.y, ownPx)
          .stroke({
            width: lit ? 2 : 1,
            color: lit ? WARM_SIGHT_COLOR : NIGHT_DISC_COLOR,
            alpha: (lit ? 0.85 : 0.55) * nightAlpha,
          });
      }
    }
  }

  // ---- Port markers and paper panel --------------------------------------

  function portSizeLabel(size: PortInfo["size"]): string {
    return size === "S" ? "Small port" : size === "M" ? "Medium port" : "Large port";
  }

  function updateKnownPortsButton(): void {
    // Known ports belongs to the Menu at every view, not only the chart.
    knownPortsButton.hidden = false;
    if (mode !== "chart") knownPortsPanel.hidden = true;
  }

  function clearPortViews(): void {
    for (const view of portViews.values()) view.container.destroy({ children: true });
    portViews.clear();
    laidOutPorts = [];
  }

  /** Draw only the port state the server has already found for this player. */
  function refreshPorts(): void {
    if (app.screen.width <= 0 || app.screen.height <= 0) return;

    const own = activeOwnViews();
    const light = sightLightNow();
    const markers = layoutPortMarkers({
      width: app.screen.width,
      height: app.screen.height,
      view,
      ports: [...portData.values()],
      sight: own.map((ship) => ({
        x: ship.x,
        y: ship.y,
        radiusKm: sightRangeKm(
          { daySightKm: daySightKmForClass(ship.classId), lightsOn: false },
          light.daylight,
          light.moon,
          false,
        ),
      })),
    });
    laidOutPorts = markers;
    portRangeInk.clear();
    const rangePortId = selectedPortId ?? attackedPortId;
    const rangePort = rangePortId ? portData.get(rangePortId) : undefined;
    if (rangePort && rangePort.rangeKm && !rangePort.npc) {
      const centre = toScreen(rangePort.x, rangePort.y);
      portRangeInk
        .circle(centre.x, centre.y, rangePort.rangeKm * scale())
        .fill({ color: 0x8a6a45, alpha: 0.045 })
        .stroke({ width: 1.2, color: 0x8a6a45, alpha: 0.38 });
    }
    const active = new Set<string>();

    for (const marker of markers) {
      active.add(marker.id);
      let view = portViews.get(marker.id);
      if (!view) {
        const container = new Container();
        const mark = new Graphics();
        const label = new Text({
          text: marker.name,
          style: {
            fontFamily: "IM Fell English",
            fontSize: settings.view.portLabelFontPx,
            fill: INK_COLOR,
          },
        });
        container.addChild(mark, label);
        portLayer.addChild(container);
        view = { container, mark, label, radius: -1, styleKey: "" };
        portViews.set(marker.id, view);
      }

      const port = portData.get(marker.id);
      const ownerNavy = port?.ownerNavy ? parseNavy(port.ownerNavy) : null;
      const ink = ownerNavy ? navyColorNumber(ownerNavy) : INK_COLOR;
      const tier = port?.tier ?? 0;
      const styleKey = `${marker.radiusPx}:${tier}:${port?.owner ?? "none"}:${port?.silenced === true}`;
      if (view.styleKey !== styleKey) {
        const radius = marker.radiusPx;
        view.mark.clear();
        view.mark
          .circle(0, 0, radius)
          .fill({ color: PAPER_COLOR, alpha: 0.9 })
          .stroke({ width: tier > 0 ? 2.5 : 1.5, color: ink });
        if (tier === 0) {
          // A small inked anchor inside the ring.
          view.mark
            .circle(0, -radius * 0.28, radius * 0.14)
            .stroke({ width: 1, color: ink })
            .moveTo(0, -radius * 0.12)
            .lineTo(0, radius * 0.42)
            .moveTo(-radius * 0.34, radius * 0.24)
            .lineTo(0, radius * 0.46)
            .lineTo(radius * 0.34, radius * 0.24)
            .stroke({ width: 1, color: ink, cap: "round", join: "round" });
        } else if (tier === 1) {
          // Wooden palisade: a broken ring of short stakes.
          for (let i = 0; i < 8; i += 1) {
            const angle = (i / 8) * Math.PI * 2;
            const inner = radius * 0.72;
            view.mark
              .moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
              .lineTo(Math.cos(angle) * (radius + 2), Math.sin(angle) * (radius + 2))
              .stroke({ width: 2, color: 0x6b4a2f });
          }
        } else if (tier === 2) {
          view.mark.circle(0, 0, radius + 2).stroke({ width: 2, color: ink });
          view.mark
            .rect(-radius * 0.5, -radius * 0.5, radius, radius)
            .stroke({ width: 1.5, color: 0x6b6760 });
        } else {
          // Star fortress.
          const points: number[] = [];
          for (let i = 0; i < 16; i += 1) {
            const angle = (i / 16) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? radius + 4 : radius * 0.66;
            points.push(Math.cos(angle) * r, Math.sin(angle) * r);
          }
          view.mark.poly(points).stroke({ width: 2, color: ink });
        }
        if (port?.silenced) {
          view.mark
            .circle(-radius * 0.5, -radius - 3, 3)
            .fill({ color: 0x656b6e, alpha: 0.55 })
            .circle(0, -radius - 7, 4)
            .fill({ color: 0x7d8284, alpha: 0.4 })
            .circle(radius * 0.5, -radius - 2, 2.5)
            .fill({ color: 0x656b6e, alpha: 0.5 });
        }
        view.radius = radius;
        view.styleKey = styleKey;
      }

      view.container.position.set(marker.screenX, marker.screenY);
      view.container.alpha = marker.dimmed ? settings.view.portDimAlpha : 1;
      view.label.text = marker.name;
      view.label.visible = marker.labelVisible;
      view.label.position.set(
        marker.labelX - marker.screenX,
        marker.labelY - marker.screenY,
      );
    }

    for (const [id, view] of portViews) {
      if (active.has(id)) continue;
      view.container.destroy({ children: true });
      portViews.delete(id);
    }
    portLayer.visible = markers.length > 0;
    updateKnownPortsButton();
  }

  /** Dotted route ink for every selected ship, on either screen. */
  function drawDotted(
    points: Array<[number, number]>,
    colour = INK_COLOR,
    smooth = false,
    graphics: Graphics = routeInk,
  ): number {
    if (points.length < 2) return 0;
    const spacing = quality.routeDetail
      ? settings.view.routeDotSpacingPx
      : settings.view.routeDotSpacingPx * 2.5;
    const screen = points.map(([x, y]) => toScreen(x, y));
    const dots = dotsAlongPath(
      smooth ? catmullRomPath(screen, quality.routeDetail ? 8 : 4) : screen,
      spacing,
    );
    for (const dot of dots) {
      graphics.circle(dot.x, dot.y, settings.view.routeDotRadiusPx).fill({ color: colour, alpha: 0.82 });
    }
    return dots.length;
  }

  /** Only the primary ship draws a route line. A fleet uses its leader. */
  function drawSelectedRoute(): void {
    const primary = selectedFleetShip() ??
      fleetShips.find((ship) => ship.id === selectedShipId) ??
      null;
    const selected = showRouteLine && primary ? [primary] : [];
    const key = JSON.stringify([
      showRouteLine,
      selected.map((ship) => [ship.id, ship.predictedPath, ship.route, ship.orderLines]),
      view.x, view.y, view.kmAcross, quality.routeDetail,
      headingPreviewOn && !headingSheet.hidden,
      fireActionMode, fireTargetId,
      fleetShips.map((ship) => [ship.id, ship.towingId, ship.fireShipTargetId]),
    ]);
    if (key === lastRouteKey) {
      drawHeadingPreview();
      return;
    }
    lastRouteKey = key;
    routeInk.clear();
    for (const label of routeLabels.removeChildren()) label.destroy();
    let drew = false;
    for (const own of selected) {
      if (own.predictedPath && own.predictedPath.length > 1) {
        drew = drawDotted(own.predictedPath, 0x8a6a45, true) > 0 || drew;
      } else if (own.route && own.route.length > 1) {
        drew = drawDotted(own.route, 0x8a6a45, true) > 0 || drew;
      }
      for (const line of own.orderLines ?? []) {
        drew = drawDotted(line.points) > 0 || drew;
        if (quality.routeDetail && line.queueNumber && line.points.length > 0) {
          const point = toScreen(line.points[0]![0], line.points[0]![1]);
          const label = new Text({
            text: String(line.queueNumber),
            style: { fontFamily: "Source Sans 3", fontSize: 11, fill: 0x8c1d1d, fontWeight: "600" },
          });
          label.position.set(point.x + 7, point.y - 15);
          routeLabels.addChild(label);
        }
      }
    }
    // 3G: a dotted orange line for a contact attack, and a thin dotted tow
    // rope with the towed ship's name. Both reuse the existing route ink.
    const fireRow = selectedFleetShip();
    const targetId = fireActionMode === "igniteConfirm"
      ? fireTargetId
      : fireRow?.fireShipTargetId ?? null;
    const fireTarget = targetId ? ships.get(targetId) : undefined;
    if (fireRow && fireTarget) {
      drew = drawDotted([[fireRow.x, fireRow.y], [fireTarget.x, fireTarget.y]], 0xc25a1e) > 0 || drew;
    }
    for (const row of fleetShips) {
      if (!row.towingId) continue;
      const tow = fleetShips.find((ship) => ship.id === row.towingId);
      if (!tow) continue;
      drew = drawDotted([[row.x, row.y], [tow.x, tow.y]], 0x4a3220) > 0 || drew;
      if (quality.routeDetail) {
        const point = toScreen(tow.x, tow.y);
        const label = new Text({
          text: `Towing ${tow.name}`,
          style: { fontFamily: "Source Sans 3", fontSize: 10, fill: 0x4a3220, fontWeight: "600" },
        });
        label.position.set(point.x + 8, point.y + 8);
        routeLabels.addChild(label);
      }
    }
    routeLayer.visible = drew;
    drawHeadingPreview();
  }

  /** Dark ink trails and lost-ship X marks, own ships only. */
  function drawTrails(): void {
    trailInk.clear();
    let drew = false;
    if (mode === "chart" && chartTrailMode !== "none") {
      const selected = fleetShips.filter((ship) =>
        multiSelect && selectedShipIds.size > 0
          ? selectedShipIds.has(ship.id)
          : ship.id === (selectedFleetShip()?.id ?? selectedShipId),
      );
      const ids = new Set(trailIdsForMode(
        chartTrailMode,
        fleetShips.map((ship) => ship.id),
        selected.map((ship) => ship.id),
      ));
      for (const row of fleetShips) {
        if (!ids.has(row.id)) continue;
        const trail = trailPoints.get(row.id);
        if (!trail || trail.length < 2) continue;
        drew = drawDotted(trail, 0x4a3220, true, trailInk) > 0 || drew;
      }
    }
    if (mode === "chart") {
      for (const [x, y] of lostMarks) {
        const at = toScreen(x, y);
        trailInk.moveTo(at.x - 5, at.y - 5).lineTo(at.x + 5, at.y + 5)
          .moveTo(at.x + 5, at.y - 5).lineTo(at.x - 5, at.y + 5)
          .stroke({ width: 2, color: 0x4a3220 });
        drew = true;
      }
    }
    routeLayer.visible = routeLayer.visible || drew;
  }

  /** A faint 1 km ring and the two 30-degree beam arcs for engaged ships. */
  function BandKmLabel(km: number): string {
    return km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`;
  }

  function drawCombatRange(): void {
    combatRangeInk.clear();
    rangeCheckLayer.visible = false;
    if (mode !== "ship") return;
    const selected = selectedFleetShip();
    if (rangeCheckOn && selected) {
      const centre = toScreen(selected.x, selected.y);
      const sightPx = ownSightFor(selected) * scale();
      const cannonPx = 1 * scale();
      combatRangeInk
        .circle(centre.x, centre.y, sightPx)
        .stroke({ width: 1, color: 0x8a9c5e, alpha: 0.6 });
      for (const band of settings.combat.hitChanceBands) {
        combatRangeInk
          .circle(centre.x, centre.y, band.maxKm * scale())
          .stroke({
            width: band.maxKm >= 1 ? 2 : 1,
            color: 0x8c1d1d,
            alpha: 0.2 + band.chance * 0.7,
          });
      }
      rangeCheckLayer.visible = true;
      rangeCheckLabels[0]!.text = `Sight ${ownSightFor(selected).toFixed(1)} km`;
      rangeCheckLabels[0]!.position.set(centre.x, centre.y + sightPx + 4);
      rangeCheckLabels[1]!.text = "Cannon 1 km";
      rangeCheckLabels[1]!.position.set(centre.x, centre.y + cannonPx + 4);
      const bands = settings.combat.hitChanceBands
        .map((band) => `${BandKmLabel(band.maxKm)} ${Math.round(band.chance * 100)}%`)
        .join(" · ");
      rangeCheckLabels[2]!.text = bands;
      rangeCheckLabels[2]!.position.set(centre.x, centre.y + cannonPx + 20);
    }
    const radius = scale();
    const arc = (settings.combat.broadsideArcDeg * Math.PI) / 180;
    for (const row of fleetShips) {
      if (!row.engagement) continue;
      const screen = toScreen(row.x, row.y);
      combatRangeInk
        .circle(screen.x, screen.y, radius)
        .stroke({ width: 1, color: 0x8c1d1d, alpha: 0.16 });
      const heading = ships.get(row.id)?.heading ?? 0;
      for (const sign of [1, -1]) {
        const middle = heading + sign * Math.PI / 2;
        combatRangeInk
          .arc(screen.x, screen.y, radius, middle - arc - Math.PI / 2, middle + arc - Math.PI / 2)
          .stroke({ width: 2, color: 0x8c1d1d, alpha: 0.28 });
      }
    }
  }

  interface FleetGroupView {
    container: Container;
    ink: Graphics;
    label: Text;
  }
  const fleetGroupPool: FleetGroupView[] = [];
  const fleetGroupActive: FleetGroupView[] = [];
  let formationPreview: { fleetId: string; formation: FleetSnapshot["formation"]; until: number } | null = null;

  function makeFleetGroupView(): FleetGroupView {
    const container = new Container();
    const ink = new Graphics();
    const label = new Text({
      text: "",
      style: { fontFamily: "Source Sans 3", fontSize: 11, fill: INK_COLOR, fontWeight: "700" },
    });
    label.anchor.set(0.5);
    container.addChild(ink, label);
    fleetGroupLayer.addChild(container);
    return { container, ink, label };
  }

  function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (points.length <= 2) return points;
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Array<{ x: number; y: number }> = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
      lower.push(point);
    }
    const upper: Array<{ x: number; y: number }> = [];
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const point = sorted[index]!;
      while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return [...lower, ...upper];
  }

  /**
   * At far zoom a 185 m station gap is only a few pixels. Link the fleet in
   * formation order and draw its outline so the shape reads without ten tiny
   * overlapping hulls and rings.
   */
  function drawFormationLinks(now: number): void {
    const gapPx = settings.fleets.defaultGapM / 1000 * scale();
    const linksVisible = gapPx < settings.client.fleetGroupPx;
    for (const fleet of linksVisible ? playerFleets : []) {
      const ordered = [fleet.leaderId, ...fleet.members.map((member) => member.id).filter((id) => id !== fleet.leaderId)]
        .map((id) => ships.get(id))
        .filter((ship): ship is ShipView => Boolean(ship && ship.own));
      if (ordered.length < 2) continue;
      const points = ordered.map((ship) => toScreen(ship.x, ship.y));
      let tooWide = false;
      for (let index = 1; index < points.length; index += 1) {
        if (Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y) >= settings.client.fleetGroupPx) {
          tooWide = true;
          break;
        }
      }
      if (tooWide) continue;
      // Thin dotted link in formation (member) order.
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1]!;
        const b = points[index]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.floor(length / 5));
        fleetFormationInk.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 0.7, color: INK_COLOR, alpha: 0.22 });
        for (let dot = 1; dot < steps; dot += 2) {
          const t = dot / steps;
          fleetFormationInk.circle(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0.8)
            .fill({ color: INK_COLOR, alpha: 0.42 });
        }
      }
      const hull = convexHull(points);
      if (hull.length >= 3) {
        fleetFormationInk.moveTo(hull[0]!.x, hull[0]!.y);
        for (const point of hull.slice(1)) fleetFormationInk.lineTo(point.x, point.y);
        fleetFormationInk.closePath().stroke({ width: 1, color: INK_COLOR, alpha: 0.28 });
      }
    }
    if (formationPreview && now < formationPreview.until) {
      const fleet = playerFleets.find((candidate) => candidate.id === formationPreview!.fleetId);
      const leader = fleet ? ships.get(fleet.leaderId) : undefined;
      if (fleet && leader) {
        const members = fleet.members.map((member) => {
          const ship = ships.get(member.id);
          return { id: member.id, classId: (ship?.classId ?? "frigate") as OwnShipSnapshot["classId"], speedKnots: 0 };
        });
        const slots = formationSlots({
          formation: formationPreview.formation,
          members,
          headingRad: leader.heading,
        });
        for (const slot of slots.slice(1)) {
          const point = toScreen(leader.x + slot.x, leader.y + slot.y);
          const alpha = 0.28 + 0.32 * Math.max(0, (formationPreview.until - now) / 3_000);
          fleetFormationInk.circle(point.x, point.y, 4)
            .fill({ color: PAPER_COLOR, alpha: alpha * 0.6 })
            .stroke({ width: 1, color: INK_COLOR, alpha });
        }
      }
    } else if (formationPreview && now >= formationPreview.until) {
      formationPreview = null;
    }
  }

  /** At far zoom one fleet marker stands in for a cluster of its ships. */
  function drawFleetGroups(): void {
    fleetFormationInk.clear();
    drawFormationLinks(performance.now());
    const fleetByShip = new Map<string, string>();
    for (const row of fleetShips) {
      if (row.fleetId) fleetByShip.set(row.id, row.fleetId);
    }
    const members = [...ships.values()]
      .filter((ship) => ship.own && fleetByShip.has(ship.id))
      .map((ship) => ({
        id: ship.id,
        fleetId: fleetByShip.get(ship.id) ?? null,
        x: ship.x,
        y: ship.y,
      }));
    const plan = groupFleetMarkers(members, scale(), settings.client.fleetGroupPx);
    const selected = multiSelect ? selectedShipIds : new Set([selectedShipId]);
    let used = 0;
    for (const group of plan.groups) {
      let view = fleetGroupActive[used];
      if (!view) {
        view = fleetGroupPool.pop() ?? makeFleetGroupView();
        fleetGroupActive[used] = view;
      }
      used += 1;
      const screen = toScreen(group.x, group.y);
      view.container.position.set(screen.x, screen.y);
      view.ink.clear();
      view.ink.circle(0, 0, 11).fill({ color: PAPER_COLOR, alpha: 0.94 }).stroke({ width: 1.5, color: INK_COLOR });
      if (group.ids.some((id) => selected.has(id))) {
        view.ink.circle(0, 0, 15).stroke({ width: 2.5, color: 0x8c1d1d });
      }
      view.label.text = `x${group.count}`;
      view.container.visible = true;
    }
    for (let index = used; index < fleetGroupActive.length; index += 1) {
      const view = fleetGroupActive[index];
      if (!view) continue;
      view.container.visible = false;
      fleetGroupPool.push(view);
    }
    fleetGroupActive.length = used;
    for (const id of plan.groupedIds) {
      const ship = ships.get(id);
      if (!ship) continue;
      ship.hull.visible = false;
      ship.ring.visible = false;
      ship.flag.visible = false;
      ship.flagshipInk.visible = false;
      ship.runInk.visible = false;
      ship.runLabel.visible = false;
      ship.statusInk.visible = false;
      ship.statusLabel.visible = false;
      ship.lightsLabel.visible = false;
    }
    fleetGroupLayer.visible = used > 0;
  }

  /** Grey smoke, splashes, hit flashes and a sinking cloud, in paper ink. */
  function drawCombatFx(now: number): void {
    combatFxInk.clear();
    const effectLimit = effectiveNetworkMode() === "saver"
      ? Math.min(48, settings.client.maxLiveEffects)
      : settings.client.maxLiveEffects;
    if (combatFx.length > effectLimit) {
      combatFx.splice(0, combatFx.length - effectLimit);
    }
    const zoom = Math.max(0.55, Math.min(2.2, scale() / 700));
    let write = 0;
    for (const fx of combatFx) {
      const age = now - fx.at;
      if (age < 0 || age > 2_400) continue;
      if (!quality.smoke && (fx.kind === "fire" || fx.kind === "miss")) continue;
      const screen = toScreen(fx.x, fx.y);
      if (
        screen.x < -120 || screen.x > app.screen.width + 120 ||
        screen.y < -120 || screen.y > app.screen.height + 120
      ) {
        continue;
      }
      combatFx[write++] = fx;
      const t = age / 1_000;
      if (fx.kind === "fire") {
        const ship = fx.shipId ? ships.get(fx.shipId) : undefined;
        const heading = ship?.heading ?? 0;
        const sign = fx.side === "port" ? -1 : 1;
        const offset = fx.side === "bow" || fx.side === "stern" ? 0 : 7 * zoom * sign;
        const puff = 3 + t * 9 * zoom;
        const dx = fx.side === "bow" ? Math.sin(heading) * 9 * zoom
          : fx.side === "stern" ? -Math.sin(heading) * 9 * zoom
          : Math.cos(heading) * offset;
        const dy = fx.side === "bow" ? -Math.cos(heading) * 9 * zoom
          : fx.side === "stern" ? Math.cos(heading) * 9 * zoom
          : Math.sin(heading) * offset;
        combatFxInk
          .circle(screen.x + dx, screen.y + dy, puff)
          .fill({ color: 0x5f6568, alpha: 0.28 * (1 - t / 2.4) });
        combatFxInk
          .circle(screen.x + dx * 0.7, screen.y + dy * 0.7, puff * 0.65)
          .fill({ color: 0x8a8d8c, alpha: 0.22 * (1 - t / 2.4) });
      } else if (fx.kind === "hit") {
        combatFxInk
          .circle(screen.x, screen.y, 3 + t * 7 * zoom)
          .fill({ color: 0x7d2a20, alpha: Math.max(0, 0.75 - t) });
      } else if (fx.kind === "miss") {
        combatFxInk
          .circle(screen.x, screen.y, 2 + t * 7 * zoom)
          .stroke({ width: 1.5, color: 0x3d5866, alpha: Math.max(0, 0.6 - t * 0.5) });
      } else {
        for (let ring = 0; ring < 3; ring += 1) {
          const scaleUp = 1 + ring * 0.65;
          combatFxInk
            .circle(screen.x, screen.y, (3 + t * 11 * zoom) * scaleUp)
            .fill({ color: 0x3a3b39, alpha: Math.max(0, 0.25 - t * 0.09) });
        }
      }
    }
    combatFx.length = write;
  }

  /** Paint a shared fire plan into any Pixi Graphics. */
  function paintFireShapes(graphics: Graphics, shapes: readonly FireShape[]): void {
    for (const shape of shapes) {
      if (shape.kind === "flame" && shape.points && shape.points.length >= 6) {
        graphics.poly(shape.points);
      } else {
        graphics.circle(shape.x, shape.y, shape.radius);
      }
      graphics.fill({ color: shape.color, alpha: shape.alpha });
    }
  }

  /** Live fire, the ignition flash and the lights-off spotting ring. */
  function drawShipEffects(ship: ShipView, screen: { x: number; y: number }, now: number): void {
    if (!ship.hull.visible) {
      ship.lightsLabel.visible = false;
      return;
    }
    shippingEffects: {
      const canvasPx = Math.min(app.screen.width, app.screen.height);
      if (ship.burning) {
        const plan = fireVisualPlan({
          screenX: screen.x,
          screenY: screen.y,
          viewportPx: canvasPx,
          kmAcross: view.kmAcross,
          strength: ship.fireStrength,
          headingRad: ship.heading,
          windFromDeg: windFrom,
          timeMs: now,
          seed: ship.id,
        });
        paintFireShapes(shipFxInk, plan.shapes);
        if (ship.ignitionAt !== null) {
          const age = now - ship.ignitionAt;
          if (age >= 0 && age <= settings.effects.ignitionFlashMs) {
            const t = age / settings.effects.ignitionFlashMs;
            shipFxInk.circle(screen.x, screen.y, 7 + t * settings.effects.ignitionFlashRadiusPx)
              .fill({ color: 0xffd47a, alpha: (1 - t) * 0.9 });
            shipFxInk.circle(screen.x, screen.y, 4 + t * 9)
              .fill({ color: 0xff6a1e, alpha: (1 - t) * 0.75 });
          }
        }
      }
      const night = gameClockAt(clockShownMs).daylight < 0.25;
      const ring = lightsRingPlan(night, !ship.lightsOff);
      if (!ring.shown) {
        ship.lightsLabel.visible = false;
        break shippingEffects;
      }
      const radius = ring.radiusKm * scale();
      const count = settings.effects.lightsRingDashCount;
      const dash = (Math.PI * 2) / count * settings.effects.lightsRingDashShare;
      for (let index = 0; index < count; index += 1) {
        const start = (index / count) * Math.PI * 2;
        shipFxInk
          .moveTo(screen.x + Math.cos(start) * radius, screen.y + Math.sin(start) * radius)
          .lineTo(
            screen.x + Math.cos(start + dash) * radius,
            screen.y + Math.sin(start + dash) * radius,
          );
      }
      shipFxInk.stroke({
        width: settings.effects.lightsRingWidthPx,
        color: 0xd9b25c,
        alpha: settings.effects.lightsRingAlpha,
      });
      ship.lightsLabel.text = ring.label;
      ship.lightsLabel.position.set(screen.x + 13, screen.y + 16);
      ship.lightsLabel.visible = true;
    }
  }

  /** Six-second parade of every effect, independent of world state. */
  function drawEffectGallery(now: number): void {
    galleryInk.clear();
    galleryLayer.visible = effectGalleryOn;
    galleryLabel.visible = effectGalleryOn;
    if (!effectGalleryOn) return;
    const frame = galleryFrame(now - effectGalleryStartedAt);
    const cx = app.screen.width / 2;
    const cy = app.screen.height / 2;
    const t = frame.elapsedMs / 1000;
    const effect = frame.effect;
    galleryLabel.text = `${effect.name} · ${Math.ceil(frame.remainingMs / 1000)}s`;
    galleryLabel.position.set(cx, Math.min(app.screen.height - 34, cy + 74));
    const puff = (x: number, y: number, radius: number, color: number, alpha: number): void => {
      galleryInk.circle(x, y, radius).fill({ color, alpha });
    };
    if (effect.id.startsWith("fire")) {
      const plan = fireVisualPlan({
        screenX: cx,
        screenY: cy,
        viewportPx: Math.min(app.screen.width, app.screen.height),
        kmAcross: 1,
        strength: effect.strength ?? 100,
        headingRad: 0,
        windFromDeg: 315,
        timeMs: now,
        seed: effect.id,
      });
      paintFireShapes(galleryInk, plan.shapes);
    } else if (effect.id === "smoke") {
      for (let index = 0; index < 5; index += 1) {
        puff(cx + index * 8, cy - index * 10, 8 + index * 3, 0x34383a, 0.32 - index * 0.04);
      }
    } else if (effect.id === "ignition") {
      const flash = (t % 1);
      galleryInk.circle(cx, cy, 8 + flash * 34).fill({ color: 0xffb02e, alpha: 0.75 * (1 - flash) });
      galleryInk.circle(cx, cy, 4 + flash * 17).fill({ color: 0xfff2c4, alpha: 0.9 * (1 - flash) });
    } else if (effect.id === "splash") {
      galleryInk.circle(cx, cy, 8 + t * 22).stroke({ width: 2, color: 0x3d5866, alpha: 0.55 });
      galleryInk.circle(cx, cy, 4 + t * 12).stroke({ width: 1.5, color: 0x7c948a, alpha: 0.65 });
    } else if (effect.id === "hit") {
      puff(cx, cy, 6 + t * 7, 0x7d2a20, Math.max(0, 0.75 - t * 0.12));
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        galleryInk.moveTo(cx, cy).lineTo(cx + Math.cos(angle) * 24, cy + Math.sin(angle) * 24)
          .stroke({ width: 1.5, color: 0x7d2a20, alpha: Math.max(0, 0.6 - t * 0.08) });
      }
    } else if (effect.id === "damage-smoke") {
      for (let index = 0; index < 4; index += 1) {
        puff(cx - 12 + index * 8, cy - 8 - index * 7, 7 + index * 3, 0x5f6568, 0.28 - index * 0.04);
      }
    } else if (effect.id === "tow") {
      puff(cx - 38, cy, 15, 0x9b2d2d, 0.9);
      puff(cx + 38, cy, 15, 0x2d2a28, 0.9);
      for (let index = 1; index < 12; index += 2) {
        const x = cx - 22 + index * 4;
        puff(x, cy + Math.sin(index) * 2, 1.5, 0x4a3220, 0.9);
      }
    } else if (effect.id === "white-flag") {
      galleryInk.moveTo(cx, cy + 28).lineTo(cx, cy - 30).stroke({ width: 2, color: INK_COLOR });
      galleryInk.poly([cx + 1, cy - 30, cx + 28, cy - 24, cx + 1, cy - 14])
        .fill({ color: 0xfffdf2, alpha: 0.98 }).stroke({ width: 1, color: INK_COLOR });
    } else if (effect.id === "lantern") {
      puff(cx, cy, 34, 0xffd27a, 0.13);
      puff(cx, cy, 18, 0xffd27a, 0.25);
      puff(cx, cy, 6, 0xffe6a8, 0.9);
      galleryInk.rect(cx - 7, cy - 12, 14, 24).fill({ color: 0x4a3220, alpha: 0.9 });
    } else if (effect.id === "pennant") {
      galleryInk.moveTo(cx, cy + 28).lineTo(cx, cy - 32).stroke({ width: 2, color: INK_COLOR });
      galleryInk.poly([cx, cy - 32, cx + 30, cy - 24, cx, cy - 16])
        .fill({ color: 0x8c1d1d, alpha: 0.95 });
    }
  }

  function portAt(screenX: number, screenY: number): PortMarkerPlan | null {
    let best: PortMarkerPlan | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const marker of laidOutPorts) {
      const distance = Math.hypot(marker.screenX - screenX, marker.screenY - screenY);
      if (distance > marker.hitRadiusPx || distance >= bestDistance) continue;
      best = marker;
      bestDistance = distance;
    }
    return best;
  }

  function selectedFleetShip(): OwnShipSnapshot | null {
    return fleetShips.find((ship) => ship.id === selectedShipId) ?? fleetShips[0] ?? null;
  }

  function portName(portId: string | null): string | null {
    return portId ? portData.get(portId)?.name ?? null : null;
  }

  function activeOwnViews(): ShipView[] {
    const ids = new Set(
      fleetShips.filter((ship) => ship.status !== "delivery").map((ship) => ship.id),
    );
    const found: ShipView[] = [];
    for (const id of ids) {
      const view = ships.get(id);
      if (view) found.push(view);
    }
    return found;
  }

  function selectedShipView(): ShipView | null {
    return ships.get(selectedShipId) ?? activeOwnViews()[0] ?? null;
  }

  function shipAt(screenX: number, screenY: number): ShipView | null {
    let best: ShipView | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const ownIds = new Set(fleetShips.map((ship) => ship.id));
    for (const [id, view] of ships) {
      if (!ownIds.has(id)) continue;
      const screen = toScreen(view.x, view.y);
      const distance = Math.hypot(screen.x - screenX, screen.y - screenY);
      if (distance > 22 || distance >= bestDistance) continue;
      best = view;
      bestDistance = distance;
    }
    return best;
  }

  function anyShipAt(screenX: number, screenY: number): ShipView | null {
    let best: ShipView | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const view of ships.values()) {
      const screen = toScreen(view.x, view.y);
      const distance = Math.hypot(screen.x - screenX, screen.y - screenY);
      if (distance > 22 || distance >= bestDistance) continue;
      best = view;
      bestDistance = distance;
    }
    return best;
  }

  function flushClientErrors(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (pendingClientErrors.length > 0) {
      const next = pendingClientErrors.shift();
      if (!next) break;
      try {
        socket.send(JSON.stringify({ t: "clientError", text: next.text, where: next.where }));
      } catch {
        // Reporting a client error must never cause another one.
      }
    }
  }

  function sendCommand(message: Record<string, unknown>): boolean {
    if (socket?.readyState === WebSocket.OPEN) {
      const id = `cmd-${++nextOrderId}`;
      const label = String(message.t ?? "order");
      pendingOrders.set(id, { at: performance.now(), label });
      orderDebugLog.push({
        at: Date.now(),
        command: label,
        ship: typeof message.ship === "string" ? message.ship : "",
        target: typeof message.target === "string" ? message.target : "",
        result: "sent",
        reason: "",
      });
      while (orderDebugLog.length > 40) orderDebugLog.shift();
      renderDebugLog();
      lastCommandSent = { ...message };
      socket.send(JSON.stringify({ ...message, id }));
      updateOrderSendingStatus();
      return true;
    }
    setStatus("Not connected yet; the order was not sent.", true);
    return false;
  }

  function updateOrderSendingStatus(): void {
    if (pendingOrders.size > 0) {
      setStatus(`Sending ${pendingOrders.size === 1 ? "order" : "orders"}…`);
    } else if (!takenOver && socket?.readyState === WebSocket.OPEN) {
      setStatus("Connected");
    }
  }

  function acknowledgeOrder(id: string, ok: unknown, text: unknown): void {
    const pending = pendingOrders.get(id);
    if (!pending) return;
    pendingOrders.delete(id);
    const accepted = ok !== false;
    const reason = typeof text === "string" ? text : "";
    const entry = [...orderDebugLog].reverse().find((row) =>
      row.command === pending.label && row.result === "sent",
    );
    if (entry) {
      entry.result = accepted ? "accepted" : "rejected";
      entry.reason = reason;
      entry.ship = entry.ship || "";
      entry.target = entry.target || "";
    }
    if (!accepted) showNotice(reason || `${pending.label} was rejected.`);
    renderDebugLog();
    updateOrderSendingStatus();
  }

  function renderDebugLog(): void {
    if (!debugLogOpen) return;
    const lines = orderDebugLog.map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString();
      const where = [entry.ship, entry.target].filter(Boolean).join(" -> ");
      return `${time}  ${entry.command}${where ? ` [${where}]` : ""}  ${entry.result}${entry.reason ? `: ${entry.reason}` : ""}`;
    });
    const errors = clientErrorLog.map((entry) =>
      `${new Date(entry.at).toLocaleTimeString()}  CLIENT ERROR  ${entry.text}`,
    );
    debugLogLines.textContent = [
      `Orders (last ${lines.length}, 40 max)`,
      ...lines,
      "",
      `Client errors (last ${errors.length}, 10 max)`,
      ...(errors.length > 0 ? errors : ["none"]),
    ].join("\n");
    debugLogLines.scrollTop = debugLogLines.scrollHeight;
  }

  function groupShipIds(): string[] {
    const wanted = multiSelect && selectedShipIds.size > 0
      ? [...selectedShipIds]
      : [selectedShipId];
    return wanted.filter((id) =>
      fleetShips.some((ship) => ship.id === id && ship.status !== "delivery"),
    );
  }

  function updateMultiUi(): void {
    const count = selectedShipIds.size;
    multiButton.setAttribute("aria-pressed", String(multiSelect));
    multiButton.classList.toggle("is-active", multiSelect);
    multiCount.textContent = String(count);
    multiCount.hidden = !multiSelect || count === 0;
    fleetSelectedCount.textContent = `${count} selected`;
    fleetUndock.disabled = count === 0;
    fleetClear.disabled = count === 0;
    for (const input of fleetList.querySelectorAll<HTMLInputElement>("[data-fleet-pick]")) {
      input.checked = selectedShipIds.has(input.dataset.fleetPick ?? "");
    }
    updateShipRings();
  }

  function toggleGroupShip(id: string): void {
    const row = fleetShips.find((ship) => ship.id === id);
    if (!row || row.status === "delivery") return;
    if (selectedShipIds.has(id)) selectedShipIds.delete(id);
    else selectedShipIds.add(id);
    multiSelect = selectedShipIds.size > 0;
    updateMultiUi();
  }

  function closeShipActions(): void {
    actionSheet.hidden = true;
    actionShipId = null;
    actionPortId = null;
  }

  function openShipActions(shipId: string): boolean {
    const row = fleetShips.find((ship) => ship.id === shipId);
    if (!row || row.status !== "docked" || !row.portId) return false;
    actionShipId = row.id;
    actionPortId = row.portId;
    actionTitle.textContent = `${row.name} at ${portName(row.portId) ?? "port"}`;
    closePortPanel();
    closeTradePanel();
    closeFleetPanel();
    actionSheet.hidden = false;
    return true;
  }

  function updateShipRings(): void {
    const ownIds = new Set(fleetShips.map((ship) => ship.id));
    const selectedIds = multiSelect
      ? selectedShipIds
      : new Set([selectedShipId]);
    for (const [id, ship] of ships) {
      const own = ownIds.has(id);
      ship.own = own;
      ship.ring.clear();
      ship.ring.visible = own;
      if (!own) continue;
      const selected = selectedIds.has(id);
      ship.ring.circle(0, 0, selected ? 19 : 17).stroke({
        width: selected ? 3.5 : 1.25,
        color: 0x8c1d1d,
      });
    }
  }

  function centreOnShip(id: string): void {
    const viewShip = ships.get(id);
    if (!viewShip) return;
    if (mode === "chart") setMode("ship");
    view.x = viewShip.x;
    view.y = viewShip.y;
    view.follow = true;
    refreshMap(performance.now(), true);
  }

  function updateSelectedShip(id: string, centre: boolean): boolean {
    const row = fleetShips.find((ship) => ship.id === id);
    if (!row || row.status === "delivery") return false;
    selectedEnemyId = null;
    if (activeDockPanel === "target") activeDockPanel = "ship";
    if (!multiSelect) selectedShipIds.clear();
    selectedShipId = id;
    target = null;
    marker.visible = false;
    sendCommand({ t: "select", ship: id });

    if (centre) centreOnShip(id);
    updateMultiUi();
    updateHud(ownSnapshot ?? undefined);
    renderBattleBar();
    return true;
  }

  function closeFleetPanel(): void {
    fleetPanel.hidden = true;
  }

  function fleetById(id: string | null): FleetSnapshot | null {
    return id ? playerFleets.find((fleet) => fleet.id === id) ?? null : null;
  }

  function shipById(id: string): OwnShipSnapshot | null {
    return fleetShips.find((ship) => ship.id === id) ?? null;
  }

  function fleetOfShip(id: string): FleetSnapshot | null {
    return playerFleets.find((fleet) => fleet.members.some((member) => member.id === id)) ?? null;
  }

  function selectedFleetIds(): string[] {
    const ids = new Set<string>();
    for (const fleet of playerFleets) {
      if (fleet.members.some((member) => selectedShipIds.has(member.id))) ids.add(fleet.id);
    }
    if (ids.size === 0 && selectedShipId) {
      const fleet = fleetOfShip(selectedShipId);
      if (fleet) ids.add(fleet.id);
    }
    return [...ids];
  }

  function selectWholeFleet(fleetId: string): void {
    const fleet = fleetById(fleetId);
    if (!fleet) return;
    selectedShipIds.clear();
    for (const member of fleet.members) {
      const ship = shipById(member.id);
      if (ship && ship.status !== "delivery") selectedShipIds.add(member.id);
    }
    if (selectedShipIds.size === 0) return;
    selectedFleetId = fleet.id;
    selectedShipId = fleet.members.find((member) => member.id === fleet.leaderId)?.id
      ?? [...selectedShipIds][0]!;
    multiSelect = true;
    updateMultiUi();
    drawSelectedRoute();
    centreOnShip(selectedShipId);
  }

  function selectControlGroup(slot: number): void {
    const ids = controlGroups[slot];
    if (!ids) return;
    selectedShipIds.clear();
    for (const id of ids) {
      const ship = shipById(id);
      if (ship && ship.status !== "delivery") selectedShipIds.add(id);
    }
    if (selectedShipIds.size === 0) return;
    selectedShipId = [...selectedShipIds][0]!;
    selectedFleetId = fleetOfShip(selectedShipId)?.id ?? null;
    multiSelect = true;
    updateMultiUi();
    drawSelectedRoute();
  }

  function saveControlGroup(slot: number): void {
    const ids = groupShipIds();
    if (ids.length === 0) {
      showNotice("Select ships before saving a control group.");
      return;
    }
    sendCommand({ t: "saveGroup", slot, ids });
    showNotice(`Control group ${slot} saved.`);
  }

  function renderGroupBar(): void {
    groupBar.replaceChildren();
    const slots = Object.keys(controlGroups).map(Number).filter((slot) => slot >= 1 && slot <= 9).sort();
    groupBar.hidden = false;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "group-chip group-save";
    save.textContent = "Save group";
    save.title = "Save the selected ships as a numbered control group";
    save.addEventListener("click", saveNextControlGroup);
    groupBar.append(save);
    for (const slot of slots) {
      const count = controlGroups[slot]?.length ?? 0;
      if (count === 0) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "group-chip";
      button.textContent = `${slot} · ${count}`;
      button.setAttribute("aria-label", `Select control group ${slot}, ${count} ships`);
      button.addEventListener("click", () => selectControlGroup(slot));
      groupBar.append(button);
    }
  }

  function saveNextControlGroup(): void {
    let slot = 0;
    for (let candidate = 1; candidate <= 9; candidate += 1) {
      if (!controlGroups[candidate] || controlGroups[candidate]!.length === 0) {
        slot = candidate;
        break;
      }
    }
    if (slot === 0) {
      showNotice("All nine control groups are in use.");
      return;
    }
    saveControlGroup(slot);
  }

  function sendFleetOrder(fleetId: string, order: FleetOrder): void {
    sendCommand({ t: "fleetOrder", fleet: fleetId, order, queue: queueOrders });
  }

  function sendSelectedSpecial(order: FleetOrder): void {
    const fleets = selectedFleetIds();
    for (const fleetId of fleets) sendFleetOrder(fleetId, order);
    for (const id of groupShipIds()) {
      if (fleetOfShip(id)) continue;
      sendCommand({ t: "shipOrder", ship: id, order });
    }
    if (fleets.length === 0 && groupShipIds().length === 0) {
      showNotice("Select a ship or fleet first.");
    }
  }

  function updateQueueButton(): void {
    fleetQueue.textContent = queueOrders ? "Queue on" : "Queue off";
    fleetQueue.setAttribute("aria-pressed", String(queueOrders));
    fleetQueue.classList.toggle("is-active", queueOrders);
  }

  function renderFleetCards(): void {
    fleetCards.replaceChildren();
    for (const fleet of playerFleets) {
      const card = document.createElement("section");
      card.className = "fleet-card";
      card.dataset.fleetCard = fleet.id;
      card.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, button, select, textarea")) return;
        selectWholeFleet(fleet.id);
      });

      const head = document.createElement("div");
      head.className = "fleet-card-head";
      const name = document.createElement("input");
      name.className = "fleet-card-name";
      name.value = fleet.name;
      name.maxLength = 40;
      name.setAttribute("aria-label", "Fleet name");
      name.addEventListener("change", () => {
        const clean = name.value.trim().slice(0, 40);
        if (clean && clean !== fleet.name) {
          sendCommand({ t: "fleetUpdate", fleet: fleet.id, name: clean });
        } else {
          name.value = fleet.name;
        }
      });
      name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          name.blur();
        }
      });
      const leader = document.createElement("span");
      leader.className = "fleet-card-leader";
      const leaderShip = shipById(fleet.leaderId);
      leader.textContent = `${leaderShip?.isFlagship ? "⚑ " : ""}${leaderShip?.name ?? "Leader"}`;
      head.append(name, leader);

      const selects = document.createElement("div");
      selects.className = "fleet-selects";
      const formationLabel = document.createElement("label");
      formationLabel.textContent = "Formation";
      const formation = document.createElement("select");
      formation.setAttribute("aria-label", "Fleet formation");
      for (const option of FORMATION_OPTIONS) {
        const item = document.createElement("option");
        item.value = option.id;
        item.textContent = `${option.icon} ${option.label}`;
        item.selected = option.id === fleet.formation;
        formation.append(item);
      }
      formation.addEventListener("change", () => {
        sendCommand({ t: "fleetUpdate", fleet: fleet.id, formation: formation.value });
        formationPreview = {
          fleetId: fleet.id,
          formation: formation.value as FleetSnapshot["formation"],
          until: performance.now() + 3_000,
        };
      });
      formationLabel.append(formation);
      const stanceLabelEl = document.createElement("label");
      stanceLabelEl.textContent = "Stance";
      const stance = document.createElement("select");
      stance.setAttribute("aria-label", "Fleet stance");
      for (const id of stanceOptionIds()) {
        const item = document.createElement("option");
        item.value = id;
        item.textContent = stanceLabel(id);
        item.selected = id === fleet.stance;
        stance.append(item);
      }
      stance.addEventListener("change", () => {
        sendCommand({ t: "fleetUpdate", fleet: fleet.id, stance: stance.value });
      });
      stanceLabelEl.append(stance);
      selects.append(formationLabel, stanceLabelEl);

      const stationLine = document.createElement("p");
      stationLine.className = "fleet-station";
      stationLine.textContent = `In station ${fleet.station.inStation} of ${fleet.station.total}`;
      const stationReasons = document.createElement("ul");
      stationReasons.className = "fleet-station-reasons";
      for (const row of fleet.station.out) {
        const item = document.createElement("li");
        const member = shipById(row.id);
        item.textContent = `${member?.name ?? row.id}: ${row.reason}`;
        stationReasons.append(item);
      }
      stationReasons.hidden = fleet.station.out.length === 0;

      const members = document.createElement("ul");
      members.className = "fleet-member-list";
      const ordered = [...fleet.members];
      const leaderIndex = ordered.findIndex((member) => member.id === fleet.leaderId);
      for (const member of ordered) {
        const item = document.createElement("li");
        item.className = "fleet-member-row";
        const memberName = document.createElement("button");
        memberName.type = "button";
        memberName.className = "fleet-member-name btn-link";
        const memberShip = shipById(member.id);
        memberName.textContent = `${memberShip?.isFlagship ? "⚑ " : ""}${memberShip?.name ?? member.id}`;
        memberName.addEventListener("click", () => {
          const ship = shipById(member.id);
          if (!ship || ship.status === "delivery") return;
          selectedShipId = member.id;
          selectedFleetId = fleet.id;
          updateMultiUi();
        });
        const pick = document.createElement("input");
        pick.type = "checkbox";
        pick.className = "fleet-member-pick";
        pick.dataset.fleetPick = member.id;
        pick.checked = selectedShipIds.has(member.id);
        pick.setAttribute("aria-label", `Select ${memberShip?.name ?? member.id}`);
        pick.addEventListener("click", (event) => event.stopPropagation());
        pick.addEventListener("change", () => toggleGroupShip(member.id));
        const state = document.createElement("span");
        state.className = "fleet-member-state";
        state.textContent = fleetMemberStateText(member.state);
        item.prepend(pick);
        if (member.state === "detached") {
          const rejoin = document.createElement("button");
          rejoin.type = "button";
          rejoin.className = "btn";
          rejoin.textContent = "Rejoin";
          rejoin.addEventListener("click", () => {
            sendCommand({ t: "fleetRejoin", ship: member.id });
          });
          item.append(rejoin);
        }
        const slot = ordered.findIndex((row) => row.id === member.id);
        const slotTools = document.createElement("span");
        slotTools.className = "fleet-member-slot";
        if (member.id === fleet.leaderId) {
          slotTools.textContent = "Leader · slot 1";
        } else {
          const up = document.createElement("button");
          up.type = "button";
          up.className = "btn";
          up.textContent = "↑";
          up.title = slot <= 1 ? "Already in the first follower slot" : "Move up one slot";
          up.disabled = slot <= 1;
          up.addEventListener("click", () => {
            sendCommand({ t: "fleetMove", fleet: fleet.id, ship: member.id, delta: -1 });
          });
          const down = document.createElement("button");
          down.type = "button";
          down.className = "btn";
          down.textContent = "↓";
          down.title = slot >= ordered.length - 1 ? "Already in the last slot" : "Move down one slot";
          down.disabled = slot >= ordered.length - 1;
          down.addEventListener("click", () => {
            sendCommand({ t: "fleetMove", fleet: fleet.id, ship: member.id, delta: 1 });
          });
          const label = document.createElement("span");
          label.textContent = `slot ${slot + 1}`;
          slotTools.append(up, down, label);
        }
        if (leaderIndex !== 0) slotTools.title = "Leader shown in slot 1";
        item.append(memberName, state, slotTools);
        if (memberShip && memberShip.status !== "delivery") {
          const battle = document.createElement("div");
          battle.className = "fleet-member-battle";
          appendBattleButtons(battle, memberShip);
          item.append(battle);
        }
        members.append(item);
      }

      const actions = document.createElement("div");
      actions.className = "fleet-card-actions";
      const action = (label: string, run: () => void): void => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = label;
        button.addEventListener("click", run);
        actions.append(button);
      };
      action("Select fleet", () => selectWholeFleet(fleet.id));
      action("Hold", () => sendFleetOrder(fleet.id, { type: "hold" }));
      action("Heading", () => openHeading(fleet.id));
      action("Patrol", () => beginPatrol(fleet.id, null));
      action("Rendezvous", () => {
        selectWholeFleet(fleet.id);
        pendingRendezvous = true;
        closeOrderMenu();
        showNotice("Tap the chart to place the rendezvous point.");
      });
      action("Return to port", () => sendFleetOrder(fleet.id, { type: "returnToPort" }));
      action("Damage", () => {
        const selected = fleet.members.find((member) => member.id === selectedShipId);
        if (!selected) {
          showNotice("Select a member of this fleet first.");
          return;
        }
        openDamagePanel(selected.id);
      });
      action("Change leader", () => {
        const selected = fleet.members.find((member) => member.id === selectedShipId);
        if (!selected) {
          showNotice("Select a member of this fleet first.");
          return;
        }
        if (selected.id === fleet.leaderId) {
          showNotice("That ship is already the leader.");
          return;
        }
        sendCommand({ t: "fleetUpdate", fleet: fleet.id, leader: selected.id });
      });
      action("Detach ship", () => {
        const selected = fleet.members.find((member) => member.id === selectedShipId);
        if (!selected) {
          showNotice("Select a member of this fleet first.");
          return;
        }
        sendCommand({ t: "fleetDetach", ship: selected.id });
      });
      action("Disband", () => {
        sendCommand({ t: "fleetDisband", fleet: fleet.id });
        if (selectedFleetId === fleet.id) selectedFleetId = null;
      });

      card.append(head, selects, stationLine, stationReasons, members, actions);
      fleetCards.append(card);
    }
  }


  function selectedSailPoint(): { id: string; x: number; y: number }[] {
    const points: Array<{ id: string; x: number; y: number }> = [];
    for (const id of groupShipIds()) {
      const ship = shipById(id);
      if (!ship) continue;
      const route = Array.isArray(ship.route) ? ship.route : [];
      const last = route.at(-1);
      const px = Array.isArray(last) ? Number(last[0]) : Number((last as { x?: number } | undefined)?.x);
      const py = Array.isArray(last) ? Number(last[1]) : Number((last as { y?: number } | undefined)?.y);
      if (Number.isFinite(px) && Number.isFinite(py)) {
        points.push({ id, x: px, y: py });
      }
    }
    return points;
  }

  function setArmedOrder(order: ControlOrder | null): void {
    armedOrder = order;
    armedOrderBar.hidden = !order;
    if (order) {
      const prompt = armedOrderPrompt(order);
      armedOrderText.textContent = prompt;
      showNotice(`${prompt}. Cancel in the banner or press Esc.`);
    } else {
      armedOrderText.textContent = "Order armed";
    }
    if (!stanceSheetPanel.hidden) renderStanceSheet();
  }

  function cancelArmedOrder(): void {
    setArmedOrder(null);
  }

  function nearestEnemyShip(): ShipView | null {
    const own = selectedFleetShip();
    if (!own) return null;
    let best: ShipView | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const ship of ships.values()) {
      if (ship.own || ship.sinking) continue;
      const distance = Math.hypot(ship.x - own.x, ship.y - own.y);
      if (distance < bestDistance) {
        best = ship;
        bestDistance = distance;
      }
    }
    return best;
  }

  function refreshAttackNearest(): void {
    const enemy = nearestEnemyShip();
    attackNearestBtn.hidden = false;
    attackNearestBtn.disabled = !enemy;
    attackNearestBtn.title = enemy
      ? "Attack the nearest enemy in sight"
      : "No enemy in sight";
  }

  function openOrdersList(): void {
    orderMenuPoint = null;
    orderMenuTarget = null;
    orderMenuTitle.textContent = "Orders";
    orderMenuWhere.textContent = "Pick an order, then tap its target. Cancel is always at the bottom.";
    orderMenuActions.replaceChildren();
    const nearest = nearestEnemyShip();
    if (nearest) {
      const quick = document.createElement("button");
      quick.type = "button";
      quick.className = "btn btn-seal";
      quick.textContent = "Attack nearest enemy";
      quick.addEventListener("click", () => {
        closeOrderMenu();
        runControlOrder(controlOrderById("attackSink"), { targetId: nearest.id });
      });
      orderMenuActions.append(quick);
    }
    for (const group of CONTROL_GROUP_NAMES) {
      const heading = document.createElement("p");
      heading.className = "order-menu-group";
      heading.textContent = group;
      orderMenuActions.append(heading);
      for (const order of controlOrdersInGroup(group)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = order.label;
        button.dataset.orderId = order.id;
        button.addEventListener("click", () => {
          closeOrderMenu();
          if (order.target === "none") runControlOrder(order, {});
          else setArmedOrder(order);
        });
        orderMenuActions.append(button);
      }
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn";
    close.textContent = "Cancel";
    close.addEventListener("click", closeOrderMenu);
    orderMenuActions.append(close);
    openOrderMenuPanel();
  }

  function controlOrderById(id: string): ControlOrder {
    return CONTROL_ORDERS.find((order) => order.id === id) ?? CONTROL_ORDERS[0]!;
  }

  function openOrderMenuPanel(): void {
    const layout = responsiveFleetLayout(window.innerWidth, window.innerHeight);
    if (layout.bottomSheet) {
      orderMenu.style.left = "";
      orderMenu.style.top = "";
      orderMenu.style.bottom = "";
      orderMenu.style.transform = "";
    } else {
      orderMenu.style.left = "12px";
      orderMenu.style.top = "76px";
      orderMenu.style.bottom = "auto";
      orderMenu.style.transform = "none";
    }
    orderMenu.hidden = false;
  }

  function runControlOrder(
    order: ControlOrder,
    target: { point?: { x: number; y: number }; targetId?: string; portId?: string },
  ): void {
    const ids = groupShipIds();
    if (ids.length === 0 && !["sail", "heading", "fitUpgrades"].includes(order.id)) {
      showNotice("Select one of your ships first.");
      return;
    }
    switch (order.id) {
      case "sail":
        if (target.point) sendOrder(target.point.x, target.point.y);
        break;
      case "sailToPort":
        if (target.portId) sendPortOrder(target.portId);
        break;
      case "heading":
        openHeading(null);
        break;
      case "patrol":
        if (target.point) beginPatrol(selectedFleetIds()[0] ?? null, target.point);
        else beginPatrol(selectedFleetIds()[0] ?? null, null);
        break;
      case "rendezvous":
        if (target.point) {
          for (const fleetId of selectedFleetIds()) {
            const fleet = fleetById(fleetId);
            sendFleetOrder(fleetId, {
              type: "rendezvous",
              point: target.point,
              memberIds: fleet?.members.map((member) => member.id) ?? [],
            });
          }
          if (selectedFleetIds().length === 0) {
            for (const id of ids) sendCommand({ t: "o", x: target.point.x, y: target.point.y, ship: id });
          }
          showNotice("Rendezvous ordered.");
        } else {
          pendingRendezvous = true;
          showNotice("Tap the chart to place the rendezvous point.");
        }
        break;
      case "hold":
        sendSelectedSpecial({ type: "hold" });
        break;
      case "anchor":
        sendAnchor("dropAnchor");
        break;
      case "weighAnchor":
        sendAnchor("weighAnchor");
        break;
      case "returnPort":
        sendSelectedSpecial({ type: "returnToPort" });
        break;
      case "attackSink":
      case "attackCapture":
        if (target.targetId) {
          sendSelectedSpecial({
            type: "engage",
            shipId: target.targetId,
            objective: order.id === "attackSink" ? "sink" : "capture",
          });
          showNotice(order.id === "attackSink" ? "Attack to sink ordered." : "Attack to capture ordered.");
        }
        break;
      case "loot":
        if (target.targetId) openLootSheet(target.targetId);
        break;
      case "board":
        if (target.targetId) openBoardSheet(target.targetId);
        break;
      case "attackPort":
        if (target.portId) sendPortAttack(target.portId);
        break;
      case "run": {
        // Run is armed from a selection, then aimed at one of my ships.
        const runIds = target.targetId ? [target.targetId] : ids;
        for (const id of runIds) {
          sendCommand({ t: "battleOrder", ship: id, order: "run" });
        }
        if (!target.targetId) {
          for (const fleetId of selectedFleetIds()) sendCommand({ t: "fleetBattleOrder", fleet: fleetId, order: "run" });
        }
        break;
      }
      case "surrender":
        if (target.targetId) openSurrenderConfirm(target.targetId);
        else if (selectedShipId) openSurrenderConfirm(selectedShipId);
        break;
      case "follow":
      case "escort":
        if (target.targetId) sendSelectedSpecial({ type: order.id as "follow" | "escort", shipId: target.targetId });
        break;
      case "tow":
        fireActionShipId = selectedShipId || null;
        fireTargetId = null;
        fireActionMode = "towPick";
        renderFireShipActions();
        showNotice("Tow: tap one of your fire ships within 300 m.");
        break;
      case "castOff":
        if (selectedShipId) sendCommand({ t: "castOff", ship: selectedShipId });
        break;
      case "crewTransfer":
        if (target.targetId) openCrewSheet(target.targetId);
        break;
      case "claim":
        if (target.targetId) openCrewSheet(target.targetId, true);
        break;
      case "igniteNow":
        if (selectedShipId) {
          if (window.confirm("Set this fire ship alight? The crew will escape and the ship is consumed.")) {
            sendCommand({ t: "igniteFireShip", ship: selectedShipId, mode: "now" });
          }
        }
        break;
      case "igniteContact":
        fireActionShipId = selectedShipId || null;
        fireTargetId = null;
        fireActionMode = "ignitePick";
        renderFireShipActions();
        showNotice("Ignite on contact: tap an enemy ship on the map.");
        break;
      case "lights": {
        const row = selectedFleetShip();
        if (row) sendCommand({ t: "lights", ship: row.id, on: row.lightsOn === false });
        break;
      }
      case "fitUpgrades":
        if (selectedShipId) sendCommand({ t: "fitShip", ship: selectedShipId });
        break;
    }
  }

  function handleArmedOrderTap(screenX: number, screenY: number): boolean {
    const order = armedOrder;
    if (!order) return false;
    const point = toWorld(screenX, screenY);
    const own = shipAt(screenX, screenY);
    const foreign = anyShipAt(screenX, screenY);
    const port = portAt(screenX, screenY);
    if (order.target === "sea") {
      setArmedOrder(null);
      runControlOrder(order, { point });
      return true;
    }
    if (order.target === "port") {
      if (!port) {
        showNotice("Tap an enemy port in sight.");
        return true;
      }
      const portInfo = portData.get(port.id);
      if (!portInfo || !targetVisibleNow({ x: portInfo.x, y: portInfo.y })) {
        showNotice("Target not in sight");
        return true;
      }
      setArmedOrder(null);
      runControlOrder(order, { portId: port.id });
      return true;
    }
    if (order.target === "own") {
      if (!own) {
        showNotice("Tap one of your ships.");
        return true;
      }
      setArmedOrder(null);
      runControlOrder(order, { targetId: own.id });
      return true;
    }
    if (order.target === "enemy" || order.target === "ship") {
      if (!foreign) {
        showNotice(order.target === "ship" ? "Tap a ship." : "Tap an enemy ship in sight.");
        return true;
      }
      if (order.target === "enemy" && foreign.own) {
        showNotice("Tap an enemy ship in sight.");
        return true;
      }
      if (!targetVisibleNow({
        x: foreign.x,
        y: foreign.y,
        lightsOn: !foreign.lightsOff,
      })) {
        showNotice("Target not in sight");
        return true;
      }
      if (order.id === "claim" && (foreign.own || !foreign.abandoned)) {
        showNotice("Tap an abandoned enemy ship in sight.");
        return true;
      }
      setArmedOrder(null);
      runControlOrder(order, { targetId: foreign.id });
      return true;
    }
    return false;
  }

  function selectShips(predicate: (ship: OwnShipSnapshot) => boolean, label: string): void {
    const ids = fleetShips
      .filter((ship) => ship.status !== "delivery" && predicate(ship))
      .map((ship) => ship.id);
    if (ids.length === 0) {
      showNotice(`No ships match ${label}.`);
      return;
    }
    selectedShipIds.clear();
    for (const id of ids) selectedShipIds.add(id);
    selectedShipId = ids[0]!;
    selectedFleetId = fleetOfShip(selectedShipId)?.id ?? null;
    multiSelect = true;
    updateMultiUi();
    drawSelectedRoute();
    centreOnShip(selectedShipId);
  }

  function showControlHint(): void {
    let seen = false;
    try {
      seen = window.localStorage.getItem("armada-controls-hint-seen") === "1";
    } catch {
      // A blocked store may show the hint again; it is never blocking.
    }
    const stage = controlHintAt(controlsHintStage);
    if (seen || !stage) {
      controlsHint.hidden = true;
      return;
    }
    controlsHintText.textContent = `${stage.index + 1}/${stage.total} · ${stage.text}`;
    controlsHint.hidden = false;
    controlsHintNext.hidden = stage.index >= stage.total - 1;
  }

  function dismissControlHints(): void {
    controlsHint.hidden = true;
    try {
      window.localStorage.setItem("armada-controls-hint-seen", "1");
    } catch {
      // The hint is still dismissed for this page.
    }
  }

  function closeOrderMenu(): void {
    orderMenu.hidden = true;
    orderMenuPoint = null;
    orderMenuTarget = null;
  }

  function openOrderMenu(screenX: number, screenY: number): void {
    const world = toWorld(screenX, screenY);
    orderMenuPoint = world;
    orderMenuTarget = null;
    orderMenuTitle.textContent = "Orders";
    orderMenuWhere.textContent = `${world.x.toFixed(1)} km E · ${world.y.toFixed(1)} km S`;
    let kind: "sea" | "ship" | "port" | "enemy" = "sea";
    const ownShip = shipAt(screenX, screenY);
    const foreignShip = anyShipAt(screenX, screenY);
    const port = portAt(screenX, screenY);
    if (ownShip) {
      kind = "ship";
      orderMenuTarget = { kind: "ship", id: ownShip.id };
      orderMenuTitle.textContent = shipById(ownShip.id)?.name ?? "Ship";
      orderMenuWhere.textContent = "Orders for the selected ships";
    } else if (foreignShip) {
      kind = "enemy";
      orderMenuTarget = { kind: "ship", id: foreignShip.id };
      orderMenuTitle.textContent = `${foreignShip.navy} ${foreignShip.classId}`;
      orderMenuWhere.textContent = "Attack with the selected ships or fleet";
    } else if (port) {
      kind = "port";
      orderMenuTarget = { kind: "port", id: port.id };
      orderMenuTitle.textContent = port.name;
      orderMenuWhere.textContent = "Sail the selected ships to this port";
    }

    orderMenuActions.replaceChildren();
    for (const item of orderMenuItems(kind)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = item.primary ? "btn btn-seal" : "btn";
      button.textContent = item.label;
      button.addEventListener("click", () => runOrderMenu(item.id, kind));
      orderMenuActions.append(button);
    }

    const layout = responsiveFleetLayout(window.innerWidth, window.innerHeight);
    if (layout.bottomSheet) {
      orderMenu.style.left = "";
      orderMenu.style.top = "";
      orderMenu.style.bottom = "";
      orderMenu.style.transform = "";
    } else {
      const x = Math.min(window.innerWidth - 360, Math.max(8, screenX + 12));
      const y = Math.min(window.innerHeight - 380, Math.max(8, screenY + 12));
      orderMenu.style.left = `${x}px`;
      orderMenu.style.top = `${y}px`;
      orderMenu.style.bottom = "auto";
      orderMenu.style.transform = "none";
    }
    orderMenu.hidden = false;
  }

  function runOrderMenu(id: string, kind: "sea" | "ship" | "port" | "enemy"): void {
    const point = orderMenuPoint;
    const target = orderMenuTarget;
    if (id === "close") {
      closeOrderMenu();
      return;
    }
    if (id === "dropAnchor" || id === "weighAnchor") {
      closeOrderMenu();
      sendAnchor(id);
      return;
    }
    if (kind === "enemy" && target?.kind === "ship" &&
      (id === "attackSink" || id === "attackCapture" || id === "board")) {
      closeOrderMenu();
      if (id === "board") {
        const view = ships.get(target.id);
        if (view?.abandoned) openCrewSheet(target.id, true);
        else openBoardSheet(target.id);
      } else {
        sendSelectedSpecial({
          type: "engage",
          shipId: target.id,
          objective: id === "attackSink" ? "sink" : "capture",
        });
      }
      return;
    }
    if (kind === "ship" && target?.kind === "ship" && (id === "follow" || id === "escort")) {
      closeOrderMenu();
      sendSelectedSpecial({ type: id, shipId: target.id });
      return;
    }
    if (kind === "port" && target?.kind === "port" && id === "sailToPort") {
      closeOrderMenu();
      sendPortOrder(target.id);
      return;
    }
    if (kind === "port" && target?.kind === "port" && id === "attackPort") {
      sendPortAttack(target.id);
      return;
    }
    if (!point) return;
    if (id === "sailHere") {
      closeOrderMenu();
      sendOrder(point.x, point.y);
    } else if (id === "heading") {
      closeOrderMenu();
      openHeading(null);
    } else if (id === "patrol") {
      closeOrderMenu();
      beginPatrol(selectedFleetIds()[0] ?? null, point);
    } else if (id === "rendezvous") {
      closeOrderMenu();
      pendingRendezvous = true;
      showNotice("Tap the chart to place the rendezvous point.");
    } else if (id === "returnPort") {
      closeOrderMenu();
      sendSelectedSpecial({ type: "returnToPort" });
    } else if (id === "hold") {
      closeOrderMenu();
      sendSelectedSpecial({ type: "hold" });
    }
  }

  function beginPatrol(fleetId: string | null, from: { x: number; y: number } | null): void {
    const chosen = fleetId ?? selectedFleetIds()[0] ?? null;
    if (!chosen) {
      showNotice("Create a fleet before setting a patrol.");
      return;
    }
    pendingPatrolFleetId = chosen;
    pendingPatrolFrom = from;
    showNotice(from ? "Tap the second patrol point." : "Tap the first patrol point.");
  }

  function placePatrolPoint(point: { x: number; y: number }): boolean {
    if (!pendingPatrolFleetId) return false;
    if (!pendingPatrolFrom) {
      pendingPatrolFrom = point;
      showNotice("Tap the second patrol point.");
      return true;
    }
    sendFleetOrder(pendingPatrolFleetId, {
      type: "patrol",
      a: pendingPatrolFrom,
      b: point,
    });
    pendingPatrolFleetId = null;
    pendingPatrolFrom = null;
    showNotice("Patrol ordered.");
    return true;
  }

  function openHeading(fleetId: string | null): void {
    headingForFleet = fleetId ?? selectedFleetIds()[0] ?? null;
    headingPreviewOn = true;
    headingSheet.hidden = false;
    headingDegrees.value = "0";
    headingDial.value = "0";
    headingDistance.value = "10";
    closeOrderMenu();
    drawHeadingPreview();
  }

  function closeHeadingSheet(): void {
    headingSheet.hidden = true;
    headingPreviewOn = false;
    headingForFleet = null;
    headingPreviewInk.clear();
    drawSelectedRoute();
  }

  function headingValues(): { heading: number; distance: number } {
    const degrees = Number(headingDegrees.value);
    const km = Number(headingDistance.value);
    return {
      heading: Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : 0,
      distance: Number.isFinite(km) ? Math.max(0.2, Math.min(800, km)) : 10,
    };
  }

  function drawHeadingPreview(): void {
    headingPreviewInk.clear();
    if (!headingPreviewOn || headingSheet.hidden) return;
    const { heading, distance } = headingValues();
    const fleet = fleetById(headingForFleet);
    const from = fleet ? shipById(fleet.leaderId) : selectedFleetShip();
    if (!from) return;
    const target = headingTarget(from, heading, distance);
    const points = [toScreen(from.x, from.y), toScreen(target.x, target.y)];
    const spacing = quality.routeDetail
      ? settings.view.routeDotSpacingPx
      : settings.view.routeDotSpacingPx * 2.5;
    const dots = dotsAlongPath(points, spacing);
    for (const dot of dots) {
      headingPreviewInk.circle(dot.x, dot.y, settings.view.routeDotRadiusPx).fill({ color: 0x8c1d1d, alpha: 0.9 });
    }
    headingPreview.textContent = `${heading.toFixed(0)}° · ${distance.toFixed(1)} km`;
    routeLayer.visible = true;
  }

  function confirmHeading(): void {
    const { heading, distance } = headingValues();
    const order: FleetOrder = { type: "heading", headingDeg: heading, distanceKm: distance };
    if (headingForFleet) sendFleetOrder(headingForFleet, order);
    else sendSelectedSpecial(order);
    closeHeadingSheet();
    showNotice(`Heading ${heading.toFixed(0)}° for ${distance.toFixed(1)} km.`);
  }

  function renderFleetPanel(force = false): void {
    const key = JSON.stringify([
      money,
      selectedShipId,
      multiSelect,
      [...selectedShipIds].sort(),
      fleetShips,
      playerFleets,
    ]);
    if (!force && key === fleetPanelKey) return;
    fleetPanelKey = key;
    fleetCountOut.textContent = String(fleetShips.length);
    fleetSummary.textContent = `${fleetCountText(fleetShips.length)} ships · ${formatMoney(money)} pieces`;
    fleetSelectedCount.textContent = `${selectedShipIds.size} selected`;
    fleetSelectAll.disabled = fleetShips.every((ship) => ship.status === "delivery");
    if (!fleetCards.contains(document.activeElement)) renderFleetCards();
    const looseShips = fleetShips.filter((ship) => !ship.fleetId);
    fleetList.replaceChildren();
    fleetEmpty.hidden = looseShips.length > 0;
    fleetEmpty.textContent = playerFleets.length > 0 ? "All ships are in fleets." : "No ships yet.";

    for (const ship of looseShips) {
      const row = buildFleetRow(ship, portName(ship.portId));
      const item = document.createElement("li");
      const pick = document.createElement("label");
      const tick = document.createElement("input");
      const button = document.createElement("button");
      pick.className = "fleet-pick";
      tick.type = "checkbox";
      tick.className = "fleet-pick-box";
      tick.dataset.fleetPick = ship.id;
      tick.checked = selectedShipIds.has(ship.id);
      tick.disabled = !row.selectable;
      tick.setAttribute("aria-label", `Select ${row.name}`);
      tick.addEventListener("click", (event) => event.stopPropagation());
      tick.addEventListener("change", () => toggleGroupShip(ship.id));
      pick.append(tick);
      const name = document.createElement("span");
      const type = document.createElement("span");
      const crew = document.createElement("span");
      const state = document.createElement("span");
      const provisions = document.createElement("span");
      const track = document.createElement("span");
      const fill = document.createElement("span");

      button.type = "button";
      button.className = "fleet-row";
      button.disabled = !row.selectable;
      button.setAttribute("aria-current", String(ship.id === selectedShipId));
      name.className = "fleet-name";

      type.className = "fleet-type";
      type.textContent = row.typeName;
      crew.className = "fleet-crew";
      crew.textContent = row.crewText;
      state.className = "fleet-state";
      state.textContent = row.stateText;
      provisions.className = "fleet-provisions";
      provisions.textContent = `Provisions: ${row.provisionsText}`;
      provisions.classList.toggle("is-low", row.provisionsLow || row.starving);
      if (row.starving) provisions.textContent += " · Starving";
      if (row.needsCrew) {
        const warning = document.createElement("span");
        warning.className = "fleet-needs";
        warning.textContent = " · Needs crew";
        state.append(warning);
      }
      track.className = "crew-track";
      fill.className = "crew-fill";
      fill.style.width = `${row.crewPercent}%`;
      track.append(fill);
      button.append(name, crew, type, state, provisions, track);
      button.addEventListener("click", () => {
        if (!row.selectable) return;
        if (multiSelect) {
          toggleGroupShip(ship.id);
          return;
        }
        updateSelectedShip(ship.id, true);
        closeFleetPanel();
      });
      const damageButton = document.createElement("button");
      damageButton.type = "button";
      damageButton.className = "btn fleet-damage";
      damageButton.textContent = "Damage";
      damageButton.disabled = ship.status === "delivery";
      damageButton.addEventListener("click", () => openDamagePanel(ship.id));
      item.append(pick, button, damageButton);
      fleetList.append(item);
    }
  }

  function openFleetPanel(): void {
    // 3K-c: the fleet panel now lives in the Sailor's Log.
    openSailorsLog("fleets");
  }

  function stockSize(port: PortInfo): "small" | "mid" | "large" {
    return port.size === "S" ? "small" : port.size === "M" ? "mid" : "large";
  }

  function closeShipyardPanel(): void {
    shipyardPortId = null;
    namingClass = null;
    namingStep.hidden = true;
    shipyardPanel.hidden = true;
  }

  function refreshShipyardSummary(): void {
    const port = shipyardPortId ? portData.get(shipyardPortId) : null;
    if (!port) {
      closeShipyardPanel();
      return;
    }
    shipyardPortOut.textContent = port.name;
    shipyardMoney.textContent = formatMoney(money);
    shipyardCount.textContent = fleetCountText(fleetShips.length);

    const deliveries = fleetShips.filter(
      (ship) => ship.status === "delivery" && ship.portId === port.id,
    );
    shipyardDelivery.hidden = deliveries.length === 0;
    shipyardDeliveryList.replaceChildren();
    for (const ship of deliveries) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const time = document.createElement("span");
      name.textContent = `${ship.name} · ${shipTypeFor(ship.navy, ship.classId).name}`;
      time.textContent = formatDuration(ship.deliveryLeftMs);
      item.append(name, time);
      shipyardDeliveryList.append(item);
    }

    for (const button of shipyardCardsOut.querySelectorAll<HTMLButtonElement>(
      "[data-yard-buy]",
    )) {
      button.disabled = fleetShips.length >= settings.ships.maxShipsPerPlayer;
      button.textContent = button.disabled ? "Over ship limit" : "Buy";
    }
  }

  function beginNaming(classId: BuyableShipClassId): void {
    if (!shipyardPortId || !namingClassAllowed(classId)) return;
    const port = portData.get(shipyardPortId);
    if (!port) return;
    const card = shipyardCards(roomKind, stockSize(port), playerNavy, fireShipResearchUnlocked()).find(
      (candidate) => candidate.classId === classId,
    );
    if (!card || card.locked) return;
    namingClass = classId;
    namingName.maxLength = settings.ships.maxNameLength;
    namingName.value = suggestShipName(playerNavy);
    namingType.textContent = `${card.name} · ${formatMoney(card.price)} pieces · ${card.deliveryText}`;
    namingCost.textContent = `${formatMoney(money)} pieces available · ${fleetCountText(fleetShips.length)} ships`;
    namingError.hidden = true;
    namingStep.hidden = false;
    namingName.focus();
    namingStep.scrollIntoView({ block: "nearest" });
  }

  function namingClassAllowed(classId: BuyableShipClassId): boolean {
    if (!shipyardPortId) return false;
    const port = portData.get(shipyardPortId);
    return !!port && shipyardCards(roomKind, stockSize(port), playerNavy, fireShipResearchUnlocked()).some(
      (card) => card.classId === classId && !card.locked,
    );
  }


  function researchLevelMap(): ReadonlyMap<string, number> {
    return new Map(Object.entries(latestResearch?.levels ?? {}));
  }

  function researchRowById(id: string) {
    const view = researchScreenView({
      navy: playerNavy,
      points: latestResearch?.points ?? 0,
      levels: researchLevelMap(),
    });
    for (const branch of view.branches) {
      const row = branch.rows.find((entry) => entry.id === id);
      if (row) return { branch, row };
    }
    return null;
  }

  function showResearchDetail(upgradeId: string): void {
    const found = researchRowById(upgradeId);
    if (!found) {
      researchDetail.hidden = true;
      researchDetailId = null;
      return;
    }
    const { row } = found;
    researchDetailId = upgradeId;
    const upgrade = researchUpgrade(upgradeId);
    researchDetail.hidden = false;
    researchDetailName.textContent = `${row.name} · L${row.level}/${row.levels}`;
    researchDetailEffect.textContent = row.effect;
    researchDetailCost.textContent = row.nextLevel === null
      ? "Fully researched."
      : `Cost: ${row.costUnits} ${row.costUnits === 1 ? "unit" : "units"} · ${row.costPoints} points · ${isShipUpgrade(upgrade as never) ? "ships" : "ports"}`;
    const captured = latestResearch?.capturePoints?.[upgradeId] ?? 0;
    researchDetailCapture.textContent = `Capture progress: ${captured} of ${settings.research.capturePointsPerLevel} points for the next level.`;
    researchDetailStored.hidden = !(row.hook && /stored/i.test(row.hook));
    researchDetailBuy.textContent = row.nextLevel === null
      ? "Fully researched"
      : `Research L${row.nextLevel}`;
    researchDetailBuy.disabled = row.disabled;
    researchDetailBuy.title = row.reason ?? "";
    if (row.reason) researchDetailBuy.textContent = `${researchDetailBuy.textContent} · ${row.reason}`;
    researchDetailBuy.onclick = () => {
      if (row.nextLevel === null || row.disabled) return;
      sendCommand({ t: "research", upgrade: row.id, level: row.nextLevel });
    };
    const ship = selectedFleetShip();
    researchDetailFit.disabled = !ship;
    researchDetailFit.title = ship ? "Open this ship's upgrades" : "Select a ship first";
    researchDetailFit.onclick = () => {
      if (!ship) return;
      closeSailorsLog();
      updateSelectedShip(ship.id, true);
      setShipExpanded(true);
    };
  }

  function applyResearchWebTransform(): void {
    researchWeb.style.transform = `translate(${researchPanX}px, ${researchPanY}px) scale(${researchZoom})`;
  }

  function renderResearchPanel(force = false): void {
    const view = researchScreenView({
      navy: playerNavy,
      points: latestResearch?.points ?? 0,
      levels: researchLevelMap(),
    });
    const key = JSON.stringify({
      navy: view.navy,
      points: view.points,
      levels: latestResearch?.levels ?? {},
      captures: latestResearch?.capturePoints ?? {},
    });
    if (!force && key === researchRenderKey) return;
    researchRenderKey = key;
    researchNavyOut.textContent = `${view.navy} navy · shared with teammates`;
    researchPointsOut.textContent = String(Math.floor(view.points));
    researchUnitsOut.textContent = String(view.units);
    researchOwnedOut.textContent = `${view.ownedLevels} of ${view.totalLevels} levels researched`;
    researchHubNavy.textContent = `${view.navy} navy`;
    researchHubPoints.textContent = `${Math.floor(view.points)} points · ${view.units} units`;
    researchBranchesOut.replaceChildren();
    if (!latestResearch) {
      const empty = document.createElement("p");
      empty.textContent = "Research arrives with the next fleet report.";
      researchBranchesOut.append(empty);
      return;
    }
    for (const branch of view.branches) {
      const section = document.createElement("section");
      section.className = "research-branch";
      section.dataset.researchBranch = branch.id;
      const summary = document.createElement("h3");
      const owned = branch.rows.reduce((sum, row) => sum + row.level, 0);
      const total = branch.rows.reduce((sum, row) => sum + row.levels, 0);
      summary.textContent = `${branch.name} · ${owned}/${total}`;
      section.append(summary);
      for (const row of branch.rows) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `research-node state-${row.state}`;
        item.dataset.researchUpgrade = row.id;
        item.setAttribute("aria-pressed", String(researchDetailId === row.id));
        const name = document.createElement("strong");
        name.textContent = row.name;
        const pips = document.createElement("span");
        pips.className = "research-pips";
        pips.setAttribute("aria-label", `${row.level} of ${row.levels} levels`);
        row.pips.forEach((filled) => {
          const pip = document.createElement("span");
          pip.className = filled ? "filled" : "";
          pip.textContent = filled ? "●" : "○";
          pips.append(pip);
        });
        const state = document.createElement("span");
        state.className = "research-state";
        state.textContent = row.state;
        item.append(name, pips, state);
        item.addEventListener("click", () => showResearchDetail(row.id));
        section.append(item);
      }
      researchBranchesOut.append(section);
    }
    if (researchDetailId) showResearchDetail(researchDetailId);
  }

  function renderShipUpgrades(): void {
    const row = selectedFleetShip();
    shipUpgradeList.replaceChildren();
    shipUpgradeButton.onclick = () => {
      const id = selectedFleetShip()?.id;
      if (id) sendCommand({ t: "fitShip", ship: id });
    };
    if (!row) {
      shipUpgradesSummary.textContent = "No ship selected.";
      shipUpgradeButton.disabled = true;
      shipUpgradeButton.title = "Select a ship";
      shipUpgradeButton.textContent = "Upgrade ship";
      return;
    }
    const info = row.research;
    const fitted = info?.fitted ?? {};
    const unlocked = info?.unlocked ?? {};
    const rows = shipUpgradeRows(playerNavy, fitted, unlocked);
    for (const upgrade of rows) {
      const item = document.createElement("div");
      item.className = "ship-upgrade-row";
      item.dataset.shipUpgrade = upgrade.id;
      const name = document.createElement("strong");
      name.textContent = upgrade.name;
      const levels = document.createElement("span");
      levels.className = "levels";
      levels.textContent = `Fitted ${upgrade.fitted}/${upgrade.levels} · unlocked ${upgrade.unlocked}`;
      const effect = document.createElement("span");
      effect.className = "effect";
      effect.textContent = upgrade.effect;
      item.append(name, levels, effect);
      shipUpgradeList.append(item);
    }
    const missing = info?.missingLevels ?? 0;
    const docked = row.status === "docked";
    const reason = info?.reason ??
      (!docked ? "Not docked at your port" : missing <= 0 ? "All unlocked upgrades fitted" : null);
    shipUpgradesSummary.textContent = missing > 0 && docked
      ? `${missing} level${missing === 1 ? "" : "s"} to fit · ${formatMoney(info?.cost ?? 0)} pieces · ${info?.gameDays ?? 1} game day docked`
      : `${rows.filter((upgrade) => upgrade.fitted > 0).length} of ${rows.length} ship upgrades fitted` +
        (reason ? ` · ${reason}` : "");
    shipUpgradeButton.disabled = !docked || missing <= 0 || info?.canFit !== true;
    shipUpgradeButton.title = reason ?? "Fit every unlocked ship upgrade";
    shipUpgradeButton.textContent = missing > 0 && docked && info?.canFit
      ? `Upgrade ship · ${formatMoney(info.cost)} pieces · ${info.gameDays} game day`
      : "Upgrade ship";
  }

  function updateFleetUpgradeAll(): void {
    const docked = fleetShips.filter((ship) => ship.status === "docked");
    fleetUpgradeAll.disabled = docked.length === 0;
    fleetUpgradeAll.title = docked.length === 0
      ? "No docked ships at your ports"
      : "Fit every unlocked upgrade to all docked ships";
  }

  function setShipSubtab(upgrades: boolean): void {
    shipUpgradesOut.hidden = !upgrades;
    shipTabOverview.setAttribute("aria-selected", String(!upgrades));
    shipTabUpgrades.setAttribute("aria-selected", String(upgrades));
  }

  function fireShipResearchUnlocked(): boolean {
    return (latestResearch?.levels.fireShips ?? 0) >= 1;
  }

  function renderShipyard(): void {
    const port = shipyardPortId ? portData.get(shipyardPortId) : null;
    if (!port || !port.buyable) {
      closeShipyardPanel();
      return;
    }

    shipyardCardsOut.replaceChildren();
    const cards = shipyardCards(roomKind, stockSize(port), playerNavy, fireShipResearchUnlocked());
    for (const card of cards) {
      const article = document.createElement("article");
      const title = document.createElement("h3");
      const price = document.createElement("p");
      const stats = document.createElement("dl");
      const buy = document.createElement("button");

      article.className = `yard-card${card.locked ? " is-locked" : ""}`;
      title.textContent = card.name;
      price.className = "yard-price";
      price.textContent = `${formatMoney(card.price)} pieces · ${card.deliveryText}`;

      const addStat = (label: string, value: string): void => {
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        stats.append(dt, dd);
      };
      addStat("Crew", String(card.crew));
      addStat("Guns", card.guns);
      addStat("Speed", card.speed);
      addStat("Cargo", `${card.cargoTonnes} t`);
      addStat("Hull", formatMoney(card.hull));
      addStat("Closest wind", `${card.closestAngleDeg}°`);
      addStat("Turn 90°", `${card.turn90GameMinutes} game min`);
      addStat("Draught", `${card.draughtM} m`);
      stats.className = "yard-stats";

      buy.type = "button";
      buy.className = "btn";
      buy.dataset.yardBuy = "true";
      buy.textContent = card.locked ? (card.lockedReason ?? "Needs research") : "Buy";
      buy.disabled = card.locked || fleetShips.length >= settings.ships.maxShipsPerPlayer;
      buy.title = card.locked
        ? (card.lockedReason ?? "Needs research")
        : buy.disabled ? "Over ship limit" : `Buy ${card.name}`;
      if (!card.locked && buy.disabled) buy.textContent = "Over ship limit";
      buy.addEventListener("click", () => beginNaming(card.classId));

      article.append(title, price, stats, buy);
      shipyardCardsOut.append(article);
    }

    refreshShipyardSummary();
  }

  function openShipyard(portId: string): void {
    const port = portData.get(portId);
    if (!port || !port.buyable) {
      showNotice("You must own a port to buy ships here.");
      return;
    }
    closePortPanel();
    closeTradePanel();
    closeFleetPanel();
    closeHirePanel();
    knownPortsPanel.hidden = true;
    shipyardPortId = portId;
    namingClass = null;
    namingStep.hidden = true;
    shipyardPanel.hidden = false;
    renderShipyard();
  }

  function confirmPurchase(): void {
    if (!shipyardPortId || !namingClass) return;
    const name = cleanShipName(namingName.value);
    if (!name) {
      namingError.textContent = `Use 1–${settings.ships.maxNameLength} letters, numbers, spaces or simple punctuation.`;
      namingError.hidden = false;
      namingName.focus();
      return;
    }
    if (!sendCommand({
      t: "buy",
      port: shipyardPortId,
      type: namingClass,
      name,
    })) return;
    namingStep.hidden = true;
    namingClass = null;
    showNotice(`Order sent: ${name}.`);
    refreshShipyardSummary();
  }

  function closeHirePanel(): void {
    hirePortId = null;
    hirePanel.hidden = true;
  }

  function renderHirePanel(): void {
    const port = hirePortId ? portData.get(hirePortId) : null;
    if (!port) {
      closeHirePanel();
      return;
    }
    const docked = fleetShips.filter(
      (ship) => ship.status === "docked" && ship.portId === port.id,
    );
    hirePortOut.textContent = port.name;
    hirePoolOut.textContent = `Crew pool: ${formatMoney(port.crewAvailable ?? 0)} sailors`;
    hireList.replaceChildren();
    hireEmpty.hidden = docked.length > 0;

    for (const ship of docked) {
      const quoteBase = port.crewAvailable ?? 0;
      const card = document.createElement("article");
      const head = document.createElement("div");
      const title = document.createElement("h3");
      const count = document.createElement("span");
      const slider = document.createElement("input");
      const quick = document.createElement("div");
      const cost = document.createElement("p");
      const confirm = document.createElement("button");
      const targets = crewQuickTargets(ship);

      card.className = "hire-card";
      head.className = "hire-head";
      title.textContent = ship.name;
      count.className = "hire-count";
      count.textContent = `${ship.crew} / ${ship.fullCrew} crew`;
      head.append(title, count);

      slider.type = "range";
      slider.className = "hire-slider";
      slider.min = String(ship.crew);
      slider.max = String(ship.fullCrew);
      slider.step = "1";
      slider.value = String(ship.crew);
      slider.setAttribute("aria-label", `Crew for ${ship.name}`);

      const updateQuote = (): void => {
        const quote = crewQuote(ship, Number(slider.value), quoteBase, money);
        count.textContent = `${formatWhole(quote.target)} / ${formatWhole(ship.fullCrew)} crew`;
        cost.className = "hire-cost";
        cost.textContent = quote.count <= 0
          ? `Move the slider to hire · pool ${formatMoney(quote.poolLeft)} left`
          : `${quote.count} sailors · ${formatMoney(quote.cost)} pieces · pool ${formatMoney(quote.poolLeft)} left`;
        confirm.disabled = !quote.canHire;
        if (!quote.canHire && quote.reason) cost.textContent += ` · ${quote.reason}`;
        confirm.dataset.count = String(quote.count);
      };
      slider.addEventListener("input", updateQuote);

      quick.className = "hire-quick";
      const quickButton = (label: string, target: number): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = label;
        button.addEventListener("click", () => {
          slider.value = String(Math.max(ship.crew, Math.min(ship.fullCrew, target)));
          updateQuote();
        });
        return button;
      };
      quick.append(
        quickButton("Minimum (10%)", targets.minimum),
        quickButton("Half", targets.half),
        quickButton("Full", targets.full),
      );

      confirm.type = "button";
      confirm.className = "btn btn-seal hire-confirm";
      confirm.textContent = "Confirm hire";
      confirm.disabled = true;
      confirm.addEventListener("click", () => {
        const amount = Number(confirm.dataset.count ?? 0);
        if (!(amount > 0) || !hirePortId) return;
        if (!sendCommand({ t: "hire", ship: ship.id, port: hirePortId, count: amount })) return;
        closeHirePanel();
      });

      updateQuote();
      card.append(head, slider, quick, cost, confirm);
      hireList.append(card);
    }
  }

  function openHirePanel(portId: string): void {
    if (!portData.has(portId)) return;
    closePortPanel();
    closeTradePanel();
    closeFleetPanel();
    closeShipyardPanel();
    knownPortsPanel.hidden = true;
    hirePortId = portId;
    hirePanel.hidden = false;
    renderHirePanel();
  }

  function closeTradePanel(): void {
    tradePortId = null;
    tradeShipId = null;
    tradeRenderKey = "";
    tradePanel.hidden = true;
    if (sailorsLogOpen) renderLogTrade();
  }

  function tradeTabAvailable(
    tab: "buy" | "sell" | "storage",
    port: PortInfo,
  ): boolean {
    if (tab === "buy") return port.npc && !!port.prices && !!port.npcStock;
    if (tab === "sell") return !!port.prices;
    return !!port.storage;
  }

  function openTradePanel(portId: string): void {
    const port = portData.get(portId);
    const ship = selectedFleetShip();
    if (!port || !ship || ship.status !== "docked" || ship.portId !== portId) {
      showNotice("Dock a ship at this port to trade.");
      return;
    }

    if (!sailorsLogOpen) openSailorsLog("trade");
    else setLogTab("trade");
    closePortPanel();
    closeFleetPanel();
    closeShipyardPanel();
    closeHirePanel();
    knownPortsPanel.hidden = true;
    tradePortId = portId;
    tradeShipId = ship.id;
    tradeTab = port.npc ? "buy" : port.storage ? "storage" : "sell";
    if (!tradeTabAvailable(tradeTab, port)) {
      tradeTab = tradeTabAvailable("sell", port)
        ? "sell"
        : tradeTabAvailable("storage", port)
          ? "storage"
          : "buy";
    }
    tradeAmounts.clear();
    tradeNotice.hidden = true;
    tradeNotice.textContent = "";
    tradeRenderKey = "";
    tradePanel.hidden = false;
    renderTradePanel(true);
    renderLogTrade();
  }

  function renderTradePanel(force = false): void {
    if (!tradePortId || !tradeShipId) return;
    const port = portData.get(tradePortId);
    const ship = fleetShips.find((mine) => mine.id === tradeShipId);
    if (!port || !ship || ship.status !== "docked" || ship.portId !== tradePortId) {
      closeTradePanel();
      return;
    }

    const key = JSON.stringify([
      tradeShipId,
      money,
      ship.cargoUsed,
      port.prices ?? null,
      port.storage ?? null,
      port.npcStock ?? null,
      port.storageLimit ?? null,
    ]);
    if (!force && key === tradeRenderKey) return;
    tradeRenderKey = key;

    tradePort.textContent = port.name;
    tradeTitle.textContent = `Trade · ${ship.name}`;
    tradeMeta.textContent = `${formatMoney(money)} pieces · ${formatTonnesWithUnit(ship.cargoUsed)} in the cargo hold`;
    tradeFree.textContent = freeSpaceText(ship);
    tradeResupplyHint.textContent = port.npc
      ? "Bought at the posted prices."
      : "Taken free from this port's storage.";
    tradeResupply.disabled = !(port.npc || port.buyable);

    const available = {
      buy: tradeTabAvailable("buy", port),
      sell: tradeTabAvailable("sell", port),
      storage: tradeTabAvailable("storage", port),
    };
    if (!available[tradeTab]) {
      tradeTab = available.buy ? "buy" : available.storage ? "storage" : "sell";
    }
    for (const button of tradePanel.querySelectorAll<HTMLButtonElement>(
      "[data-trade-tab]",
    )) {
      const tab = button.dataset.tradeTab;
      if (tab !== "buy" && tab !== "sell" && tab !== "storage") continue;
      button.disabled = !available[tab];
      button.setAttribute("aria-selected", String(tab === tradeTab));
    }

    tradeBody.replaceChildren();

    function makeStepper(
      amountKey: string,
      maxValue: number,
      onChange: (amount: number) => void,
    ): { element: HTMLElement; amount: () => number } {
      const max = Math.max(0, Math.floor(maxValue));
      const stored = tradeAmounts.get(amountKey);
      let current = stored !== undefined && Number.isFinite(stored)
        ? Math.floor(stored)
        : Math.min(1, max);
      current = Math.max(0, Math.min(max, current));

      const element = document.createElement("div");
      const out = document.createElement("span");
      element.className = "trade-stepper";
      out.className = "trade-amount";
      out.setAttribute("aria-live", "polite");

      const set = (next: number): void => {
        current = Math.max(0, Math.min(max, Math.floor(next)));
        tradeAmounts.set(amountKey, current);
        out.textContent = `${current} t`;
        onChange(current);
      };

      const stepButton = (label: string, delta: number): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = label;
        button.addEventListener("click", () => set(current + delta));
        return button;
      };
      const fill = document.createElement("button");
      fill.type = "button";
      fill.className = "btn trade-fill";
      fill.textContent = "Fill up";
      fill.disabled = max <= 0;
      fill.addEventListener("click", () => set(max));

      element.append(
        stepButton("−10", -10),
        stepButton("−1", -1),
        out,
        stepButton("+1", 1),
        stepButton("+10", 10),
        fill,
      );
      out.textContent = `${current} t`;
      return { element, amount: () => current };
    }

    const section = document.createElement("section");
    const heading = document.createElement("h3");
    const help = document.createElement("p");
    heading.className = "trade-section-title";
    help.className = "trade-help";

    if (tradeTab === "buy") {
      heading.textContent = "Buy resources";
      help.textContent = "Neutral merchants sell these five resources from their stock.";
      section.append(heading, help);
      const rows = buildBuyRows(port, ship, money);
      if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "trade-empty";
        empty.textContent = "This port sells no resources.";
        section.append(empty);
      }
      for (const row of rows) {
        const card = document.createElement("article");
        const head = document.createElement("div");
        const title = document.createElement("h4");
        const meta = document.createElement("p");
        const total = document.createElement("p");
        const actions = document.createElement("div");
        const action = document.createElement("button");
        card.className = "trade-row";
        head.className = "trade-row-head";
        title.textContent = row.name;
        if (row.regional) {
          const cheap = document.createElement("span");
          cheap.className = "trade-cheap";
          cheap.textContent = "regional · cheap";
          title.append(" ", cheap);
        }
        meta.className = "trade-row-meta";
        meta.textContent = `${formatPrice(row.price)} pieces/t · ${formatTonnes(row.stock)} t in stock · ${formatTonnes(row.freeSpace)} t free`;
        total.className = "trade-total";
        actions.className = "trade-actions";
        action.type = "button";
        action.className = "btn";
        head.append(title);
        card.append(head, meta);
        const update = (amount: number): void => {
          total.textContent = `Total cost: ${formatMoney(amount * row.price)} pieces`;
          action.textContent = amount > 0 ? `Buy ${amount} t` : "Buy";
          action.disabled = amount <= 0;
        };
        const stepper = makeStepper(`buy:${row.good}`, row.max, update);
        action.addEventListener("click", () => {
          const amount = stepper.amount();
          if (amount <= 0) return;
          sendCommand({
            t: "buyGoods",
            ship: ship.id,
            port: port.id,
            good: row.good,
            amount,
          });
        });
        actions.append(action);
        card.append(stepper.element, total, actions);
        update(stepper.amount());
        section.append(card);
      }
    } else if (tradeTab === "sell") {
      heading.textContent = "Sell cargo";
      help.textContent = "Trade goods, timber and cloth in your hold are bought at the posted price.";
      section.append(heading, help);
      const rows = buildSellRows(port, ship);
      if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "trade-empty";
        empty.textContent = "Your cargo hold is empty.";
        section.append(empty);
      }
      for (const row of rows) {
        const card = document.createElement("article");
        const head = document.createElement("div");
        const title = document.createElement("h4");
        const meta = document.createElement("p");
        const total = document.createElement("p");
        const actions = document.createElement("div");
        const action = document.createElement("button");
        card.className = "trade-row";
        head.className = "trade-row-head";
        title.textContent = row.name;
        meta.className = "trade-row-meta";
        meta.textContent = `${formatPrice(row.price)} pieces/t · ${formatTonnes(row.hold)} t in your hold`;
        total.className = "trade-total";
        actions.className = "trade-actions";
        action.type = "button";
        action.className = "btn";
        head.append(title);
        card.append(head, meta);
        const update = (amount: number): void => {
          total.textContent = `Total paid: ${formatMoney(amount * row.price)} pieces`;
          action.textContent = amount > 0 ? `Sell ${amount} t` : "Sell";
          action.disabled = amount <= 0;
        };
        const stepper = makeStepper(`sell:${row.good}`, row.max, update);
        action.addEventListener("click", () => {
          const amount = stepper.amount();
          if (amount <= 0) return;
          sendCommand({
            t: "sellGoods",
            ship: ship.id,
            port: port.id,
            good: row.good,
            amount,
          });
        });
        actions.append(action);
        card.append(stepper.element, total, actions);
        update(stepper.amount());
        section.append(card);
      }
    } else {
      heading.textContent = "Port storage";
      section.append(heading);
      const rows = buildStorageRows(port, ship);
      if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "trade-empty";
        empty.textContent = "This port has no storage you can use.";
        section.append(empty);
      } else {
        const used = rows.reduce((total, row) => total + row.portAmount, 0);
        help.textContent = `Port storage: ${formatTonnes(used)} t of ${formatTonnes(port.storageLimit ?? 0)} t used. Loading and unloading are free.`;
        section.append(help);
        for (const row of rows) {
          const card = document.createElement("article");
          const head = document.createElement("div");
          const title = document.createElement("h4");
          const meta = document.createElement("p");
          card.className = "trade-row trade-storage-row";
          head.className = "trade-row-head";
          title.textContent = row.name;
          meta.className = "trade-row-meta";
          meta.textContent = `Port ${formatTonnes(row.portAmount)} t · Ship ${formatTonnes(row.shipAmount)} t`;
          head.append(title);
          card.append(head, meta);

          const side = (
            label: string,
            key: string,
            max: number,
            command: "load" | "unload",
          ): void => {
            const wrap = document.createElement("div");
            const strong = document.createElement("strong");
            const actions = document.createElement("div");
            const action = document.createElement("button");
            wrap.className = "trade-storage-side";
            strong.textContent = label;
            actions.className = "trade-actions";
            action.type = "button";
            action.className = "btn";
            action.textContent = command === "load" ? "Load" : "Unload";
            const update = (amount: number): void => {
              action.disabled = amount <= 0;
              action.textContent = amount > 0
                ? `${command === "load" ? "Load" : "Unload"} ${amount} t`
                : command === "load" ? "Load" : "Unload";
            };
            const stepper = makeStepper(key, max, update);
            action.addEventListener("click", () => {
              const amount = stepper.amount();
              if (amount <= 0) return;
              sendCommand({
                t: command,
                ship: ship.id,
                port: port.id,
                good: row.good,
                amount,
              });
            });
            actions.append(action);
            wrap.append(strong, stepper.element, actions);
            update(stepper.amount());
            card.append(wrap);
          };

          side("Load from port", `load:${row.good}`, row.loadMax, "load");
          side("Unload into port", `unload:${row.good}`, row.unloadMax, "unload");
          section.append(card);
        }
      }
    }

    tradeBody.append(section);

    if (port.prices) {
      const prices = document.createElement("section");
      const priceTitle = document.createElement("h3");
      const note = document.createElement("p");
      const list = document.createElement("ul");
      prices.className = "trade-prices";
      priceTitle.textContent = "Price list";
      note.className = "trade-help";
      note.textContent = regionalGoodNote(port);
      list.className = "trade-price-list";
      for (const row of priceBookRows(port)) {
        const item = document.createElement("li");
        const name = document.createElement("span");
        const price = document.createElement("span");
        name.textContent = row.name;
        price.textContent = row.cheap
          ? `${formatPrice(row.price)} pieces · cheap`
          : `${formatPrice(row.price)} pieces`;
        if (row.cheap) item.className = "is-cheap";
        item.append(name, price);
        list.append(item);
      }
      prices.append(priceTitle, note, list);
      tradeBody.append(prices);
    }
  }

  function formatCountdown(seconds: number): string {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  }

  function refreshCaptureStrip(): void {
    const text = captureStripText({
      ports: [...portData.values()],
      selectedPortId,
      viewerId: identity.id,
    }) ?? "";
    captureStrip.textContent = text;
    captureStrip.hidden = text === "";
  }

  function closePortPanel(): void {
    selectedPortId = null;
    portPanel.hidden = true;
    refreshCaptureStrip();
  }

  function refreshPortPanel(): void {
    if (!selectedPortId) return;
    const port = portData.get(selectedPortId);
    if (!port) {
      closePortPanel();
      return;
    }

    const ship = ownSnapshot;
    const dockedHere = ship?.[7] === port.id;
    const hasDockedShip = fleetShips.some(
      (mine) => mine.status === "docked" && mine.portId === port.id,
    );
    const distanceKm = ship
      ? Math.hypot(port.x - ship[2], port.y - ship[3])
      : null;
    const model = buildPortPanelModel({
      port,
      distanceKm,
      dockedHere,
      hasShip: ship !== null,
      canBuy: port.buyable === true,
      canTrade: dockedHere && (port.npc || port.buyable === true),
      hasDockedShip,
    });

    portSize.textContent = model.sizeLabel;
    portTitle.textContent = model.title;
    portStatus.textContent = model.status;
    portRegion.textContent = model.region;
    portGood.textContent = model.good;
    portCapacity.textContent = model.capacityText;
    portFree.textContent = model.freeText ?? "";
    portFree.hidden = model.freeText === null;
    portDistance.textContent = model.distanceText;
    portNpcNote.hidden = !port.npc;
    portSail.hidden = !model.buttons.includes("sail");
    portUndock.hidden = !model.buttons.includes("undock");
    portTrade.hidden = !model.buttons.includes("trade");
    portShipyard.hidden = !model.buttons.includes("shipyard");
    portHire.hidden = !model.buttons.includes("hire");
    const dockedMine = fleetShips.find((mine) => mine.status === "docked" && mine.portId === port.id);
    const prisoners = prisonerHandoverRow(dockedMine?.prisoners ?? 0);
    portPrisoners.hidden = !prisoners.shown;
    portHandover.textContent = prisoners.label;
    portPrisonerTotal.textContent = prisoners.shown
      ? `${prisoners.count} prisoners · ${formatMoney(prisoners.total)} pieces`
      : "";
    const ownPort = port.owner === identity.id;
    const tier = port.tier ?? 0;
    portOwnerOut.textContent = port.npc
      ? "Neutral port · not attackable"
      : port.owner === null || port.owner === undefined
        ? "Unclaimed port"
        : ownPort
          ? "Your port"
          : `${port.ownerNavy ?? "Foreign"} port`;
    const hasExact = typeof port.health === "number" && typeof port.maxHealth === "number" &&
      port.maxHealth > 0;
    portHealthOut.hidden = !hasExact;
    if (hasExact) {
      const share = Math.max(0, Math.min(1, port.health! / port.maxHealth!));
      portHealthFill.style.width = `${(share * 100).toFixed(1)}%`;
      portHealthFill.className = share <= 0
        ? "silenced"
        : share >= 0.75 ? "healthy" : share >= 0.4 ? "damaged" : "";
      portHealthText.textContent =
        `${Math.round(port.health!)} / ${Math.round(port.maxHealth!)} hull · ${Math.round(share * 100)}%`;
    }
    portBatteryOut.textContent = port.guns
      ? `Batteries ${port.guns.heavy}/${port.guns.medium}/${port.guns.light} (H/M/L)`
      : `Condition: ${port.condition ?? "unknown"} · batteries unknown`;
    const researchTier = Math.max(0, Math.min(3, latestResearch?.levels.fortification ?? 0));
    portTierOut.textContent = `Fortifications: tier ${tier}` +
      (tier === 0 ? " (none)" : tier === 1 ? " (wooden palisade)" : tier === 2 ? " (stone wall)" : " (star fortress)") +
      ` · may build up to tier ${researchTier}`;
    const captureStatus = port.capture
      ? port.capture.seconds > 0
        ? ` · capturing ${formatCountdown(Math.max(0, port.capture.requiredSeconds - port.capture.seconds))} left`
        : port.silenced && port.capture.reason ? ` · ${port.capture.reason}` : ""
      : "";
    portCaptureRangeOut.textContent =
      `Capture range ${Math.round(port.rangeKm ?? 0)} km` +
      (port.rangeKm !== undefined &&
        port.rangeKm < settings.ports.battle.captureRangeKm[port.size]
        ? " (reduced by night or weather)"
        : "") +
      captureStatus;
    const canBuild = ownPort && tier < Math.min(3, researchTier);
    portBuildOut.hidden = !ownPort && !port.build;
    portBuildButton.hidden = !ownPort;
    if (port.build) {
      const total = Math.max(1, port.build.endsGameMs - port.build.startedGameMs);
      const done = Math.max(0, Math.min(total, clockShownMs - port.build.startedGameMs));
      portBuildFill.style.width = `${((done / total) * 100).toFixed(1)}%`;
      portBuildFill.className = "healthy";
      const leftGameSeconds = Math.max(0, (port.build.endsGameMs - clockShownMs) / 1000);
      portBuildText.textContent =
        `Tier ${tier} → ${port.build.toTier} · ${Math.round((done / total) * 100)}% · ` +
        `${Math.ceil(leftGameSeconds / 60)} game min left`;
      portBuildButton.disabled = true;
      portBuildButton.textContent = "Build in progress";
    } else {
      portBuildFill.style.width = "0%";
      if (port.nextCost) {
        const haveTimber = port.stock?.timber ?? 0;
        const haveRepair = port.stock?.repairMaterials ?? 0;
        portBuildText.textContent =
          `Next tier ${tier + 1}: ${port.nextCost.timber} timber (have ${Math.floor(haveTimber)}) · ` +
          `${port.nextCost.repairMaterials} repair (have ${Math.floor(haveRepair)})`;
      } else if (canBuild) {
        portBuildText.textContent = "Choose the next fortification tier.";
      }
      const enough = port.nextCost
        ? (port.stock?.timber ?? 0) >= port.nextCost.timber &&
          (port.stock?.repairMaterials ?? 0) >= port.nextCost.repairMaterials
        : false;
      const gateReason = tier >= researchTier
        ? `Needs research: Fortification tier ${tier + 1}`
        : null;
      portBuildButton.disabled = !enough || gateReason !== null;
      portBuildButton.title = gateReason ??
        (enough ? `Build tier ${Math.min(3, tier + 1)}` : "Not enough timber or repair materials");
      portBuildButton.textContent = gateReason ??
        `Build tier ${Math.min(3, tier + 1)}`;
    }
    portAttackButton.hidden = ownPort;
    portAttackButton.disabled = port.npc;
    portAttackButton.textContent = port.npc ? "Neutral ground" : "Attack port";
    refreshCaptureStrip();
    portPanel.hidden = false;
  }

  function openPortPanel(portId: string): void {
    if (!portData.has(portId)) return;
    closeShipActions();
    closeFleetPanel();
    closeTradePanel();
    closeShipyardPanel();
    closeHirePanel();
    selectedPortId = portId;
    knownPortsPanel.hidden = true;
    refreshPortPanel();
  }

  function confirmRouteCancel(ids: string[]): boolean {
    if (!ids.some((id) => latestRoutes.some((route) => route.shipId === id))) return true;
    return window.confirm("This ship is running a trade route. Give the direct order and cancel the route?");
  }

  function sendPortOrder(portId: string): void {
    const port = portData.get(portId);
    const ids = groupShipIds();
    if (!port || ids.length === 0) return;
    if (!confirmRouteCancel(ids)) return;
    target = { x: port.x, y: port.y };
    const screen = toScreen(port.x, port.y);
    marker.position.set(screen.x, screen.y);
    marker.visible = true;

    let sent = false;
    for (const id of ids) {
      sent = sendCommand({ t: "sailToPort", port: portId, ship: id }) || sent;
    }
    if (sent) closePortPanel();
  }

  function sendPortAttack(portId: string): void {
    const port = portData.get(portId);
    if (!port) return;
    if (port.npc) {
      showNotice("Neutral ground");
      return;
    }
    const fleets = selectedFleetIds();
    for (const fleetId of fleets) {
      sendCommand({ t: "fleetAttackPort", fleet: fleetId, port: portId });
    }
    const ids = groupShipIds().filter((id) => !fleetOfShip(id));
    if (ids.length === 0 && fleets.length === 0) {
      showNotice("Select a ship or fleet first.");
      return;
    }
    for (const id of ids) sendCommand({ t: "attackPort", port: portId, ship: id });
    attackedPortId = portId;
    closePortPanel();
    closeOrderMenu();
  }

  function sendUndock(): void {
    const ids = groupShipIds();
    if (ids.length === 0) return;
    let sent = false;
    for (const id of ids) {
      sent = sendCommand({ t: "undock", ship: id }) || sent;
    }
    if (sent) {
      closePortPanel();
      closeShipActions();
    }
  }

  function sendAnchor(action: "dropAnchor" | "weighAnchor"): void {
    const ids = groupShipIds();
    if (ids.length === 0) {
      showNotice("Select one of your ships first.");
      return;
    }
    for (const id of ids) sendCommand({ t: action, ship: id });
  }

  function renderKnownPorts(): void {
    knownPortsList.replaceChildren();
    const from = ownSnapshot ? { x: ownSnapshot[2], y: ownSnapshot[3] } : null;
    const ports = knownPortsNearest([...portData.values()], from);
    knownPortsEmpty.hidden = ports.length > 0;

    for (const port of ports) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const name = document.createElement("span");
      const meta = document.createElement("span");
      const distance = from ? Math.hypot(port.x - from.x, port.y - from.y) : null;

      button.type = "button";
      button.className = "known-port";
      name.className = "known-port-name";
      name.textContent = port.name;
      meta.className = "known-port-meta";
      meta.textContent = `${portSizeLabel(port.size)} · ${distance === null ? "–" : `${Math.round(distance)} km`}`;
      button.append(name, meta);
      button.addEventListener("click", () => {
        knownPortsPanel.hidden = true;
        view.x = port.x;
        view.y = port.y;
        view.kmAcross = clamp(
          settings.view.startKmAcross,
          minViewKmAcross(),
          maxViewKmAcross(),
        );
        setFollow(false);
        refreshMap(performance.now(), true);
        openPortPanel(port.id);
      });
      item.appendChild(button);
      knownPortsList.appendChild(item);
    }
  }

  /** Recreate the parts Pixi loses when the WebGL context is restored. */
  function rebuildAfterGraphicsReset(): void {
    chartTexture?.destroy(true);
    chartTexture = null;
    chartViewTexture?.destroy(true);
    chartViewTexture = null;
    chartViewPose = null;
    chartViewDirty = true;
    chartViewPendingKey = "";
    chartSprite.texture = Texture.EMPTY;
    chartCacheInitialized = false;
    chartGraphics.clear();
    chartPaperGraphics.clear();
    lastChartBuild = 0;
    markAllChartDirty();
    destroyBlockPaints();
    clearPortViews();
    builtScale = 0;
    drawGrain();
    refreshMap(performance.now(), true);
    refreshFogPaper();
    updateLiveCircles();
    updateLayerOffset();
    drawLastSeen();
    drawBorders();
    refreshPorts();
    updateDebugLine();
  }

  // ---- Last seen and ships ------------------------------------------------

  function clearLastSeen(): void {
    for (const view of lastSeenViews) view.destroy({ children: true });
    lastSeenViews = [];
  }

  function drawLastSeen(): void {
    clearLastSeen();
    for (const row of lastSeen) {
      const [classId, navy, x, y, age, npcKind] = row;
      const container = new Container();
      const mark = new Graphics();
      let labelText = `${navy} ${classId} · ${Math.round(age)}s`;
      if (npcKind) {
        const marker = neutralMarker(npcKind, false);
        paintNeutralMarker(mark, marker, 0, 0);
        labelText = `Neutral ${marker.label} · ${Math.round(age)}s`;
      } else {
        mark
          .circle(0, 0, 8)
          .stroke({ width: 1, color: INK_COLOR, alpha: 0.55 })
          .moveTo(-5, -5)
          .lineTo(5, 5)
          .moveTo(5, -5)
          .lineTo(-5, 5)
          .stroke({ width: 1, color: INK_COLOR, alpha: 0.55 });
      }
      const label = new Text({
        text: labelText,
        style: { fontFamily: "Source Sans 3", fontSize: 10, fill: INK_COLOR },
      });
      label.alpha = 0.65;
      label.position.set(10, -6);
      container.addChild(mark, label);
      lastSeenLayer.addChild(container);
      lastSeenViews.push(container);
      container.position.set(x, y);
      container.alpha = 0.8;
      container.visible = false;
    }
  }

  function drawWhiteFlag(flag: Graphics): void {
    flag.clear();
    flag.moveTo(0, -10).lineTo(0, -24).stroke({ width: 1.5, color: INK_COLOR });
    flag
      .poly([1, -24, 10, -21, 1, -17])
      .fill({ color: 0xfffdf2 })
      .stroke({ width: 1, color: INK_COLOR });
  }

  function asNpcKind(value: unknown): NpcKindId | null {
    return value === "merchant" || value === "whaler" || value === "privateer" ? value : null;
  }

  function paintHull(
    hull: Graphics,
    own: boolean,
    navy: string,
    npcKind: NpcKindId | null = null,
    npcHired = false,
  ): Graphics {
    const size = own ? 1 : 0.85;
    const fleetColor = navyColorNumber(parseNavy(navy) ?? "British");
    const neutral = npcKind ? neutralHullStyle(npcKind, npcHired) : null;
    hull.clear();
    hull
      .poly([
        0, -13 * size,
        5 * size, -4 * size,
        4.5 * size, 7 * size,
        0, 10 * size,
        -4.5 * size, 7 * size,
        -5 * size, -4 * size,
      ])
      .fill(neutral?.fill ?? fleetColor)
      .stroke({ width: 1.4, color: own ? 0xf3e7cb : neutral?.stroke ?? 0x1b2f3d });
    return hull;
  }

  function paintNeutralMarker(
    ink: Graphics,
    marker: ReturnType<typeof neutralMarker>,
    cx: number,
    cy: number,
  ): void {
    const size = marker.sizePx;
    if (marker.shape === "circle") {
      ink.circle(cx, cy, size).fill(marker.fill).stroke({ width: 1.3, color: marker.stroke });
    } else if (marker.shape === "diamond") {
      ink.poly([cx, cy - size, cx + size, cy, cx, cy + size, cx - size, cy])
        .fill(marker.fill).stroke({ width: 1.3, color: marker.stroke });
    } else {
      ink.poly([cx, cy - size, cx + size, cy + size, cx - size, cy + size])
        .fill(marker.fill).stroke({ width: 1.3, color: marker.stroke });
    }
    if (marker.hiredRing) {
      ink.circle(cx, cy, size + 3).stroke({ width: 1.2, color: 0xd6b45a, alpha: 0.95 });
    }
  }

  function updateShipReconMarker(ship: ShipView): void {
    ship.reconInk.clear();
    ship.reconInk.visible = false;
    ship.reconLabel.visible = false;
    if (!ship.npcKind) return;
    const marker = neutralMarker(ship.npcKind, ship.npcHired);
    paintNeutralMarker(ship.reconInk, marker, 0, -22);
    ship.reconInk.visible = true;
    ship.reconLabel.text = marker.short;
    ship.reconLabel.style.fill = marker.stroke;
    ship.reconLabel.position.set(9, -27);
    ship.reconLabel.visible = true;
  }

  function makeHull(own: boolean, navy: string): Graphics {
    return paintHull(new Graphics(), own, navy);
  }

  const shipPool: ShipView[] = [];

  /** One ship's whole display list, made once and reused after it leaves view. */
  function createShipView(): ShipView {
    const hull = new Graphics();
    const ring = new Graphics();
    ring.visible = false;
    const flag = new Graphics();
    drawWhiteFlag(flag);
    flag.visible = false;
    const flagshipInk = new Graphics();
    flagshipInk
      .moveTo(8, 2).lineTo(8, -12)
      .stroke({ width: 1.4, color: 0x2a1c10, alpha: 0.95 })
      .moveTo(8, -12).lineTo(16, -9).lineTo(8, -6).closePath()
      .fill({ color: 0x8c1d1d });
    flagshipInk.visible = false;
    const runInk = new Graphics();
    runInk.moveTo(0, 0).lineTo(0, -34).stroke({
      width: 1.6,
      color: 0xfff8e6,
      alpha: 0.95,
      cap: "round",
    });
    runInk.visible = false;
    const runLabel = new Text({
      text: "Running",
      style: { fontFamily: "Source Sans 3", fontSize: 10, fill: 0xfff8e6 },
    });
    runLabel.visible = false;
    const statusInk = new Graphics();
    const statusLabel = new Text({
      text: "Abandoned",
      style: { fontFamily: "Source Sans 3", fontSize: 9, fill: 0x4a3a2a },
    });
    statusLabel.visible = false;
    const lightsLabel = new Text({
      text: settings.effects.lightsRingLabel,
      style: { fontFamily: "Source Sans 3", fontSize: 9, fill: 0xd9b25c },
    });
    lightsLabel.visible = false;
    const reconInk = new Graphics();
    reconInk.visible = false;
    const reconLabel = new Text({
      text: "",
      style: { fontFamily: "Source Sans 3", fontSize: 8, fill: 0x4a3220, fontWeight: "600" },
    });
    reconLabel.visible = false;
    return {
      id: "",
      hull,
      ring,
      flag,
      flagshipInk,
      runInk,
      runLabel,
      own: false,
      classId: "frigate",
      navy: "British",
      x: 0,
      y: 0,
      heading: 0,
      motion: new MotionTrack(
        12,
        settings.client.renderExtrapolationMs / 1_000,
        settings.client.renderCorrectionRate,
      ),
      dockedPortId: null,
      waitingPortId: null,
      surrendered: false,
      running: false,
      abandoned: false,
      burning: false,
      fireStrength: 0,
      ignitionAt: null,
      sinking: false,
      lantern: false,
      lightsOff: false,
      isFlagship: false,
      statusInk,
      statusLabel,
      lightsLabel,
      npcKind: null,
      npcHired: false,
      reconInk,
      reconLabel,
      statusKey: "",
    };
  }

  function shipDisplayChildren(ship: ShipView): Array<Container | Graphics | Text> {
    return [ship.hull, ship.ring, ship.flag, ship.flagshipInk, ship.runInk, ship.runLabel, ship.reconInk, ship.reconLabel, ship.statusInk, ship.statusLabel, ship.lightsLabel];
  }

  function updateShipStores(ship: OwnShipSnapshot | null): void {
    const key = ship
      ? JSON.stringify([
          ship.id,
          ship.stores,
          ship.capacities,
          ship.cargoUsed,
          ship.provisionsDays,
          ship.starving,
        ])
      : "none";
    if (key === storeRenderKey) return;
    storeRenderKey = key;
    shipStoresOut.replaceChildren();
    if (!ship) {
      shipStarvingOut.hidden = true;
      return;
    }

    for (const bar of buildShipStoreBars(ship)) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      const amount = document.createElement("span");
      const track = document.createElement("span");
      const fill = document.createElement("span");
      const detail = document.createElement("p");
      row.className = "store-bar";
      row.classList.toggle("is-urgent", bar.urgent);
      label.className = "store-label";
      label.textContent = bar.label;
      amount.className = "store-amount";
      amount.textContent = bar.amountText;
      track.className = "store-track";
      fill.className = "store-fill";
      fill.style.width = `${bar.percent}%`;
      track.append(fill);
      detail.className = "store-detail";
      detail.textContent = bar.detail;
      row.append(label, amount, track, detail);
      shipStoresOut.append(row);
    }
    shipStarvingOut.hidden = !ship.starving;
  }

  function resetFireActionMode(): void {
    fireActionMode = "none";
    fireActionShipId = null;
    fireTargetId = null;
  }

  function fireTowCandidates(): OwnShipSnapshot[] {
    const tower = selectedFleetShip();
    if (!tower) return [];
    return fleetShips.filter((ship) =>
      ship.classId === "fireShip" &&
      ship.fireShipIgnited !== true &&
      !ship.towedBy &&
      Math.hypot(ship.x - tower.x, ship.y - tower.y) <= 0.3,
    );
  }

  function renderFireShipActions(): void {
    const row = selectedFleetShip();
    if (!row) {
      fireShipActionsOut.hidden = true;
      resetFireActionMode();
      return;
    }
    if (fireActionShipId && fireActionShipId !== row.id) resetFireActionMode();
    const candidates = fireTowCandidates();
    const actions = fireShipCardActions(row, candidates.length > 0);
    const towName = row.towingId
      ? fleetShips.find((ship) => ship.id === row.towingId)?.name ?? null
      : null;
    const status = fireShipStatusText(row, towName);
    fireShipActionsOut.hidden = actions.length === 0 && !status;
    fireShipStatusOut.textContent = status;
    fireShipStatusOut.hidden = status.length === 0;

    // Diff the existing buttons instead of replacing them on every snapshot.
    // An open card and any focused button survive the 5 Hz/10 Hz updates.
    const keep = new Set(actions.map((action) => action.id));
    for (const button of [...fireShipButtonsOut.querySelectorAll<HTMLButtonElement>("button")]) {
      if (!keep.has(button.dataset.fireAction as FireShipActionId)) button.remove();
    }
    for (const action of actions) {
      let button = fireShipButtonsOut.querySelector<HTMLButtonElement>(
        `button[data-fire-action="${action.id}"]`,
      );
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.fireAction = action.id;
        button.addEventListener("click", () => runFireShipAction(action.id));
      }
      button.className = `btn${action.confirm ? " btn-seal" : ""}`;
      button.disabled = action.disabled === true;
      button.title = action.reason ?? "";
      button.replaceChildren();
      button.append(action.label);
      if (action.reason) {
        const reason = document.createElement("span");
        reason.className = "fire-action-reason";
        reason.textContent = action.reason;
        button.append(reason);
      }
      fireShipButtonsOut.append(button);
    }

    if (fireActionMode === "none") {
      fireTargetBox.hidden = true;
      return;
    }
    fireTargetBox.hidden = false;
    fireTargetConfirm.hidden = fireActionMode !== "igniteConfirm";
    if (fireActionMode === "ignitePick") {
      fireTargetText.textContent = "Ignite on contact: tap an enemy ship on the map.";
    } else if (fireActionMode === "towPick") {
      fireTargetText.textContent = "Tow: tap one of your fire ships within 300 m.";
    } else {
      const target = fireTargetId ? ships.get(fireTargetId) : undefined;
      fireTargetText.textContent = target
        ? `Target: ${target.navy} ${target.classId}. The dotted line shows the attack.`
        : "Target lost. Cancel and choose another ship.";
    }
    fireTargetConfirm.disabled = fireActionMode === "igniteConfirm" &&
      (!fireTargetId || !ships.has(fireTargetId));
  }

  function runFireShipAction(action: FireShipActionId): void {
    const row = selectedFleetShip();
    if (!row) return;
    if (action === "lightsOn" || action === "lightsOff") {
      sendCommand({ t: "lights", ship: row.id, on: action === "lightsOn" });
      return;
    }
    if (action === "cancelContact") {
      sendCommand({ t: "cancelIgnite", ship: row.id });
      resetFireActionMode();
      renderFireShipActions();
      return;
    }
    if (action === "castOff") {
      sendCommand({ t: "castOff", ship: row.id });
      resetFireActionMode();
      renderFireShipActions();
      return;
    }
    if (action === "igniteNow") {
      if (!window.confirm(`Set ${row.name} alight? The crew will escape and the ship is consumed.`)) {
        return;
      }
      sendCommand({ t: "igniteFireShip", ship: row.id, mode: "now" });
      return;
    }
    fireActionShipId = row.id;
    fireTargetId = null;
    if (action === "igniteContact") {
      fireActionMode = "ignitePick";
    } else if (action === "tow") {
      fireActionMode = "towPick";
    }
    renderFireShipActions();
  }

  function handleFireTargetTap(screenX: number, screenY: number): boolean {
    if (fireActionMode === "none") return false;
    if (fireActionMode === "ignitePick") {
      const foreign = anyShipAt(screenX, screenY);
      if (foreign && !foreign.own) {
        fireTargetId = foreign.id;
        fireActionMode = "igniteConfirm";
        renderFireShipActions();
      } else {
        showNotice("Tap an enemy ship, or Cancel.");
      }
      return true;
    }
    if (fireActionMode === "towPick") {
      const ownShip = shipAt(screenX, screenY);
      if (!ownShip) {
        showNotice("Tap one of your fire ships within 300 m, or Cancel.");
        return true;
      }
      const row = fleetShips.find((ship) => ship.id === ownShip.id);
      if (!row || row.classId !== "fireShip") {
        showNotice("The tow must be one of your fire ships.");
        return true;
      }
      const tower = selectedFleetShip();
      if (!tower || Math.hypot(row.x - tower.x, row.y - tower.y) > 0.3) {
        showNotice("That fire ship is more than 300 m away.");
        return true;
      }
      sendCommand({ t: "towShip", ship: tower.id, target: row.id });
      resetFireActionMode();
      renderFireShipActions();
      return true;
    }
    return true;
  }

  function updateHud(own: ShipSnapshot | undefined): void {
    const row = selectedFleetShip();
    const viewRow = row ? buildFleetRow(row, portName(row.portId)) : null;
    moneyOut.textContent = formatMoney(money);
    fleetCountOut.textContent = String(fleetShips.length);
    fleetSummary.textContent = `${fleetCountText(fleetShips.length)} ships · ${formatMoney(money)} pieces`;
    shipNameOut.textContent = row?.name ?? "No ship selected";
    shipFlagshipTag.hidden = viewRow?.isFlagship !== true;
    shipTypeOut.textContent = viewRow?.typeName ?? "–";
    updateShipStores(row);
    shipCrewOut.textContent = viewRow?.crewText ?? "–";
    shipCrewOut.classList.toggle("needs-crew", viewRow?.needsCrew === true);
    shipStateOut.textContent = viewRow
      ? `${viewRow.stateText}${viewRow.needsCrew ? " · Needs crew" : ""}`
      : "–";
    shipStateOut.classList.toggle(
      "ship-state-needs-crew",
      viewRow?.needsCrew === true,
    );
    const shipReadout = row?.debugCombat;
    shipCombatReadout.textContent = shipReadout ?? "";
    shipCombatReadout.hidden = !shipReadout;

    if (own) {
      const heading = own[4];
      speedOut.textContent = formatKnots(own[5]);
      headingOut.textContent = `${Math.round(heading)}° ${compassPoint(heading)}`;
      compassNeedle.setAttribute("transform", `rotate(${heading} 36 36)`);
    } else {
      speedOut.textContent = "–";
      headingOut.textContent = "–";
    }
    shipStripSpeed.textContent = speedOut.textContent;
    shipStripHeading.textContent = headingOut.textContent;
    shipStripCrew.textContent = viewRow?.crewText ?? "–";
    shipStripProvisions.textContent = viewRow?.provisionsText ?? "–";
    const hullPoints = row?.damagePoints?.hull ?? 0;
    const hullCapacity = row?.damageCapacities?.hull ?? 0;
    const hullPercent = hullCapacity > 0
      ? Math.max(0, Math.min(100, Math.round((hullPoints / hullCapacity) * 100)))
      : 100;
    shipChipHullFill.style.width = `${hullPercent}%`;
    shipUndock.hidden = row?.status !== "docked";
    shipDamage.disabled = !row || row.status === "delivery";
    const lightsOn = row?.lightsOn !== false;
    shipStripStance.textContent = row?.stance ? stanceLabel(row.stance) : "Stance –";
    shipStripLights.textContent = `Lights ${lightsOn ? "On" : "Off"}`;
    shipLightsOut.dataset.on = String(lightsOn);
    shipLightsText.textContent = `Lights: ${lightsOn ? "On" : "Off"}`;
    shipLightsOut.hidden = !row;
    const anchored = row?.anchored === true;
    shipAnchorActions.hidden = !row || row.status === "delivery";
    shipDropAnchor.hidden = anchored;
    shipDropAnchor.disabled = !row || row.status !== "sailing";
    shipWeighAnchor.hidden = !anchored;
    shipWeighAnchor.disabled = !row || row.weighingAnchor === true;
    shipWeighAnchor.textContent = row?.weighingAnchor ? "Weighing anchor…" : "Weigh anchor";
    renderFireShipActions();
    updateJourneyUi(row);
    renderShipUpgrades();
    updateFleetUpgradeAll();
    if (!researchPanel.hidden) renderResearchPanel();
    const researchUnits = latestResearch?.units ?? 0;
    if (researchUnitsSeen >= 0 && researchUnits > researchUnitsSeen) {
      const now = performance.now();
      if (now - lastResearchNoticeAt >= 60_000) {
        lastResearchNoticeAt = now;
        showNotice("Research available");
      }
    }
    researchUnitsSeen = researchUnits;
    refreshAttackNearest();
  }

  function updateJourneyUi(row: ReturnType<typeof selectedFleetShip>): void {
    const journey = row?.journey;
    const text = journey
      ? `Journey: ${Math.round(journey.distanceKm)} km, ${Math.max(0, (clockShownMs - journey.startedGameMs) / (settings.time.hoursPerDay * 60 * 60 * 1000)).toFixed(1)} game days`
      : "";
    for (const line of [shipJourney, damageJourney]) {
      line.textContent = text;
      line.hidden = !journey;
    }
    for (const button of [shipEndJourney, damageEndJourney]) button.hidden = !journey;
  }



  // ---- 3E-c: resign, eliminated and victory screens ----------------------

  function renderStatusStats(container: HTMLElement, rows: ReturnType<typeof statsRows>): void {
    container.replaceChildren();
    for (const row of rows) {
      const label = document.createElement("span");
      label.className = "status-stat-label";
      label.textContent = row.label;
      const value = document.createElement("span");
      value.className = "status-stat-value";
      value.textContent = row.value;
      container.append(label, value);
    }
  }

  function closeResignSheet(): void {
    resignSheet.hidden = true;
    resignSelection = null;
    resignConfirm.disabled = true;
  }

  function renderResignRecipients(): void {
    const teammate = latestRoster.find(
      (player) => player.navy === playerNavy && player.id !== ownId,
    );
    const { choices, nobodyLabel } = resignRecipients(
      latestRoster,
      ownId,
      teammate?.id ?? null,
    );
    resignRecipientsOut.replaceChildren();
    const addChoice = (id: string, label: string, detail: string): void => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn resign-choice";
      button.dataset.resignRecipient = id;
      button.setAttribute("aria-pressed", String(resignSelection === id));
      const strong = document.createElement("strong");
      strong.textContent = label;
      const small = document.createElement("small");
      small.textContent = detail;
      button.append(strong, small);
      button.addEventListener("click", () => {
        resignSelection = id;
        resignConfirm.disabled = false;
        for (const other of resignRecipientsOut.querySelectorAll<HTMLButtonElement>("[data-resign-recipient]")) {
          other.setAttribute("aria-pressed", String(other.dataset.resignRecipient === id));
        }
      });
      resignRecipientsOut.append(button);
    };
    for (const choice of choices) {
      addChoice(
        choice.id,
        `${choice.name}${choice.isTeammate ? " (teammate)" : ""}`,
        choice.navy,
      );
    }
    addChoice("nobody", nobodyLabel, "Your ships become abandoned.");
  }

  function openResignSheet(): void {
    if (latestOut || latestGo || !fleetShips.some((ship) => ship.isFlagship)) return;
    closeMenuPanel();
    closeResignSheet();
    renderResignRecipients();
    resignSheet.hidden = false;
  }

  function sendResign(): void {
    if (resignSelection === null) return;
    const to = resignSelection === "nobody" ? null : resignSelection;
    if (sendCommand({ t: "resign", to })) {
      closeResignSheet();
      showNotice("Resignation sent. The decision is final.");
    }
  }

  function renderEliminatedScreen(): void {
    const out = latestOut;
    if (!out) return;
    eliminatedTitleOut.textContent = eliminatedTitle(out.flagshipName, out.reason);
    eliminatedReasonOut.textContent =
      "Orders are blocked. Your remaining ships and money have already been handed over or abandoned.";
    const by = out.byNames.map((name, index) => {
      const navy = out.byNavies[index];
      return navy ? `${name} (${navy})` : name;
    });
    eliminatedByOut.textContent = eliminatedByText(by);
    eliminatedAssetsOut.textContent = eliminatedAssetsText(
      out.heirNames,
      out.shipsGiven,
      out.moneyGiven,
    );
    renderStatusStats(eliminatedStatsOut, statsRows(out.stats));
    eliminatedScreen.hidden = false;
  }

  function renderVictoryScreen(): void {
    const go = latestGo;
    if (!go) return;
    const rows = victoryRows(go.players);
    victoryTitleOut.textContent = `Victory — ${go.navy}`;
    const winners = rows.filter((row) => row.winner);
    victoryWinnersOut.textContent =
      `The ${go.navy} navy is the last navy standing. ` +
      (winners.length > 0
        ? `Winners: ${winners.map((row) => `${row.name} (${row.navy})`).join(", ")}.`
        : "No captain survived.");
    victoryPlayersOut.replaceChildren();
    for (const row of rows) {
      const line = document.createElement("div");
      line.className = "victory-player";
      const name = document.createElement("b");
      name.textContent = `${row.winner ? "★ " : ""}${row.name}`;
      const navy = document.createElement("span");
      navy.textContent = row.navy;
      const flagship = document.createElement("span");
      flagship.textContent = `⚑ ${row.flagshipName}`;
      const left = document.createElement("span");
      left.textContent = row.left === "won" ? "Won" : `Left: ${row.left}`;
      line.append(name, navy, flagship, left);
      victoryPlayersOut.append(line);
    }

    const table = document.createElement("table");
    table.className = "victory-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["Captain", "Navy", "Flagship", "Left", ...rows[0]!.stats.map((stat) => stat.label)]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      headRow.append(th);
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      const cells = [
        row.name,
        row.navy,
        row.flagshipName,
        row.left === "won" ? "Won" : row.left,
        ...row.stats.map((stat) => stat.value),
      ];
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(head, body);
    victoryStatsOut.replaceChildren(table);
    victoryStatsOut.setAttribute("tabindex", "0");
    victoryReset.hidden = latestRoomKind === "normal";
    victoryScreen.hidden = false;
  }

  function renderEndScreens(): void {
    const canResign = !latestOut && !latestGo && fleetShips.some((ship) => ship.isFlagship);
    resignButton.hidden = !canResign;
    if (latestGo) {
      if (lastGoAt !== latestGo.atGameMs) {
        lastGoAt = latestGo.atGameMs;
        victoryClosed = false;
        eliminatedClosed = true;
      }
      closeResignSheet();
      if (!victoryClosed) renderVictoryScreen();
      else victoryScreen.hidden = true;
      eliminatedScreen.hidden = true;
      return;
    }
    victoryScreen.hidden = true;
    if (latestOut) {
      const key = JSON.stringify(latestOut);
      if (key !== lastOutKey) {
        lastOutKey = key;
        eliminatedClosed = false;
      }
      closeResignSheet();
      if (!eliminatedClosed) renderEliminatedScreen();
      else eliminatedScreen.hidden = true;
      return;
    }
    eliminatedScreen.hidden = true;
  }

  function closeDamagePanel(): void {
    damagePanel.hidden = true;
    damageShipId = null;
  }

  // ---- 3C-c: battle orders, surrender offers and white flags -------------

  function battleFleetScope(): boolean {
    return multiSelect && selectedFleetIds().length > 0;
  }

  function sendFleetBattle(order: "capture" | "sink" | "run"): void {
    const fleets = selectedFleetIds();
    if (fleets.length === 0) {
      showNotice("No fleet selected.");
      return;
    }
    for (const fleetId of fleets) {
      sendCommand({ t: "fleetBattleOrder", fleet: fleetId, order });
    }
  }

  function sendShipBattle(shipId: string, order: "capture" | "sink" | "run" | "surrender"): void {
    sendCommand({ t: "battleOrder", ship: shipId, order });
  }

  // ---- 3D: Board, crew transfer, claims and captured crew ----------------

  function closeBoardSheet(): void {
    boardSheetPanel.hidden = true;
    boardTargetId = null;
  }

  function openBoardSheet(targetId: string): void {
    const target = ships.get(targetId);
    if (!target || !selectedShipId) return;
    boardTargetId = targetId;
    const plan = boardSheet({
      targetName: target.id === targetId ? `${target.navy} ${target.classId}` : target.classId,
      targetClass: `${target.navy} ${target.classId}`,
      chance: null,
    });
    boardTitle.textContent = plan.title;
    boardDetail.textContent = plan.detail;
    boardOdds.textContent = "Odds: checking…";
    boardConfirm.disabled = true;
    boardSheetPanel.hidden = false;
    sendCommand({ t: "board", ship: selectedShipId, target: targetId });
  }

  function closeCrewSheet(): void {
    crewSheetPanel.hidden = true;
    crewClaimPrizeId = null;
  }

  function ownCrewOption(ship: OwnShipSnapshot): HTMLOptionElement {
    const option = document.createElement("option");
    option.value = ship.id;
    option.textContent = `${ship.name} (${Math.floor(ship.crew)}/${ship.fullCrew})`;
    return option;
  }

  function openCrewSheet(receiverId: string | null, claim = false): void {
    const available = fleetShips.filter((ship) => ship.status !== "delivery");
    if (available.length === 0) return;
    crewClaimPrizeId = claim ? receiverId : null;
    crewDonor.replaceChildren(...available.map(ownCrewOption));
    crewReceiver.replaceChildren(...available.map(ownCrewOption));
    const fallback = available.find((ship) => ship.id !== selectedShipId) ?? available[0]!;
    crewDonor.value = (available.find((ship) => ship.id === selectedShipId) ?? fallback).id;
    if (!claim) {
      crewReceiver.value = (available.find((ship) => ship.id === receiverId && ship.id !== crewDonor.value) ?? fallback).id;
      crewReceiver.hidden = false;
    } else {
      crewReceiver.hidden = true;
    }
    crewTitle.textContent = claim ? "Claim abandoned ship" : "Transfer crew";
    crewSheetPanel.hidden = false;
    refreshCrewSheet();
  }

  function refreshCrewSheet(): void {
    const donor = shipById(crewDonor.value);
    const receiver = crewClaimPrizeId ? null : shipById(crewReceiver.value);
    if (!donor || (!receiver && !crewClaimPrizeId)) return;
    const prize = crewClaimPrizeId ? ships.get(crewClaimPrizeId) : null;
    const receiverFullCrew = receiver?.fullCrew ??
      shipTypeFor(parseNavy(prize?.navy ?? "British") ?? "British", (prize?.classId ?? "frigate") as OwnShipSnapshot["classId"]).crew;
    const receiverCrew = receiver?.crew ?? 0;
    const key = crewTransferSheet({
      donorName: donor.name,
      receiverName: receiver?.name ?? "this hull",
      donorCrew: donor.crew,
      receiverCrew,
      receiverFullCrew,
      claim: crewClaimPrizeId !== null,
    });
    crewHint.textContent = key.hint;
    const max = Math.max(1, Math.min(
      Math.floor(donor.crew - Math.max(1, Math.ceil(donor.crew * 0.1))),
      Math.floor(receiverFullCrew - receiverCrew),
    ));
    crewAmount.max = String(max);
    if (Number(crewAmount.value) < 1) crewAmount.value = String(Math.min(max, key.quick[0]?.amount || 1));
    crewAmount.value = String(Math.min(max, Math.max(1, Number(crewAmount.value))));
    crewQuick.replaceChildren();
    for (const quick of key.quick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = `${quick.label}: ${quick.amount}`;
      button.disabled = quick.amount < 1;
      button.addEventListener("click", () => {
        crewAmount.value = String(Math.max(1, quick.amount));
        refreshCrewPreview();
      });
      crewQuick.append(button);
    }
    refreshCrewPreview();
  }

  function refreshCrewPreview(): void {
    const donor = shipById(crewDonor.value);
    const amount = Math.max(0, Math.floor(Number(crewAmount.value)));
    crewPreview.textContent = donor
      ? `${amount} crew · donor keeps ${Math.max(0, Math.floor(donor.crew - amount))}`
      : "Choose a donor.";
  }

  function closeCapturedSheet(): void {
    capturedSheetPanel.hidden = true;
    capturedShipId = null;
  }

  function openCapturedSheet(shipId: string): void {
    const row = shipById(shipId);
    if (!row || !(row.capturedCrew && row.capturedCrew > 0)) return;
    capturedShipId = row.id;
    const plan = capturedCrewSheet({
      captured: row.capturedCrew,
      fullCrew: row.fullCrew,
      secondsLeft: row.capturedChoiceSeconds,
    });
    capturedTitle.textContent = plan.title;
    capturedDetail.textContent = `${plan.captured} captured crew aboard ${row.name}.`;
    capturedRule.textContent = `${plan.overflowRule} ${plan.defaultText}`;
    capturedJoin.textContent = plan.joinLabel;
    capturedKill.textContent = plan.killLabel;
    capturedPrisoners.textContent = plan.prisonerLabel;
    capturedSheetPanel.hidden = false;
  }

  // ---- 3H-d: loot, privateer and escort screens --------------------------

  function closeLootSheet(): void {
    lootSheetPanel.hidden = true;
    lootTargetId = null;
  }

  function openLootSheet(targetId: string): void {
    const contact = npcContacts.get(targetId);
    if (!contact) return;
    const target = ships.get(targetId);
    const looter = selectedFleetShip();
    const alongside = !!(target && looter &&
      Math.hypot(target.x - looter.x, target.y - looter.y) <=
        settings.combat.transferRangeM / 1000);
    const freeTonnes = looter
      ? Math.max(0, looter.capacities.cargo - looter.cargoUsed)
      : 0;
    const plan = npcLootSheet({
      name: contact.name,
      kind: contact.kind,
      eligible: Array.isArray(contact.lootCargo),
      lootCargo: contact.lootCargo ?? null,
      looted: contact.looted === true,
      freeTonnes,
      alongside,
    });
    lootTargetId = targetId;
    lootTitle.textContent = plan.title;
    lootDetail.textContent = plan.detail;
    lootCargo.replaceChildren();
    for (const row of plan.cargoRows) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const tonnes = document.createElement("span");
      name.textContent = row.name;
      tonnes.textContent = `${row.tonnes.toFixed(1)} t`;
      item.append(name, tonnes);
      lootCargo.append(item);
    }
    lootFree.textContent = plan.freeText;
    lootNotice.textContent = plan.reason ?? "";
    lootNotice.hidden = plan.reason === null;
    lootConfirm.textContent = plan.actionLabel;
    lootConfirm.disabled = !plan.canLoot;
    privateerSheetPanel.hidden = true;
    escortSheetPanel.hidden = true;
    lootSheetPanel.hidden = false;
  }

  function closePrivateerSheet(): void {
    privateerSheetPanel.hidden = true;
    privateerSheetId = null;
  }

  function privateerInfo(id: string): {
    name: string;
    hiredByMe: boolean;
    hiredByOther: boolean;
    visible: boolean;
    mode: NpcModeId;
    fee: number;
    remainingGameSeconds: number;
    escortTargetId: string | null;
  } | null {
    const contact = npcContacts.get(id);
    const escort = npcEscorts.find((row) => row.id === id);
    if (!contact && !escort) return null;
    const hiredByMe = contact?.hiredBy === identity.id || !!escort;
    return {
      name: contact?.name ?? escort?.name ?? "Privateer",
      hiredByMe,
      hiredByOther: contact?.hiredBy !== null && contact?.hiredBy !== undefined && !hiredByMe,
      visible: !!contact,
      mode: (contact?.mode ?? escort?.mode ?? "patrol") as NpcModeId,
      fee: contact?.fee ?? settings.npcs.privateerFee,
      remainingGameSeconds: contact?.contractRemainingGameSeconds ??
        escort?.contractRemainingGameSeconds ?? 0,
      escortTargetId: escort?.targetId ?? null,
    };
  }

  function openPrivateerSheet(id: string): void {
    const info = privateerInfo(id);
    if (!info) return;
    const plan = privateerSheet({
      name: info.name,
      hiredByMe: info.hiredByMe,
      hiredByOther: info.hiredByOther,
      visible: info.visible,
      mode: info.mode,
      fee: info.fee,
      remainingGameSeconds: info.remainingGameSeconds,
      money,
    });
    privateerSheetId = id;
    privateerTitle.textContent = plan.title;
    privateerDetail.textContent = plan.detail;
    privateerContract.textContent = `${plan.contractText} · ${plan.feeText}`;
    privateerNotice.textContent = plan.reason ?? "";
    privateerNotice.hidden = plan.reason === null;
    privateerMode.replaceChildren();
    for (const mode of plan.modes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn${mode.active ? " is-active" : ""}`;
      button.textContent = mode.label;
      button.disabled = mode.disabled;
      button.setAttribute("aria-pressed", String(mode.active));
      button.addEventListener("click", () => {
        if (mode.id === "escort") {
          openEscortSheet(id);
          return;
        }
        sendCommand({ t: "privateerMode", ship: id, mode: mode.id });
        closePrivateerSheet();
      });
      privateerMode.append(button);
    }
    privateerActions.replaceChildren();
    if (!info.hiredByMe) {
      const hire = document.createElement("button");
      hire.type = "button";
      hire.className = "btn btn-seal";
      hire.textContent = plan.hireLabel;
      hire.disabled = !plan.canHire;
      hire.addEventListener("click", () => {
        sendCommand({ t: "hirePrivateer", ship: id, mode: "raid" });
        closePrivateerSheet();
      });
      const escort = document.createElement("button");
      escort.type = "button";
      escort.className = "btn";
      escort.textContent = plan.escortLabel;
      escort.disabled = !plan.canHire;
      escort.addEventListener("click", () => openEscortSheet(id));
      privateerActions.append(hire, escort);
    } else {
      const escort = document.createElement("button");
      escort.type = "button";
      escort.className = "btn";
      escort.textContent = "Escort a ship…";
      escort.addEventListener("click", () => openEscortSheet(id));
      privateerActions.append(escort);
    }
    lootSheetPanel.hidden = true;
    escortSheetPanel.hidden = true;
    privateerSheetPanel.hidden = false;
  }

  function closeEscortSheet(): void {
    escortSheetPanel.hidden = true;
    escortPrivateerId = null;
  }

  function openEscortSheet(privateerId: string): void {
    const info = privateerInfo(privateerId);
    if (!info) return;
    const targets = fleetShips
      .filter((ship) => ship.status !== "delivery")
      .map((ship) => ({ id: ship.id, name: ship.name, classId: ship.classId }));
    const plan = escortSheet({
      privateerName: info.name,
      hiredByMe: info.hiredByMe,
      fee: settings.npcs.escortFee,
      money,
      targets,
      selectedTargetId: info.escortTargetId ?? selectedShipId,
    });
    escortPrivateerId = privateerId;
    escortTitle.textContent = plan.title;
    escortDetail.textContent = plan.hint;
    escortFee.textContent = plan.feeText;
    escortNotice.textContent = plan.reason ?? "";
    escortNotice.hidden = plan.reason === null;
    escortTarget.replaceChildren();
    for (const row of plan.targets) {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = `${row.name} · ${row.classId}`;
      option.selected = row.selected;
      escortTarget.append(option);
    }
    escortTarget.disabled = plan.targets.length === 0;
    escortTarget.value = plan.selectedTargetId ?? "";
    escortConfirm.textContent = plan.confirmLabel;
    escortConfirm.disabled = !plan.canConfirm;
    privateerSheetPanel.hidden = true;
    lootSheetPanel.hidden = true;
    escortSheetPanel.hidden = false;
  }

  function refreshEscortStrip(): void {
    const plan = escortStrip(npcEscorts.map((escort) => ({
      id: escort.id,
      name: escort.name,
      mode: escort.mode,
      targetName: escort.targetName,
      contractRemainingGameSeconds: escort.contractRemainingGameSeconds,
    })));
    escortStripText.textContent = plan.text;
    escortStripPanel.hidden = !plan.shown;
    escortStripOpen.hidden = !plan.shown;
  }

  function openSurrenderConfirm(shipId: string): void {
    const row = shipById(shipId);
    if (!row || row.surrendered) return;
    surrenderConfirmShipId = row.id;
    surrenderConfirmText.textContent = row.isFlagship
      ? `${row.name} is your flagship. Surrendering her eliminates you from the game. Are you sure?`
      : `${row.name} will stop and fly the white flag. You can take it down until an enemy accepts.`;
    surrenderConfirm.hidden = false;
  }

  /** The same four order buttons in the damage sheet and fleet ship cards. */
  function appendBattleButtons(
    container: HTMLElement,
    row: OwnShipSnapshot,
  ): void {
    const items = battleBarItems({
      fleet: false,
      surrendered: row.surrendered === true,
      battleOrder: row.battleOrder,
      running: row.running === true,
    });
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn${item.active ? " is-active" : ""}`;
      button.textContent = item.label;
      button.addEventListener("click", () => {
        if (item.id === "surrender") {
          openSurrenderConfirm(row.id);
        } else if (item.id === "cancelSurrender") {
          sendCommand({ t: "cancelSurrender", ship: row.id });
        } else {
          sendShipBattle(row.id, item.id);
        }
      });
      container.append(button);
    }
    const auto = document.createElement("label");
    auto.className = "repair-toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = row.autoBoard !== false;
    box.addEventListener("change", () => {
      sendCommand({ t: "autoBoard", ship: row.id, enabled: box.checked });
    });
    auto.append(box, document.createTextNode(" Auto-board"));
    container.append(auto);
  }

  function hideBattleBar(): void {
    battleBar.hidden = true;
    document.body.classList.remove("has-battle-bar");
    battleBarKey = "";
  }

  function renderBattleBar(): void {
    if (selectedEnemyId && !ships.has(selectedEnemyId)) {
      selectedEnemyId = null;
      if (activeDockPanel === "target") activeDockPanel = "ship";
    }
    const enemy = selectedEnemyId ? ships.get(selectedEnemyId) : null;
    if (enemy) {
      const contact = npcContacts.get(enemy.id);
      const hiredByMe = contact?.hiredBy === identity.id;
      const hiredByOther = contact?.hiredBy !== null && contact?.hiredBy !== undefined && !hiredByMe;
      const key = [
        "enemy", enemy.id, enemy.navy, enemy.classId, enemy.npcKind ?? "",
        enemy.abandoned ? "abandoned" : "", enemy.surrendered ? "surrendered" : "",
        contact?.hiredBy ?? "", contact?.mode ?? "", contact?.looted ? "looted" : "",
        selectedFleetShip()?.classId ?? "",
      ].join("|");
      if (key === battleBarKey) return;
      battleBarKey = key;
      const title = enemy.npcKind
        ? `${npcKindLabel(enemy.npcKind)} ${enemy.classId}${contact?.name ? ` · ${contact.name}` : ""}`
        : `${enemy.navy} ${enemy.classId}`;
      battleBarTitle.textContent = title;
      battleBarActions.replaceChildren();
      const npcAction = (action: string): (() => void) => {
        if (action === "manageContract" || action === "hirePrivateer") {
          return () => openPrivateerSheet(enemy.id);
        }
        if (action === "loot") return () => openLootSheet(enemy.id);
        if (action === "claim") return () => openCrewSheet(enemy.id, true);
        return () => openBoardSheet(enemy.id);
      };
      for (const item of npcBattleActions({
        kind: enemy.npcKind,
        hiredByMe,
        hiredByOther,
        abandoned: enemy.abandoned,
        surrendered: enemy.surrendered,
      })) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn${item.seal ? " btn-seal" : ""}`;
        button.textContent = item.label;
        button.addEventListener("click", npcAction(item.id));
        battleBarActions.append(button);
      }
      if (!enemy.npcKind && !hiredByMe) {
        for (const [label, objective] of [["Attack: Sink", "sink"], ["Attack: Capture", "capture"]] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = objective === "sink" ? "btn btn-seal" : "btn";
          button.textContent = label;
          button.addEventListener("click", () => {
            sendSelectedSpecial({ type: "engage", shipId: enemy.id, objective });
          });
          battleBarActions.append(button);
        }
        const board = document.createElement("button");
        board.type = "button";
        board.className = "btn";
        board.textContent = "Board";
        board.addEventListener("click", () => openBoardSheet(enemy.id));
        battleBarActions.append(board);
      }
      if (enemy.abandoned || enemy.surrendered) {
        const loot = document.createElement("button");
        loot.type = "button";
        loot.className = "btn btn-seal";
        loot.textContent = "Loot";
        loot.addEventListener("click", () => openLootSheet(enemy.id));
        battleBarActions.append(loot);
      }
      if (selectedFleetShip()?.classId === "fireShip") {
        const ignite = document.createElement("button");
        ignite.type = "button";
        ignite.className = "btn";
        ignite.textContent = "Ignite on contact";
        ignite.addEventListener("click", () => {
          const fire = selectedFleetShip();
          if (!fire) return;
          fireActionShipId = fire.id;
          fireTargetId = enemy.id;
          fireActionMode = "igniteConfirm";
          renderFireShipActions();
        });
        battleBarActions.append(ignite);
      }
      battleBar.hidden = false;
      document.body.classList.add("has-battle-bar");
      return;
    }

    const row = selectedFleetShip();
    if (!row) {
      hideBattleBar();
      return;
    }
    const fleet = battleFleetScope();
    const fleetIds = fleet ? selectedFleetIds() : [];
    const fleetMemberIds = new Set<string>();
    for (const fleetId of fleetIds) {
      for (const member of fleetById(fleetId)?.members ?? []) fleetMemberIds.add(member.id);
    }
    const fleetInCombat = fleet
      ? fleetShips.some((ship) => fleetMemberIds.has(ship.id) && ship.inCombat === true)
      : false;
    const visible = battleBarVisible({
      hasOwnShip: true,
      inCombat: row.inCombat === true,
      fleetInCombat,
      enemySelected: false,
      surrendered: row.surrendered === true,
      running: row.running === true,
    });
    if (!visible) {
      hideBattleBar();
      return;
    }
    const items = battleBarItems({
      fleet,
      surrendered: row.surrendered === true,
      battleOrder: row.battleOrder,
      running: row.running === true,
    });
    const title = fleet
      ? (fleetIds.length === 1 ? fleetById(fleetIds[0]!)?.name ?? "Fleet" : "Fleets")
      : row.surrendered
        ? `${row.name} · white flag`
        : row.running
          ? `${row.name} · running`
          : row.name;
    const key = [title, ...items.map((item) => `${item.id}:${item.active}`)].join("|");
    if (key === battleBarKey) return;
    battleBarKey = key;
    battleBarTitle.textContent = title;
    battleBarActions.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn${item.active ? " is-active" : ""}`;
      button.textContent = item.label;
      button.setAttribute("aria-pressed", String(item.active));
      button.addEventListener("click", () => {
        if (item.id === "surrender") {
          openSurrenderConfirm(row.id);
        } else if (item.id === "cancelSurrender") {
          sendCommand({ t: "cancelSurrender", ship: row.id });
        } else if (fleet) {
          sendFleetBattle(item.id);
        } else {
          sendShipBattle(row.id, item.id);
        }
      });
      battleBarActions.append(button);
    }
    battleBar.hidden = false;
    document.body.classList.add("has-battle-bar");
  }

  function hideSurrenderOffer(): void {
    surrenderSheet.hidden = true;
    surrenderOfferShipId = null;
    surrenderOfferKey = "";
  }

  function renderSurrenderOffer(): void {
    for (const id of [...surrenderDismissed]) {
      if (!surrenderFlags.has(id)) surrenderDismissed.delete(id);
    }
    let target: ShipView | null = null;
    for (const id of surrenderFlags) {
      if (surrenderDismissed.has(id)) continue;
      const view = ships.get(id);
      if (view && whiteFlagVisible(true, view.surrendered)) {
        target = view;
        break;
      }
    }
    if (!target) {
      hideSurrenderOffer();
      return;
    }
    const own = fleetShips.filter((ship) => ship.status !== "delivery");
    let nearestKm = Number.POSITIVE_INFINITY;
    let nearestShip: OwnShipSnapshot | null = null;
    for (const ship of own) {
      const distance = Math.hypot(ship.x - target.x, ship.y - target.y);
      if (distance < nearestKm) {
        nearestKm = distance;
        nearestShip = ship;
      }
    }
    const fleetCount = own.length;
    const typeName = shipTypeFor(
      target.navy as NavyId,
      target.classId as BuyableShipClassId,
    ).name;
    const offer = surrenderOffer({
      visible: true,
      name: typeName,
      navy: target.navy,
      classId: target.classId,
      fleetCount,
      maxShips: settings.ships.maxShipsPerPlayer,
      nearestShipKm: nearestKm,
      acceptRangeM: settings.combat.surrenderAcceptRangeM,
    });
    if (!offer) {
      hideSurrenderOffer();
      return;
    }
    const key = [target.id, offer.title, offer.acceptEnabled, offer.reason].join("|");
    surrenderOfferShipId = target.id;
    if (key === surrenderOfferKey && !surrenderSheet.hidden) return;
    surrenderOfferKey = key;
    surrenderOfferTitle.textContent = offer.title;
    surrenderOfferDetail.textContent = offer.detail;
    surrenderOfferFleet.textContent = offer.fleetText;
    surrenderOfferReason.textContent = offer.reason ?? "";
    surrenderOfferReason.hidden = offer.reason === null;
    surrenderAccept.disabled = !offer.acceptEnabled;
    surrenderAccept.title = offer.reason ?? "Take this ship into your fleet";
    surrenderSail.hidden = !offer.sailThere;
    surrenderOfferShipId = target.id;
    surrenderSail.onclick = () => {
      if (!nearestShip) return;
      sendCommand({
        t: "o",
        x: Number(target!.x.toFixed(2)),
        y: Number(target!.y.toFixed(2)),
        ship: nearestShip.id,
      });
      showNotice(`${nearestShip.name} sails towards the white flag.`);
    };
    surrenderSheet.hidden = false;
  }

  function closeSurrenderConfirm(): void {
    surrenderConfirm.hidden = true;
    surrenderConfirmShipId = null;
  }

  function openDamagePanel(shipId: string | null = null): void {
    const row = shipId ? shipById(shipId) : selectedFleetShip();
    if (!row) return;
    damageShipId = row.id;
    closeFleetPanel();
    damagePanel.hidden = false;
    renderDamagePanel();
  }

  function renderDamagePanel(): void {
    if (damagePanel.hidden) return;
    const row = damageShipId ? shipById(damageShipId) : selectedFleetShip();
    if (!row) {
      closeDamagePanel();
      return;
    }
    damageTitle.textContent = `${row.name} · ${shipTypeFor(row.navy, row.classId).name}`;
    const damage = row.damage;
    const labels = [
      ["hull", "Hull"],
      ["sails", "Sails"],
      ["masts", "Masts"],
      ["rudder", "Rudder"],
      ["guns", "Guns"],
      ["crew", "Crew"],
    ] as const;
    damageBars.replaceChildren();
    const hurt: string[] = [];
    for (const [key, label] of labels) {
      const pct = damage ? damage[key] : 100;
      const bar = document.createElement("div");
      const name = document.createElement("span");
      const track = document.createElement("span");
      const fill = document.createElement("span");
      const value = document.createElement("span");
      bar.className = "damage-bar";
      name.className = "damage-bar-label";
      name.textContent = label;
      track.className = "damage-bar-track";
      fill.className = `damage-bar-fill${pct >= 98 ? " is-ok" : ""}`;
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      value.className = "damage-bar-value";
      value.textContent = `${Math.round(pct)}%`;
      track.append(fill);
      bar.append(name, track, value);
      damageBars.append(bar);
      if (pct < 99) hurt.push(`${label} at ${Math.round(pct)}%`);
    }
    damageSummary.textContent = row.crewTooLow
      ? "Crew too low — the ship cannot sail or fight."
      : `${row.status === "docked" ? "In port" : "At sea"} · ${hurt.length === 0 ? "No damage" : `${hurt.length} areas damaged`}`;
    damageAmmo.textContent = `${(row.ammunitionBroadsides ?? 0).toFixed(1)} broadsides`;
    damageReload.textContent = row.reloadProgress === undefined
      ? "–"
      : `${Math.round(row.reloadProgress * 100)}% · ${(row.reloadLeftSeconds ?? 0).toFixed(1)}s`;
    const repairState = row.inCombat
      ? "In combat — repairs blocked"
      : row.canRepair
        ? "Can repair"
        : "Repairs blocked";
    damageState.textContent = `${row.stateLabel ?? "Sailing"} · ${repairState}`;
    const damageReadout = row.debugCombat;
    damageCombatReadout.textContent = damageReadout ?? "";
    damageCombatReadout.hidden = !damageReadout;
    damageSpeed.textContent = row.effectiveSpeedKnots === undefined
      ? "–"
      : `${row.effectiveSpeedKnots.toFixed(1)} / ${(row.normalSpeedKnots ?? 0).toFixed(1)} kn`;
    damageTurn.textContent = row.effectiveTurnDegPerSecond === undefined
      ? "–"
      : `${row.effectiveTurnDegPerSecond.toFixed(1)} / ${(row.normalTurnDegPerSecond ?? 0).toFixed(1)}°/s`;
    damageHurts.textContent = hurt.length > 0 ? hurt.join(" · ") : "All six areas sound.";
    const fire = fireRow(row.burning === true, row.fireStrength ?? 0);
    damageFire.hidden = !fire.shown;
    if (fire.shown) {
      damageFireBar.textContent = `${Math.round(fire.strength)}%`;
      damageFireStatus.textContent = fire.status;
    }
    const boarding = boardingProgress(row.boardingProgress, row.boardingSecondsLeft);
    damageBoarding.hidden = !boarding.shown;
    if (boarding.shown) {
      damageBoardingLabel.textContent = boarding.label;
      damageBoardingFill.style.width = `${Math.round(boarding.progress * 100)}%`;
    }
    const captured = row.capturedCrew ?? 0;
    damageCapturedRow.hidden = captured <= 0;
    damageCaptured.textContent = `Captured crew (${captured})`;
    damageAutoBoard.checked = row.autoBoard !== false;
    damageClaim.hidden = true;
    damageBattle.replaceChildren();
    if (row.status !== "delivery") appendBattleButtons(damageBattle, row);
    damageRepairToggle.checked = row.repairEnabled !== false;
    damageRepairToggle.disabled = row.status === "delivery";
    const quote = row.portRepair;
    portRepairBox.hidden = !quote;
    if (quote) {
      portRepairQuote.textContent = quote.active
        ? `Repair in progress at x${quote.rateMultiplier}. ${quote.materials.toFixed(1)} t quoted.`
        : `Stores ${quote.materials.toFixed(1)} t (x4) · pay locals ${formatMoney(quote.money)} pieces (x2, x6).`;
      repairStores.disabled = quote.active;
      repairPay.disabled = quote.active;
    }
  }

  function renderBattleLog(lines: string[] | undefined): void {
    const clean: string[] = [];
    for (const line of lines ?? []) {
      if (typeof line !== "string" || line.length > 120) continue;
      if (!/your/i.test(line)) continue;
      clean.push(line);
    }
    const key = clean.join("\n");
    if (key === battleLogKey) return;
    battleLogKey = key;
    battleLog.hidden = clean.length === 0;
    battleLogCount.textContent = String(clean.length);
    battleLogButtonCount.textContent = String(clean.length);
    battleLogList.replaceChildren();
    for (const line of clean) {
      const item = document.createElement("li");
      item.textContent = line;
      battleLogList.append(item);
    }
    battleLogList.scrollTop = battleLogList.scrollHeight;
  }

  function updateClockAndNight(now: number): void {
    if (!clockStarted) return;

    const predicted =
      clockTargetMs + (now - clockTargetAt) * settings.time.sailingTimeScale;
    const frameSeconds = clockFrameAt === 0
      ? 0
      : Math.min(0.1, (now - clockFrameAt) / 1000);
    clockFrameAt = now;

    const error = predicted - clockShownMs;
    if (Math.abs(error) > 30_000) {
      clockShownMs = predicted;
    } else {
      clockShownMs += error * Math.min(1, frameSeconds * 4);
    }

    const clock = gameClockAt(clockShownMs);
    const text = formatGameClock(clock);
    if (text !== lastClockText) {
      clockOut.textContent = text;
      clockPanel.dataset.night = String(!clock.isDay);
      const moon = moonPhase(clockShownMs);
      const moonValue = serverMoonPhase ?? moon.phase;
      const phaseName = moonValue < 0.0625 || moonValue >= 0.9375 ? "new"
        : moonValue < 0.1875 ? "crescent"
          : moonValue < 0.3125 ? "quarter"
            : moonValue < 0.4375 ? "gibbous"
              : moonValue < 0.5625 ? "full"
                : moonValue < 0.6875 ? "gibbous"
                  : moonValue < 0.8125 ? "quarter" : "crescent";
      const illumination = (1 - Math.cos(moonValue * Math.PI * 2)) / 2;
      moonOut.textContent = `Moon: ${phaseName} · ${Math.round(illumination * 100)}%`;
      lastClockText = text;
    }

    const alpha = mode === "ship"
      ? (1 - clock.daylight) * settings.view.nightTintStrength
      : 0;
    nightTint.clear();
    if (alpha > 0.001 && app.screen.width > 0 && app.screen.height > 0) {
      nightTint
        .rect(0, 0, app.screen.width, app.screen.height)
        .fill({ color: NIGHT_COLOR, alpha });
      nightTint.visible = true;
    } else {
      nightTint.visible = false;
    }
  }

  function noteStateReceived(): void {
    const now = performance.now();
    receivedAt.push(now);
    while (receivedAt.length > 0 && receivedAt[0]! < now - 10_000) receivedAt.shift();
    if (receivedAt.length >= 2) {
      receivedGapMaxMs = 0;
      for (let index = 1; index < receivedAt.length; index += 1) {
        receivedGapMaxMs = Math.max(receivedGapMaxMs, receivedAt[index]! - receivedAt[index - 1]!);
      }
    }
  }

  function noteInbound(bytes: number, messages: number): void {
    const at = performance.now();
    inboundSamples.push({ at, bytes: Math.max(0, bytes), messages: Math.max(0, messages) });
    while (inboundSamples.length > 0 && inboundSamples[0]!.at < at - settings.network.performanceWindowSeconds * 1000) {
      inboundSamples.shift();
    }
  }

  function updatePerfPanel(now: number): void {
    if (!perfVisible || roomKind === "normal") {
      perfPanel.hidden = true;
      perfVisibleState.textContent = "off";
      return;
    }
    perfPanel.hidden = false;
    perfVisibleState.textContent = "on";
    const frameWindow = frameDurations.filter((sample) => sample.at >= now - 5_000);
    const averageFrame = frameWindow.length === 0
      ? 0
      : frameWindow.reduce((sum, sample) => sum + sample.ms, 0) / frameWindow.length;
    const worstFrame = frameWindow.reduce((worst, sample) => Math.max(worst, sample.ms), 0);
    const inbound = inboundSamples.filter((sample) => sample.at >= now - settings.network.performanceWindowSeconds * 1000);
    const inboundSpan = inbound.length >= 2
      ? Math.max(1, (inbound[inbound.length - 1]!.at - inbound[0]!.at) / 1000)
      : settings.network.performanceWindowSeconds;
    const inboundBytes = inbound.reduce((sum, sample) => sum + sample.bytes, 0) / inboundSpan;
    const inboundMessages = inbound.reduce((sum, sample) => sum + sample.messages, 0) / inboundSpan;
    domUpdateSamples.push({ at: now, count: domUpdateCount });
    while (domUpdateSamples.length > 0 && domUpdateSamples[0]!.at < now - 5_000) domUpdateSamples.shift();
    const domFirst = domUpdateSamples[0];
    const domLast = domUpdateSamples[domUpdateSamples.length - 1];
    const domRate = domFirst && domLast && domLast.at > domFirst.at
      ? ((domLast.count - domFirst.count) * 1000) / (domLast.at - domFirst.at)
      : 0;
    const snapshotAge = lastStateReceivedAt === 0 ? "—" : `${Math.round(now - lastStateReceivedAt)} ms`;
    const recentSteps = drawnSteps.filter((sample) => sample.at >= now - 5_000);
    const ownSteps = recentSteps.map((sample) => sample.own).filter((step) => step > 0);
    const otherMax = recentSteps.reduce((worst, sample) => Math.max(worst, sample.otherMax), 0);
    const ownAvgStep = ownSteps.length > 0
      ? ownSteps.reduce((sum, step) => sum + step, 0) / ownSteps.length
      : 0;
    const ownMaxStep = ownSteps.reduce((worst, step) => Math.max(worst, step), 0);
    const snapshotTimes = receivedAt.filter((at) => at >= now - 5_000);
    const intervals = snapshotTimes.slice(1).map((at, index) => at - snapshotTimes[index]!);
    const intervalAvg = intervals.length > 0
      ? intervals.reduce((sum, ms) => sum + ms, 0) / intervals.length
      : 0;
    const intervalMax = intervals.reduce((worst, ms) => Math.max(worst, ms), 0);
    const ownView = ships.get(ownId) ?? selectedShipView();
    const ownSnapshotAge = ownView
      ? ownView.motion.snapshotAgeMs(performance.now() / 1_000)
      : 0;
    const correctionPx = ownView ? ownView.motion.lastCorrectionKm * scale() : 0;
    perfLines.textContent = [
      `FPS ${fps.toFixed(1)} · frame ${averageFrame.toFixed(1)} avg / ${worstFrame.toFixed(1)} worst ms (5 s)`,
      `Objects ${app.stage.children.length + fleetGroupActive.length} · effects ${combatFx.length} · DOM ${domRate.toFixed(0)}/s`,
      `Ping ${pingMs > 0 ? `${Math.round(pingMs)} ms` : "—"} · in ${(inboundBytes / 1024).toFixed(1)} KB/s · ${inboundMessages.toFixed(1)} msg/s`,
      `Snapshot age ${snapshotAge} · queued ${pendingStateMessages.length} · server step ${serverWorldMs.toFixed(2)} ms`,
      `Drawn step mine ${ownAvgStep.toFixed(1)} avg / ${ownMaxStep.toFixed(1)} max px · others max ${otherMax.toFixed(1)} px`,
      `Snapshots ${intervalAvg.toFixed(0)} avg / ${intervalMax.toFixed(0)} max ms · buffer ${settings.client.renderDelayMs} ms · age ${Math.round(ownSnapshotAge)} ms`,
      `Dead reckoning correction ${correctionPx.toFixed(1)} px`,
      `Resolution ${app.renderer.resolution.toFixed(2)}x · quality ${qualityLabel()} · sending ${pendingOrders.size}`,
    ].join("\n");
  }

  let domObserver: MutationObserver | null = null;
  function setPerfVisible(next: boolean): void {
    perfVisible = next;
    perfAutoOpened = true;
    perfToggle.setAttribute("aria-pressed", String(next));
    perfToggle.textContent = `Performance: ${next ? "on" : "off"}`;
    perfPanel.hidden = !next || roomKind === "normal";
    if (next && !domObserver) {
      domObserver = new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target instanceof Element
            ? record.target
            : record.target.parentElement;
          if (target?.closest("#perf-panel")) continue;
          domUpdateCount += 1;
        }
      });
      domObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
    }
    if (next) updatePerfPanel(performance.now());
  }

  function updateDebugLine(): void {
    const now = performance.now();
    while (receivedAt.length > 0 && receivedAt[0]! < now - 10_000) receivedAt.shift();
    const spanMs = receivedAt.length >= 2
      ? receivedAt[receivedAt.length - 1]! - receivedAt[0]!
      : 0;
    const receivedHz = spanMs > 0 ? ((receivedAt.length - 1) * 1000) / spanMs : undefined;

    const line = fogDebugLine(
      roomKind,
      chartAll,
      discovered,
      blocks.size,
      {
        ...debugInfo,
        playerId: identity.id,
        buildCommit,
        receivedHz,
        receivedGapMaxMs: receivedAt.length >= 2 ? receivedGapMaxMs : undefined,
        fps,
        liveBlocks: liveBlockGraphics,
        serverCells: chartServerCells,
        clientCells: discoveredCellCount(chartAll, discovered),
        drawnBlocks: blocks.size,
        missingCells: Math.max(0, chartServerCells - discoveredCellCount(chartAll, discovered)),
        graphicsResets,
        devicePixelRatio: app.renderer.resolution,
        money,
        fleetShips: fleetShips.length,
        hungerMultiplier,
      },
    );
    const debugLine = line === null
      ? null
      : `${line} · suspicious segments: ${suspectSegments} · layout issues: ${layoutIssueCount}` +
        (chartDebug ? ` · chart cells ${chartCellKm} km (red undiscovered, green discovered)` : "");
    fogDebugOut.textContent = debugLine ?? "";
    fogDebugOut.hidden = debugLine === null;
  }

  /**
   * Read the small version file, never from cache. The page's build id comes
   * from its no-cache HTML; any different live id shows the reload notice.
   */
  async function checkForNewVersion(): Promise<void> {
    try {
      const response = await fetch("./version.json", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { id?: unknown; commit?: unknown };
      if (typeof data.id !== "string") return;

      if (!pageBuildId) pageBuildId = data.id;
      if (typeof data.commit === "string") {
        buildCommit = data.commit;
        updateDebugLine();
      }
      if (data.id !== pageBuildId) versionNotice.hidden = false;
    } catch {
      // A version check failure is not a game failure. Try again next minute.
    }
  }

  function onState(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      noteInbound(event.data.byteLength, 1);
      handleStateDelta(event.data);
      return;
    }
    if (typeof Blob !== "undefined" && event.data instanceof Blob) {
      noteInbound(event.data.size, 1);
      void event.data.arrayBuffer().then(handleStateDelta).catch((error) => reportClientError(error, "state delta"));
      return;
    }
    if (typeof event.data === "string") noteInbound(event.data.length, 1);
    flushClientErrors();
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (!message || typeof message !== "object") return;
    const type = (message as { t?: unknown }).t;

    // 4B: the lobby, the waiting card and takeover questions are not world state.
    if (lobbyUi?.handleMessage(message)) {
      if (type === "gameStarted") setStatus("Connected");
      return;
    }

    if (type === "n") {
      const text = (message as { text?: unknown }).text;
      if (typeof text === "string" && text.length <= 120) {
        showNotice(text);
        if (
          !tradePanel.hidden &&
          /^(Resupplied:|Bought |Sold |Loaded |Unloaded |No stock|Not enough money|No space)/.test(text)
        ) {
          tradeNotice.textContent = text;
          tradeNotice.hidden = false;
        }
      }
      return;
    }
    if (type === "boardOdds") {
      const reply = message as { target?: unknown; odds?: unknown };
      if (typeof reply.target === "string" && typeof reply.odds === "number" &&
          reply.target === boardTargetId) {
        const odds = Math.max(0, Math.min(100, Math.round(reply.odds)));
        boardOdds.textContent = `Odds: about ${odds}%`;
        boardConfirm.disabled = false;
      }
      return;
    }
    if (type === "scenarioStatus") {
      const status = (message as { status?: unknown }).status;
      if (status && typeof status === "object") {
        renderScenario(status as ScenarioStatus);
      }
      return;
    }
    if (type === "sessionReport") {
      const text = (message as { text?: unknown }).text;
      if (typeof text === "string") {
        testReportText.textContent = text;
        testReportText.hidden = false;
        testReportCopy.disabled = false;
        testReportDownload.disabled = false;
      }
      return;
    }
    if (type === "pong") {
      const at = Number((message as { at?: unknown }).at);
      if (Number.isFinite(at)) pingMs = Math.max(0, Date.now() - at);
      return;
    }
    if (type === "ack") {
      const reply = message as { id?: unknown; ok?: unknown; text?: unknown };
      if (typeof reply.id === "string") acknowledgeOrder(reply.id, reply.ok, reply.text);
      return;
    }
    if (type !== "s") return;
    enqueueState(message as StateMessage);
  }

  function handleStateDelta(buffer: ArrayBuffer): void {
    let delta;
    try {
      delta = decodeStateDelta(buffer);
    } catch (error) {
      reportClientError(error, "state delta");
      return;
    }
    if (!cachedState || delta.base !== cachedState.seq) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "resync" }));
      return;
    }
    const next = applyStateDelta(cachedState, delta);
    cachedState = next;
    enqueueState(next);
  }

  /**
   * Chart discovery is permanent and independent of the render loop. Apply it
   * on arrival, before state messages are coalesced, so a slow tab or a full
   * send buffer can never drop cells or private block geometry.
   */
  function applyChartPayload(chart: StateMessage["chart"] | undefined): void {
    if (!chart || typeof chart !== "object") return;
    const wasAll = chartMemory.all;
    const applied = applyChartUpdate(chartMemory, chart);
    chartAll = chartMemory.all;
    for (const cell of applied.addedCells) {
      chartDirtyBlocks.add(blockIdForCell(cell));
    }
    for (const id of applied.changedBlocks) chartDirtyBlocks.add(id);
    if (!wasAll && chartAll) {
      // The base texture now needs the full pale sea wash.
      chartCacheInitialized = false;
      markAllChartDirty();
    }
    const serverCells = finiteNumber(chart.serverCells) ?? undefined;
    if (serverCells !== undefined) chartServerCells = Math.max(chartServerCells, serverCells);
    chartBlocksRemaining = Math.max(0, Math.floor(finiteNumber(chart.remaining) ?? 0));
    updateCharting();
    if (applied.changed) chartRevision += 1;
  }

  function enqueueState(state: StateMessage): void {
    if (!Array.isArray(state.ships)) return;
    lastStateReceivedAt = performance.now();
    noteStateReceived();
    if (!cachedState || state.full === true) cachedState = state;
    applyChartPayload(state.chart);
    pendingStateMessages.push(state);
    if (pendingStateMessages.length > 30) pendingStateMessages.shift();
  }

  function flushPendingState(): void {
    if (pendingStateMessages.length === 0) return;
    const newest = newestStateWithEvents(pendingStateMessages);
    pendingStateMessages = [];
    if (newest) applyStateMessage(newest);
  }

  function applyStateMessage(state: StateMessage): void {
    if (!Array.isArray(state.ships)) return;
    if (typeof state.tick === "number") latestTick = state.tick;
    const receivedAtSeconds = performance.now() / 1_000;
    const fullSnapshot = state.full === true;
    const receivedGameMs = Number(state.g);
    if (Number.isFinite(receivedGameMs)) {
      clockTargetMs = receivedGameMs;
      clockTargetAt = performance.now();
      if (!clockStarted) {
        clockShownMs = receivedGameMs;
        clockStarted = true;
        lastClockText = "";
      }
    }

    if (state.k === "dev" && Array.isArray(state.d) && state.d.length >= 7) {
      const [ships, bots, worldHz, gapAvgMs, gapMaxMs, bytesAvg, bytesMax] = state.d;
      if (
        [ships, bots, worldHz, gapAvgMs, gapMaxMs, bytesAvg, bytesMax]
          .every((value) => typeof value === "number" && Number.isFinite(value))
      ) {
        debugInfo = { ships, bots, worldHz, gapAvgMs, gapMaxMs, bytesAvg, bytesMax };
      }
    }

    ownId = state.you;
    latestRoster = Array.isArray(state.roster)
      ? state.roster.filter((player) =>
          player && typeof player.id === "string" &&
          typeof player.name === "string" &&
          typeof player.navy === "string")
        .map((player) => ({
          id: player.id,
          name: player.name,
          navy: player.navy as NavyId,
        }))
      : [];
    latestOut = state.out ?? null;
    latestGo = state.go ?? null;
    if (Array.isArray(state.events)) {
      const receivedAtClient = performance.now();
      for (const raw of state.events) {
        if (!raw || typeof raw !== "object") continue;
        const event = raw as unknown as Record<string, unknown>;
        const visualKind = event.kind === "portFire" ? "fire"
          : event.kind === "portHit" ? "hit"
          : event.kind === "portSilenced" || event.kind === "portCaptured" ? "sunk"
          : event.kind === "fireStarted" ? "fire"
          : event.kind === "friendlyFire" || event.kind === "claim" || event.kind === "boarding" ? "hit"
          : event.kind === "explosion" || event.kind === "sinking" ? "sunk"
          : event.kind;
        if (
          visualKind !== "fire" && visualKind !== "hit" &&
          visualKind !== "miss" && visualKind !== "sunk"
        ) continue;
        if (typeof event.x !== "number" || typeof event.y !== "number") continue;
        combatFx.push({
          kind: visualKind,
          x: event.x,
          y: event.y,
          side: event.side === "port" || event.side === "starboard" ||
            event.side === "bow" || event.side === "stern"
            ? event.side
            : undefined,
          shipId: typeof event.shipId === "string" ? event.shipId : undefined,
          at: receivedAtClient,
        });
        if (visualKind === "sunk") {
          lastSunkAt = { x: event.x, y: event.y };
          if (notice.textContent?.startsWith("Ship sunk")) {
            notice.dataset.sunk = "true";
            notice.tabIndex = 0;
            notice.title = "Tap to centre the map on the sinking";
          }
        }
      }
      while (combatFx.length > (effectiveNetworkMode() === "saver" ? 48 : settings.client.maxLiveEffects)) combatFx.shift();
    }

    if (Array.isArray(state.fleet)) {
      const incomingFleet: OwnShipSnapshot[] = [];
      for (const raw of state.fleet) {
        const parsed = parseOwnShip(raw);
        if (parsed) incomingFleet.push(parsed);
      }
      fleetShips = incomingFleet;
      if (state.full === true) {
        trailPoints.clear();
        for (const row of incomingFleet) {
          if (row.trail && row.trail.length > 0) trailPoints.set(row.id, [...row.trail]);
        }
      }
    }

    // Neutral contacts are visible identities only. Cargo is present only
    // when the server says the hull is abandoned or has struck.
    const incomingContacts = new Map<string, NpcContactSnapshot>();
    if (Array.isArray(state.npcs)) {
      for (const raw of state.npcs) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as unknown as Record<string, unknown>;
        if (typeof row.id !== "string") continue;
        if (row.kind !== "merchant" && row.kind !== "whaler" && row.kind !== "privateer") continue;
        if (row.mode !== "patrol" && row.mode !== "escort" && row.mode !== "raid") continue;
        const cargo: NpcContactSnapshot["lootCargo"] = [];
        if (Array.isArray(row.lootCargo)) {
          for (const rawCargo of row.lootCargo) {
            if (!rawCargo || typeof rawCargo !== "object") continue;
            const line = rawCargo as Record<string, unknown>;
            if (typeof line.good !== "string" || !(GOOD_IDS as readonly string[]).includes(line.good)) continue;
            const tonnes = finiteNumber(line.tonnes);
            if (tonnes === null || tonnes <= 0) continue;
            cargo.push({ good: line.good as GoodId, tonnes });
          }
        }
        incomingContacts.set(row.id, {
          id: row.id,
          name: typeof row.name === "string" ? row.name : row.id,
          kind: row.kind,
          groupId: typeof row.groupId === "string" ? row.groupId : "",
          homePortId: typeof row.homePortId === "string" ? row.homePortId : null,
          hiredBy: typeof row.hiredBy === "string" ? row.hiredBy : null,
          mode: row.mode,
          contractRemainingGameSeconds: Math.max(0, Math.round(finiteNumber(row.contractRemainingGameSeconds) ?? 0)),
          fee: Math.max(0, Math.round(finiteNumber(row.fee) ?? 0)),
          ...(Array.isArray(row.lootCargo) ? { lootCargo: cargo, looted: row.looted === true } : {}),
        });
      }
      npcContacts = incomingContacts;
    } else if (state.full === true) {
      npcContacts.clear();
    }

    if (Array.isArray(state.escorts)) {
      npcEscorts = state.escorts
        .filter((row): row is EscortSnapshot =>
          !!row && typeof row.id === "string" && typeof row.name === "string" &&
          (row.mode === "patrol" || row.mode === "escort" || row.mode === "raid"),
        )
        .map((row) => ({
          ...row,
          targetId: typeof row.targetId === "string" ? row.targetId : null,
          targetName: typeof row.targetName === "string" ? row.targetName : null,
          contractRemainingGameSeconds: Math.max(0, Math.round(row.contractRemainingGameSeconds ?? 0)),
        }));
    } else if (state.full === true) {
      npcEscorts = [];
    }
    if (state.ships && Array.isArray(state.trailReset)) {
      for (const id of state.trailReset) {
        if (typeof id === "string") trailPoints.delete(id);
      }
    }
    if (state.trailAdds && typeof state.trailAdds === "object") {
      for (const [id, rawPoints] of Object.entries(state.trailAdds)) {
        if (typeof id !== "string" || !Array.isArray(rawPoints)) continue;
        const points = trailPoints.get(id) ?? [];
        for (const rawPoint of rawPoints) {
          if (!Array.isArray(rawPoint) || rawPoint.length !== 2) continue;
          const px = finiteNumber(rawPoint[0]);
          const py = finiteNumber(rawPoint[1]);
          if (px !== null && py !== null) points.push([px, py]);
        }
        trailPoints.set(id, points);
      }
    }
    if (Array.isArray(state.lostMarks)) {
      lostMarks = state.lostMarks
        .filter((point): point is [number, number] =>
          Array.isArray(point) && point.length === 2 &&
          Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(([x, y]) => [x, y]);
    }
    if (Array.isArray(state.fleets)) {
      playerFleets = state.fleets.map(parseFleet).filter((fleet): fleet is FleetSnapshot => fleet !== null);
    }
    latestPortIncome = state.pi && Array.isArray(state.pi.ports) ? state.pi : null;
    if (Array.isArray(state.routes)) {
      latestRoutes = state.routes.filter((row): row is TradeRouteSnapshot =>
        !!row && typeof row.id === "string" && typeof row.shipId === "string" &&
        typeof row.portA === "string" && typeof row.portB === "string" &&
        (CARGO_GOOD_IDS as readonly string[]).includes(row.good));
      if (sailorsLogOpen && activeLogTab === "trade") renderRouteList();
    }
    if (state.groups && typeof state.groups === "object") {
      controlGroups = {};
      for (const [rawSlot, ids] of Object.entries(state.groups)) {
        const slot = Number(rawSlot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 9 || !Array.isArray(ids)) continue;
        controlGroups[slot] = ids.filter((id): id is string => typeof id === "string");
      }
    }
    if (selectedEnemyId && !ships.has(selectedEnemyId)) {
      selectedEnemyId = null;
      if (activeDockPanel === "target") activeDockPanel = "ship";
    }
    if (selectedFleetId && !playerFleets.some((fleet) => fleet.id === selectedFleetId)) {
      selectedFleetId = null;
    }
    if (!selectedFleetId) {
      selectedFleetId = playerFleets.find((fleet) =>
        fleet.members.some((member) => member.id === selectedShipId),
      )?.id ?? null;
    }
    if (state.research && typeof state.research === "object") {
      const levels: Record<string, number> = {};
      const capturePoints: Record<string, number> = {};
      for (const [id, value] of Object.entries(state.research.levels ?? {})) {
        if (Number.isFinite(value) && value >= 0) levels[id] = Math.floor(value);
      }
      for (const [id, value] of Object.entries(state.research.capturePoints ?? {})) {
        if (Number.isFinite(value) && value >= 0) capturePoints[id] = Math.floor(value);
      }
      latestResearch = {
        points: Math.max(0, finiteNumber(state.research.points) ?? 0),
        units: Math.max(0, finiteNumber(state.research.units) ?? 0),
        levels,
        capturePoints,
      };
    } else if (state.full === true) {
      latestResearch = null;
    }
    hungerMultiplier = finiteNumber(state.h) ?? undefined;
    if (typeof state.sp === "string" && state.sp.length > 0) startPortName = state.sp;
    if (Number.isFinite(state.m)) money = Math.max(0, Math.floor(state.m));
    playerNavy = fleetShips[0]?.navy ?? playerNavy;
    if (state.sel === null || typeof state.sel === "string") {
      const serverSelection = typeof state.sel === "string" ? state.sel : "";
      if (fleetShips.some((ship) => ship.id === serverSelection && ship.status !== "delivery")) {
        selectedShipId = serverSelection;
      } else if (!fleetShips.some((ship) => ship.id === selectedShipId)) {
        selectedShipId = fleetShips.find((ship) => ship.status !== "delivery")?.id ?? "";
      }
    }
    for (const id of [...selectedShipIds]) {
      if (!fleetShips.some((ship) => ship.id === id && ship.status !== "delivery")) {
        selectedShipIds.delete(id);
      }
    }
    if (selectedShipIds.size === 0) multiSelect = false;
    updateMultiUi();
    const ownIds = new Set(fleetShips.map((ship) => ship.id));
    surrenderFlags = new Set(
      Array.isArray(state.sf)
        ? state.sf.filter((id): id is string => typeof id === "string" && !ownIds.has(id))
        : [],
    );
    const idList = (value: unknown): Set<string> => new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [],
    );
    abandonedFlags = idList(state.abandoned);
    burningFlags = idList(state.burning);
    burningStrength = new Map(
      state.burningStrength && typeof state.burningStrength === "object"
        ? Object.entries(state.burningStrength)
          .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
          .map(([id, value]) => [id, Math.max(0, Math.min(100, value as number))])
        : [],
    );
    nightLightsOff = idList(state.nightLightsOff);
    sinkingFlags = idList(state.sinking);
    grappledPairs = Array.isArray(state.grappled)
      ? state.grappled.filter((pair): pair is [string, string] =>
          Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string")
      : [];

    serverMoonPhase = typeof state.moon === "number" && Number.isFinite(state.moon)
      ? state.moon
      : null;
    windFrom = Number.isFinite(state.w) ? state.w : settings.weather.windFromDeg;
    serverWorldMs = typeof state.sv === "number" && Number.isFinite(state.sv) ? state.sv : serverWorldMs;
    roomKind = validRoomKind(state.k) ? state.k : "normal";
    latestRoomKind = roomKind;
    if (perfVisible && roomKind !== "normal" && !perfAutoOpened) {
      perfAutoOpened = true;
      testTools.hidden = false;
    }
    bordersButton.hidden = roomKind === "normal";
    debugSection.hidden = roomKind === "normal";
    testToolsButton.hidden = roomKind === "normal";
    if (roomKind === "normal") testTools.hidden = true;
    layoutAudit.hidden = roomKind === "normal";
    if (roomKind === "normal") {
      bordersVisible = false;
      bordersButton.setAttribute("aria-pressed", "false");
      borderLayer.clear();
    }
    scheduleLayoutAudit();
    windArrow.setAttribute("transform", `rotate(${(windFrom + 180) % 360} 12 12)`);
    windDialArrow.setAttribute("transform", `rotate(${(windFrom + 180) % 360} 36 36)`);
    const windSpeed = Math.round(settings.weather.windStrengthKnots);
    windSpeedLabel.textContent = `Wind speed ${windSpeed} kn`;
    windChipLabel.textContent = `${compassPoint(windFrom)} ${windSpeed} kn`;
    windLabel.textContent = `Wind from ${compassPoint(windFrom)} (${Math.round(windFrom)}°)`;
    updateToolWindMarker();

    // The server sends only ports this player has found. Keep the display set
    // in step with that filtered list rather than the full port table.
    const incomingPorts = new Map<string, PortInfo>();
    if (Array.isArray(state.ports)) {
      for (const raw of state.ports) {
        if (!Array.isArray(raw) || raw.length < 8) continue;
        const [id, name, size, npc, x, y, region, good] = raw;
        if (
          typeof id !== "string" ||
          typeof name !== "string" ||
          (size !== "S" && size !== "M" && size !== "L") ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          typeof region !== "string" ||
          typeof good !== "string"
        ) {
          continue;
        }
        const free = raw[8];
        const buyable = raw[9];
        const crewAvailable = raw[10];
        const tradeRaw: unknown = raw[11];
        let prices: PortInfo["prices"];
        let storage: PortInfo["storage"];
        let storageLimit: number | undefined;
        let npcStock: PortInfo["npcStock"];
        if (tradeRaw && typeof tradeRaw === "object") {
          const tradeSource = tradeRaw as Record<string, unknown>;
          prices = numericGoods(tradeSource.prices) ?? undefined;
          storage = numericGoods(tradeSource.storage) ?? undefined;
          npcStock = numericGoods(tradeSource.npcStock) ?? undefined;
          storageLimit = finiteNumber(tradeSource.storageLimit) ?? undefined;
        }
        incomingPorts.set(id, {
          id,
          name,
          size,
          npc: npc === 1,
          x,
          y,
          region,
          good,
          found: true,
          freePlaces:
            typeof free === "number" && Number.isFinite(free)
              ? Math.max(0, Math.floor(free))
              : undefined,
          buyable: buyable === 1,
          crewAvailable:
            typeof crewAvailable === "number" && Number.isFinite(crewAvailable)
              ? Math.max(0, Math.floor(crewAvailable))
              : undefined,
          prices,
          storage,
          storageLimit,
          npcStock,
        });
      }
    }
    if (Array.isArray(state.portBattle)) {
      for (const raw of state.portBattle) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as unknown as Record<string, unknown>;
        const port = typeof row.id === "string" ? incomingPorts.get(row.id) : undefined;
        if (!port) continue;
        if (typeof row.owner === "string" || row.owner === null) port.owner = row.owner;
        if (typeof row.navy === "string") port.ownerNavy = row.navy;
        if (row.tier === 0 || row.tier === 1 || row.tier === 2 || row.tier === 3) port.tier = row.tier;
        if (typeof row.condition === "string") {
          port.condition = row.condition as PortInfo["condition"];
        }
        port.silenced = row.silenced === true;
        if (typeof row.rangeKm === "number" && Number.isFinite(row.rangeKm)) port.rangeKm = row.rangeKm;
        if (typeof row.health === "number" && Number.isFinite(row.health)) port.health = row.health;
        if (typeof row.maxHealth === "number" && Number.isFinite(row.maxHealth)) port.maxHealth = row.maxHealth;
        if (row.stock && typeof row.stock === "object") {
          const stock = row.stock as Record<string, unknown>;
          if (typeof stock.timber === "number" && typeof stock.repairMaterials === "number") {
            port.stock = { timber: stock.timber, repairMaterials: stock.repairMaterials };
          }
        }
        if (row.build && typeof row.build === "object") {
          const build = row.build as Record<string, unknown>;
          if (typeof build.toTier === "number" && typeof build.startedGameMs === "number" &&
            typeof build.endsGameMs === "number") {
            port.build = {
              toTier: build.toTier,
              startedGameMs: build.startedGameMs,
              endsGameMs: build.endsGameMs,
            };
          }
        }
        if (row.nextCost && typeof row.nextCost === "object") {
          const cost = row.nextCost as Record<string, unknown>;
          if (typeof cost.timber === "number" && typeof cost.repairMaterials === "number") {
            port.nextCost = { timber: cost.timber, repairMaterials: cost.repairMaterials };
          }
        }
        if (row.guns && typeof row.guns === "object") {
          const guns = row.guns as Record<string, unknown>;
          if (typeof guns.heavy === "number" && typeof guns.medium === "number" && typeof guns.light === "number") {
            port.guns = { heavy: guns.heavy, medium: guns.medium, light: guns.light };
          }
        }
        if (row.capture && typeof row.capture === "object") {
          const capture = row.capture as Record<string, unknown>;
          if (typeof capture.seconds === "number" && typeof capture.requiredSeconds === "number") {
            port.capture = {
              seconds: capture.seconds,
              requiredSeconds: capture.requiredSeconds,
              sideId: typeof capture.sideId === "string" ? capture.sideId : null,
              reason: typeof capture.reason === "string" ? capture.reason : null,
            };
          }
        }
      }
    }
    portData.clear();
    for (const [id, port] of incomingPorts) portData.set(id, port);
    if (selectedPortId && !portData.has(selectedPortId)) closePortPanel();
    refreshCaptureStrip();
    if (shipyardPortId && !portData.has(shipyardPortId)) closeShipyardPanel();
    if (hirePortId && !portData.has(hirePortId)) closeHirePanel();

    const seen = new Set<string>();
    let own: ShipSnapshot | undefined;

    for (const snapshot of state.ships) {
      const [id, classId, x, y, headingDeg, knots] = snapshot;
      const navy = parseNavy(typeof snapshot[6] === "string" ? snapshot[6] : "British") ?? "British";
      const dockedPortId = typeof snapshot[7] === "string" ? snapshot[7] : null;
      const waitingPortId = typeof snapshot[8] === "string" ? snapshot[8] : null;
      if (
        typeof id !== "string" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(headingDeg) ||
        !Number.isFinite(knots)
      ) {
        continue;
      }

      seen.add(id);
      let ship = ships.get(id);
      const ownHere = ownIds.has(id);
      const npcFlag = snapshot[9] === 1;
      const npcKind = npcFlag ? asNpcKind(snapshot[10]) : null;
      const contact = npcContacts.get(id);
      const npcHired = contact ? contact.hiredBy !== null : false;
      if (!ship) {
        ship = shipPool.pop() ?? createShipView();
        ship.id = id;
        ship.own = ownHere;
        const headingRad = headingDeg * (Math.PI / 180);
        ship.x = x;
        ship.y = y;
        ship.heading = headingRad;
        ship.motion.reset(receivedAtSeconds, x, y, headingRad);
        ship.statusKey = "";
        ship.npcKind = npcKind;
        ship.npcHired = npcHired;
        paintHull(ship.hull, ownHere, navy, npcKind, npcHired);
        updateShipReconMarker(ship);
        ship.ring.clear();
        ship.ring.visible = false;
        ship.flag.visible = false;
        ship.flagshipInk.visible = false;
        ship.runInk.visible = false;
        ship.runLabel.visible = false;
        ship.statusInk.clear();
        ship.statusLabel.visible = false;
        ship.lightsLabel.visible = false;
        ship.hull.alpha = 1;
        for (const child of shipDisplayChildren(ship)) {
          if (!child.parent) fleetLayer.addChild(child);
        }
        // Hulls and normal ink stay in the fleet layer; fire status moves above
        // every hull and its labels above the ink.
        if (ship.statusInk.parent !== shipFxLayer) shipFxLayer.addChild(ship.statusInk);
        if (ship.statusLabel.parent !== shipLabelLayer) shipLabelLayer.addChild(ship.statusLabel);
        if (ship.lightsLabel.parent !== shipLabelLayer) shipLabelLayer.addChild(ship.lightsLabel);
        ships.set(id, ship);
      }

      ship.classId = String(classId);
      ship.hull.name = id;
      ship.navy = navy;
      ship.dockedPortId = dockedPortId;
      ship.waitingPortId = waitingPortId;
      if (ship.npcKind !== npcKind || ship.npcHired !== npcHired) {
        ship.npcKind = npcKind;
        ship.npcHired = npcHired;
        paintHull(ship.hull, ownHere, navy, npcKind, npcHired);
        updateShipReconMarker(ship);
      }
      const snapshotHeading = headingDeg * (Math.PI / 180);
      if (fullSnapshot) {
        ship.motion.reset(receivedAtSeconds, x, y, snapshotHeading);
      } else {
        ship.motion.push(receivedAtSeconds, x, y, snapshotHeading);
      }
      const ownRow = ownIds.has(id) ? fleetShips.find((row) => row.id === id) : undefined;
      ship.surrendered = ownRow?.surrendered === true || surrenderFlags.has(id);
      ship.running = ownRow?.running === true;
      ship.abandoned = abandonedFlags.has(id) || ownRow?.abandoned === true;
      const wasBurning = ship.burning;
      ship.burning = burningFlags.has(id) || ownRow?.burning === true;
      ship.fireStrength = ship.burning
        ? burningStrength.get(id) ?? ownRow?.fireStrength ?? 100
        : 0;
      ship.ignitionAt = ship.burning
        ? wasBurning ? ship.ignitionAt : performance.now()
        : null;
      ship.sinking = sinkingFlags.has(id);
      ship.lightsOff = ownRow ? ownRow.lightsOn === false : nightLightsOff.has(id);
      const night = gameClockAt(clockShownMs).daylight < 0.25;
      ship.lantern = night && !ship.lightsOff && !ship.burning;
      ship.isFlagship = ownRow?.isFlagship === true;
      if (ship.sinking) ship.surrendered = false;
      if (id === selectedShipId) own = snapshot;
    }

    for (const [id, ship] of ships) {
      if (!seen.has(id)) {
        for (const child of shipDisplayChildren(ship)) child.removeFromParent();
        ships.delete(id);
        if (shipPool.length < 80) shipPool.push(ship);
      }
    }

    ownSnapshot = own ?? null;
    updateShipRings();
    const selectedView = selectedShipView();
    if (selectedView && builtRevision < 0) {
      view.x = selectedView.x;
      view.y = selectedView.y;
    }

    const domNow = performance.now();
    if (domThrottle.due("hud", domNow, settings.client.shipPanelHz)) updateHud(own);
    if (own && target) {
      const distance = Math.hypot(own[2] - target.x, own[3] - target.y);
      if (distance <= settings.sailing.arrivalRadiusKm) {
        target = null;
        marker.visible = false;
      }
    }

    if (!fleetPanel.hidden && domThrottle.due("fleet", domNow, settings.client.panelHz)) {
      renderFleetPanel();
    }
    if (domThrottle.due("groups", domNow, settings.client.panelHz)) renderGroupBar();
    if (!headingSheet.hidden) drawHeadingPreview();
    if (!shipyardPanel.hidden) refreshShipyardSummary();
    if (!hirePanel.hidden && !hirePanel.contains(document.activeElement)) {
      renderHirePanel();
    }
    if (!tradePanel.hidden) renderTradePanel();
    if (damageShipId && !shipById(damageShipId)) closeDamagePanel();
    if (!damagePanel.hidden) renderDamagePanel();
    if (domThrottle.due("log", domNow, settings.client.panelHz)) {
      safeLayer("battle log", () => renderBattleLog(state.log));
    }
    safeLayer("battle bar", renderBattleBar);
    safeLayer("surrender offer", renderSurrenderOffer);
    safeLayer("status screens", renderEndScreens);
    if (lootTargetId && !npcContacts.has(lootTargetId)) closeLootSheet();
    if (privateerSheetId && !privateerInfo(privateerSheetId)) closePrivateerSheet();
    refreshEscortStrip();

    if (Array.isArray(state.l)) lastSeen = state.l;
    drawLastSeen();
    refreshPortPanel();
    updateKnownPortsButton();
    updateDebugLine();
    if (pendingOrders.size === 0) setStatus("Connected");
    else updateOrderSendingStatus();
  }

  function refreshKeepaliveButton(): void {
    testKeepalive.disabled = !accountSession;
    testKeepalive.title = !accountSession
      ? "Log in to run keepalive."
      : "";
    if (!accountSession) testKeepaliveResult.textContent = "Log in to run keepalive.";
  }

  async function connect(): Promise<void> {
    if (!room) return;
    if (!location.host) {
      setStatus("Open this page from the game server to sail.", true);
      return;
    }
    if (socket || connectionAttempt) return;
    connectionAttempt = true;

    let token: string | null = null;
    if (roomKindForCode(room) === "normal") {
      const session = accountSession ?? await accountApi?.session().catch(() => null) ?? null;
      accountSession = session;
      if (!session) {
        connectionAttempt = false;
        connectedAccountId = null;
        setStatus("Log in to play online", true);
        if (lobbyUi && lobbyUi.visibleScreen() !== "none") {
          lobbyUi.showHome("Log in to play online.");
        }
        return;
      }
      token = session.accessToken;
      connectedAccountId = session.user.id;
    }

    setStatus("Connecting…");
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const botsQuery = requestedBots === null
      ? ""
      : `&bots=${encodeURIComponent(requestedBots)}`;
    // Every test option must reach /ws. This was the missing-enemy bug: the
    // old code forwarded start and ship but silently dropped `enemy`.
    const testQuery = testJoinQuery(location.search);
    const url = `${scheme}://${location.host}/ws?room=${encodeURIComponent(room)}&player=${encodeURIComponent(identity.id)}${botsQuery}${testQuery}`;
    const next = new WebSocket(url);
    socket = next;
    connectionAttempt = false;

    next.addEventListener("open", () => {
      setStatus("Connected");
      // Normal rooms get the token in the first message, never in the URL.
      if (token) next.send(JSON.stringify({ t: "auth", token }));
      next.send(JSON.stringify({ t: "routeLine", enabled: showRouteLine }));
    });
    next.addEventListener("message", (event) => {
      try {
        onState(event);
      } catch (error) {
        reportClientError(error, "state update");
      }
    });
    next.addEventListener("error", () => setStatus("Could not reach the ship. Retrying…", true));
    next.addEventListener("close", (event) => {
      if (socket !== next) return;
      socket = null;

      if (event.code === TAKEN_OVER_CLOSE_CODE) {
        takenOver = true;
        if (retry !== null) {
          window.clearTimeout(retry);
          retry = null;
        }
        setStatus("This game is open in another tab", true);
        showNotice("This game is open in another tab");
        return;
      }

      if (event.code === 4401 || event.code === 4403) {
        if (retry !== null) {
          window.clearTimeout(retry);
          retry = null;
        }
        const text = event.reason || (event.code === 4403 ? "Account deleted" : "Log in to play online");
        setStatus(text, true);
        showNotice(text);
        if (roomKindForCode(room) === "normal") {
          leaveRoom();
          lobbyUi?.showHome(text);
        }
        return;
      }

      if (event.code === 4002) {
        // The host removed this captain, or the lobby closed.
        if (retry !== null) {
          window.clearTimeout(retry);
          retry = null;
        }
        const text = event.reason || "The lobby closed.";
        leaveRoom();
        lobbyUi?.showHome(text);
        return;
      }

      if (takenOver) return;
      setStatus("Connection lost. Retrying…", true);
      if (retry === null && !document.hidden) {
        retry = window.setTimeout(() => {
          retry = null;
          void connect();
        }, 2000);
      }
    });
  }

  function sendOrder(x: number, y: number): void {
    const ids = groupShipIds();
    if (ids.length === 0) return;
    if (!confirmRouteCancel(ids)) return;
    const previousSail = selectedSailPoint();
    target = { x, y };
    const screen = toScreen(x, y);
    marker.position.set(screen.x, screen.y);
    marker.visible = true;

    const fleets = selectedFleetIds();
    if (fleets.length > 0) {
      for (const fleetId of fleets) {
        sendFleetOrder(fleetId, { type: "goTo", x, y });
      }
      return;
    }

    for (let index = 0; index < ids.length; index += 1) {
      let tx = x;
      let ty = y;
      if (ids.length > 1 && index > 0) {
        const radius = settings.sailing.groupSpreadKm *
          Math.sqrt(index / (ids.length - 1));
        const angle = index * 2.399963229728653;
        tx = clamp(x + Math.cos(angle) * radius, 0.5, MAP_WIDTH_KM - 0.5);
        ty = clamp(y + Math.sin(angle) * radius, 0.5, MAP_HEIGHT_KM - 0.5);
      }
      sendCommand({
        t: "o",
        x: Number(tx.toFixed(2)),
        y: Number(ty.toFixed(2)),
        ship: ids[index]!,
      });
    }
  }

  // ---- Chart mode and scale ----------------------------------------------

  function setMode(next: ViewMode): void {
    if (next === mode) return;
    const now = performance.now();

    if (next === "chart") {
      savedShipView = { ...view };
      mode = "chart";
      setFollow(false);
      view.x = MAP_WIDTH_KM / 2;
      view.y = MAP_HEIGHT_KM / 2;
      view.kmAcross = wholeMapKmAcross();
      // Opening the chart should show stored ground immediately, not wait out
      // the previous cache throttle window.
      lastChartBuild = 0;
      chartButton.textContent = "Back to ship";
      chartButton.setAttribute("aria-pressed", "true");
      rulerLayer.visible = true;
      nightTint.visible = false;
      chartTrails.hidden = false;
    } else {
      mode = "ship";
      view.x = savedShipView.x;
      view.y = savedShipView.y;
      view.kmAcross = clamp(
        savedShipView.kmAcross,
        settings.view.shipMinKmAcross,
        settings.view.shipMaxKmAcross,
      );
      setFollow(savedShipView.follow);
      chartButton.textContent = "Chart";
      chartButton.setAttribute("aria-pressed", "false");
      rulerLayer.visible = false;
      chartTrails.hidden = true;
    }

    updateKnownPortsButton();
    updateToolWindMarker();
    refreshMap(now, true);
    refreshFogPaper();
    refreshPorts();
  }

  function updateRuler(): void {
    if (mode !== "chart") return;

    const s = scale();
    const steps = settings.view.chartRulerStepsKm;
    let step = steps[steps.length - 1] ?? 1_000;
    for (const candidate of steps) {
      const px = candidate * s;
      if (px >= settings.view.chartRulerMinPx && px <= settings.view.chartRulerMaxPx) {
        step = candidate;
        break;
      }
    }

    const px = step * s;
    const right = app.screen.width - 22;
    const bottom = app.screen.height - 22;
    rulerLine.clear();
    rulerLine
      .moveTo(right - px, bottom)
      .lineTo(right, bottom)
      .moveTo(right - px, bottom - 5)
      .lineTo(right - px, bottom + 5)
      .moveTo(right, bottom - 5)
      .lineTo(right, bottom + 5)
      .stroke({ width: 1.5, color: INK_COLOR });
    rulerText.text = `${step} km`;
    rulerText.position.set(right - px, bottom - 20);
  }

  // ---- Camera and input ---------------------------------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  let dragDistance = 0;
  let downAt = 0;
  let multiTouch = false;
  let pinchStartDistance = 0;
  let pinchStartKm = view.kmAcross;


  function mapTapAction(screenX: number, screenY: number): void {
    if (handleLogChartTap(screenX, screenY)) return;
    if (handleArmedOrderTap(screenX, screenY)) return;
    if (handleFireTargetTap(screenX, screenY)) return;
    const ownShip = shipAt(screenX, screenY);
    const portHit = portAt(screenX, screenY);
    const worldPoint = toWorld(screenX, screenY);
    if (ownShip) {
      const now = performance.now();
      const fleet = fleetOfShip(ownShip.id);
      if (fleet && lastOwnTap.id === ownShip.id && now - lastOwnTap.at < 350) {
        lastOwnTap = { id: "", at: 0 };
        selectWholeFleet(fleet.id);
        return;
      }
      lastOwnTap = { id: ownShip.id, at: now };
      if (multiSelect) {
        toggleGroupShip(ownShip.id);
        return;
      }
      const row = fleetShips.find((ship) => ship.id === ownShip.id);
      if (row?.status === "docked" && openShipActions(ownShip.id)) return;
      if (row && row.id === selectedShipId && !multiSelect) {
        openDamagePanel(row.id);
        return;
      }
      updateSelectedShip(ownShip.id, false);
      selectedFleetId = fleet?.id ?? null;
      return;
    }
    const foreign = anyShipAt(screenX, screenY);
    if (foreign && !foreign.own) {
      selectedEnemyId = foreign.id;
      if (!isPhoneLayout()) activeDockPanel = "target";
      closePortPanel();
      closeTradePanel();
      closeFleetPanel();
      closeShipyardPanel();
      closeHirePanel();
      knownPortsPanel.hidden = true;
      renderBattleBar();
      return;
    }
    const port = portHit;
    if (port) {
      const docked = fleetShips.find(
        (ship) => ship.status === "docked" && ship.portId === port.id,
      );
      if (docked && !multiSelect && openShipActions(docked.id)) return;
      openPortPanel(port.id);
      return;
    }

    // 3K-b: a tap on empty sea does nothing. Orders come from the Tools and
    // Stance sheets, ports, the queue or the chart.
    void worldPoint;
    return;
  }

  function drawSelectionBox(): void {
    selectionBoxInk.clear();
    const left = Math.min(boxStart.x, boxCurrent.x);
    const top = Math.min(boxStart.y, boxCurrent.y);
    const width = Math.abs(boxCurrent.x - boxStart.x);
    const height = Math.abs(boxCurrent.y - boxStart.y);
    selectionBoxInk.rect(left, top, width, height).fill({ color: PAPER_COLOR, alpha: 0.12 }).stroke({ width: 1.5, color: 0x8c1d1d });
    selectionBoxInk.visible = true;
  }

  function selectShipsInBox(start: { x: number; y: number }, end: { x: number; y: number }): void {
    const points = fleetShips
      .filter((ship) => ship.status !== "delivery")
      .map((ship) => ({ id: ship.id, ...toScreen(ship.x, ship.y) }));
    const ids = selectedShipIdsInBox(points, start, end);
    if (ids.length === 0) return;
    selectedShipIds.clear();
    for (const id of ids) selectedShipIds.add(id);
    selectedShipId = ids[0]!;
    selectedFleetId = fleetOfShip(selectedShipId)?.id ?? null;
    multiSelect = true;
    updateMultiUi();
    drawSelectedRoute();
    centreOnShip(selectedShipId);
  }

  function applyChartClamp(): void {
    if (mode !== "chart" || app.screen.width <= 0 || app.screen.height <= 0) return;
    const clamped = clampChartView(
      { x: view.x, y: view.y, kmAcross: view.kmAcross },
      MAP_WIDTH_KM,
      MAP_HEIGHT_KM,
      app.screen.width,
      app.screen.height,
      minViewKmAcross(),
    );
    view.x = clamped.x;
    view.y = clamped.y;
    view.kmAcross = clamped.kmAcross;
  }

  function zoomTo(kmAcross: number): void {
    view.kmAcross = clamp(kmAcross, minViewKmAcross(), maxViewKmAcross());
    applyChartClamp();
    if (sailorsLogOpen) {
      renderLogGrid();
      if (!logRuler.hidden) logRulerCache();
    }
  }

  function fitDiscoveredChartView(): void {
    const fit = fitDiscoveredChart(
      discovered,
      chartColumns,
      chartRows,
      chartCellKm,
      app.screen.width,
      app.screen.height,
    );
    if (!fit) {
      showNotice("No charted ground to fit yet.");
      return;
    }
    view.x = fit.x;
    view.y = fit.y;
    zoomTo(fit.kmAcross);
    refreshMap(performance.now(), true);
  }

  app.canvas.addEventListener("pointerdown", (event) => {
    app.canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      dragDistance = 0;
      downAt = performance.now();
      multiTouch = false;
      const rect = app.canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      if (multiSelect && !shipAt(sx, sy) && !portAt(sx, sy)) {
        boxPointer = event.pointerId;
        boxStart = { x: sx, y: sy };
        boxCurrent = { x: sx, y: sy };
        boxDragged = false;
      }
    }
    if (pointers.size === 2) {
      multiTouch = true;
      const [a, b] = [...pointers.values()];
      if (a && b) pinchStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartKm = view.kmAcross;
    }
  });

  app.canvas.addEventListener("pointermove", (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStartDistance > 0 && distance > 0) {
        zoomTo((pinchStartKm * pinchStartDistance) / distance);
      }
      return;
    }

    if (boxPointer === event.pointerId) {
      const rect = app.canvas.getBoundingClientRect();
      boxCurrent = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (Math.hypot(boxCurrent.x - boxStart.x, boxCurrent.y - boxStart.y) > 6) {
        boxDragged = true;
      }
      drawSelectionBox();
      return;
    }

    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    dragDistance += Math.hypot(dx, dy);

    // The chart is a paper you can drag; the ship view stays centred.
    if (mode === "chart" && !multiSelect) {
      const s = scale();
      view.x -= dx / s;
      view.y -= dy / s;
      applyChartClamp();
      if (sailorsLogOpen) {
        renderLogGrid();
        if (!logRuler.hidden) logRulerCache();
      }
      return;
    }

    // 3K: the selected ship is always centred. Dragging never pans the map.
  });

  function endPointer(event: PointerEvent): void {
    const wasSingle = pointers.size === 1;
    pointers.delete(event.pointerId);

    if (boxPointer === event.pointerId) {
      const didDrag = boxDragged;
      boxPointer = null;
      boxDragged = false;
      selectionBoxInk.clear();
      selectionBoxInk.visible = false;
      if (didDrag) {
        const rect = app.canvas.getBoundingClientRect();
        const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        selectShipsInBox(boxStart, end);
        return;
      }
    }

    if (!wasSingle || multiTouch || dragDistance >= 10) return;
    // 3J-fix-c1: a long press is just a long tap. It must not open a menu or
    // send an order. Only a short completed tap acts.
    if (performance.now() - downAt >= 600) return;

    const rect = app.canvas.getBoundingClientRect();
    mapTapAction(event.clientX - rect.left, event.clientY - rect.top);
  }

  app.canvas.addEventListener("pointerup", endPointer);
  app.canvas.addEventListener("pointercancel", (event) => {
    pointers.delete(event.pointerId);
  });

  app.canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomTo(view.kmAcross * Math.exp(event.deltaY * 0.0015));
    },
    { passive: false },
  );

  followButton.addEventListener("click", () => {
    if (mode === "chart") {
      setMode("ship");
      setFollow(true);
      return;
    }
    setFollow(!view.follow);
  });

  chartButton.addEventListener("click", () => {
    setMode(mode === "chart" ? "ship" : "chart");
  });

  multiButton.addEventListener("click", () => {
    multiSelect = !multiSelect;
    selectedShipIds.clear();
    if (multiSelect && selectedShipId) selectedShipIds.add(selectedShipId);
    updateMultiUi();
  });

  fleetSelectAll.addEventListener("click", () => {
    selectShips(() => true, "the whole fleet");
  });
  fleetSelectNearby.addEventListener("click", () => {
    const from = selectedFleetShip();
    if (!from) {
      showNotice("Select a ship to choose what is nearby.");
      return;
    }
    selectShips((ship) => Math.hypot(ship.x - from.x, ship.y - from.y) <= 5, "ships within 5 km");
  });
  fleetSelectFrigate.addEventListener("click", () => selectShips((ship) => ship.classId === "frigate", "frigates"));
  fleetSelectLine.addEventListener("click", () => selectShips((ship) => ship.classId === "line", "line ships"));

  fleetClear.addEventListener("click", () => {
    selectedShipIds.clear();
    multiSelect = false;
    updateMultiUi();
  });

  fleetUndock.addEventListener("click", sendUndock);
  fleetUpgradeAll.addEventListener("click", () => sendCommand({ t: "fitAllShips" }));
  shipTabOverview.addEventListener("click", () => setShipSubtab(false));
  shipTabUpgrades.addEventListener("click", () => {
    setShipSubtab(true);
    renderShipUpgrades();
  });
  shipUndock.addEventListener("click", sendUndock);
  shipDropAnchor.addEventListener("click", () => sendAnchor("dropAnchor"));
  shipWeighAnchor.addEventListener("click", () => sendAnchor("weighAnchor"));
  shipDamage.addEventListener("click", () => openDamagePanel());
  fireTargetCancel.addEventListener("click", () => {
    resetFireActionMode();
    renderFireShipActions();
  });
  fireTargetConfirm.addEventListener("click", () => {
    if (!fireActionShipId || !fireTargetId) return;
    sendCommand({
      t: "igniteFireShip",
      ship: fireActionShipId,
      mode: "contact",
      target: fireTargetId,
    });
    resetFireActionMode();
    renderFireShipActions();
  });
  const endJourney = (): void => {
    const id = selectedFleetShip()?.id;
    if (id) sendCommand({ t: "endJourney", ship: id });
  };
  shipEndJourney.addEventListener("click", endJourney);
  damageEndJourney.addEventListener("click", endJourney);
  chartClearTrails.addEventListener("click", () => sendCommand({ t: "clearTrails" }));
  for (const button of document.querySelectorAll<HTMLButtonElement>(".chart-trail-option")) {
    button.addEventListener("click", () => {
      const mode = button.dataset.trailMode;
      if (mode !== "selected" && mode !== "all" && mode !== "none") return;
      chartTrailMode = mode;
      for (const option of document.querySelectorAll<HTMLButtonElement>(".chart-trail-option")) {
        option.setAttribute("aria-pressed", String(option.dataset.trailMode === mode));
      }
    });
  }
  damageClose.addEventListener("click", closeDamagePanel);
  damageCrew.addEventListener("click", () => openCrewSheet(null));
  damageCaptured.addEventListener("click", () => {
    const row = damageShipId ? shipById(damageShipId) : selectedFleetShip();
    if (row) openCapturedSheet(row.id);
  });
  damageAutoBoard.addEventListener("change", () => {
    const row = damageShipId ? shipById(damageShipId) : selectedFleetShip();
    if (row) sendCommand({ t: "autoBoard", ship: row.id, enabled: damageAutoBoard.checked });
  });
  boardCancel.addEventListener("click", closeBoardSheet);
  boardClose.addEventListener("click", closeBoardSheet);
  lootCancel.addEventListener("click", closeLootSheet);
  lootClose.addEventListener("click", closeLootSheet);
  lootConfirm.addEventListener("click", () => {
    if (!lootTargetId) return;
    sendCommand({ t: "loot", target: lootTargetId, ship: selectedShipId });
    closeLootSheet();
  });
  privateerClose.addEventListener("click", closePrivateerSheet);
  escortCancel.addEventListener("click", closeEscortSheet);
  escortClose.addEventListener("click", closeEscortSheet);
  escortConfirm.addEventListener("click", () => {
    if (!escortPrivateerId) return;
    const info = privateerInfo(escortPrivateerId);
    if (!info) return;
    const target = escortTarget.value;
    sendCommand({
      t: info.hiredByMe ? "privateerMode" : "hirePrivateer",
      ship: escortPrivateerId,
      mode: "escort",
      ...(target ? { target } : {}),
    });
    closeEscortSheet();
  });
  escortStripOpen.addEventListener("click", () => {
    const first = npcEscorts[0];
    if (first) openPrivateerSheet(first.id);
  });
  boardConfirm.addEventListener("click", () => {
    if (!boardTargetId || !selectedShipId) return;
    sendCommand({ t: "board", ship: selectedShipId, target: boardTargetId, confirm: true });
    closeBoardSheet();
  });
  crewCancel.addEventListener("click", closeCrewSheet);
  crewClose.addEventListener("click", closeCrewSheet);
  crewDonor.addEventListener("change", refreshCrewSheet);
  crewReceiver.addEventListener("change", refreshCrewSheet);
  crewAmount.addEventListener("input", refreshCrewPreview);
  crewConfirm.addEventListener("click", () => {
    const amount = Math.max(1, Math.floor(Number(crewAmount.value)));
    if (crewClaimPrizeId) {
      sendCommand({ t: "claim", ship: crewClaimPrizeId, donor: crewDonor.value });
    } else {
      sendCommand({
        t: "crewTransfer",
        donor: crewDonor.value,
        receiver: crewReceiver.value,
        amount,
      });
    }
    closeCrewSheet();
  });
  capturedClose.addEventListener("click", closeCapturedSheet);
  capturedJoin.addEventListener("click", () => {
    if (capturedShipId) sendCommand({ t: "capturedCrew", ship: capturedShipId, choice: "join" });
    closeCapturedSheet();
  });
  capturedKill.addEventListener("click", () => {
    if (capturedShipId) sendCommand({ t: "capturedCrew", ship: capturedShipId, choice: "kill" });
    closeCapturedSheet();
  });
  capturedPrisoners.addEventListener("click", () => {
    if (capturedShipId) {
      const row = shipById(capturedShipId);
      sendCommand({ t: "capturedCrew", ship: capturedShipId, choice: "prisoners", prisoners: Number.MAX_SAFE_INTEGER });
      if (row) showNotice(`Prisoners limited to 20% of ${row.fullCrew}.`);
    }
    closeCapturedSheet();
  });
  portHandover.addEventListener("click", () => {
    if (!selectedPortId) return;
    const ship = fleetShips.find((mine) => mine.status === "docked" && mine.portId === selectedPortId);
    if (ship) sendCommand({ t: "handOverPrisoners", ship: ship.id, port: selectedPortId });
  });
  damageRepairToggle.addEventListener("change", () => {
    const row = damageShipId ? shipById(damageShipId) : selectedFleetShip();
    if (!row) return;
    sendCommand({ t: "repair", ship: row.id, enabled: damageRepairToggle.checked });
  });
  repairStores.addEventListener("click", () => {
    const row = damageShipId ? shipById(damageShipId) : selectedFleetShip();
    if (!row?.portId) return;
    sendCommand({ t: "portRepair", ship: row.id, port: row.portId, mode: "stores" });
  });
  repairPay.addEventListener("click", () => {
    const row = damageShipId ? shipById(damageShipId) : selectedFleetShip();
    if (!row?.portId) return;
    sendCommand({ t: "portRepair", ship: row.id, port: row.portId, mode: "pay" });
  });
  battleLogToggle.addEventListener("click", () => {
    const collapsed = battleLog.classList.toggle("is-collapsed");
    battleLogToggle.setAttribute("aria-expanded", String(!collapsed));
  });
  battleLogClose.addEventListener("click", () => {
    battleLog.hidden = true;
    battleLogButton.setAttribute("aria-expanded", "false");
    if (activeDockPanel === "log") activeDockPanel = "ship";
    scheduleScreenLayout();
  });
  chartBack.addEventListener("click", () => {
    setMode("ship");
    scheduleScreenLayout();
  });
  surrenderConfirmYes.addEventListener("click", () => {
    if (surrenderConfirmShipId) {
      sendShipBattle(surrenderConfirmShipId, "surrender");
    }
    closeSurrenderConfirm();
  });
  surrenderConfirmCancel.addEventListener("click", closeSurrenderConfirm);
  surrenderAccept.addEventListener("click", () => {
    if (surrenderOfferShipId) {
      sendCommand({ t: "acceptSurrender", ship: surrenderOfferShipId });
      surrenderDismissed.add(surrenderOfferShipId);
    }
    hideSurrenderOffer();
    renderBattleBar();
  });
  const dismissSurrender = (): void => {
    if (surrenderOfferShipId) surrenderDismissed.add(surrenderOfferShipId);
    hideSurrenderOffer();
  };
  surrenderKeep.addEventListener("click", dismissSurrender);
  surrenderOfferClose.addEventListener("click", dismissSurrender);

  actionUndock.addEventListener("click", () => {
    if (actionShipId) sendCommand({ t: "undock", ship: actionShipId });
    closeShipActions();
  });

  actionPort.addEventListener("click", () => {
    if (actionPortId) openPortPanel(actionPortId);
  });
  actionClose.addEventListener("click", closeShipActions);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeShipActions();
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    const slot = controlGroupSlotForKey(event.key);
    if (slot !== null) selectControlGroup(slot);
  });

  // TEMP-DEBUG: block and cell outlines for screenshots in test/dev rooms.
  bordersButton.addEventListener("click", () => {
    bordersVisible = !bordersVisible;
    bordersButton.setAttribute("aria-pressed", String(bordersVisible));
    drawBorders();
  });
  routeLineButton.setAttribute("aria-pressed", String(showRouteLine));
  routeLineButton.textContent = `Show route line: ${showRouteLine ? "On" : "Off"}`;
  routeLineButton.addEventListener("click", () => {
    showRouteLine = !showRouteLine;
    routeLineButton.setAttribute("aria-pressed", String(showRouteLine));
    routeLineButton.textContent = `Show route line: ${showRouteLine ? "On" : "Off"}`;
    try {
      localStorage.setItem(ROUTE_LINE_KEY, showRouteLine ? "1" : "0");
    } catch {
      // Remembering the choice is optional.
    }
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: "routeLine", enabled: showRouteLine }));
    }
    lastRouteKey = "";
    drawSelectedRoute();
  });
  flagshipPennantButton.setAttribute("aria-pressed", String(showFlagshipPennant));
  flagshipPennantButton.addEventListener("click", () => {
    showFlagshipPennant = !showFlagshipPennant;
    routeLineButton.setAttribute("aria-pressed", String(showRouteLine));
  routeLineButton.textContent = `Show route line: ${showRouteLine ? "On" : "Off"}`;
  routeLineButton.addEventListener("click", () => {
    showRouteLine = !showRouteLine;
    routeLineButton.setAttribute("aria-pressed", String(showRouteLine));
    routeLineButton.textContent = `Show route line: ${showRouteLine ? "On" : "Off"}`;
    try {
      localStorage.setItem(ROUTE_LINE_KEY, showRouteLine ? "1" : "0");
    } catch {
      // Remembering the choice is optional.
    }
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: "routeLine", enabled: showRouteLine }));
    }
    lastRouteKey = "";
    drawSelectedRoute();
  });
  flagshipPennantButton.setAttribute("aria-pressed", String(showFlagshipPennant));
    try {
      localStorage.setItem(FLAGSHIP_PENNANT_KEY, showFlagshipPennant ? "1" : "0");
    } catch {
      // Remembering the choice is optional.
    }
  });

  function drawSuspects(): void {
    suspectSegments = 0;
    if ((roomKind !== "test" && roomKind !== "dev") || app.screen.width <= 0) {
      return;
    }
    suspectSegments = findChartSuspects(screenBlockList(), isLandAt).length;
  }

  function isPhoneLayout(): boolean {
    return resolveLayoutMode(window.innerWidth, window.innerHeight, layoutPreference) !== "desktop";
  }

  function visibleById(id: string): boolean {
    const node = document.getElementById(id) as HTMLElement | null;
    return node !== null && !node.hidden;
  }

  function currentModalId(): LayoutModalId | null {
    const candidates: Array<[string, LayoutModalId]> = [
      ["surrender-confirm", "surrender"],
      ["board-sheet", "board"],
      ["crew-sheet", "crew"],
      ["captured-sheet", "captured"],
      ["loot-sheet", "loot"],
      ["privateer-sheet", "privateer"],
      ["escort-sheet", "escort"],
      ["surrender-sheet", "surrenderOffer"],
      ["resign-sheet", "resign"],
      ["victory-screen", "victory"],
      ["eliminated-screen", "eliminated"],
      ["order-menu", "orderMenu"],
      ["heading-sheet", "heading"],
      ["ship-action", "shipAction"],
    ];
    for (const [id, modal] of candidates) {
      if (visibleById(id)) return modal;
    }
    return null;
  }

  function currentDockPanel(): LayoutPanelId {
    if (!portPanel.hidden) return "port";
    if (!damagePanel.hidden) return "damage";
    if (!tradePanel.hidden) return "trade";
    if (!shipyardPanel.hidden) return "shipyard";
    if (!hirePanel.hidden) return "hire";
    if (!knownPortsPanel.hidden) return "knownPorts";
    if (!researchPanel.hidden) return "research";
    if (!fleetPanel.hidden) return "fleet";
    if (!battleLog.hidden && !isPhoneLayout()) return "log";
    return activeDockPanel;
  }

  function currentLayoutState(): LayoutState {
    const phone = isPhoneLayout();
    const row = selectedFleetShip();
    const enemy = selectedEnemyId ? ships.get(selectedEnemyId) : null;
    const selectedPort = selectedPortId ? portData.get(selectedPortId) : null;
    const ownPort = selectedPort?.owner === identity.id;
    const enemyPort = Boolean(selectedPort && !ownPort);
    const noticeCount = (notice.hidden ? 0 : 1) + (noticeSecond.hidden ? 0 : 1);
    const enemyChipAt = enemy ? toScreen(enemy.x, enemy.y) : null;
    return {
      idle: !selectedShipId && !enemy,
      ownShipSelected: Boolean(selectedShipId),
      inCombat: row?.inCombat === true || fleetShips.some((ship) => ship.inCombat === true),
      enemySelected: Boolean(enemy),
      surrenderOffered: !surrenderSheet.hidden,
      enemyPortSelected: enemyPort,
      ownPortSelected: ownPort,
      fireShipSelected: row?.classId === "fireShip",
      towAvailable: row?.classId === "fireShip",
      chartOpen: mode === "chart",
      trailsOpen: !chartTrails.hidden,
      menuOpen: !menuPanel.hidden,
      developerOpen: !testTools.hidden,
      ordersOpen,
      shipSheetOpen: phone && !shipPanel.classList.contains("is-collapsed"),
      battleLogOpen: phone && !battleLog.hidden,
      dockCollapsed,
      tapToSail: false,
      dockPanel: currentDockPanel(),
      noticeCount,
      battleLogUnread: Number(battleLogButtonCount.textContent) || 0,
      modal: currentModalId(),
      enemyChip: enemyChipAt,
    };
  }

  function setLayoutRect(node: HTMLElement, element: {
    rect: { left: number; top: number; width: number; height: number };
    z: number;
    scrollable: boolean;
  }): void {
    node.style.setProperty("position", "fixed", "important");
    node.style.setProperty("left", `${element.rect.left}px`, "important");
    node.style.setProperty("top", `${element.rect.top}px`, "important");
    node.style.setProperty("width", `${element.rect.width}px`, "important");
    node.style.setProperty("height", `${element.rect.height}px`, "important");
    node.style.setProperty("right", "auto", "important");
    node.style.setProperty("bottom", "auto", "important");
    node.style.setProperty("margin", "0", "important");
    node.style.setProperty("max-width", "none", "important");
    node.style.setProperty("max-height", "none", "important");
    node.style.setProperty("transform", "none", "important");
    node.style.setProperty("z-index", String(element.z), "important");
    node.style.setProperty("overflow-y", element.scrollable ? "auto" : "visible", "important");
    node.style.setProperty("overflow-x", "hidden", "important");
    node.style.setProperty("overscroll-behavior", "contain", "important");
  }

  function drawLayoutDebug(slots: ReturnType<typeof fixedGameSlots>): void {
    if (!layoutDebug || roomKind === "normal") {
      layoutDebugLayer.hidden = true;
      layoutDebugLayer.replaceChildren();
      return;
    }
    layoutDebugLayer.hidden = false;
    layoutDebugLayer.replaceChildren();
    for (const slot of slots.slots) {
      const node = document.getElementById(slot.id) ?? (slot.id === "ship-slot" ? shipPanel : null);
      const rect = node?.getBoundingClientRect();
      const use = rect && rect.width > 0 && rect.height > 0
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : slot.rect;
      const box = document.createElement("div");
      box.className = "layout-debug-box";
      box.dataset.group = "slot";
      box.style.left = `${use.left}px`;
      box.style.top = `${use.top}px`;
      box.style.width = `${use.width}px`;
      box.style.height = `${use.height}px`;
      const label = document.createElement("span");
      label.textContent = `${slot.id}`;
      box.append(label);
      layoutDebugLayer.append(box);
    }
  }

  function addContextAction(label: string, action: () => void): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.dataset.contextExtra = "true";
    button.textContent = label;
    button.addEventListener("click", action);
    battleBarActions.append(button);
  }

  function refreshContextActions(): void {
    if (!contextStripVisible(currentLayoutState())) return;
    for (const extra of battleBarActions.querySelectorAll<HTMLElement>("[data-context-extra]")) {
      extra.remove();
    }
    if (selectedPortId && !portPanel.hidden && !portAttackButton.hidden) {
      addContextAction("Attack port", () => portAttackButton.click());
    }
    const selected = selectedFleetShip();
    if (selected?.classId === "fireShip") {
      for (const button of fireShipButtonsOut.querySelectorAll<HTMLButtonElement>("button")) {
        const text = button.textContent?.toLowerCase() ?? "";
        if ((text.includes("ignite") || text.includes("tow")) && !button.hidden) {
          addContextAction(button.textContent ?? "Fire ship", () => button.click());
        }
      }
    }
    if (selectedEnemyId && ![...battleBarActions.querySelectorAll("button")].some((button) => /board/i.test(button.textContent ?? ""))) {
      addContextAction("Board", () => openBoardSheet(selectedEnemyId!));
    }
  }

  function applyFixedRect(node: HTMLElement, rect: { left: number; top: number; width: number; height: number }, z: number, scrollable = false): void {
    node.style.setProperty("position", "fixed", "important");
    node.style.setProperty("left", `${rect.left}px`, "important");
    node.style.setProperty("top", `${rect.top}px`, "important");
    node.style.setProperty("width", `${rect.width}px`, "important");
    node.style.setProperty("height", `${rect.height}px`, "important");
    node.style.setProperty("right", "auto", "important");
    node.style.setProperty("bottom", "auto", "important");
    node.style.setProperty("margin", "0", "important");
    node.style.setProperty("max-width", "none", "important");
    node.style.setProperty("max-height", "none", "important");
    node.style.setProperty("transform", "none", "important");
    node.style.setProperty("z-index", String(z), "important");
    node.style.setProperty("overflow-y", scrollable ? "auto" : "visible", "important");
    node.style.setProperty("overflow-x", "hidden", "important");
    node.style.setProperty("overscroll-behavior", "contain", "important");
  }

  function applyScreenLayout(): void {
    const slots = fixedGameSlots(window.innerWidth, window.innerHeight);
    const byId = new Map(slots.slots.map((slot) => [slot.id, slot.rect]));

    const topRight = byId.get("top-right-slot")!;
    const shipSlot = byId.get("ship-slot")!;
    const bottomLeft = byId.get("bottom-left-slot")!;
    const wordmarkRect = byId.get("wordmark")!;
    const armedRect = byId.get("armed-order")!;
    const noticeRect = byId.get("notice")!;
    const notice2Rect = byId.get("notice-2")!;

    applyFixedRect(topRightSlot, topRight, 30);
    const shipRect = shipExpanded
      ? {
          left: shipSlot.left,
          top: shipSlot.top,
          width: Math.min(430, window.innerWidth - shipSlot.left - 8),
          height: Math.min(window.innerHeight - shipSlot.top - 8, 640),
        }
      : shipSlot;
    applyFixedRect(shipPanel, shipRect, 26, shipExpanded);
    applyFixedRect(bottomLeftSlot, bottomLeft, 28);
    applyFixedRect(wordmark, wordmarkRect, 6);
    applyFixedRect(armedOrderBar, armedRect, 42);
    applyFixedRect(notice, noticeRect, 41);
    applyFixedRect(noticeSecond, notice2Rect, 41);
    document.body.dataset.layout3k = slots.mode;

    if (mapCompass.parentElement) mapCompass.hidden = true;
    scaleBar.hidden = true;
    queueButton.disabled = !selectedFleetId;
    developerButton.hidden = roomKind === "normal";
    refreshContextActions();

    const selectedEnemy = selectedEnemyId ? ships.get(selectedEnemyId) : null;
    enemyChip.textContent = selectedEnemy
      ? `${selectedEnemy.navy} ${selectedEnemy.classId}`
      : "";
    targetCardTitle.textContent = selectedEnemy
      ? `${selectedEnemy.navy} ${selectedEnemy.classId}`
      : "No target";
    targetCardDetail.textContent = selectedEnemy
      ? (selectedEnemy.surrendered ? "Struck colours" : selectedEnemy.abandoned ? "Abandoned" : "Under way")
      : "Select an enemy ship on the map.";

    drawLayoutDebug(slots);
    layoutApplyFrame = 0;
    lastLayoutApplyAt = performance.now();
  }

  function scheduleScreenLayout(): void {
    if (layoutApplyFrame) return;
    layoutApplyFrame = requestAnimationFrame(applyScreenLayout);
  }

  function scheduleLayoutAudit(): void {
    if (layoutAuditFrame) cancelAnimationFrame(layoutAuditFrame);
    layoutAuditFrame = requestAnimationFrame(runLayoutAudit);
  }

  /** Audit the real measured fixed slots, never the planned rectangles. */
  function runLayoutAudit(): SlotAuditIssue[] {
    layoutAuditFrame = 0;
    if (roomKind === "normal") {
      layoutAudit.hidden = true;
      layoutIssueCount = 0;
      return [];
    }

    const measured: MeasuredSlot[] = [];
    const addNode = (id: string, node: HTMLElement | null, nested = false): void => {
      if (!node || node.hidden) return;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      measured.push({
        id,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        interactive: node instanceof HTMLButtonElement,
        contentHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        scrollable: node.scrollHeight <= node.clientHeight + 1 || (node === shipPanel && shipExpanded),
        nested,
      });
    };
    addNode("top-right-slot", document.getElementById("top-right-slot"));
    addNode("ship-slot", shipPanel);
    addNode("bottom-left-slot", document.getElementById("bottom-left-slot"));
    addNode("wordmark", document.getElementById("wordmark"));
    if (!armedOrderBar.hidden) addNode("armed-order", armedOrderBar);
    if (!notice.hidden) addNode("notice", notice);
    if (!noticeSecond.hidden) addNode("notice-2", noticeSecond);
    for (const container of [document.getElementById("top-right-slot"), document.getElementById("bottom-left-slot"), shipPanel]) {
      for (const button of container?.querySelectorAll<HTMLButtonElement>("button") ?? []) {
        addNode(`${container === shipPanel ? "ship-slot" : container!.id}:${button.id}`, button, true);
      }
    }

    const issues = auditMeasuredSlots(measured, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    layoutIssueCount = issues.length;
    layoutAudit.hidden = false;
    layoutAuditSummary.textContent = issues.length === 0
      ? "Layout audit: clean"
      : `Layout audit: ${issues.length} issue${issues.length === 1 ? "" : "s"} (${[...new Set(issues.map((issue) => issue.kind))].join(", ")})`;
    layoutAuditList.replaceChildren();
    for (const issue of issues) {
      const item = document.createElement("li");
      item.textContent = `${issue.kind}: ${issue.id}${issue.other ? ` ↔ ${issue.other}` : ""} — ${issue.detail}`;
      layoutAuditList.append(item);
    }
    return issues;
  }

  function drawBorders(): void {
    borderLayer.clear();
    if (
      !bordersVisible ||
      (roomKind !== "test" && roomKind !== "dev") ||
      app.screen.width <= 0
    ) {
      return;
    }

    const s = scale();
    const halfW = app.screen.width / (2 * s);
    const halfH = app.screen.height / (2 * s);
    const left = Math.max(0, view.x - halfW);
    const right = Math.min(MAP_WIDTH_KM, view.x + halfW);
    const top = Math.max(0, view.y - halfH);
    const bottom = Math.min(MAP_HEIGHT_KM, view.y + halfH);

    for (const block of blocks.values()) {
      if (block.x + block.km < left || block.x > right || block.y + block.km < top || block.y > bottom) {
        continue;
      }
      const topLeft = toScreen(block.x, block.y);
      borderLayer
        .rect(topLeft.x, topLeft.y, block.km * s, block.km * s)
        .stroke({ width: 1, color: 0x8c1d1d, alpha: settings.view.borderLineAlpha });
    }

    const cellPx = chartCellKm * s;
    if (cellPx < settings.view.borderGridMinPx) return;

    const firstColumn = Math.max(0, Math.floor(left / chartCellKm));
    const lastColumn = Math.min(chartColumns, Math.ceil(right / chartCellKm));
    const firstRow = Math.max(0, Math.floor(top / chartCellKm));
    const lastRow = Math.min(chartRows, Math.ceil(bottom / chartCellKm));
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const x = toScreen(column * chartCellKm, 0).x;
      borderLayer
        .moveTo(x, toScreen(0, top).y)
        .lineTo(x, toScreen(0, bottom).y)
        .stroke({ width: 0.75, color: 0x2a1c10, alpha: settings.view.borderLineAlpha });
    }
    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = toScreen(0, row * chartCellKm).y;
      borderLayer
        .moveTo(toScreen(left, 0).x, y)
        .lineTo(toScreen(right, 0).x, y)
        .stroke({ width: 0.75, color: 0x2a1c10, alpha: settings.view.borderLineAlpha });
    }
  }

  function closeMenuPanel(): void {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  function sightLightNow(): { daylight: number; moon: number } {
    const clock = gameClockAt(clockShownMs);
    const moon = moonPhase(clockShownMs);
    return {
      daylight: settings.fog.nightSightEnabled ? clock.daylight : 1,
      moon: serverMoonPhase ?? moon.phase,
    };
  }

  function ownSightRange(row: OwnShipSnapshot, light = sightLightNow()): number {
    return ownSightFor(row, light);
  }

  function targetVisibleNow(target: {
    x: number;
    y: number;
    daySightKm?: number;
    lightsOn?: boolean;
  }): boolean {
    const light = sightLightNow();
    return fleetShips.some((ship) => ship.status !== "delivery" &&
      targetInSight(
        {
          x: ship.x,
          y: ship.y,
          lightsOn: false,
          daySightKm: daySightKmForClass(ship.classId),
        },
        target,
        light.daylight,
        light.moon,
      ));
  }

  function visibleEnemyShips(): ShipView[] {
    return [...ships.values()].filter((ship) =>
      !ship.own && !ship.sinking && targetVisibleNow({
        x: ship.x,
        y: ship.y,
        lightsOn: !ship.lightsOff,
        daySightKm: daySightKmForClass(ship.classId),
      }));
  }

  function visiblePorts(): PortInfo[] {
    const light = sightLightNow();
    const ranges = fleetShips
      .filter((ship) => ship.status !== "delivery")
      .map((ship) => ownSightRange(ship, light));
    const maxRange = Math.max(0, ...ranges);
    return [...portData.values()].filter((port) =>
      port.found !== false &&
      Math.hypot(port.x - (selectedFleetShip()?.x ?? port.x), port.y - (selectedFleetShip()?.y ?? port.y)) <= maxRange);
  }

  function stanceFleet(): FleetSnapshot | null {
    if (!(multiSelect && selectedShipIds.size > 1)) return null;
    const id = selectedFleetIds()[0];
    return id ? fleetById(id) : null;
  }

  function stanceSubjectShip(): OwnShipSnapshot | null {
    const fleet = stanceFleet();
    if (fleet) return shipById(fleet.leaderId) ?? selectedFleetShip();
    return selectedFleetShip();
  }

  function orderDisabledReason(orderId: string): string | null {
    const row = stanceSubjectShip();
    if (!row) return "No ship selected";
    if (orderId === "run") return visibleEnemyShips().length > 0 ? null : "No enemy in sight";
    if (orderId === "surrender" || orderId === "castOff" || orderId === "lights") return null;
    const light = sightLightNow();
    const maxRange = Math.max(
      0,
      ...fleetShips
        .filter((ship) => ship.status !== "delivery")
        .map((ship) => ownSightRange(ship, light)),
    );
    if (orderId === "attackPort") {
      return [...portData.values()].some((port) =>
        port.found !== false && port.owner !== identity.id &&
        Math.hypot(port.x - row.x, port.y - row.y) <= maxRange)
        ? null
        : "No enemy port in sight";
    }
    if (orderId === "tow") {
      return fleetShips.some((ship) =>
        ship.id !== row.id && ship.status !== "delivery" &&
        Math.hypot(ship.x - row.x, ship.y - row.y) <= maxRange)
        ? null
        : "No friendly ship in sight";
    }
    if (orderId === "claim") {
      return visibleEnemyShips().some((ship) => ship.abandoned)
        ? null
        : "No abandoned ship in sight";
    }
    return visibleEnemyShips().length > 0 ? null : "No enemy in sight";
  }

  function armedOrderPrompt(order: ControlOrder): string {
    switch (order.id) {
      case "attackSink": return "Sink armed: tap an enemy ship in sight";
      case "attackCapture": return "Capture armed: tap an enemy ship in sight";
      case "loot": return "Loot armed: tap an enemy ship in sight";
      case "board": return "Board armed: tap an enemy ship in sight";
      case "igniteContact": return "Ignite armed: tap an enemy ship in sight";
      case "attackPort": return "Attack port armed: tap an enemy port in sight";
      case "claim": return "Claim armed: tap an abandoned ship in sight";
      case "tow": return "Tow armed: tap one of your ships in sight";
      case "run": return "Run armed: tap one of your ships or fleet card";
      case "surrender": return "Surrender armed: tap one of your ships";
      default: return `${order.label} armed: tap its target`;
    }
  }

  function stanceToggle(orderId: string, label: string, container: HTMLElement): void {
    const order = controlOrderById(orderId);
    const reason = orderDisabledReason(orderId);
    const wrap = document.createElement("div");
    wrap.className = "stance-toggle";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.dataset.order = orderId;
    const castOffReason = orderId === "castOff" && !(stanceSubjectShip()?.towingId || stanceSubjectShip()?.towedBy)
      ? "Not towing"
      : null;
    const disabledReason = orderId === "castOff" ? castOffReason : reason;
    button.disabled = disabledReason !== null;
    button.setAttribute("aria-pressed", String(armedOrder?.id === orderId));
    button.title = disabledReason ?? `Arm ${label.toLowerCase()}`;
    button.addEventListener("click", () => {
      if (armedOrder?.id === orderId) {
        setArmedOrder(null);
        return;
      }
      if (orderId === "castOff") {
        runControlOrder(order, {});
        setArmedOrder(null);
        return;
      }
      setArmedOrder(order);
    });
    wrap.append(button);
    const why = document.createElement("p");
    why.className = "stance-reason";
    why.textContent = disabledReason ?? "";
    wrap.append(why);
    container.append(wrap);
  }

  function renderStanceSheet(): void {
    const fleet = stanceFleet();
    const ship = stanceSubjectShip();
    if (!ship && !fleet) {
      stanceSelection.textContent = "Select a ship or fleet.";
    } else if (fleet) {
      stanceSelection.textContent = `${fleet.name} · ${fleet.members.length} ships · leader ${shipById(fleet.leaderId)?.name ?? "unknown"}`;
    } else {
      stanceSelection.textContent = `${ship!.name} · ${stanceLabel(ship!.stance ?? "fightIfAttacked")}`;
    }
    const current = fleet?.stance ?? ship?.stance ?? "fightIfAttacked";
    stanceOptions.replaceChildren();
    for (const id of stanceOptionIds()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = stanceLabel(id);
      button.dataset.stance = id;
      button.setAttribute("aria-pressed", String(id === current));
      button.disabled = !fleet && !ship;
      button.title = !fleet && !ship ? "No ship selected" : `Set ${stanceLabel(id)}`;
      button.addEventListener("click", () => {
        if (fleet) sendCommand({ t: "fleetUpdate", fleet: fleet.id, stance: id });
        else if (ship) sendCommand({ t: "shipStance", ship: ship.id, stance: id });
        showNotice(`Stance: ${stanceLabel(id)}.`);
        renderStanceSheet();
      });
      stanceOptions.append(button);
    }
    battleOrdersOut.replaceChildren();
    for (const [id, label] of [
      ["attackSink", "Sink"],
      ["attackCapture", "Capture"],
      ["loot", "Loot"],
      ["run", "Run"],
      ["surrender", "Surrender"],
    ] as const) stanceToggle(id, label, battleOrdersOut);
    actionOrdersOut.replaceChildren();
    for (const [id, label] of [
      ["board", "Board"],
      ["claim", "Claim abandoned ship"],
      ["igniteContact", "Ignite"],
      ["tow", "Tow"],
      ["castOff", "Cast off"],
      ["attackPort", "Attack port"],
    ] as const) stanceToggle(id, label, actionOrdersOut);
    lightsSwitch.disabled = !ship;
    lightsSwitch.checked = ship ? ship.lightsOn !== false : false;
    lightsSwitchLabel.textContent = ship
      ? `Lights ${ship.lightsOn !== false ? "on" : "off"}`
      : "Lights: no ship selected";
    stanceNote.textContent = armedOrder
      ? `${armedOrderPrompt(armedOrder)}. Cancel in the banner or press Esc.`
      : "One toggle can be armed at a time. Tap its target on the sea, or Cancel in the banner.";
  }

  function openStanceSheet(): void {
    stanceSheetPanel.hidden = false;
    renderStanceSheet();
  }

  function closeStanceSheet(): void {
    stanceSheetPanel.hidden = true;
  }

  // ---- 3K-c: Sailor's Log, chart grid and scale ruler --------------------

  function hydrateLogHosts(): void {
    if (fleetPanel.parentElement !== logFleetsHost) logFleetsHost.append(fleetPanel);
    if (tradePanel.parentElement !== logTradeHost) logTradeHost.append(tradePanel);
    if (knownPortsPanel.parentElement !== logPortsHost) logPortsHost.append(knownPortsPanel);
    if (researchPanel.parentElement !== logResearchHost) logResearchHost.append(researchPanel);
  }

  function logPaneRect(): { left: number; top: number; width: number; height: number } {
    const pane = document.getElementById("log-chart");
    const rect = pane?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return {
      left: 0,
      top: 64,
      width: app.screen.width * 0.55,
      height: Math.max(1, app.screen.height - 64),
    };
  }

  function logGridDiscovered(xKm: number, yKm: number): boolean {
    if (chartMemory.all) return true;
    const column = Math.floor(xKm / chartCellKm);
    const row = Math.floor(yKm / chartCellKm);
    if (column < 0 || column >= chartColumns || row < 0 || row >= chartRows) return false;
    return discovered.has(row * chartColumns + column);
  }

  function renderLogGrid(): void {
    logGrid.replaceChildren();
    if (!sailorsLogOpen || mode !== "chart" || app.screen.width <= 0) return;
    const pane = logPaneRect();
    const s = scale();
    const halfW = app.screen.width / (2 * s);
    const halfH = app.screen.height / (2 * s);
    const lines = chartGridLines({
      xMin: view.x - halfW,
      xMax: view.x + halfW,
      yMin: view.y - halfH,
      yMax: view.y + halfH,
      isDiscovered: logGridDiscovered,
    });
    for (const line of lines) {
      for (const segment of line.segments) {
        const a = line.axis === "lon"
          ? toScreen(line.at, segment.from)
          : toScreen(segment.from, line.at);
        const b = line.axis === "lon"
          ? toScreen(line.at, segment.to)
          : toScreen(segment.to, line.at);
        const x = a.x - pane.left;
        const y = a.y - pane.top;
        if (line.axis === "lon") {
          if (x < 0 || x > pane.width) continue;
          const mark = document.createElement("div");
          mark.className = "log-grid-line lon";
          mark.style.left = `${x}px`;
          mark.style.top = `${y}px`;
          mark.style.height = `${Math.max(1, b.y - a.y)}px`;
          logGrid.append(mark);
        } else {
          if (y < 0 || y > pane.height) continue;
          const mark = document.createElement("div");
          mark.className = "log-grid-line lat";
          mark.style.left = `${x}px`;
          mark.style.top = `${y}px`;
          mark.style.width = `${Math.max(1, b.x - a.x)}px`;
          logGrid.append(mark);
        }
      }
      const first = line.segments[0];
      if (!first) continue;
      const edge = line.axis === "lon"
        ? toScreen(line.at, first.from)
        : toScreen(first.from, line.at);
      const labelX = edge.x - pane.left;
      const labelY = edge.y - pane.top;
      if (labelX < 0 || labelX > pane.width || labelY < 0 || labelY > pane.height) continue;
      const label = document.createElement("span");
      label.className = "log-grid-label";
      label.textContent = line.label;
      label.style.left = `${labelX + 2}px`;
      label.style.top = `${labelY + 2}px`;
      logGrid.append(label);
    }
  }

  function renderLogShips(): void {
    logShips.replaceChildren();
    for (const ship of fleetShips.filter((row) => row.status !== "delivery")) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${ship.isFlagship ? "⚑ " : ""}${ship.name} · ${ship.classId} · ${Math.round(ship.crew)}/${ship.fullCrew}`;
      button.dataset.shipId = ship.id;
      button.setAttribute("aria-pressed", String(ship.id === selectedShipId));
      button.addEventListener("click", () => {
        updateSelectedShip(ship.id, true);
        closeSailorsLog();
      });
      item.append(button);
      logShips.append(item);
    }
    if (logShips.childElementCount === 0) {
      const item = document.createElement("li");
      item.textContent = "No ships yet.";
      logShips.append(item);
    }
  }

  function renderLogQueue(): void {
    const fleet = selectedFleetIds()[0] ? fleetById(selectedFleetIds()[0]!) : null;
    logPatrol.disabled = !fleet;
    logPatrol.title = fleet ? "Pick a patrol and tap two chart points" : "Select a fleet first";
    logRendezvous.disabled = !fleet;
    logRendezvous.title = fleet ? "Pick a rendezvous point on the chart" : "Select a fleet first";
    logQueueNote.textContent = fleet
      ? `${fleet.name}: Patrol or Rendezvous, then tap the chart. Taps only pick points.`
      : "Select a fleet first. Taps on the chart only pick points, never sail a ship.";
    logQueueList.replaceChildren();
    for (const entry of playerFleets) {
      const leader = shipById(entry.leaderId);
      const queued = (leader?.orderLines ?? [])
        .filter((line) => line.kind === "queue" && line.queueNumber !== undefined);
      const heading = document.createElement("li");
      heading.textContent = `${entry.name}${queued.length ? "" : " · no queued points"}`;
      heading.className = "log-queue-fleet";
      logQueueList.append(heading);
      for (const line of queued) {
        const index = (line.queueNumber ?? 1) - 1;
        const item = document.createElement("li");
        item.className = "log-queue-row";
        const label = document.createElement("span");
        label.textContent = line.label || `Queued ${index + 1}`;
        const buttons = document.createElement("span");
        const up = document.createElement("button");
        up.type = "button";
        up.className = "btn";
        up.textContent = "Up";
        up.disabled = index <= 0;
        up.addEventListener("click", () => sendCommand({ t: "queueUpdate", fleet: entry.id, action: "move", index, to: index - 1 }));
        const down = document.createElement("button");
        down.type = "button";
        down.className = "btn";
        down.textContent = "Down";
        down.disabled = index >= queued.length - 1;
        down.addEventListener("click", () => sendCommand({ t: "queueUpdate", fleet: entry.id, action: "move", index, to: index + 1 }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => sendCommand({ t: "queueUpdate", fleet: entry.id, action: "remove", index }));
        buttons.append(up, down, remove);
        item.append(label, buttons);
        logQueueList.append(item);
      }
    }
    if (logQueueList.childElementCount === 0) {
      const item = document.createElement("li");
      item.textContent = "No fleets yet.";
      logQueueList.append(item);
    }
  }

  function routePortOptions(select: HTMLSelectElement, selectedId: string): void {
    select.replaceChildren();
    const ports = [...portData.values()]
      .filter((port) => port.npc || port.buyable)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const port of ports) {
      const option = document.createElement("option");
      option.value = port.id;
      option.textContent = port.name;
      option.selected = port.id === selectedId;
      select.append(option);
    }
  }

  function openRouteForm(route?: TradeRouteSnapshot): void {
    editingRouteId = route?.id ?? null;
    routeForm.hidden = false;
    routeEditNote.hidden = !route;
    routeEditNote.textContent = route ? `Editing ${route.shipName}'s route.` : "";
    routeSave.textContent = route ? "Save route" : "Start route";
    const tradeShips = fleetShips.filter((ship) => ship.classId === "trade" && ship.status !== "delivery");
    routeShip.replaceChildren();
    for (const ship of tradeShips) {
      const option = document.createElement("option");
      option.value = ship.id;
      option.textContent = `${ship.name} · ${formatTonnesWithUnit(ship.capacities.cargo)} hold`;
      option.selected = route ? ship.id === route.shipId : ship.id === selectedShipId;
      routeShip.append(option);
    }
    routePortOptions(routePortA, route?.portA ?? "");
    routePortOptions(routePortB, route?.portB ?? "");
    if (!routeGood.childElementCount) {
      for (const good of CARGO_GOOD_IDS) {
        const option = document.createElement("option");
        option.value = good;
        option.textContent = goodName(good);
        routeGood.append(option);
      }
    }
    routeGood.value = route?.good ?? "timber";
    const ship = tradeShips.find((row) => row.id === routeShip.value) ?? tradeShips[0];
    routeTonnes.max = String(Math.max(1, Math.floor(ship?.capacities.cargo ?? 1)));
    routeTonnes.value = String(Math.max(1, Math.floor(route?.tonnes ?? ship?.capacities.cargo ?? 1)));
    routeMinutes.value = String(route?.limitMinutes ?? settings.trade.routeDefaultLimitMinutes);
    if (tradeShips.length === 0) {
      routeSave.disabled = true;
      routeSave.title = "Buy a trade ship first";
    } else {
      routeSave.disabled = false;
      routeSave.title = "";
    }
    updateRouteEstimate();
  }

  function closeRouteForm(): void {
    editingRouteId = null;
    routePick = null;
    routeForm.hidden = true;
  }

  function updateRouteEstimate(): void {
    const a = portData.get(routePortA.value);
    const b = portData.get(routePortB.value);
    const tonnes = Number(routeTonnes.value);
    const buy = a?.prices?.[routeGood.value as GoodId];
    const sell = b?.prices?.[routeGood.value as GoodId];
    if (buy === undefined || sell === undefined || !(tonnes > 0)) {
      routeEstimate.textContent = "Estimated profit: prices not known until both ports are usable.";
      return;
    }
    const profit = (sell - buy) * Math.min(tonnes, Number(routeTonnes.max) || tonnes);
    routeEstimate.textContent = `Estimated profit per trip: ${formatMoney(profit)} pieces (buy ${formatMoney(buy)}, sell ${formatMoney(sell)} per tonne).`;
  }

  function renderRouteIncome(): void {
    routeIncome.replaceChildren();
    if (!latestPortIncome) {
      const empty = document.createElement("p");
      empty.className = "log-note";
      empty.textContent = "Port income: no owned ports. Captured ports pay from the next cycle.";
      routeIncome.append(empty);
      return;
    }
    const total = document.createElement("strong");
    total.textContent = `Port income ${formatMoney(latestPortIncome.total)} pieces · next in ${latestPortIncome.nextGameDays.toFixed(2)} game days (${latestPortIncome.nextRealMinutes.toFixed(1)} real min)`;
    const list = document.createElement("ul");
    for (const port of latestPortIncome.ports) {
      const item = document.createElement("li");
      item.textContent = `${port.name} (${port.size}) · ${formatMoney(port.income)} pieces · ${port.routes} route${port.routes === 1 ? "" : "s"}`;
      list.append(item);
    }
    routeIncome.append(total, list);
  }

  function renderRouteList(): void {
    renderRouteIncome();
    routeList.replaceChildren();
    routeFast.hidden = roomKind === "normal" || latestRoutes.length === 0;
    routePayNow.hidden = roomKind === "normal" || !latestPortIncome;
    if (latestRoutes.length === 0) {
      const item = document.createElement("li");
      item.className = "log-note";
      item.textContent = "No trade routes yet.";
      routeList.append(item);
      return;
    }
    for (const route of latestRoutes) {
      const item = document.createElement("li");
      item.className = "log-route-row";
      item.dataset.routeId = route.id;
      const title = document.createElement("strong");
      title.textContent = `${route.shipName} · ${route.portAName} → ${route.portBName}`;
      const detail = document.createElement("span");
      detail.textContent = `${goodName(route.good)} ${formatTonnesWithUnit(route.tonnes)} · limit ${route.limitMinutes} min · last trip ${formatMoney(route.lastProfit)} pieces`;
      const status = document.createElement("span");
      status.className = route.late ? "log-route-late" : "log-route-status";
      status.textContent = route.status === "late" ? `Late${route.reason ? ` · ${route.reason}` : ""}`
        : route.status === "paused" ? `Paused · ${route.reason ?? "waiting"}`
        : route.status === "outbound" ? "Outbound"
        : route.status === "returning" ? "Returning"
        : "Loading";
      const actions = document.createElement("span");
      actions.className = "log-order-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openRouteForm(route));
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        sendCommand({ t: "routeCancel", route: route.id });
        if (editingRouteId === route.id) closeRouteForm();
      });
      actions.append(edit, cancel);
      item.append(title, detail, status, actions);
      routeList.append(item);
    }
  }

  function renderLogTrade(): void {
    renderRouteList();
    logCargoList.replaceChildren();
    for (const ship of fleetShips.filter((row) => row.status !== "delivery")) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.shipId = ship.id;
      button.textContent = `${ship.name} · ${formatTonnesWithUnit(ship.cargoUsed)} in the hold`;
      button.addEventListener("click", () => {
        updateSelectedShip(ship.id, true);
        closeSailorsLog();
        setShipExpanded(true);
      });
      item.append(button);
      logCargoList.append(item);
    }
    const note = logTradeHost.querySelector<HTMLElement>("[data-log-trade-note]");
    if (tradePortId && tradePanel.hidden) tradePanel.hidden = false;
    if (!tradePortId) {
      if (!note) {
        const p = document.createElement("p");
        p.className = "log-note";
        p.dataset.logTradeNote = "1";
        p.textContent = "Dock a ship and open its port trade to see cargo and storage here.";
        logTradeHost.prepend(p);
      }
    } else {
      note?.remove();
    }
  }

  function renderLogFleets(): void {
    renderFleetPanel(true);
    fleetPanel.hidden = false;
  }

  function setLogTab(tab: LogTab): void {
    activeLogTab = tab;
    for (const button of logTabs) {
      button.setAttribute("aria-selected", String(button.dataset.logTab === tab));
    }
    logPanelChart.hidden = tab !== "chart";
    logPanelQueued.hidden = tab !== "queued";
    logPanelFleets.hidden = tab !== "fleets";
    logPanelTrade.hidden = tab !== "trade";
    logPanelResearch.hidden = tab !== "research";
    logPickHint.hidden = logChartPick === null;
    if (tab === "chart") {
      renderLogShips();
      renderKnownPorts();
      knownPortsPanel.hidden = false;
    } else if (tab === "queued") {
      renderLogQueue();
    } else if (tab === "fleets") {
      renderLogFleets();
    } else if (tab === "research") {
      renderResearchPanel(true);
      researchPanel.hidden = false;
    } else if (tab === "trade") {
      renderLogTrade();
    }
    renderLogGrid();
  }

  function openSailorsLog(tab: LogTab = "chart"): void {
    hydrateLogHosts();
    closePortPanel();
    closeFleetPanel();
    closeShipyardPanel();
    closeHirePanel();
    sailorsLogOpen = true;
    sailorsLogPanel.hidden = false;
    sailorsLogButton.setAttribute("aria-expanded", "true");
    setMode("chart");
    if (!logChartCentred) {
      // The chart canvas runs the full screen; the log covers its right side.
      // Centre the selected ship's discovered chart in the visible left pane,
      // not underneath the list panel.
      const pane = logPaneRect();
      view.kmAcross = clamp(600, minViewKmAcross(), maxViewKmAcross());
      const focusShip = selectedFleetShip() ?? fleetShips.find((ship) => ship.status !== "delivery");
      const focus = focusShip
        ? { x: focusShip.x, y: focusShip.y }
        : { x: MAP_WIDTH_KM / 2, y: MAP_HEIGHT_KM / 2 };
      const s = scale();
      view.x = clamp(
        focus.x + (app.screen.width / 2 - (pane.left + pane.width / 2)) / s,
        0,
        MAP_WIDTH_KM,
      );
      view.y = clamp(
        focus.y + (app.screen.height / 2 - (pane.top + pane.height / 2)) / s,
        0,
        MAP_HEIGHT_KM,
      );
      logChartCentred = true;
      lastChartBuild = 0;
      refreshMap(performance.now(), true);
      refreshFogPaper();
    }
    setLogTab(tab);
  }

  function closeSailorsLog(): void {
    if (!sailorsLogOpen) return;
    sailorsLogOpen = false;
    sailorsLogPanel.hidden = true;
    sailorsLogButton.setAttribute("aria-expanded", "false");
    logChartPick = null;
    logRulerArmed = false;
    logRulerPoints = [];
    logPickHint.hidden = true;
    logRuler.hidden = true;
    logRulerLine.hidden = true;
    logRulerUse.hidden = true;
    logChartCentred = false;
    setMode("ship");
  }

  function logRulerCache(): void {
    logRuler.hidden = false;
    logRulerUse.hidden = logRulerPoints.length < 2;
    if (logRulerPoints.length === 0) {
      logRulerText.textContent = "Scale ruler: tap two chart points.";
      logRulerLine.hidden = true;
      return;
    }
    if (logRulerPoints.length === 1) {
      logRulerText.textContent = "Scale ruler: tap the second point.";
      logRulerLine.hidden = true;
      return;
    }
    const a = logRulerPoints[0]!;
    const b = logRulerPoints[1]!;
    const result = scaleRuler(a, b);
    logRulerText.textContent = `${result.bearingDeg.toFixed(0)}° · ${result.distanceKm.toFixed(1)} km`;
    const pane = logPaneRect();
    const from = toScreen(a.x, a.y);
    const to = toScreen(b.x, b.y);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    logRulerLine.hidden = false;
    logRulerLine.style.left = `${from.x - pane.left}px`;
    logRulerLine.style.top = `${from.y - pane.top}px`;
    logRulerLine.style.width = `${Math.hypot(dx, dy)}px`;
    logRulerLine.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }

  function handleLogChartTap(screenX: number, screenY: number): boolean {
    if (!sailorsLogOpen) return false;
    if (routePick) {
      const marker = portAt(screenX, screenY);
      if (!marker) {
        showNotice("Tap a discovered port marker to pick it.");
        return true;
      }
      const select = routePick === "a" ? routePortA : routePortB;
      select.value = marker.id;
      routePick = null;
      routePickA.setAttribute("aria-pressed", "false");
      routePickB.setAttribute("aria-pressed", "false");
      logPickHint.hidden = true;
      updateRouteEstimate();
      return true;
    }
    const point = toWorld(screenX, screenY);
    if (logRulerArmed) {
      if (logRulerPoints.length >= 2) logRulerPoints = [];
      logRulerPoints.push(point);
      renderLogGrid();
      logRulerCache();
      logPickHint.hidden = false;
      logPickHint.textContent = logRulerPoints.length < 2
        ? "Scale ruler: tap the second point."
        : "Scale ruler: bearing and distance shown.";
      return true;
    }
    if (logChartPick?.kind === "patrol") {
      logChartPick.points.push(point);
      if (logChartPick.points.length < 2) {
        logPickHint.hidden = false;
        logPickHint.textContent = "Patrol: tap the second point.";
        return true;
      }
      const [a, b] = logChartPick.points;
      sendFleetOrder(logChartPick.fleetId, { type: "patrol", a: a!, b: b! });
      showNotice("Patrol ordered from the chart.");
      logChartPick = null;
      logPickHint.hidden = true;
      renderLogQueue();
      return true;
    }
    if (logChartPick?.kind === "rendezvous") {
      const fleet = fleetById(logChartPick.fleetId);
      sendFleetOrder(logChartPick.fleetId, {
        type: "rendezvous",
        point,
        memberIds: fleet?.members.map((member) => member.id) ?? [],
      });
      showNotice("Rendezvous ordered from the chart.");
      logChartPick = null;
      logPickHint.hidden = true;
      renderLogQueue();
      return true;
    }
    return false;
  }

  function beginLogPick(kind: "patrol" | "rendezvous"): void {
    const fleetId = selectedFleetIds()[0];
    if (!fleetId) {
      showNotice("Select a fleet first.");
      return;
    }
    logRulerArmed = false;
    logRulerPoints = [];
    logRuler.hidden = true;
    logChartPick = kind === "patrol"
      ? { kind, fleetId, points: [] }
      : { kind, fleetId };
    logPickHint.hidden = false;
    logPickHint.textContent = kind === "patrol"
      ? "Patrol: tap the first point."
      : "Rendezvous: tap the point.";
  }

  function armLogRuler(): void {
    logChartPick = null;
    logRulerArmed = true;
    logRulerPoints = [];
    logRuler.hidden = false;
    logRulerUse.hidden = true;
    logPickHint.hidden = false;
    logPickHint.textContent = "Scale ruler: tap two chart points.";
    logRulerText.textContent = "Scale ruler: tap two chart points.";
    logRulerLine.hidden = true;
  }

  function useRulerCourse(): void {
    if (logRulerPoints.length < 2) return;
    const result = scaleRuler(logRulerPoints[0]!, logRulerPoints[1]!);
    closeSailorsLog();
    openHeading(null);
    headingDegrees.value = String(Math.round(result.bearingDeg) % 360);
    headingDial.value = String(Math.round(result.bearingDeg) % 360);
    headingDistance.value = result.distanceKm.toFixed(1);
    drawHeadingPreview();
  }

  function openLogFromKnownPorts(): void {
    hydrateLogHosts();
    openSailorsLog("chart");
    knownPortsPanel.hidden = false;
    renderKnownPorts();
  }

  for (const button of logTabs) {
    button.addEventListener("click", () => {
      const tab = button.dataset.logTab;
      if (tab === "return") closeSailorsLog();
      else if (tab === "chart" || tab === "queued" || tab === "fleets" || tab === "trade") {
        if (!sailorsLogOpen) openSailorsLog(tab);
        else setLogTab(tab);
      }
    });
  }
  logRulerButton.addEventListener("click", armLogRuler);
  logZoomOut.addEventListener("click", () => zoomTo(view.kmAcross * 1.25));
  logZoomIn.addEventListener("click", () => zoomTo(view.kmAcross / 1.25));
  logFitDiscovered.addEventListener("click", fitDiscoveredChartView);
  researchZoomOut.addEventListener("click", () => {
    researchZoom = Math.max(0.55, researchZoom - 0.15);
    applyResearchWebTransform();
  });
  researchZoomIn.addEventListener("click", () => {
    researchZoom = Math.min(2.2, researchZoom + 0.15);
    applyResearchWebTransform();
  });
  researchDetailClose.addEventListener("click", () => {
    researchDetail.hidden = true;
    researchDetailId = null;
  });
  researchWebViewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    researchZoom = Math.max(0.55, Math.min(2.2, researchZoom * Math.exp(-event.deltaY * 0.001)));
    applyResearchWebTransform();
  }, { passive: false });
  let researchDrag: { id: number; x: number; y: number } | null = null;
  researchWebViewport.addEventListener("pointerdown", (event) => {
    researchDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    researchWebViewport.setPointerCapture(event.pointerId);
  });
  researchWebViewport.addEventListener("pointermove", (event) => {
    if (!researchDrag || researchDrag.id !== event.pointerId) return;
    researchPanX += event.clientX - researchDrag.x;
    researchPanY += event.clientY - researchDrag.y;
    researchDrag.x = event.clientX;
    researchDrag.y = event.clientY;
    applyResearchWebTransform();
  });
  const endResearchDrag = (event: PointerEvent): void => {
    if (researchDrag?.id === event.pointerId) researchDrag = null;
  };
  researchWebViewport.addEventListener("pointerup", endResearchDrag);
  researchWebViewport.addEventListener("pointercancel", endResearchDrag);
  logRulerUse.addEventListener("click", useRulerCourse);
  logPatrol.addEventListener("click", () => {
    beginLogPick("patrol");
  });
  logRendezvous.addEventListener("click", () => {
    beginLogPick("rendezvous");
  });
  logPortsHost.addEventListener("click", () => {
    window.setTimeout(() => {
      if (!portPanel.hidden) closeSailorsLog();
    }, 0);
  });

  // ---- 3K-d: Tools sheet, wind marker and range check ---------------------

  function toggleToolsSheet(open = toolsSheet.hidden): void {
    toolsSheet.hidden = !open;
    toolsButton.setAttribute("aria-expanded", String(open));
    if (open) {
      closeHeadingSheet();
      closeStanceSheet();
      stanceButton.setAttribute("aria-expanded", "false");
    }
  }

  function daySightKmForClass(classId: string | undefined): number {
    return classId === "fireShip"
      ? settings.research.effects.fireShipSightKm
      : settings.research.effects.shipSightKm;
  }

  function ownSightFor(row: OwnShipSnapshot, light = sightLightNow()): number {
    return sightRangeKm(
      { daySightKm: daySightKmForClass(row.classId), lightsOn: false },
      light.daylight,
      light.moon,
      false,
    );
  }

  function selectedSightKm(): number {
    const row = selectedFleetShip();
    return row ? ownSightFor(row) : 0;
  }

  function updateToolWindMarker(): void {
    const row = selectedFleetShip();
    const visible = windToolOn && mode === "ship" && !!row;
    toolWindMarker.hidden = !visible;
    if (!visible) return;
    const speed = Math.round(settings.weather.windStrengthKnots);
    toolWindMarker.style.left = `${app.screen.width / 2}px`;
    toolWindMarker.style.top = `${app.screen.height / 2}px`;
    toolWindArrow.style.transform = `rotate(${(windFrom + 180) % 360}deg)`;
    toolWindText.textContent = `${compassPoint(windFrom)} · ${speed} kn`;
  }

  function toggleWindTool(): void {
    windToolOn = !windToolOn;
    toolWind.setAttribute("aria-pressed", String(windToolOn));
    updateToolWindMarker();
  }

  function toggleRangeCheck(): void {
    rangeCheckOn = !rangeCheckOn;
    toolRange.setAttribute("aria-pressed", String(rangeCheckOn));
    drawCombatRange();
    showNotice(rangeCheckOn
      ? "Range check: sight, cannon range and hit-chance bands."
      : "Range check off.");
  }

  function openScaleTool(): void {
    toggleToolsSheet(false);
    openSailorsLog("chart");
    armLogRuler();
  }

  function renderFormationsSheet(): void {
    const fleet = fleetById(selectedFleetId);
    formationsChoices.replaceChildren();
    if (!fleet) {
      formationsDetail.textContent = "Select a fleet first. A ship without a fleet cannot take a formation.";
      for (const option of FORMATION_OPTIONS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = `${option.icon} ${option.label}`;
        button.disabled = true;
        button.title = "Select a fleet first";
        formationsChoices.append(button);
      }
      return;
    }
    formationsDetail.textContent = `${fleet.name} · ${fleet.members.length} ships · leader ${shipById(fleet.leaderId)?.name ?? "unknown"}`;
    for (const option of FORMATION_OPTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = `${option.icon} ${option.label}`;
      button.setAttribute("aria-pressed", String(fleet.formation === option.id));
      button.addEventListener("click", () => {
        sendCommand({ t: "fleetUpdate", fleet: fleet.id, formation: option.id });
        formationPreview = { fleetId: fleet.id, formation: option.id, until: performance.now() + 3_000 };
        renderFormationsSheet();
      });
      formationsChoices.append(button);
    }
  }

  function toggleFormationsSheet(): void {
    const open = formationsSheet.hidden;
    formationsSheet.hidden = !open;
    formationsButton.setAttribute("aria-expanded", String(open));
    if (open) renderFormationsSheet();
  }

  formationsButton.addEventListener("click", toggleFormationsSheet);
  formationsClose.addEventListener("click", () => {
    formationsSheet.hidden = true;
    formationsButton.setAttribute("aria-expanded", "false");
  });
  sailorsLogButton.addEventListener("click", () => {
    if (sailorsLogOpen) closeSailorsLog();
    else openSailorsLog("chart");
  });
  toolsButton.addEventListener("click", () => toggleToolsSheet());
  toolsClose.addEventListener("click", () => toggleToolsSheet(false));
  toolHeading.addEventListener("click", () => {
    toggleToolsSheet(false);
    openHeading(null);
  });
  toolWind.addEventListener("click", toggleWindTool);
  toolRange.addEventListener("click", toggleRangeCheck);
  toolScale.addEventListener("click", openScaleTool);
  testMoonSet.addEventListener("click", () => {
    const phase = Number(testMoonPhase.value);
    sendCommand({ t: "testMoonPhase", phase });
    showNotice(`Moon phase set to ${testMoonPhase.selectedOptions[0]?.textContent ?? "phase"}.`);
  });
  stanceButton.addEventListener("click", () => {
    if (stanceSheetPanel.hidden) openStanceSheet();
    else closeStanceSheet();
    stanceButton.setAttribute("aria-expanded", String(!stanceSheetPanel.hidden));
  });
  stanceClose.addEventListener("click", () => {
    closeStanceSheet();
    stanceButton.setAttribute("aria-expanded", "false");
  });
  lightsSwitch.addEventListener("change", () => {
    const row = stanceSubjectShip();
    if (!row) return;
    sendCommand({ t: "lights", ship: row.id, on: lightsSwitch.checked });
    showNotice(lightsSwitch.checked ? "Lights on." : "Lights off.");
    renderStanceSheet();
  });

  routeForm.addEventListener("submit", (event) => event.preventDefault());
  routeNew.addEventListener("click", () => openRouteForm());
  routeEditCancel.addEventListener("click", closeRouteForm);
  routeFast.addEventListener("click", () => sendCommand({ t: "routeFast" }));
  routePayNow.addEventListener("click", () => sendCommand({ t: "portIncomeNow" }));
  testRouteFast.addEventListener("click", () => sendCommand({ t: "routeFast" }));
  testPortIncome.addEventListener("click", () => sendCommand({ t: "portIncomeNow" }));
  testKeepalive.addEventListener("click", () => {
    if (!accountUi) {
      testKeepaliveResult.textContent = "Accounts are not configured.";
      return;
    }
    testKeepalive.disabled = true;
    testKeepaliveResult.textContent = "Running keepalive…";
    void accountUi.afterDeveloperKeepalive()
      .then((result) => {
        testKeepaliveResult.textContent = result.text;
        testKeepalive.disabled = false;
      })
      .catch(() => {
        testKeepaliveResult.textContent = "Keepalive could not run.";
        testKeepalive.disabled = false;
      });
  });
  routePickA.addEventListener("click", () => {
    routePick = routePick === "a" ? null : "a";
    routePickA.setAttribute("aria-pressed", String(routePick === "a"));
    routePickB.setAttribute("aria-pressed", "false");
    logPickHint.hidden = routePick === null;
    if (routePick) logPickHint.textContent = "New route: tap port A on the chart.";
  });
  routePickB.addEventListener("click", () => {
    routePick = routePick === "b" ? null : "b";
    routePickB.setAttribute("aria-pressed", String(routePick === "b"));
    routePickA.setAttribute("aria-pressed", "false");
    logPickHint.hidden = routePick === null;
    if (routePick) logPickHint.textContent = "New route: tap port B on the chart.";
  });
  for (const control of [routeShip, routePortA, routePortB, routeGood, routeTonnes]) {
    control.addEventListener("input", updateRouteEstimate);
  }
  routeSave.addEventListener("click", () => {
    if (!routeShip.value || !routePortA.value || !routePortB.value) {
      showNotice("Pick a trade ship and two ports.");
      return;
    }
    const sent = sendCommand({
      t: editingRouteId ? "routeEdit" : "routeNew",
      route: editingRouteId ?? undefined,
      ship: routeShip.value,
      portA: routePortA.value,
      portB: routePortB.value,
      good: routeGood.value,
      tonnes: Number(routeTonnes.value),
      minutes: Number(routeMinutes.value),
    });
    if (sent) closeRouteForm();
  });
  menuButton.addEventListener("click", () => {
    menuPanel.hidden = !menuPanel.hidden;
    menuButton.setAttribute("aria-expanded", String(!menuPanel.hidden));
    if (!menuPanel.hidden) closeTestTools();
    scheduleScreenLayout();
  });
  menuClose.addEventListener("click", () => {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    scheduleScreenLayout();
  });
  accountMenuButton.addEventListener("click", () => {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    accountUi?.open();
    scheduleScreenLayout();
  });
  accountClose.addEventListener("click", () => {
    accountUi?.close();
    scheduleScreenLayout();
  });
  function showMenuPanel(): void {
    menuPanel.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    testTools.hidden = true;
    scheduleScreenLayout();
  }
  dockMenuButton.addEventListener("click", showMenuPanel);
  researchButton.addEventListener("click", () => {
    closeMenuPanel();
    hydrateLogHosts();
    openSailorsLog("research");
  });
  researchClose.addEventListener("click", () => {
    researchPanel.hidden = true;
    if (sailorsLogOpen) closeSailorsLog();
    activeDockPanel = "ship";
    scheduleScreenLayout();
  });
  ordersButton.addEventListener("click", () => {
    ordersOpen = false;
    ordersSheet.hidden = true;
    openOrdersList();
  });
  ordersListBtn.addEventListener("click", openOrdersList);
  armedOrderCancel.addEventListener("click", cancelArmedOrder);
  backToShipBtn.addEventListener("click", () => {
    const row = selectedFleetShip();
    if (!row) {
      showNotice("Select one of your ships first.");
      return;
    }
    if (mode === "chart") setMode("ship");
    view.x = row.x;
    view.y = row.y;
    setFollow(true);
    refreshMap(performance.now(), true);
  });
  controlsHelpBtn.addEventListener("click", () => {
    controlsHelp.hidden = !controlsHelp.hidden;
    controlsHelpBtn.setAttribute("aria-expanded", String(!controlsHelp.hidden));
  });
  controlsHintNext.addEventListener("click", () => {
    controlsHintStage = Math.min(CONTROL_HINTS.length - 1, controlsHintStage + 1);
    showControlHint();
  });
  controlsHintClose.addEventListener("click", dismissControlHints);
  attackNearestBtn.addEventListener("click", () => {
    const enemy = nearestEnemyShip();
    if (!enemy) {
      showNotice("No enemy in sight.");
      return;
    }
    runControlOrder(controlOrderById("attackSink"), { targetId: enemy.id });
  });
  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === "Tab") {
      event.preventDefault();
      const ids = fleetShips.filter((ship) => ship.status !== "delivery").map((ship) => ship.id);
      if (ids.length > 0) {
        const current = ids.indexOf(selectedShipId);
        const next = ids[(current + 1 + ids.length) % ids.length]!;
        updateSelectedShip(next, true);
      }
      return;
    }
    if (event.key === "Escape") {
      if (armedOrder) cancelArmedOrder();
      else if (!stanceSheetPanel.hidden) closeStanceSheet();
      else closeOrderMenu();
      return;
    }
    if (event.key === "h" || event.key === "H") {
      runControlOrder(controlOrderById("hold"), {});
    } else if (event.key === "a" || event.key === "A") {
      const enemy = nearestEnemyShip();
      if (enemy) runControlOrder(controlOrderById("attackSink"), { targetId: enemy.id });
    } else if (event.key === "f" || event.key === "F") {
      if (selectedFleetId) selectWholeFleet(selectedFleetId);
    } else if (event.key === "?") {
      controlsHelp.hidden = false;
      controlsHelpBtn.setAttribute("aria-expanded", "true");
      showMenuPanel();
    } else if (event.key === "+" || event.key === "=") {
      zoomTo(view.kmAcross / 1.2);
    } else if (event.key === "-") {
      zoomTo(view.kmAcross * 1.2);
    } else if (/^[1-9]$/.test(event.key)) {
      selectControlGroup(Number(event.key));
    }
  });
  queueButton.addEventListener("click", () => {
    if (!selectedFleetId) {
      showNotice("Select a fleet before queueing orders.");
      return;
    }
    fleetQueue.click();
    queueButton.classList.toggle("is-active", queueOrders);
    queueButton.setAttribute("aria-pressed", String(queueOrders));
  });
  function showDockPanel(panel: LayoutPanelId): void {
    activeDockPanel = panel;
    closePortPanel();
    closeFleetPanel();
    closeDamagePanel();
    closeTradePanel();
    closeShipyardPanel();
    closeHirePanel();
    knownPortsPanel.hidden = true;
    battleLog.hidden = true;
    researchPanel.hidden = true;
    if (panel === "fleet") openFleetPanel();
    if (panel === "log") battleLog.hidden = false;
    if (panel === "ports" || panel === "knownPorts") {
      renderKnownPorts();
      knownPortsPanel.hidden = false;
    }
    if (panel === "research") {
      renderResearchPanel(true);
      researchPanel.hidden = false;
    }
    scheduleScreenLayout();
  }
  dockTabShip.addEventListener("click", () => showDockPanel("ship"));
  dockTabFleet.addEventListener("click", () => showDockPanel("fleet"));
  dockTabLog.addEventListener("click", () => showDockPanel("log"));
  dockTabPorts.addEventListener("click", () => showDockPanel("ports"));
  dockTabResearch.addEventListener("click", () => {
    hydrateLogHosts();
    openSailorsLog("research");
  });
  dockCollapseButton.addEventListener("click", () => {
    dockCollapsed = !dockCollapsed;
    scheduleScreenLayout();
  });
  battleLogButton.addEventListener("click", () => {
    battleLogButton.setAttribute("aria-expanded", String(battleLog.hidden));
    if (isPhoneLayout()) {
      battleLog.hidden = !battleLog.hidden;
      scheduleScreenLayout();
      return;
    }
    showDockPanel("log");
  });
  targetCardClose.addEventListener("click", () => {
    selectedEnemyId = null;
    activeDockPanel = "ship";
    renderBattleBar();
    scheduleScreenLayout();
  });
  developerButton.addEventListener("click", () => testToolsButton.click());
  resignButton.addEventListener("click", openResignSheet);
  resignCancel.addEventListener("click", closeResignSheet);
  resignConfirm.addEventListener("click", sendResign);
  eliminatedClose.addEventListener("click", () => {
    eliminatedClosed = true;
    eliminatedScreen.hidden = true;
  });
  victoryClose.addEventListener("click", () => {
    victoryClosed = true;
    victoryScreen.hidden = true;
  });
  victoryReset.addEventListener("click", () => {
    if (latestRoomKind === "normal") return;
    sendCommand({ t: "resetRoom" });
    victoryClosed = true;
    victoryScreen.hidden = true;
  });

  function closeTestTools(): void {
    testTools.hidden = true;
    refreshNoteFab();
    scheduleScreenLayout();
  }

  function refreshTestInvite(): void {
    const ownClass = fleetShips[0]?.classId ?? requestedShip ?? "frigate";
    testInviteLink.value = inviteSecondDeviceLink(location.href, {
      room,
      navy: otherNavy(playerNavy),
      startPort: startPortName || null,
      shipClass: ownClass,
    });
  }

  if (perfVisible) {
    setPerfVisible(true);
  }
  testToolsButton.addEventListener("click", () => {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    closePortPanel();
    closeFleetPanel();
    closeDamagePanel();
    closeTestTools();
    testTools.hidden = false;
    refreshNoteFab();
    refreshTestInvite();
    scheduleScreenLayout();
  });
  testToolsClose.addEventListener("click", closeTestTools);
  perfToggle.addEventListener("click", () => setPerfVisible(!perfVisible));
  effectGalleryButton.addEventListener("click", () => {
    effectGalleryOn = !effectGalleryOn;
    effectGalleryStartedAt = performance.now();
    effectGalleryButton.setAttribute("aria-pressed", String(effectGalleryOn));
    effectGalleryButton.textContent = effectGalleryOn ? "Stop effect gallery" : "Effect gallery";
    if (!effectGalleryOn) {
      galleryLayer.visible = false;
      galleryInk.clear();
    }
  });
  debugLogToggle.addEventListener("click", () => {
    debugLogOpen = !debugLogOpen;
    debugLogLines.hidden = !debugLogOpen;
    debugLogToggle.setAttribute("aria-expanded", String(debugLogOpen));
    debugLogToggle.textContent = debugLogOpen ? "Hide debug log" : "Debug log";
    renderDebugLog();
  });
  testAnchoredFleet.addEventListener("click", () => {
    sendCommand({
      t: "testAnchoredFleet",
      stance: testAnchoredStance.value === "engage" ? "engage" : "fightIfAttacked",
    });
  });
  testTimeSet.addEventListener("click", () => {
    const hour = Math.max(0, Math.min(23, Math.floor(Number(testTimeHour.value))));
    if (!Number.isFinite(hour)) return;
    sendCommand({ t: "testTimeOfDay", hour });
  });
  testSpawn.addEventListener("click", () => {
    const classId = testEnemyClass.value;
    const navy = parseNavy(testEnemyNavy.value);
    const count = Number(testEnemyCount.value);
    const dummy = parseDummyBehaviour(testDummyBehaviour.value);
    if (!navy || !dummy || !Number.isInteger(count) || count < 1 || count > 6) {
      showNotice("Choose a navy, type, count from 1 to 6 and a behaviour.");
      return;
    }
    sendCommand({ t: "spawnEnemies", type: classId, name: navy, count, mode: dummy });
  });
  testRemove.addEventListener("click", () => {
    sendCommand({ t: "removeEnemies" });
    showNotice("Dummy ships removed.");
  });
  testRefill.addEventListener("click", () => {
    sendCommand({ t: "refillShips" });
    showNotice("Refilling and repairing your ships.");
  });
  testSinkFlagship.addEventListener("click", () => {
    sendCommand({ t: "sinkFlagship" });
    showNotice("Sinking your flagship.");
  });
  testSpareShips.addEventListener("click", () => {
    sendCommand({ t: "spareShips" });
    showNotice("Three spare ships requested.");
  });
  testSetWind.addEventListener("click", () => {
    const deg = Number(testWindFrom.value);
    const knots = Number(testWindSpeed.value);
    if (!Number.isFinite(deg) || !Number.isFinite(knots)) {
      showNotice("Type a wind direction and speed.");
      return;
    }
    sendCommand({ t: "testWind", deg, knots });
    showNotice(`Wind set to ${((deg % 360) + 360) % 360}° at ${knots} knots.`);
  });
  function layoutModeName(): string {
    return isPhoneLayout() ? "phone" : "desktop";
  }

  function sessionReportMeta(): Record<string, unknown> {
    return {
      build: pageBuildId || buildCommit || "unknown",
      layout: layoutModeName(),
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      zoom: view.kmAcross,
    };
  }

  function copyPlainText(text: string): void {
    const done = (): void => showNotice("Copied.");
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(done).catch(() => {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        done();
      });
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    done();
  }

  testReportButton.addEventListener("click", () => {
    if (!sendCommand({ t: "sessionReport", ...sessionReportMeta() })) return;
    testReportText.textContent = "Building the report…";
    testReportText.hidden = false;
  });
  testReportCopy.addEventListener("click", () => {
    if (testReportText.textContent) copyPlainText(testReportText.textContent);
  });
  testReportDownload.addEventListener("click", () => {
    const text = testReportText.textContent ?? "";
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `armadas-session-${pageBuildId || "report"}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  testClearRecorder.addEventListener("click", () => {
    sendCommand({ t: "clearRecorder" });
    testReportText.textContent = "";
    testReportText.hidden = true;
    testReportCopy.disabled = true;
    testReportDownload.disabled = true;
    showNotice("Recorder cleared.");
  });
  function refreshNoteFab(): void {
    noteFab.hidden = !testNoteToggle.checked || !noteSheet.hidden || !testTools.hidden;
  }
  function openNoteSheet(): void {
    noteSheet.hidden = false;
    noteFab.hidden = true;
    noteText.value = "";
    window.setTimeout(() => noteText.focus(), 0);
    scheduleScreenLayout();
  }
  function closeNoteSheet(): void {
    noteSheet.hidden = true;
    refreshNoteFab();
    scheduleScreenLayout();
  }
  testNoteButton.addEventListener("click", openNoteSheet);
  noteFab.addEventListener("click", openNoteSheet);
  noteCancel.addEventListener("click", closeNoteSheet);
  noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = noteText.value.trim();
    if (!text) return;
    if (!sendCommand({
      t: "sessionNote",
      text,
      zoom: view.kmAcross,
      layout: layoutModeName(),
    })) return;
    noteText.value = "";
    closeNoteSheet();
    showNotice("Note recorded.");
  });
  testNoteToggle.addEventListener("change", refreshNoteFab);
  refreshNoteFab();

  let activeScenario: ScenarioDefinition | null = null;
  let lastScenarioStatus: ScenarioStatus | null = null;
  let ratingPending = false;

  function scenarioDefinition(id: string): ScenarioDefinition | null {
    return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
  }

  function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.round(ms / 100) / 10);
    if (total < 60) return `${total.toFixed(1)}s`;
    return `${Math.floor(total / 60)}m ${(total % 60).toFixed(0)}s`;
  }

  function renderScenario(status: ScenarioStatus | null): void {
    lastScenarioStatus = status;
    if (!status) {
      scenarioScoreboard.hidden = true;
      return;
    }
    activeScenario = scenarioDefinition(status.id);
    scenarioName.textContent = `${status.name} — seed ${status.seed}`;
    scenarioElapsed.textContent = formatElapsed(status.elapsedRealMs);
    scenarioMyLosses.textContent = String(status.myLosses);
    scenarioTheirLosses.textContent = String(status.theirLosses);
    scenarioOutcome.textContent = status.outcome;
    scenarioScoreboard.hidden = false;
    scenarioEnd.textContent = status.ended ? "Ended — rate it" : "End scenario";
    scenarioEnd.disabled = status.ended;
    if (status.ended && ratingPending) {
      ratingPending = false;
      openScenarioRating(status);
    }
  }

  function openScenarioRating(status: ScenarioStatus): void {
    scenarioRatingResult.textContent =
      `${status.name}: ${status.outcome}, ${formatElapsed(status.elapsedRealMs)}, ` +
      `my losses ${status.myLosses}, their losses ${status.theirLosses}.`;
    scenarioRatingNote.value = "";
    scenarioRating.hidden = false;
    scheduleScreenLayout();
  }

  function closeScenarioRating(): void {
    scenarioRating.hidden = true;
    scheduleScreenLayout();
  }

  function startScenario(definition: ScenarioDefinition): void {
    if (!sendCommand({ t: "scenario", scenario: definition.id })) return;
    activeScenario = definition;
    ratingPending = false;
    scenarioScoreboard.hidden = false;
    scenarioName.textContent = `${definition.name} — building…`;
    scenarioElapsed.textContent = "0.0s";
    scenarioMyLosses.textContent = "0";
    scenarioTheirLosses.textContent = "0";
    scenarioOutcome.textContent = "ongoing";
    scenarioEnd.disabled = false;
    scenarioEnd.textContent = "End scenario";
    if (definition.performance) setPerfVisible(true);
    if (definition.twoPlayer) {
      refreshTestInvite();
      showNotice("Scenario 17: copy the invite link for the second device.");
    }
  }

  for (const definition of SCENARIOS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = definition.name;
    button.title = definition.summary;
    button.dataset.scenario = definition.id;
    button.addEventListener("click", () => startScenario(definition));
    scenarioList.appendChild(button);
  }
  scenarioEnd.addEventListener("click", () => {
    if (!lastScenarioStatus || lastScenarioStatus.ended) return;
    ratingPending = true;
    sendCommand({ t: "endScenario" });
  });
  scenarioRatingCancel.addEventListener("click", closeScenarioRating);
  for (const button of scenarioRating.querySelectorAll<HTMLButtonElement>("[data-rating]")) {
    button.addEventListener("click", () => {
      const rating = button.dataset.rating;
      if (!rating) return;
      sendCommand({
        t: "scenarioRating",
        rating,
        note: scenarioRatingNote.value,
      });
      closeScenarioRating();
      showNotice(`Scenario rated ${rating}.`);
    });
  }

  testResetRoom.addEventListener("click", () => {
    sendCommand({ t: "resetRoom" });
    showNotice("Reset room requested.");
  });
  testCopyLink.addEventListener("click", () => {
    refreshTestInvite();
    const text = testInviteLink.value;
    const copied = (): void => showNotice("Invite link copied.");
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(copied).catch(() => {
        testInviteLink.select();
        document.execCommand("copy");
        copied();
      });
    } else {
      testInviteLink.select();
      document.execCommand("copy");
      copied();
    }
  });

  let shipExpanded = false;
  function setShipExpanded(expanded: boolean): void {
    shipExpanded = expanded;
    shipPanel.classList.toggle("is-expanded", expanded);
    shipPanel.classList.toggle("is-collapsed", !expanded);
    shipExpand.setAttribute("aria-expanded", String(expanded));
    scheduleScreenLayout();
  }
  setShipExpanded(false);
  shipExpand.addEventListener("click", () => setShipExpanded(!shipExpanded));
  setShipExpanded(false);

  knownPortsButton.addEventListener("click", () => {
    // 3K-c: the old floating port list now lives in the Sailor's Log chart.
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    closePortPanel();
    closeFleetPanel();
    closeShipyardPanel();
    closeHirePanel();
    openLogFromKnownPorts();
  });

  for (const button of tradePanel.querySelectorAll<HTMLButtonElement>(
    "[data-trade-tab]",
  )) {
    button.addEventListener("click", () => {
      const tab = button.dataset.tradeTab;
      if (tab !== "buy" && tab !== "sell" && tab !== "storage") return;
      tradeTab = tab;
      renderTradePanel(true);
    });
  }
  tradeClose.addEventListener("click", closeTradePanel);
  tradeResupply.addEventListener("click", () => {
    if (!tradePortId || !tradeShipId) return;
    sendCommand({
      t: "resupply",
      ship: tradeShipId,
      port: tradePortId,
    });
  });

  fleetButton.addEventListener("click", () => {
    if (fleetPanel.hidden) openFleetPanel();
    else closeFleetPanel();
  });
  fleetClose.addEventListener("click", closeFleetPanel);
  fleetCreate.addEventListener("click", () => {
    const ids = groupShipIds().slice(0, settings.fleets.maxShipsPerFleet);
    if (ids.length === 0) {
      showNotice("Select ships before creating a fleet.");
      return;
    }
    sendCommand({ t: "createFleet", ships: ids });
    showNotice("Fleet created.");
  });
  fleetQueue.addEventListener("click", () => {
    queueOrders = !queueOrders;
    updateQueueButton();
  });
  fleetSaveGroup.addEventListener("click", () => {
    let slot = 0;
    for (let candidate = 1; candidate <= 9; candidate += 1) {
      if (!controlGroups[candidate] || controlGroups[candidate]!.length === 0) {
        slot = candidate;
        break;
      }
    }
    if (slot === 0) {
      showNotice("All nine control groups are in use.");
      return;
    }
    saveControlGroup(slot);
  });
  orderMenuClose.addEventListener("click", closeOrderMenu);
  headingClose.addEventListener("click", closeHeadingSheet);
  headingCancel.addEventListener("click", closeHeadingSheet);
  headingConfirm.addEventListener("click", confirmHeading);
  headingDegrees.addEventListener("input", () => {
    const value = headingValues().heading;
    headingDial.value = String(value);
    drawHeadingPreview();
  });
  headingDial.addEventListener("input", () => {
    headingDegrees.value = headingDial.value;
    drawHeadingPreview();
  });
  headingDistance.addEventListener("input", drawHeadingPreview);
  updateQueueButton();
  portClose.addEventListener("click", closePortPanel);
  knownPortsClose.addEventListener("click", () => {
    knownPortsPanel.hidden = true;
  });
  portSail.addEventListener("click", () => {
    if (selectedPortId) sendPortOrder(selectedPortId);
  });
  portAttackButton.addEventListener("click", () => {
    if (selectedPortId) sendPortAttack(selectedPortId);
  });
  portBuildButton.addEventListener("click", () => {
    if (selectedPortId) sendCommand({ t: "buildFortification", port: selectedPortId });
  });
  portUndock.addEventListener("click", sendUndock);
  portTrade.addEventListener("click", () => {
    if (selectedPortId) openTradePanel(selectedPortId);
  });
  portShipyard.addEventListener("click", () => {
    if (selectedPortId) openShipyard(selectedPortId);
  });
  portHire.addEventListener("click", () => {
    if (selectedPortId) openHirePanel(selectedPortId);
  });
  shipyardClose.addEventListener("click", closeShipyardPanel);
  hireClose.addEventListener("click", closeHirePanel);
  namingRandom.addEventListener("click", () => {
    namingName.value = suggestShipName(playerNavy);
    namingError.hidden = true;
    namingName.focus();
  });
  namingCancel.addEventListener("click", () => {
    namingClass = null;
    namingStep.hidden = true;
  });
  namingConfirm.addEventListener("click", confirmPurchase);
  namingName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmPurchase();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (sailorsLogOpen) {
      closeSailorsLog();
      return;
    }
    if (!toolsSheet.hidden) {
      toggleToolsSheet(false);
      return;
    }
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    closePortPanel();
    closeTradePanel();
    knownPortsPanel.hidden = true;
    closeFleetPanel();
    closeShipyardPanel();
    closeHirePanel();
    closeOrderMenu();
    closeHeadingSheet();
  });

  versionNotice.addEventListener("click", () => location.reload());
  notice.addEventListener("click", () => {
    if (notice.dataset.reload === "true") {
      location.reload();
      return;
    }
    if (notice.dataset.sunk === "true" && lastSunkAt) {
      view.x = lastSunkAt.x;
      view.y = lastSunkAt.y;
      setFollow(false);
      refreshMap(performance.now(), true);
      notice.dataset.sunk = "false";
    }
  });
  notice.addEventListener("keydown", (event) => {
    if (
      notice.dataset.reload === "true" &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      location.reload();
    }
  });

  // Pixi restores its GL resources itself; this handler asks the browser to
  // keep the canvas alive and rebuilds our textures and graphics from state.
  app.canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    const result = graphicsRecovery.lost(performance.now());
    showNotice(result.message, { persistent: result.reload, reload: result.reload });
  });
  app.canvas.addEventListener("webglcontextrestored", () => {
    graphicsRecovery.restored();
    graphicsResets = graphicsRecovery.resetCount;
    rebuildAfterGraphicsReset();
    if (!graphicsRecovery.reloadRequired) showNotice(GRAPHICS_RESET_NOTICE);
  });

  // ---- Frame loop ---------------------------------------------------------

  app.ticker.add(() => {
    const now = performance.now();
    frameCount += 1;
    const fpsElapsed = now - fpsWindowAt;
    if (fpsElapsed >= 1_000) {
      fps = (frameCount * 1_000) / fpsElapsed;
      frameCount = 0;
      fpsWindowAt = now;
    }

    if (app.screen.width !== lastWidth || app.screen.height !== lastHeight) {
      lastWidth = app.screen.width;
      lastHeight = app.screen.height;
      drawGrain();
      refreshMap(now, true);
    }

    const frameGap = lastFrameAt === 0 ? 0 : now - lastFrameAt;
    lastFrameAt = now;
    if (frameGap > 0) {
      frameDurations.push({ at: now, ms: frameGap });
      while (frameDurations.length > 0 && frameDurations[0]!.at < now - 5_000) frameDurations.shift();
      const sampled = qualityPreference === "auto"
        ? qualityGovernor.sample(Math.min(frameGap, 250), now)
        : qualityLevelForPreference(qualityPreference, qualityLevel);
      if (sampled !== qualityLevel) applyQuality(sampled);
    }
    flushPendingState();
    updateClockAndNight(now);
    const own = selectedShipView();
    const renderAtSeconds = (now - settings.client.renderDelayMs) / 1_000;

    // Follow the same interpolated position the hull uses, so the camera and
    // selection ring never disagree or fight each other.
    if (own && mode === "ship") {
      const ownMotion = own.motion.sample(renderAtSeconds);
      if (ownMotion) {
        view.x = ownMotion.x;
        view.y = ownMotion.y;
      }
    }

    const flagScale = clamp(8 / Math.max(1, view.kmAcross), 0.65, 1.6);
    shipFxInk.clear();
    for (const ship of ships.values()) {
      safeLayer(`ship ${ship.id}`, () => {
        const motion = ship.motion.sample(renderAtSeconds);
        if (motion) {
          ship.x = motion.x;
          ship.y = motion.y;
          ship.heading = motion.heading;
        }

        const screen = toScreen(ship.x, ship.y);
        const lastDrawn = lastDrawnPositions.get(ship.id);
        if (lastDrawn && mode === "ship") {
          const stepPx = Math.hypot(screen.x - lastDrawn.x, screen.y - lastDrawn.y);
          const prior = drawnSteps[drawnSteps.length - 1];
          if (ship.id === ownId) {
            drawnSteps.push({ at: now, own: stepPx, otherMax: prior?.at === now ? prior.otherMax : 0 });
          } else if (prior?.at === now) {
            prior.otherMax = Math.max(prior.otherMax, stepPx);
          } else if (stepPx > 0.01) {
            drawnSteps.push({ at: now, own: 0, otherMax: stepPx });
          }
        }
        lastDrawnPositions.set(ship.id, { x: screen.x, y: screen.y });
        ship.hull.position.set(screen.x, screen.y);
        ship.hull.rotation = ship.heading;
        ship.ring.position.set(screen.x, screen.y);
        ship.hull.visible =
          screen.x > -90 && screen.x < app.screen.width + 90 &&
          screen.y > -90 && screen.y < app.screen.height + 90;
        ship.ring.visible = ship.own && ship.hull.visible;
        ship.flag.position.set(screen.x, screen.y);
        ship.flag.rotation = ship.heading;
        ship.flag.scale.set(flagScale);
        ship.flag.visible = whiteFlagVisible(ship.hull.visible, ship.surrendered);
        ship.flagshipInk.position.set(screen.x, screen.y);
        ship.flagshipInk.rotation = ship.heading;
        ship.flagshipInk.scale.set(flagScale * settings.flagshipMarker.pennantScale);
        ship.flagshipInk.visible = flagshipPennantVisible(
          ship.own,
          ship.isFlagship,
          showFlagshipPennant,
        ) && ship.hull.visible;
        ship.runInk.position.set(screen.x, screen.y);
        ship.runInk.rotation = ship.heading;
        ship.runInk.visible = ship.running && ship.hull.visible;
        ship.runLabel.position.set(screen.x + 10, screen.y - 20);
        ship.runLabel.visible = ship.running && ship.hull.visible;

        // 3D status layers are pooled graphics. Rebuild the ink only when the
        // flags or zoom bucket change, not on every animation frame.
        const abandonedSize = abandonedMarkerSize(view.kmAcross);
        const statusKey = `${ship.classId}|${ship.abandoned}|${ship.sinking}|${ship.lantern}|${abandonedSize}`;
        if (statusKey !== ship.statusKey) {
          ship.statusKey = statusKey;
          ship.statusInk.clear();
          if (ship.abandoned) {
            ship.statusInk
              .moveTo(-2, 8).lineTo(-2, -abandonedSize)
              .moveTo(-2, -abandonedSize + 4).lineTo(8, -abandonedSize + 8)
              .stroke({ width: 1.6, color: 0x3b3024, alpha: 0.9 });
          }
          if (ship.classId === "fireShip") {
            ship.statusInk.circle(0, 0, 3.2).fill({ color: 0x2d2a28, alpha: 0.95 });
          }
          if (ship.lantern) {
            ship.statusInk.circle(0, 0, 9).fill({ color: 0xffd27a, alpha: 0.12 });
            ship.statusInk.circle(0, 0, 2).fill({ color: 0xffe6a8, alpha: 0.7 });
          }
        }
        ship.statusInk.position.set(screen.x, screen.y);
        ship.statusLabel.visible = false;
        ship.hull.alpha = ship.sinking ? 0.5 : 1;
        if (ship.abandoned) {
          ship.statusLabel.position.set(screen.x - 18, screen.y + 12);
          ship.statusLabel.text = "Abandoned";
          ship.statusLabel.visible = ship.hull.visible;
        }
        if (ship.sinking) {
          ship.statusLabel.position.set(screen.x - 15, screen.y + 12);
          ship.statusLabel.text = "Sinking";
          ship.statusLabel.visible = ship.hull.visible;
        }
        ship.statusInk.visible = ship.hull.visible && (
          ship.abandoned || ship.classId === "fireShip" || ship.lantern
        );
        safeLayer(`ship effects ${ship.id}`, () => drawShipEffects(ship, screen, now));
      });
    }

    while (drawnSteps.length > 1_200) drawnSteps.shift();
    safeLayer("fleet groups", drawFleetGroups);
    const drawnShips = [...ships.values()].filter(
      (ship) => ship.hull.visible && ship.hull.parent === fleetLayer,
    );
    const drawnMine = drawnShips.filter((ship) => ship.own).length;
    const drawnText = `Ships drawn: ${drawnShips.length} (my ships ${drawnMine}, other ships ${drawnShips.length - drawnMine})`;
    if (drawnText !== lastShipsDrawnText) {
      lastShipsDrawnText = drawnText;
      testShipsDrawn.textContent = drawnText;
    }

    if (socket?.readyState === WebSocket.OPEN) {
      if (now - lastPingSentAt >= settings.network.pingIntervalSeconds * 1000) {
        lastPingSentAt = now;
        pingAt = Date.now();
        socket.send(JSON.stringify({ t: "ping", at: pingAt }));
      }
      if (now - lastConnectionSampleAt >= 1_000) {
        lastConnectionSampleAt = now;
        if (networkPreference === "auto") {
          const snapshotAge = lastStateReceivedAt === 0 ? 0 : performance.now() - lastStateReceivedAt;
          const sampled = dataSaverGovernor.update(Date.now(), { pingMs, snapshotAgeMs: snapshotAge });
          if (sampled.changed) syncNetworkMode(true);
          else syncNetworkMode();
        } else {
          syncNetworkMode();
        }
      }
      if (now - lastFocusSentAt >= settings.network.pingIntervalSeconds * 1000) {
        lastFocusSentAt = now;
        socket.send(JSON.stringify({ t: "focus", x: view.x, y: view.y }));
      }
    }
    if (perfVisible && now - lastPerfRenderAt >= 500) {
      lastPerfRenderAt = now;
      updatePerfPanel(now);
    }

    safeLayer("discovered outline", () => refreshDiscoveredOutline(now));
    safeLayer("chart", () => refreshMap(now));
    safeLayer("fog paper", () => refreshFogPaper());
    safeLayer("live sight", () => updateLiveCircles());
    safeLayer("chart offset", () => updateLayerOffset());
    safeLayer("ports", () => refreshPorts());
    safeLayer("selected route", () => drawSelectedRoute());
    safeLayer("trails", () => drawTrails());
    safeLayer("combat range", () => drawCombatRange());
    safeLayer("combat effects", () => drawCombatFx(now));
    safeLayer("effect gallery", () => drawEffectGallery(now));

    for (let index = 0; index < lastSeenViews.length; index += 1) {
      const markerView = lastSeenViews[index];
      const seen = lastSeen[index];
      if (!markerView || !seen) continue;
      const screen = toScreen(seen[2], seen[3]);
      markerView.position.set(screen.x, screen.y);
      markerView.visible =
        screen.x > -60 && screen.x < app.screen.width + 60 &&
        screen.y > -60 && screen.y < app.screen.height + 60;
    }

    if (target && marker.visible) {
      const screen = toScreen(target.x, target.y);
      marker.position.set(screen.x, screen.y);
    }

    // Wind streaks blow towards the direction the wind is going to.
    safeLayer("wind", () => {
    windLayer.clear();
    if (!quality.wind) return;
    const angle = ((windFrom + 180) * Math.PI) / 180;
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const width = app.screen.width;
    const height = app.screen.height;
    const maxLength = settings.view.windStreakMaxPx;
    const span = width + height + maxLength * 2;
    for (let index = 0; index < settings.view.windStreakCount; index += 1) {
      const length =
        settings.view.windStreakMinPx +
        ((index * 37) % Math.max(1, maxLength - settings.view.windStreakMinPx));
      const travel =
        (now / 1000) * settings.view.windStreakSpeedPxPerSec +
        (index * span) / settings.view.windStreakCount;
      const baseX = (index * 97 + 17) % Math.max(1, width);
      const baseY = (index * 193 + 31) % Math.max(1, height);
      const x = ((baseX + dx * travel) % (width + maxLength)) - maxLength / 2;
      const y = ((baseY + dy * travel) % (height + maxLength)) - maxLength / 2;
      windLayer
        .moveTo(x, y)
        .lineTo(x + dx * length, y + dy * length)
        .stroke({
          width: settings.view.windStreakWidthPx,
          color: WIND_COLOR,
          alpha: settings.view.windStreakAlpha,
          cap: "round",
        });
    }
    });

    safeLayer("chart ruler", updateRuler);
    safeLayer("borders", drawBorders);
    if (now - lastLayoutApplyAt >= 150) {
      scheduleScreenLayout();
    }
    if (now - lastDebugLineAt >= 500) {
      lastDebugLineAt = now;
      updateDebugLine();
    }
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-layout]")) {
    const preference = button.dataset.layout;
    button.setAttribute("aria-pressed", String(preference === layoutPreference));
    button.addEventListener("click", () => {
      if (preference !== "auto" && preference !== "phone" && preference !== "desktop") return;
      layoutPreference = preference;
      try {
        layoutStorage?.setItem(layoutPreferenceKey, preference);
      } catch {
        // Remembering the choice is optional.
      }
      for (const option of document.querySelectorAll<HTMLButtonElement>("[data-layout]")) {
        option.setAttribute("aria-pressed", String(option.dataset.layout === layoutPreference));
      }
      dockCollapsed = false;
      scheduleScreenLayout();
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-network]")) {
    button.addEventListener("click", () => {
      const next = parseNetworkPreference(button.dataset.network);
      if (next) setNetworkPreference(next);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
    button.addEventListener("click", () => {
      const size = button.dataset.size;
      if (size === "small" || size === "medium" || size === "large") setUiSize(size);
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-quality]")) {
    button.addEventListener("click", () => {
      setQualityPreference(parseQualityPreference(button.dataset.quality));
    });
  }
  applyQuality(qualityLevelForPreference(qualityPreference, 0));

  drawGrain();
  if (identity.warning) showNotice(identity.warning);
  window.addEventListener("resize", () => {
    scheduleScreenLayout();
    scheduleLayoutAudit();
  });
  scheduleScreenLayout();
  scheduleLayoutAudit();
  showControlHint();
  // A narrow read-only surface for the real-client jsdom harness. It exposes
  // only what the player already sees and never touches server state.
  type ArmadaTestWindow = Window & {
    __armadaTest?: {
      screenForWorld: (x: number, y: number) => { x: number; y: number };
      tapWorld: (x: number, y: number) => void;
      tapScreen: (x: number, y: number) => void;
      sailTo: (x: number, y: number) => void;
      armOrder: (id: string) => void;
      lastCommand: () => Record<string, unknown>;
      drawPlan: () => Array<Record<string, unknown>>;
      selectedShipId: () => string;
      fleet: () => Array<Record<string, unknown>>;
      tick: () => number;
      gallery: () => { on: boolean; name: string; remainingSeconds: number };
      layoutAudit: () => SlotAuditIssue[];
      layoutSlots: () => Array<{ id: string; left: number; top: number; width: number; height: number }>;
      centreScreen: () => { x: number; y: number };
      selectShip: (id: string) => boolean;
      openLog: (tab: "chart" | "queued" | "fleets" | "trade") => void;
      closeLog: () => void;
      logTab: () => string;
      logGridLabels: () => string[];
      logRuler: () => { points: number; text: string };
      armLogRuler: () => void;
      queueLines: () => string[];
      logDebug: () => Record<string, unknown>;
      sightCircle: () => { km: number; px: number; scale: number };
      rangeCheck: () => boolean;
      windTool: () => boolean;
      moonPhase: () => number;
    };
  };
  (window as ArmadaTestWindow).__armadaTest = {
    screenForWorld: (x, y) => toScreen(x, y),
    tapWorld: (x, y) => {
      const screen = toScreen(x, y);
      mapTapAction(screen.x, screen.y);
    },
    tapScreen: (x, y) => mapTapAction(x, y),
    sailTo: (x, y) => sendOrder(x, y),
    armOrder: (id) => setArmedOrder(controlOrderById(id)),
    lastCommand: () => ({ ...lastCommandSent }),
    drawPlan: () => [...ships.values()].map((ship) => {
      const screen = toScreen(ship.x, ship.y);
      const fire = ship.burning
        ? fireVisualPlan({
            screenX: screen.x,
            screenY: screen.y,
            viewportPx: Math.min(app.screen.width, app.screen.height),
            kmAcross: view.kmAcross,
            strength: ship.fireStrength,
            headingRad: ship.heading,
            windFromDeg: windFrom,
            timeMs: performance.now(),
            seed: ship.id,
          })
        : null;
      return {
        id: ship.id,
        classId: ship.classId,
        x: ship.x,
        y: ship.y,
        screenX: screen.x,
        screenY: screen.y,
        heading: ship.heading,
        visible: ship.hull.visible,
        own: ship.own,
        burning: ship.burning,
        fireBand: fire?.band ?? null,
        fireShapes: fire?.shapes.length ?? 0,
        fireAlphaMax: fire ? Math.max(0, ...fire.shapes.map((shape) => shape.alpha)) : 0,
        lightsRing: lightsRingPlan(
          gameClockAt(clockShownMs).daylight < 0.25,
          !ship.lightsOff,
        ).shown,
        sinking: ship.sinking,
        abandoned: ship.abandoned,
        lantern: ship.lantern,
        glowCommands: ((ship.statusInk as unknown as {
          commands?: Array<{ kind: string }>;
        }).commands ?? []).filter((command) =>
          command.kind === "circle" || command.kind === "fill").length,
      };
    }),
    selectedShipId: () => selectedShipId,
    fleet: () => fleetShips.map((ship) => ({ ...ship })),
    tick: () => latestTick,
    gallery: () => {
      const frame = galleryFrame(performance.now() - effectGalleryStartedAt);
      return {
        on: effectGalleryOn,
        name: effectGalleryOn ? frame.effect.name : "",
        remainingSeconds: effectGalleryOn ? Math.ceil(frame.remainingMs / 1000) : 0,
      };
    },
    layoutAudit: () => runLayoutAudit(),
    layoutSlots: () => ["top-right-slot", "ship-slot", "bottom-left-slot", "wordmark"].map((id) => {
      const node = id === "ship-slot" ? shipPanel : document.getElementById(id);
      const rect = node?.getBoundingClientRect();
      return { id, left: rect?.left ?? 0, top: rect?.top ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 };
    }),
    centreScreen: () => ({ x: app.screen.width / 2, y: app.screen.height / 2 }),
    selectShip: (id) => updateSelectedShip(id, true),
    openLog: (tab) => openSailorsLog(tab),
    closeLog: closeSailorsLog,
    logTab: () => activeLogTab,
    logGridLabels: () => [...logGrid.querySelectorAll<HTMLElement>(".log-grid-label")].map((node) => node.textContent ?? ""),
    logRuler: () => ({ points: logRulerPoints.length, text: logRulerText.textContent ?? "" }),
    armLogRuler,
    queueLines: () => [...logQueueList.querySelectorAll<HTMLElement>(".log-queue-row")].map((node) => node.textContent ?? ""),
    sightCircle: () => {
      const km = selectedSightKm();
      return { km, px: km * scale(), scale: scale() };
    },
    rangeCheck: () => rangeCheckOn,
    windTool: () => windToolOn,
    moonPhase: () => sightLightNow().moon,
    logDebug: () => {
      const pane = logPaneRect();
      const s = scale();
      const halfW = app.screen.width / (2 * s);
      const halfH = app.screen.height / (2 * s);
      const box = {
        xMin: view.x - halfW,
        xMax: view.x + halfW,
        yMin: view.y - halfH,
        yMax: view.y + halfH,
      };
      return {
        mode,
        all: chartMemory.all,
        discovered: discovered.size,
        view: { ...view },
        pane,
        gridChildren: logGrid.childElementCount,
        screen: { width: app.screen.width, height: app.screen.height },
        linesAll: chartGridLines({ ...box, isDiscovered: () => true }).length,
        linesDisc: chartGridLines({ ...box, isDiscovered: logGridDiscovered }).length,
        box,
        sample: [...discovered].slice(0, 5),
        columns: chartColumns,
        rows: chartRows,
        cell: chartCellKm,
      };
    },
  };
  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message, "window error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, "unhandled promise");
  });
  // The menu waits for Create game or Join with code. A room in the address
  // opens straight away, exactly as every test and dev link did before.
  if (room) void connect();
  else lobbyUi.showHome(homeStartMessage);
  void checkForNewVersion();
  window.setInterval(
    () => void checkForNewVersion(),
    settings.client.versionCheckMs,
  );
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkForNewVersion();
  });
}

setUiSize(readSavedSize());
void start().catch((error: unknown) => {
  const status = document.getElementById("status");
  reportClientError(error, "client start");
  if (status) {
    status.textContent = `The sea could not be drawn: ${errorText(error)}`;
    status.dataset.state = "error";
  }
});
