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
  LastSeenSnapshot,
  OwnShipSnapshot,
  ShipSnapshot,
  StateMessage,
} from "@naval/shared/world";
import { orderedChartBlocks } from "@naval/shared/chart-draw";
import { fogDebugLine, type FogDebugInfo } from "@naval/shared/fog-view";
import { GRAPHICS_RESET_NOTICE, GraphicsRecovery } from "@naval/shared/graphics-safety";
import { formatGameClock, gameClockAt } from "@naval/shared/time";
import { navyColorNumber, parseNavy, type NavyId } from "@naval/shared/navies";
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
  const fleetEmpty = element<HTMLElement>("fleet-empty");
  const fleetClose = element<HTMLButtonElement>("fleet-close");
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
  const clockPanel = element<HTMLElement>("game-clock-panel");
  const clockOut = element<HTMLElement>("game-clock");
  const roomOut = element<HTMLElement>("room-code");
  const notice = element<HTMLParagraphElement>("notice");
  const versionNotice = element<HTMLButtonElement>("version-notice");
  const fogDebugOut = element<HTMLParagraphElement>("fog-debug");
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
  routeLayer.addChild(routeInk);
  routeLayer.visible = false;

  const marker = new Graphics();
  marker.circle(0, 0, 9).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(-14, 0).lineTo(-7, 0).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(7, 0).lineTo(14, 0).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(0, -14).lineTo(0, -7).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(0, 7).lineTo(0, 14).stroke({ width: 2, color: INK_COLOR });
  marker.visible = false;

  const fleetLayer = new Container();
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
    nightTint,
    liveHalo,
    liveMapLayer,
    liveMask,
    routeLayer,
    portLayer,
    lastSeenLayer,
    fleetLayer,
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
  let selectedShipId = "";
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

  const scale = (): number => Math.min(app.screen.width, app.screen.height) / view.kmAcross;

  function toScreen(x: number, y: number): { x: number; y: number } {
    const s = scale();
    return {
      x: app.screen.width / 2 + (x - view.x) * s,
      y: app.screen.height / 2 + (y - view.y) * s,
    };
  }

  function toWorld(screenX: number, screenY: number): { x: number; y: number } {
    const s = scale();
    return {
      x: view.x + (screenX - app.screen.width / 2) / s,
      y: view.y + (screenY - app.screen.height / 2) / s,
    };
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

  /** Paint stained paper, then only the discovered 5 km cells in opaque sea. */
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

    // Only visit cells that can touch the screen. A player who has explored
    // most of the ocean still paints a small, constant number of rectangles.
    const s = scale();
    const halfWidth = app.screen.width / (2 * s);
    const halfHeight = app.screen.height / (2 * s);
    const firstColumn = Math.max(0, Math.floor((view.x - halfWidth) / chartCellKm));
    const lastColumn = Math.min(
      chartColumns - 1,
      Math.floor((view.x + halfWidth) / chartCellKm),
    );
    const firstRow = Math.max(0, Math.floor((view.y - halfHeight) / chartCellKm));
    const lastRow = Math.min(
      chartRows - 1,
      Math.floor((view.y + halfHeight) / chartCellKm),
    );
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        if (!discovered.has(row * chartColumns + column)) continue;
        const topLeft = toScreen(column * chartCellKm, row * chartCellKm);
        dimSea
          .rect(topLeft.x, topLeft.y, chartCellKm * s, chartCellKm * s)
          .fill(DIM_SEA_COLOR);
      }
    }
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

  function drawFill(graphics: Graphics, block: ChartBlock, color: number): void {
    for (const ring of block.fill) {
      if (ring.length < 6) continue;
      const points: number[] = [];
      for (let index = 0; index < ring.length; index += 2) {
        const point = builtScreen(ring[index]!, ring[index + 1]!);
        points.push(point.x, point.y);
      }
      graphics.poly(points).fill(color);
    }
  }

  function drawLines(
    graphics: Graphics,
    block: ChartBlock,
    width: number,
    color: number,
    alpha: number,
  ): void {
    for (const line of block.coast) {
      if (line.length < 4) continue;
      const first = builtScreen(line[0]!, line[1]!);
      graphics.moveTo(first.x, first.y);
      for (let index = 2; index < line.length; index += 2) {
        const point = builtScreen(line[index]!, line[index + 1]!);
        graphics.lineTo(point.x, point.y);
      }
      graphics.stroke({
        width,
        color,
        alpha,
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
    drawFill(graphics, block, land);
    drawLines(graphics, block, settings.view.waterLinePx, water, 1);
    drawLines(graphics, block, settings.view.coastLinePx, ink, 1);
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
      for (const ring of block.fill) {
        if (ring.length < 6) continue;
        const points: number[] = [];
        for (let index = 0; index < ring.length; index += 2) {
          points.push(ring[index]! * scale, ring[index + 1]! * scale);
        }
        chartGraphics.poly(points).fill(LAND_COLOR);
      }
      for (const [lineWidth, color] of [
        [settings.view.waterLinePx, WATERLINE_COLOR],
        [settings.view.coastLinePx, INK_COLOR],
      ] as const) {
        for (const line of block.coast) {
          if (line.length < 4) continue;
          chartGraphics.moveTo(line[0]! * scale, line[1]! * scale);
          for (let index = 2; index < line.length; index += 2) {
            chartGraphics.lineTo(line[index]! * scale, line[index + 1]! * scale);
          }
          chartGraphics.stroke({
            width: lineWidth,
            color,
            alpha: 1,
            cap: "round",
            join: "round",
          });
        }
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
      chartBlockLayer.visible = true;
      if (repaintChartCache(now)) {
        builtRevision = chartRevision;
        lastMapBuild = now;
      }
      return;
    }

    chartBlockLayer.visible = false;
    dimBlockLayer.visible = true;
    unknownPaper.visible = true;
    dimSea.visible = true;
    rebuildShipBlocks();
    builtRevision = chartRevision;
    lastMapBuild = now;
  }

  function updateLayerOffset(): void {
    const x = (builtView.x - view.x) * builtScale;
    const y = (builtView.y - view.y) * builtScale;
    dimBlockLayer.position.set(x, y);
    liveMapLayer.position.set(x, y);
    liveMask.position.set(x, y);

    const origin = toScreen(0, 0);
    chartBlockLayer.position.set(origin.x, origin.y);
    chartBlockLayer.scale.set(scale(), scale());
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
    const chartCacheChanged =
      mode === "chart" &&
      (!chartCacheInitialized || chartDirtyBlocks.size > 0);
    const dataChanged = builtRevision !== chartRevision || chartCacheChanged;

    if (!force && !zoomChanged && !farPan && !dataChanged) {
      updateLayerOffset();
      return;
    }

    if (
      !force &&
      dataChanged &&
      !zoomChanged &&
      !farPan &&
      mode === "chart" &&
      now - lastMapBuild < settings.view.chartCacheRebuildMs
    ) {
      updateLayerOffset();
      return;
    }

    if (!force && zoomChanged && !farPan && now - lastMapBuild < 120) {
      updateLayerOffset();
      return;
    }

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
    knownPortsButton.hidden = mode !== "chart" || portData.size === 0;
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

  /** Dotted ink route for the selected ship only, on either screen. */
  function drawSelectedRoute(): void {
    routeInk.clear();
    const own = selectedFleetShip();
    const route = own?.route;
    if (!own || !route || route.length === 0) {
      routeLayer.visible = false;
      return;
    }

    const points = [{ x: own.x, y: own.y }, ...route.map(([x, y]) => ({ x, y }))];
    const dashPx = 4;
    const gapPx = 3;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const a = toScreen(from.x, from.y);
      const b = toScreen(to.x, to.y);
      const lengthPx = Math.hypot(b.x - a.x, b.y - a.y);
      if (lengthPx < 0.5) continue;
      for (let at = 0; at < lengthPx; at += dashPx + gapPx) {
        const t0 = at / lengthPx;
        const t1 = Math.min(lengthPx, at + dashPx) / lengthPx;
        routeInk
          .moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0)
          .lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      }
    }
    routeInk.stroke({ width: 1.2, color: INK_COLOR, alpha: 0.78 });

    for (const point of route) {
      const screen = toScreen(point[0], point[1]);
      routeInk.circle(screen.x, screen.y, 2).fill({ color: INK_COLOR, alpha: 0.82 });
    }
    routeLayer.visible = true;
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

  function sendCommand(message: Record<string, unknown>): boolean {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    setStatus("Not connected yet; the order was not sent.", true);
    return false;
  }

  function updateShipRings(): void {
    const ownIds = new Set(fleetShips.map((ship) => ship.id));
    for (const [id, ship] of ships) {
      const own = ownIds.has(id);
      ship.own = own;
      ship.ring.clear();
      ship.ring.visible = own;
      if (!own) continue;
      const selected = id === selectedShipId;
      ship.ring.circle(0, 0, selected ? 19 : 17).stroke({
        width: selected ? 3.5 : 1.25,
        color: 0x8c1d1d,
      });
    }
  }

  function updateSelectedShip(id: string, centre: boolean): boolean {
    const row = fleetShips.find((ship) => ship.id === id);
    if (!row || row.status === "delivery") return false;
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
    updateShipRings();
    updateHud(ownSnapshot ?? undefined);
    return true;
  }

  function closeFleetPanel(): void {
    fleetPanel.hidden = true;
  }

  function renderFleetPanel(): void {
    fleetCountOut.textContent = String(fleetShips.length);
    fleetSummary.textContent = `${fleetCountText(fleetShips.length)} ships · ${formatMoney(money)} pieces`;
    fleetList.replaceChildren();
    fleetEmpty.hidden = fleetShips.length > 0;

    for (const ship of fleetShips) {
      const row = buildFleetRow(ship, portName(ship.portId));
      const item = document.createElement("li");
      const button = document.createElement("button");
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
        updateSelectedShip(ship.id, true);
        closeFleetPanel();
      });
      item.append(button);
      fleetList.append(item);
    }
  }

  function openFleetPanel(): void {
    closePortPanel();
    closeTradePanel();
    closeShipyardPanel();
    closeHirePanel();
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
    portSail.hidden = !model.buttons.includes("sail");
    portUndock.hidden = !model.buttons.includes("undock");
    portTrade.hidden = !model.buttons.includes("trade");
    portShipyard.hidden = !model.buttons.includes("shipyard");
    portHire.hidden = !model.buttons.includes("hire");
    portPanel.hidden = false;
  }

  function openPortPanel(portId: string): void {
    if (!portData.has(portId)) return;
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
    if (!port || !selectedShipId) return;
    target = { x: port.x, y: port.y };
    const screen = toScreen(port.x, port.y);
    marker.position.set(screen.x, screen.y);
    marker.visible = true;

    if (sendCommand({ t: "sailToPort", port: portId, ship: selectedShipId })) {
      closePortPanel();
    }
  }

  function sendUndock(): void {
    if (!selectedShipId) return;
    if (sendCommand({ t: "undock", ship: selectedShipId })) {
      closePortPanel();
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
    fogDebugOut.textContent = line ?? "";
    fogDebugOut.hidden = line === null;
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

    const incomingFleet: OwnShipSnapshot[] = [];
    if (Array.isArray(state.fleet)) {
      for (const raw of state.fleet) {
        const parsed = parseOwnShip(raw);
        if (parsed) incomingFleet.push(parsed);
      }
    }
    fleetShips = incomingFleet;
    hungerMultiplier = finiteNumber(state.h) ?? undefined;
    money = Number.isFinite(state.m) ? Math.max(0, Math.floor(state.m)) : 0;
    playerNavy = fleetShips[0]?.navy ?? playerNavy;
    const serverSelection = typeof state.sel === "string" ? state.sel : "";
    if (fleetShips.some((ship) => ship.id === serverSelection && ship.status !== "delivery")) {
      selectedShipId = serverSelection;
    } else if (!fleetShips.some((ship) => ship.id === selectedShipId)) {
      selectedShipId = fleetShips.find((ship) => ship.status !== "delivery")?.id ?? "";
    }
    const ownIds = new Set(fleetShips.map((ship) => ship.id));

    windFrom = Number.isFinite(state.w) ? state.w : settings.weather.windFromDeg;
    roomKind = validRoomKind(state.k) ? state.k : "normal";
    bordersButton.hidden = roomKind === "normal";
    if (roomKind === "normal") {
      bordersVisible = false;
      bordersButton.setAttribute("aria-pressed", "false");
      borderLayer.clear();
    }
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
    if (!shipyardPanel.hidden) refreshShipyardSummary();
    if (!hirePanel.hidden && !hirePanel.contains(document.activeElement)) {
      renderHirePanel();
    }
    if (!tradePanel.hidden) renderTradePanel();

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
    const fleetQuery = roomKindForCode(room) === "normal"
      ? ""
      : `${requestedNavy === null ? "" : `&navy=${encodeURIComponent(requestedNavy)}`}` +
        `${requestedStart === null ? "" : `&start=${encodeURIComponent(requestedStart)}`}` +
        `${requestedShip === null ? "" : `&ship=${encodeURIComponent(requestedShip)}`}` +
        `${requestedCash === null ? "" : `&cash=${encodeURIComponent(requestedCash)}`}`;
    const url = `${scheme}://${location.host}/ws?room=${encodeURIComponent(room)}&player=${encodeURIComponent(identity.id)}${botsQuery}${fleetQuery}`;
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
    if (!selectedShipId) return;
    target = { x, y };
    const screen = toScreen(x, y);
    marker.position.set(screen.x, screen.y);
    marker.visible = true;

    sendCommand({
      t: "o",
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      ship: selectedShipId,
    });
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

    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    dragDistance += Math.hypot(dx, dy);

    if (dragDistance > 6) {
      view.x -= dx / scale();
      view.y -= dy / scale();
      setFollow(false);
    }
  });

  function endPointer(event: PointerEvent): void {
    const wasSingle = pointers.size === 1;
    pointers.delete(event.pointerId);

    if (wasSingle && !multiTouch && dragDistance < 10 && performance.now() - downAt < 600) {
      const rect = app.canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const ownShip = shipAt(screenX, screenY);
      if (ownShip) {
        updateSelectedShip(ownShip.id, false);
        return;
      }
      const port = portAt(screenX, screenY);
      if (port) {
        openPortPanel(port.id);
        return;
      }
      const world = toWorld(screenX, screenY);
      sendOrder(world.x, world.y);
    }
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

  // TEMP-DEBUG: block and cell outlines for screenshots in test/dev rooms.
  bordersButton.addEventListener("click", () => {
    bordersVisible = !bordersVisible;
    bordersButton.setAttribute("aria-pressed", String(bordersVisible));
    drawBorders();
  });

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

  knownPortsButton.addEventListener("click", () => {
    if (mode !== "chart") return;
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
    closePortPanel();
    closeTradePanel();
    knownPortsPanel.hidden = true;
    closeFleetPanel();
    closeShipyardPanel();
    closeHirePanel();
  });

  versionNotice.addEventListener("click", () => location.reload());
  notice.addEventListener("click", () => {
    if (notice.dataset.reload === "true") location.reload();
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

    refreshMap(now);
    refreshFogPaper();
    updateLiveCircles();
    updateLayerOffset();
    refreshPorts();
    drawSelectedRoute();

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
