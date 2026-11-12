// Armada's 1805 browser client.
//
// The server owns the world and the private chart. This client only draws what
// visibleStateFor() sends: the ship view, the remembered chart, live sight
// circles and short-lived last-seen markers. It never predicts the world.

import { Application, Container, Graphics, RenderTexture, Sprite, Text, Texture } from "pixi.js";
import { settings } from "@naval/shared/settings";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM, lonLatToMap } from "@naval/shared/map";
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
import type {
  FleetMemberSnapshot,
  FleetSnapshot,
  LastSeenSnapshot,
  OrderLineSnapshot,
  OwnShipSnapshot,
  ShipSnapshot,
  StateMessage,
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
import { orderedChartBlocks } from "@naval/shared/chart-draw";
import { chartTextureSize, planChartDetail } from "@naval/shared/chart-detail";
import {
  auditLayout,
  layoutIssueSummary,
  type LayoutAuditElement,
} from "@naval/shared/layout-audit";
import { buildBlockCommands, findChartSuspects } from "@naval/shared/chart-paint";
import { isLandAt } from "@naval/shared/land";
import { cameraScale, screenToWorld, worldToScreen } from "@naval/shared/camera";
import { buildDiscoveredOutline, type OutlineRing } from "@naval/shared/discovered-outline";
import { dotsAlongPath } from "@naval/shared/route-ink";
import { readTapToSail, resolveTap, writeTapToSail } from "@naval/shared/tap-to-sail";
import { fogDebugLine, type FogDebugInfo } from "@naval/shared/fog-view";
import { GRAPHICS_RESET_NOTICE, GraphicsRecovery } from "@naval/shared/graphics-safety";
import { formatGameClock, gameClockAt } from "@naval/shared/time";
import { navyColorNumber, parseNavy, type NavyId } from "@naval/shared/navies";
import {
  inviteSecondDeviceLink,
  otherNavy,
  parseDummyBehaviour,
  testJoinQuery,
} from "@naval/shared/test-setup";
import {
  shipTypeFor,
  type BuyableShipClassId,
} from "@naval/shared/ships";
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
  type GoodId,
} from "@naval/shared/goods";
import type { ShipStoreCapacities, ShipStores } from "@naval/shared/trade";
import {
  buildPortPanelModel,
  knownPortsNearest,
  layoutPortMarkers,
  type PortInfo,
  type PortMarkerPlan,
} from "@naval/shared/port-view";

// ---------------------------------------------------------------------------
// Chart look.
// ---------------------------------------------------------------------------

const SEA_COLOR = 0x7c948a;
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
  if (!node) throw new Error(`Missing element #${id}`);
  return node as unknown as T;
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

function shortestRadians(delta: number): number {
  return ((delta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
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
  return {
    id: source.id,
    name: source.name.slice(0, 80),
    leaderId: source.leaderId,
    formation: (typeof source.formation === "string" ? source.formation : "lineAhead") as FleetSnapshot["formation"],
    stance: (typeof source.stance === "string" ? source.stance : "fightIfAttacked") as FleetSnapshot["stance"],
    members,
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
  own: boolean;
  classId: string;
  navy: string;
  x: number;
  y: number;
  heading: number;
  targetX: number;
  targetY: number;
  targetHeading: number;
  dockedPortId: string | null;
  waitingPortId: string | null;
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
  const tapButton = element<HTMLButtonElement>("tap-btn");
  const tapModeLabel = element<HTMLElement>("tap-mode-label");
  const moveButton = element<HTMLButtonElement>("move-btn");
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
  const fleetClear = element<HTMLButtonElement>("fleet-clear");
  const fleetSelectedCount = element<HTMLElement>("fleet-selected-count");
  const shipUndock = element<HTMLButtonElement>("ship-undock");
  const shipDamage = element<HTMLButtonElement>("ship-damage");
  const damagePanel = element<HTMLElement>("damage-panel");
  const damageTitle = element<HTMLElement>("damage-title");
  const damageSummary = element<HTMLElement>("damage-summary");
  const damageBars = element<HTMLElement>("damage-bars");
  const damageAmmo = element<HTMLElement>("damage-ammo");
  const damageReload = element<HTMLElement>("damage-reload");
  const damageState = element<HTMLElement>("damage-state");
  const damageSpeed = element<HTMLElement>("damage-speed");
  const damageTurn = element<HTMLElement>("damage-turn");
  const damageHurts = element<HTMLElement>("damage-hurts");
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
  const actionSheet = element<HTMLElement>("ship-action");
  const actionTitle = element<HTMLElement>("action-title");
  const actionUndock = element<HTMLButtonElement>("action-undock");
  const actionPort = element<HTMLButtonElement>("action-port");
  const actionClose = element<HTMLButtonElement>("action-close");
  const shipNameOut = element<HTMLElement>("ship-name");
  const shipTypeOut = element<HTMLElement>("ship-type");
  const shipCrewOut = element<HTMLElement>("ship-crew");
  const shipStateOut = element<HTMLElement>("ship-state");
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
  const menuButton = element<HTMLButtonElement>("menu-btn");
  const menuPanel = element<HTMLElement>("menu-panel");
  const menuClose = element<HTMLButtonElement>("menu-close");
  const testToolsButton = element<HTMLButtonElement>("test-tools-btn");
  const testTools = element<HTMLElement>("test-tools");
  const testToolsClose = element<HTMLButtonElement>("test-tools-close");
  const testEnemyClass = element<HTMLSelectElement>("test-enemy-class");
  const testEnemyNavy = element<HTMLSelectElement>("test-enemy-navy");
  const testEnemyCount = element<HTMLInputElement>("test-enemy-count");
  const testDummyBehaviour = element<HTMLSelectElement>("test-dummy-behaviour");
  const testSpawn = element<HTMLButtonElement>("test-spawn");
  const testRemove = element<HTMLButtonElement>("test-remove");
  const testRefill = element<HTMLButtonElement>("test-refill");
  const testInviteLink = element<HTMLInputElement>("test-invite-link");
  const testCopyLink = element<HTMLButtonElement>("test-copy-link");
  const debugSection = element<HTMLDetailsElement>("debug-info");
  const shipPanel = element<HTMLElement>("ship-panel");
  const shipExpand = element<HTMLButtonElement>("ship-expand");
  const shipStripSpeed = element<HTMLElement>("ship-strip-speed");
  const shipStripHeading = element<HTMLElement>("ship-strip-heading");
  const shipStripCrew = element<HTMLElement>("ship-strip-crew");
  const shipStripProvisions = element<HTMLElement>("ship-strip-provisions");
  const clockPanel = element<HTMLElement>("game-clock-panel");
  const clockOut = element<HTMLElement>("game-clock");
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
  const room = query.get("room") ?? "test";
  const requestedBots = query.get("bots");
  const requestedNavy = query.get("navy");
  const requestedStart = query.get("start");
  const requestedShip = query.get("ship");
  const requestedCash = query.get("cash");
  let startPortName = requestedStart ?? "";
  const identity: PlayerIdentity = resolvePlayerIdentity(
    browserStorage("localStorage"),
    browserStorage("sessionStorage"),
    roomKindForCode(room),
    query.get("as"),
    makePlayerId,
  );
  const roomPattern = new RegExp(`^[A-Za-z0-9_-]{1,${settings.server.maxRoomCodeLength}}$`);
  if (!roomPattern.test(room)) {
    status.textContent = "Room code must be letters, numbers, dash or underscore.";
    status.dataset.state = "error";
    return;
  }
  roomOut.textContent = room;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: PAPER_COLOR,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, settings.client.maxDevicePixelRatio),
    preference: "webgl",
  });
  root.appendChild(app.canvas);

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

  // The selected ship's planned route sits above the map and below ports.
  const routeLayer = new Container();
  const routeInk = new Graphics();
  const routeLabels = new Container();
  routeLayer.addChild(routeInk, routeLabels);
  routeLayer.visible = false;

  // Screen-space progress ring for the press-and-hold order gesture.
  const holdRing = new Graphics();
  holdRing.visible = false;
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
  const combatFxInk = new Graphics();
  const combatRangeInk = new Graphics();
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
    holdRing,
    selectionBoxInk,
    routeLayer,
    combatRangeInk,
    portLayer,
    lastSeenLayer,
    fleetLayer,
    combatFxInk,
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
  let savedShipView: Camera = { ...view };
  let builtView = { x: view.x, y: view.y };
  let builtScale = 0;
  let builtRevision = -1;
  let chartRevision = 0;
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
  let groupHoldTimer = 0;
  let groupHoldSlot = 0;
  let groupHoldFired = false;
  let damageShipId: string | null = null;
  let battleLogKey = "";
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
  let selectedPortId: string | null = null;
  let shipyardPortId: string | null = null;
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
  let bordersVisible = false;
  let layoutIssueCount = 0;
  let layoutAuditFrame = 0;
  const tapStorage = browserStorage("localStorage");
  let tapToSail = readTapToSail(tapStorage);
  let moveArmed = false;
  let holdPointerId: number | null = null;
  let holdStartAt = 0;
  let holdAt = { x: 0, y: 0 };
  let holdTimer = 0;
  let holdFrame = 0;
  let holdActive = false;
  let holdSent = false;
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
    followButton.setAttribute("aria-pressed", String(on));
  }

  function showNotice(
    text: string,
    options: { persistent?: boolean; reload?: boolean } = {},
  ): void {
    window.clearTimeout(noticeTimer);
    window.clearTimeout(noticeHideTimer);
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
              .fill(DIM_SEA_COLOR);
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
    const radiusPx = settings.fog.sightRangeKm * builtScale;
    const featherPx = settings.fog.sightFeatherKm * builtScale;
    liveHalo.clear();
    const rings = settings.view.sightFeatherRings;

    for (const ship of own) {
      const centre = builtScreen(ship.x, ship.y);
      const screenCentre = toScreen(ship.x, ship.y);
      liveSea.circle(centre.x, centre.y, radiusPx).fill(SEA_COLOR);
      liveMask.circle(centre.x, centre.y, radiusPx).fill(0xffffff);

      // A ring per step, each wider and fainter, softens the sight edge without
      // a texture or a filter.
      for (let ring = 1; ring <= rings; ring += 1) {
        const share = ring / rings;
        liveHalo
          .circle(screenCentre.x, screenCentre.y, radiusPx + featherPx * share)
          .stroke({
            width: Math.max(1, featherPx / rings),
            color: SEA_COLOR,
            alpha: settings.view.sightFeatherAlpha * (1 - share * settings.view.sightFeatherFade),
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
    const markers = layoutPortMarkers({
      width: app.screen.width,
      height: app.screen.height,
      view,
      ports: [...portData.values()],
      sight: own.map((ship) => ({
        x: ship.x,
        y: ship.y,
        radiusKm: settings.fog.sightRangeKm,
      })),
    });
    laidOutPorts = markers;
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
        view = { container, mark, label, radius: -1 };
        portViews.set(marker.id, view);
      }

      if (view.radius !== marker.radiusPx) {
        const radius = marker.radiusPx;
        view.mark.clear();
        view.mark
          .circle(0, 0, radius)
          .fill({ color: PAPER_COLOR, alpha: 0.9 })
          .stroke({ width: 1.5, color: INK_COLOR });
        // A small inked anchor inside the ring.
        view.mark
          .circle(0, -radius * 0.28, radius * 0.14)
          .stroke({ width: 1, color: INK_COLOR })
          .moveTo(0, -radius * 0.12)
          .lineTo(0, radius * 0.42)
          .moveTo(-radius * 0.34, radius * 0.24)
          .lineTo(0, radius * 0.46)
          .lineTo(radius * 0.34, radius * 0.24)
          .stroke({ width: 1, color: INK_COLOR, cap: "round", join: "round" });
        view.radius = radius;
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
  function drawDotted(points: Array<[number, number]>, colour = INK_COLOR): number {
    if (points.length < 2) return 0;
    const dots = dotsAlongPath(points.map(([x, y]) => toScreen(x, y)), settings.view.routeDotSpacingPx);
    for (const dot of dots) {
      routeInk.circle(dot.x, dot.y, settings.view.routeDotRadiusPx).fill({ color: colour, alpha: 0.82 });
    }
    return dots.length;
  }

  /** Every selected ship keeps all of its active order geometry on screen. */
  function drawSelectedRoute(): void {
    routeInk.clear();
    for (const label of routeLabels.removeChildren()) label.destroy();
    const selected = fleetShips.filter((ship) =>
      multiSelect && selectedShipIds.size > 0
        ? selectedShipIds.has(ship.id)
        : ship.id === selectedFleetShip()?.id,
    );
    let drew = false;
    for (const own of selected) {
      if (own.route && own.route.length > 1) {
        drew = drawDotted(own.route) > 0 || drew;
      }
      for (const line of own.orderLines ?? []) {
        drew = drawDotted(line.points) > 0 || drew;
        if (line.queueNumber && line.points.length > 0) {
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
    routeLayer.visible = drew;
    drawHeadingPreview();
  }

  /** A faint 1 km ring and the two 30-degree beam arcs for engaged ships. */
  function drawCombatRange(): void {
    combatRangeInk.clear();
    if (mode !== "ship") return;
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

  /** Grey smoke, splashes, hit flashes and a sinking cloud, in paper ink. */
  function drawCombatFx(now: number): void {
    combatFxInk.clear();
    const zoom = Math.max(0.55, Math.min(2.2, scale() / 700));
    let write = 0;
    for (const fx of combatFx) {
      const age = now - fx.at;
      if (age < 0 || age > 2_400) continue;
      combatFx[write++] = fx;
      const screen = toScreen(fx.x, fx.y);
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

  function sendCommand(message: Record<string, unknown>): boolean {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    setStatus("Not connected yet; the order was not sent.", true);
    return false;
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

  function updateSelectedShip(id: string, centre: boolean): boolean {
    const row = fleetShips.find((ship) => ship.id === id);
    if (!row || row.status === "delivery") return false;
    if (!multiSelect) selectedShipIds.clear();
    selectedShipId = id;
    target = null;
    marker.visible = false;
    sendCommand({ t: "select", ship: id });

    if (centre) {
      if (mode === "chart") setMode("ship");
      const viewShip = ships.get(id);
      if (viewShip) {
        view.x = viewShip.x;
        view.y = viewShip.y;
        setFollow(true);
        refreshMap(performance.now(), true);
      }
    }
    updateMultiUi();
    updateHud(ownSnapshot ?? undefined);
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
    groupBar.hidden = slots.length === 0;
    for (const slot of slots) {
      const count = controlGroups[slot]?.length ?? 0;
      if (count === 0) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "group-chip";
      button.textContent = `${slot} · ${count}`;
      button.setAttribute("aria-label", `Select control group ${slot}, ${count} ships`);
      button.addEventListener("pointerdown", () => {
        groupHoldSlot = slot;
        groupHoldFired = false;
        window.clearTimeout(groupHoldTimer);
        groupHoldTimer = window.setTimeout(() => {
          if (groupHoldSlot !== slot) return;
          groupHoldFired = true;
          saveControlGroup(slot);
        }, 650);
      });
      const stopHold = (): void => {
        window.clearTimeout(groupHoldTimer);
        groupHoldTimer = 0;
      };
      button.addEventListener("pointerup", stopHold);
      button.addEventListener("pointercancel", stopHold);
      button.addEventListener("pointerleave", stopHold);
      button.addEventListener("click", () => {
        stopHold();
        if (groupHoldFired) {
          groupHoldFired = false;
          return;
        }
        selectControlGroup(slot);
      });
      groupBar.append(button);
    }
    groupBar.hidden = groupBar.childElementCount === 0;
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
      leader.textContent = `⚑ ${shipById(fleet.leaderId)?.name ?? "Leader"}`;
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

      const members = document.createElement("ul");
      members.className = "fleet-member-list";
      const ordered = [...fleet.members].sort((a, b) =>
        a.id === fleet.leaderId ? -1 : b.id === fleet.leaderId ? 1 : 0,
      );
      for (const member of ordered) {
        const item = document.createElement("li");
        item.className = "fleet-member-row";
        const memberName = document.createElement("button");
        memberName.type = "button";
        memberName.className = "fleet-member-name btn-link";
        memberName.textContent = shipById(member.id)?.name ?? member.id;
        memberName.addEventListener("click", () => {
          const ship = shipById(member.id);
          if (!ship || ship.status === "delivery") return;
          selectedShipId = member.id;
          selectedFleetId = fleet.id;
          updateMultiUi();
        });
        const state = document.createElement("span");
        state.className = "fleet-member-state";
        state.textContent = fleetMemberStateText(member.state);
        item.append(memberName, state);
        if (member.state === "detached") {
          const rejoin = document.createElement("button");
          rejoin.type = "button";
          rejoin.className = "btn";
          rejoin.textContent = "Rejoin";
          rejoin.addEventListener("click", () => {
            sendCommand({ t: "fleetRejoin", ship: member.id });
          });
          item.append(rejoin);
        } else {
          item.append(document.createElement("span"));
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

      card.append(head, selects, members, actions);
      fleetCards.append(card);
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
    if (kind === "enemy" && target?.kind === "ship" &&
      (id === "attackSink" || id === "attackCapture")) {
      closeOrderMenu();
      sendSelectedSpecial({
        type: "engage",
        shipId: target.id,
        objective: id === "attackSink" ? "sink" : "capture",
      });
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
    const dots = dotsAlongPath(points, settings.view.routeDotSpacingPx);
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

  function renderFleetPanel(): void {
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
      name.textContent = row.name;
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
    closePortPanel();
    closeTradePanel();
    closeShipyardPanel();
    closeHirePanel();
    closeShipActions();
    knownPortsPanel.hidden = true;
    fleetPanel.hidden = false;
    renderFleetPanel();
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
      button.textContent = button.disabled ? "Fleet full" : "Buy";
    }
  }

  function beginNaming(classId: BuyableShipClassId): void {
    if (!shipyardPortId || !namingClassAllowed(classId)) return;
    const port = portData.get(shipyardPortId);
    if (!port) return;
    const card = shipyardCards(roomKind, stockSize(port), playerNavy).find(
      (candidate) => candidate.classId === classId,
    );
    if (!card) return;
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
    return !!port && shipyardCards(roomKind, stockSize(port), playerNavy).some(
      (card) => card.classId === classId,
    );
  }

  function renderShipyard(): void {
    const port = shipyardPortId ? portData.get(shipyardPortId) : null;
    if (!port || !port.buyable) {
      closeShipyardPanel();
      return;
    }

    shipyardCardsOut.replaceChildren();
    const cards = shipyardCards(roomKind, stockSize(port), playerNavy);
    for (const card of cards) {
      const article = document.createElement("article");
      const title = document.createElement("h3");
      const price = document.createElement("p");
      const stats = document.createElement("dl");
      const buy = document.createElement("button");

      article.className = "yard-card";
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
      buy.textContent = "Buy";
      buy.disabled = fleetShips.length >= settings.ships.maxShipsPerPlayer;
      if (buy.disabled) buy.textContent = "Fleet full";
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
        count.textContent = `${quote.target} / ${ship.fullCrew} crew`;
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

  function closePortPanel(): void {
    selectedPortId = null;
    portPanel.hidden = true;
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

  function sendPortOrder(portId: string): void {
    const port = portData.get(portId);
    const ids = groupShipIds();
    if (!port || ids.length === 0) return;
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
    for (const [classId, navy, x, y, age] of lastSeen) {
      const container = new Container();
      const mark = new Graphics();
      mark
        .circle(0, 0, 8)
        .stroke({ width: 1, color: INK_COLOR, alpha: 0.55 })
        .moveTo(-5, -5)
        .lineTo(5, 5)
        .moveTo(5, -5)
        .lineTo(-5, 5)
        .stroke({ width: 1, color: INK_COLOR, alpha: 0.55 });
      const label = new Text({
        text: `${navy} ${classId} · ${Math.round(age)}s`,
        style: { fontFamily: "Source Sans 3", fontSize: 10, fill: INK_COLOR },
      });
      label.alpha = 0.65;
      label.position.set(10, -6);
      container.addChild(mark, label);
      lastSeenLayer.addChild(container);
      lastSeenViews.push(container);
      container.position.set(0, 0);
      container.alpha = 0.8;
      container.visible = false;
    }
  }

  function makeHull(own: boolean, navy: string): Graphics {
    const hull = new Graphics();
    const size = own ? 1 : 0.85;
    const fleetColor = navyColorNumber(parseNavy(navy) ?? "British");

    hull
      .poly([
        0, -13 * size,
        5 * size, -4 * size,
        4.5 * size, 7 * size,
        0, 10 * size,
        -4.5 * size, 7 * size,
        -5 * size, -4 * size,
      ])
      .fill(fleetColor)
      .stroke({ width: 1.4, color: own ? 0xf3e7cb : 0x1b2f3d });

    return hull;
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

  function updateHud(own: ShipSnapshot | undefined): void {
    const row = selectedFleetShip();
    const viewRow = row ? buildFleetRow(row, portName(row.portId)) : null;
    moneyOut.textContent = formatMoney(money);
    fleetCountOut.textContent = String(fleetShips.length);
    fleetSummary.textContent = `${fleetCountText(fleetShips.length)} ships · ${formatMoney(money)} pieces`;
    shipNameOut.textContent = row?.name ?? "No ship selected";
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

    if (own) {
      const heading = own[4];
      speedOut.textContent = `${own[5].toFixed(1)} kn`;
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
    shipUndock.hidden = row?.status !== "docked";
    shipDamage.disabled = !row || row.status === "delivery";
  }

  function closeDamagePanel(): void {
    damagePanel.hidden = true;
    damageShipId = null;
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
    damageState.textContent = row.inCombat
      ? "In combat — repairs blocked"
      : row.canRepair
        ? "Can repair"
        : "Repairs blocked";
    damageSpeed.textContent = row.effectiveSpeedKnots === undefined
      ? "–"
      : `${row.effectiveSpeedKnots.toFixed(1)} / ${(row.normalSpeedKnots ?? 0).toFixed(1)} kn`;
    damageTurn.textContent = row.effectiveTurnDegPerSecond === undefined
      ? "–"
      : `${row.effectiveTurnDegPerSecond.toFixed(1)} / ${(row.normalTurnDegPerSecond ?? 0).toFixed(1)}°/s`;
    damageHurts.textContent = hurt.length > 0 ? hurt.join(" · ") : "All six areas sound.";
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
        graphicsResets,
        devicePixelRatio: app.renderer.resolution,
        money,
        fleetShips: fleetShips.length,
        hungerMultiplier,
      },
    );
    const debugLine = line === null
      ? null
      : `${line} · suspicious segments: ${suspectSegments} · layout issues: ${layoutIssueCount}`;
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
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (!message || typeof message !== "object") return;
    const type = (message as { t?: unknown }).t;

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
    if (type !== "s") return;

    const state = message as StateMessage;
    if (!Array.isArray(state.ships)) return;

    noteStateReceived();
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
    if (Array.isArray(state.events)) {
      const receivedAtClient = performance.now();
      for (const raw of state.events) {
        if (!raw || typeof raw !== "object") continue;
        const event = raw as unknown as Record<string, unknown>;
        if (
          event.kind !== "fire" && event.kind !== "hit" &&
          event.kind !== "miss" && event.kind !== "sunk"
        ) continue;
        if (typeof event.x !== "number" || typeof event.y !== "number") continue;
        combatFx.push({
          kind: event.kind,
          x: event.x,
          y: event.y,
          side: event.side === "port" || event.side === "starboard" ||
            event.side === "bow" || event.side === "stern"
            ? event.side
            : undefined,
          shipId: typeof event.shipId === "string" ? event.shipId : undefined,
          at: receivedAtClient,
        });
        if (event.kind === "sunk") {
          lastSunkAt = { x: event.x, y: event.y };
          if (notice.textContent?.startsWith("Ship sunk")) {
            notice.dataset.sunk = "true";
            notice.tabIndex = 0;
            notice.title = "Tap to centre the map on the sinking";
          }
        }
      }
      while (combatFx.length > 240) combatFx.shift();
    }

    const incomingFleet: OwnShipSnapshot[] = [];
    if (Array.isArray(state.fleet)) {
      for (const raw of state.fleet) {
        const parsed = parseOwnShip(raw);
        if (parsed) incomingFleet.push(parsed);
      }
    }
    fleetShips = incomingFleet;
    playerFleets = Array.isArray(state.fleets)
      ? state.fleets.map(parseFleet).filter((fleet): fleet is FleetSnapshot => fleet !== null)
      : [];
    controlGroups = {};
    if (state.groups && typeof state.groups === "object") {
      for (const [rawSlot, ids] of Object.entries(state.groups)) {
        const slot = Number(rawSlot);
        if (!Number.isInteger(slot) || slot < 1 || slot > 9 || !Array.isArray(ids)) continue;
        controlGroups[slot] = ids.filter((id): id is string => typeof id === "string");
      }
    }
    if (selectedFleetId && !playerFleets.some((fleet) => fleet.id === selectedFleetId)) {
      selectedFleetId = null;
    }
    if (!selectedFleetId) {
      selectedFleetId = playerFleets.find((fleet) =>
        fleet.members.some((member) => member.id === selectedShipId),
      )?.id ?? null;
    }
    hungerMultiplier = finiteNumber(state.h) ?? undefined;
    if (typeof state.sp === "string" && state.sp.length > 0) startPortName = state.sp;
    money = Number.isFinite(state.m) ? Math.max(0, Math.floor(state.m)) : 0;
    playerNavy = fleetShips[0]?.navy ?? playerNavy;
    const serverSelection = typeof state.sel === "string" ? state.sel : "";
    if (fleetShips.some((ship) => ship.id === serverSelection && ship.status !== "delivery")) {
      selectedShipId = serverSelection;
    } else if (!fleetShips.some((ship) => ship.id === selectedShipId)) {
      selectedShipId = fleetShips.find((ship) => ship.status !== "delivery")?.id ?? "";
    }
    for (const id of [...selectedShipIds]) {
      if (!fleetShips.some((ship) => ship.id === id && ship.status !== "delivery")) {
        selectedShipIds.delete(id);
      }
    }
    if (selectedShipIds.size === 0) multiSelect = false;
    updateMultiUi();
    const ownIds = new Set(fleetShips.map((ship) => ship.id));

    windFrom = Number.isFinite(state.w) ? state.w : settings.weather.windFromDeg;
    roomKind = validRoomKind(state.k) ? state.k : "normal";
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
    windLabel.textContent = `Wind from ${compassPoint(windFrom)} (${Math.round(windFrom)}°)`;

    const chart = state.chart;
    let dataChanged = false;
    if (chart && typeof chart === "object") {
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
      dataChanged = applied.changed;
      chartBlocksRemaining = Math.max(0, Math.floor(finiteNumber(chart.remaining) ?? 0));
      updateCharting();
    }

    if (dataChanged) chartRevision += 1;

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
    portData.clear();
    for (const [id, port] of incomingPorts) portData.set(id, port);
    if (selectedPortId && !portData.has(selectedPortId)) closePortPanel();
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
      if (!ship) {
        const ownHere = ownIds.has(id);
        const hull = makeHull(ownHere, navy);
        const ring = new Graphics();
        ring.visible = false;
        fleetLayer.addChild(hull, ring);
        ship = {
          id,
          hull,
          ring,
          own: ownHere,
          classId: String(classId),
          navy,
          x,
          y,
          heading: headingDeg * (Math.PI / 180),
          targetX: x,
          targetY: y,
          targetHeading: headingDeg * (Math.PI / 180),
          dockedPortId,
          waitingPortId,
        };
        ships.set(id, ship);
      }

      ship.classId = String(classId);
      ship.navy = navy;
      ship.dockedPortId = dockedPortId;
      ship.waitingPortId = waitingPortId;
      ship.targetX = x;
      ship.targetY = y;
      ship.targetHeading = headingDeg * (Math.PI / 180);
      if (id === selectedShipId) own = snapshot;
    }

    for (const [id, ship] of ships) {
      if (!seen.has(id)) {
        ship.hull.destroy();
        ship.ring.destroy();
        ships.delete(id);
      }
    }

    ownSnapshot = own ?? null;
    updateShipRings();
    const selectedView = selectedShipView();
    if (selectedView && builtRevision < 0) {
      view.x = selectedView.x;
      view.y = selectedView.y;
    }

    updateHud(own);
    if (own && target) {
      const distance = Math.hypot(own[2] - target.x, own[3] - target.y);
      if (distance <= settings.sailing.arrivalRadiusKm) {
        target = null;
        marker.visible = false;
      }
    }

    if (!fleetPanel.hidden) renderFleetPanel();
    renderGroupBar();
    if (!headingSheet.hidden) drawHeadingPreview();
    if (!shipyardPanel.hidden) refreshShipyardSummary();
    if (!hirePanel.hidden && !hirePanel.contains(document.activeElement)) {
      renderHirePanel();
    }
    if (!tradePanel.hidden) renderTradePanel();
    if (damageShipId && !shipById(damageShipId)) closeDamagePanel();
    if (!damagePanel.hidden) renderDamagePanel();
    renderBattleLog(state.log);

    lastSeen = Array.isArray(state.l) ? state.l : [];
    drawLastSeen();
    refreshPortPanel();
    updateKnownPortsButton();
    updateDebugLine();
    setStatus("Connected");
  }

  function connect(): void {
    if (!location.host) {
      setStatus("Open this page from the game server to sail.", true);
      return;
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

    next.addEventListener("open", () => setStatus("Connected"));
    next.addEventListener("message", onState);
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

      if (takenOver) return;
      setStatus("Connection lost. Retrying…", true);
      if (retry === null && !document.hidden) {
        retry = window.setTimeout(() => {
          retry = null;
          connect();
        }, 2000);
      }
    });
  }

  function sendOrder(x: number, y: number): void {
    const ids = groupShipIds();
    if (ids.length === 0) return;
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
    }

    updateKnownPortsButton();
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

  function refreshTapUi(): void {
    tapButton.setAttribute("aria-pressed", String(tapToSail));
    tapButton.classList.toggle("is-off", !tapToSail);
    tapModeLabel.textContent = tapToSail ? "On" : "Off";
    tapButton.title = tapToSail
      ? "A quick tap on the sea sends a move order"
      : "Press and hold the sea, or use Move, to send an order";
    moveButton.hidden = tapToSail;
    moveButton.setAttribute("aria-pressed", String(moveArmed));
    moveButton.classList.toggle("is-armed", moveArmed);
  }

  function disarmMove(): void {
    moveArmed = false;
    refreshTapUi();
  }

  function drawHoldRing(progress: number): void {
    const radius = settings.client.tapHoldRingPx;
    const width = settings.client.tapHoldRingWidthPx;
    holdRing.clear();
    holdRing
      .circle(holdAt.x, holdAt.y, radius)
      .stroke({ width: 1, color: INK_COLOR, alpha: 0.35 });
    if (progress <= 0) return;
    holdRing
      .arc(
        holdAt.x,
        holdAt.y,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress),
      )
      .stroke({ width, color: 0x8c1d1d, alpha: 0.95, cap: "round" });
  }

  function cancelTapHold(): void {
    window.clearTimeout(holdTimer);
    holdTimer = 0;
    if (holdFrame) cancelAnimationFrame(holdFrame);
    holdFrame = 0;
    holdActive = false;
    holdPointerId = null;
    holdRing.clear();
    holdRing.visible = false;
  }

  function finishTapHold(): void {
    if (!holdActive) return;
    holdActive = false;
    holdSent = true;
    drawHoldRing(1);
    openOrderMenu(holdAt.x, holdAt.y);
    window.clearTimeout(holdTimer);
    holdTimer = 0;
  }

  function beginTapHold(event: PointerEvent): void {
    if (pointers.size !== 1) return;
    const rect = app.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    cancelTapHold();
    holdPointerId = event.pointerId;
    holdStartAt = performance.now();
    holdAt = { x: screenX, y: screenY };
    holdActive = true;
    holdSent = false;
    holdRing.visible = true;
    drawHoldRing(0);

    const animate = (): void => {
      if (!holdActive) return;
      drawHoldRing((performance.now() - holdStartAt) / settings.client.tapHoldMs);
      holdFrame = requestAnimationFrame(animate);
    };
    holdFrame = requestAnimationFrame(animate);
    holdTimer = window.setTimeout(finishTapHold, settings.client.tapHoldMs);
  }

  function mapTapAction(screenX: number, screenY: number): void {
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
    const port = portHit;
    if (port) {
      const docked = fleetShips.find(
        (ship) => ship.status === "docked" && ship.portId === port.id,
      );
      if (docked && !multiSelect && openShipActions(docked.id)) return;
      openPortPanel(port.id);
      return;
    }

    if (pendingPatrolFleetId && placePatrolPoint(worldPoint)) return;
    if (pendingRendezvous) {
      pendingRendezvous = false;
      const fleets = selectedFleetIds();
      for (const fleetId of fleets) {
        const fleet = fleetById(fleetId);
        sendFleetOrder(fleetId, {
          type: "rendezvous",
          point: worldPoint,
          memberIds: fleet?.members.map((member) => member.id) ?? [],
        });
      }
      if (fleets.length === 0) {
        for (const id of groupShipIds()) {
          sendCommand({ t: "o", x: worldPoint.x, y: worldPoint.y, ship: id });
        }
      }
      showNotice("Rendezvous ordered.");
      return;
    }

    const decision = resolveTap({ tapToSail, moveArmed, heldMs: 0 });
    moveArmed = decision.moveArmed;
    refreshTapUi();
    if (!decision.sendOrder) {
      closePortPanel();
      closeTradePanel();
      closeFleetPanel();
      closeShipyardPanel();
      closeHirePanel();
      knownPortsPanel.hidden = true;
      return;
    }
    sendOrder(worldPoint.x, worldPoint.y);
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
  }

  function zoomTo(kmAcross: number): void {
    view.kmAcross = clamp(kmAcross, minViewKmAcross(), maxViewKmAcross());
  }

  app.canvas.addEventListener("pointerdown", (event) => {
    app.canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      dragDistance = 0;
      downAt = performance.now();
      multiTouch = false;
      beginTapHold(event);
      const rect = app.canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      if (multiSelect && !shipAt(sx, sy) && !portAt(sx, sy)) {
        cancelTapHold();
        boxPointer = event.pointerId;
        boxStart = { x: sx, y: sy };
        boxCurrent = { x: sx, y: sy };
        boxDragged = false;
      }
    }
    if (pointers.size === 2) {
      multiTouch = true;
      cancelTapHold();
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

    if (
      holdActive &&
      holdPointerId === event.pointerId &&
      Math.hypot(event.clientX - holdAt.x, event.clientY - holdAt.y) > 8
    ) {
      cancelTapHold();
    }

    if (dragDistance > 6) {
      view.x -= dx / scale();
      view.y -= dy / scale();
      setFollow(false);
    }
  });

  function endPointer(event: PointerEvent): void {
    const wasSingle = pointers.size === 1;
    const wasHeld = holdSent;
    cancelTapHold();
    holdSent = false;
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
    if (wasHeld) return;
    if (performance.now() - downAt >= 600) return;

    const rect = app.canvas.getBoundingClientRect();
    mapTapAction(event.clientX - rect.left, event.clientY - rect.top);
  }

  app.canvas.addEventListener("pointerup", endPointer);
  app.canvas.addEventListener("pointercancel", (event) => {
    cancelTapHold();
    holdSent = false;
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

  tapButton.addEventListener("click", () => {
    tapToSail = !tapToSail;
    writeTapToSail(tapStorage, tapToSail);
    if (tapToSail) cancelTapHold();
    if (!tapToSail) disarmMove();
    refreshTapUi();
  });

  moveButton.addEventListener("click", () => {
    if (tapToSail) return;
    moveArmed = !moveArmed;
    if (moveArmed) {
      showNotice("Move armed: tap the sea once.");
    }
    refreshTapUi();
  });

  refreshTapUi();

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
    selectedShipIds.clear();
    for (const ship of fleetShips) {
      if (ship.status !== "delivery") selectedShipIds.add(ship.id);
    }
    multiSelect = selectedShipIds.size > 0;
    updateMultiUi();
  });

  fleetClear.addEventListener("click", () => {
    selectedShipIds.clear();
    multiSelect = false;
    updateMultiUi();
  });

  fleetUndock.addEventListener("click", sendUndock);
  shipUndock.addEventListener("click", sendUndock);
  shipDamage.addEventListener("click", () => openDamagePanel());
  damageClose.addEventListener("click", closeDamagePanel);
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

  function drawSuspects(): void {
    suspectSegments = 0;
    if ((roomKind !== "test" && roomKind !== "dev") || app.screen.width <= 0) {
      return;
    }
    suspectSegments = findChartSuspects(screenBlockList(), isLandAt).length;
  }

  function scheduleLayoutAudit(): void {
    if (layoutAuditFrame) cancelAnimationFrame(layoutAuditFrame);
    layoutAuditFrame = requestAnimationFrame(runLayoutAudit);
  }

  /** TEMP-DEBUG: measure the rendered UI in test and dev rooms. */
  function runLayoutAudit(): void {
    layoutAuditFrame = 0;
    if (roomKind === "normal") {
      layoutAudit.hidden = true;
      layoutIssueCount = 0;
      return;
    }

    const measures: LayoutAuditElement[] = [];
    const add = (
      node: Element,
      group: string,
      interactive: boolean,
      index: number,
    ): void => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      measures.push({
        id: element.id || `${group}-${element.tagName.toLowerCase()}-${index}`,
        group,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        interactive,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      });
    };

    document.querySelectorAll("header.hud-top, .hud-ship, section[role='dialog']").forEach(
      (node, index) => add(node, "surface", false, index),
    );
    document.querySelectorAll("button, input").forEach(
      (node, index) => add(node, "control", true, index),
    );

    const issues = auditLayout(
      measures,
      { width: window.innerWidth, height: window.innerHeight },
      44,
    );
    layoutIssueCount = issues.length;
    layoutAudit.hidden = false;
    layoutAuditSummary.textContent = layoutIssueSummary(issues);
    layoutAuditList.replaceChildren();
    for (const issue of issues) {
      const item = document.createElement("li");
      item.textContent = `${issue.kind}: ${issue.id}${issue.other ? ` ↔ ${issue.other}` : ""} — ${issue.detail}`;
      layoutAuditList.append(item);
    }
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

  menuButton.addEventListener("click", () => {
    menuPanel.hidden = !menuPanel.hidden;
    menuButton.setAttribute("aria-expanded", String(!menuPanel.hidden));
    if (!menuPanel.hidden) closeTestTools();
  });
  menuClose.addEventListener("click", () => {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  });

  function closeTestTools(): void {
    testTools.hidden = true;
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

  testToolsButton.addEventListener("click", () => {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    closePortPanel();
    closeFleetPanel();
    closeDamagePanel();
    closeTestTools();
    testTools.hidden = false;
    refreshTestInvite();
  });
  testToolsClose.addEventListener("click", closeTestTools);
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

  let shipExpanded = !window.matchMedia("(max-width: 640px)").matches;
  function setShipExpanded(expanded: boolean): void {
    shipExpanded = expanded;
    shipPanel.classList.toggle("is-expanded", expanded);
    shipPanel.classList.toggle("is-collapsed", !expanded);
    shipExpand.setAttribute("aria-expanded", String(expanded));
  }
  setShipExpanded(shipExpanded);
  shipExpand.addEventListener("click", () => setShipExpanded(!shipExpanded));
  window.matchMedia("(max-width: 640px)").addEventListener("change", (event) => {
    setShipExpanded(!event.matches);
  });

  knownPortsButton.addEventListener("click", () => {
    if (mode !== "chart") setMode("chart");
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    closePortPanel();
    closeFleetPanel();
    closeShipyardPanel();
    closeHirePanel();
    renderKnownPorts();
    knownPortsPanel.hidden = false;
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
  app.canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    openOrderMenu(event.clientX - rect.left, event.clientY - rect.top);
  });
  updateQueueButton();
  portClose.addEventListener("click", closePortPanel);
  knownPortsClose.addEventListener("click", () => {
    knownPortsPanel.hidden = true;
  });
  portSail.addEventListener("click", () => {
    if (selectedPortId) sendPortOrder(selectedPortId);
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

    const dt = Math.min(0.1, app.ticker.deltaMS / 1000);
    updateClockAndNight(now);
    const own = selectedShipView();

    if (view.follow && own && mode === "ship") {
      view.x = own.x;
      view.y = own.y;
    }

    const ease = 1 - Math.exp(-7 * dt);
    for (const ship of ships.values()) {
      ship.x += (ship.targetX - ship.x) * ease;
      ship.y += (ship.targetY - ship.y) * ease;
      ship.heading += shortestRadians(ship.targetHeading - ship.heading) * ease;

      const screen = toScreen(ship.x, ship.y);
      ship.hull.position.set(screen.x, screen.y);
      ship.hull.rotation = ship.heading;
      ship.ring.position.set(screen.x, screen.y);
      ship.hull.visible =
        screen.x > -90 && screen.x < app.screen.width + 90 &&
        screen.y > -90 && screen.y < app.screen.height + 90;
      ship.ring.visible = ship.own && ship.hull.visible;
    }

    refreshDiscoveredOutline(now);
    refreshMap(now);
    refreshFogPaper();
    updateLiveCircles();
    updateLayerOffset();
    refreshPorts();
    drawSelectedRoute();
    drawCombatRange();
    drawCombatFx(now);

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
    windLayer.clear();
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

    updateRuler();
    drawBorders();
    if (now - lastDebugLineAt >= 500) {
      lastDebugLineAt = now;
      updateDebugLine();
    }
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
    button.addEventListener("click", () => {
      const size = button.dataset.size;
      if (size === "small" || size === "medium" || size === "large") setUiSize(size);
    });
  }

  drawGrain();
  if (identity.warning) showNotice(identity.warning);
  window.addEventListener("resize", scheduleLayoutAudit);
  scheduleLayoutAudit();
  connect();
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
  if (status) {
    status.textContent = `The sea could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
    status.dataset.state = "error";
  }
});
