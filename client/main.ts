// Armada's 1805 browser client.
//
// The server owns the world and the private chart. This client only draws what
// visibleStateFor() sends: the ship view, the remembered chart, live sight
// circles and short-lived last-seen markers. It never predicts the world.

import { Application, Container, Graphics, RenderTexture, Sprite, Text } from "pixi.js";
import { settings } from "@naval/shared/settings";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM, lonLatToMap } from "@naval/shared/map";
import {
  chartCellKm,
  chartColumns,
  chartRows,
  roomKindForCode,
  type ChartBlock,
  type RoomKind,
} from "@naval/shared/fog";
import {
  resolvePlayerIdentity,
  type PlayerIdentity,
  type StorageLike,
} from "@naval/shared/player-identity";
import { TAKEN_OVER_CLOSE_CODE } from "@naval/shared/player-sessions";
import type { LastSeenSnapshot, StateMessage } from "@naval/shared/world";
import { orderedChartBlocks } from "@naval/shared/chart-draw";
import { fogDebugLine, type FogDebugInfo } from "@naval/shared/fog-view";
import { formatGameClock, gameClockAt } from "@naval/shared/time";

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
const DIM_SEA_COLOR = mixedColor(PAPER_COLOR, SEA_COLOR, settings.view.fogDimAlpha + 0.22);
const DIM_LAND_COLOR = mixedColor(DIM_SEA_COLOR, LAND_COLOR, settings.view.fogDimAlpha);
const DIM_WATERLINE_COLOR = mixedColor(DIM_LAND_COLOR, WATERLINE_COLOR, 0.55);
const DIM_INK_COLOR = mixedColor(DIM_LAND_COLOR, INK_COLOR, 0.62);

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

// ---------------------------------------------------------------------------
// Game screen.
// ---------------------------------------------------------------------------

interface ShipView {
  hull: Graphics;
  classId: string;
  x: number;
  y: number;
  heading: number;
  targetX: number;
  targetY: number;
  targetHeading: number;
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
  const bordersButton = element<HTMLButtonElement>("borders-btn");
  const clockPanel = element<HTMLElement>("game-clock-panel");
  const clockOut = element<HTMLElement>("game-clock");
  const roomOut = element<HTMLElement>("room-code");
  const notice = element<HTMLParagraphElement>("notice");
  const versionNotice = element<HTMLButtonElement>("version-notice");
  const fogDebugOut = element<HTMLParagraphElement>("fog-debug");
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
    lastSeenLayer,
    fleetLayer,
    windLayer,
    borderLayer,
    grainLayer,
    marker,
    rulerLayer,
  );

  const startPoint = lonLatToMap(
    settings.world.startArea.lonDeg,
    settings.world.startArea.latDeg,
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

  const blocks = new Map<string, ChartBlock>();
  const discovered = new Set<number>();
  const ships = new Map<string, ShipView>();
  let lastSeen: LastSeenSnapshot[] = [];
  let lastSeenViews: Container[] = [];

  interface BlockPaint {
    blockId: string;
    dim: Graphics;
    live: Graphics;
  }
  const blockPaints = new Map<string, BlockPaint>();

  const chartGraphics = new Graphics();
  const chartBuildLayer = new Container();
  chartBuildLayer.addChild(chartGraphics);
  let chartTexture: RenderTexture | null = null;
  let chartTextureScale = 1;
  let chartBuiltRevision = -1;
  let lastChartBuild = 0;
  let liveBlockGraphics = 0;

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

  function showNotice(text: string): void {
    window.clearTimeout(noticeTimer);
    window.clearTimeout(noticeHideTimer);
    notice.textContent = text;
    notice.hidden = false;
    requestAnimationFrame(() => notice.classList.add("is-visible"));

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

    for (const index of discovered) {
      const column = index % chartColumns;
      const row = Math.floor(index / chartColumns);
      if (column < 0 || column >= chartColumns || row < 0 || row >= chartRows) continue;
      const topLeft = toScreen(column * chartCellKm, row * chartCellKm);
      dimSea
        .rect(
          topLeft.x,
          topLeft.y,
          chartCellKm * scale(),
          chartCellKm * scale(),
        )
        .fill(DIM_SEA_COLOR);
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
    chartBuiltRevision = -1;
  }

  /** Draw all received blocks into a small fixed texture, at most once a second. */
  function rebuildChartCache(now: number): boolean {
    if (chartBuiltRevision === chartRevision) return true;
    if (now - lastChartBuild < settings.view.chartCacheRebuildMs) return false;

    ensureChartTexture();
    const scale = chartTextureScale;
    chartGraphics.clear();

    for (const block of orderedChartBlocks(blocks)) {
      const left = block.x * scale;
      const top = block.y * scale;
      const size = block.km * scale;
      chartGraphics.rect(left, top, size, size).fill(SEA_COLOR);

      for (const ring of block.fill) {
        if (ring.length < 6) continue;
        const points: number[] = [];
        for (let index = 0; index < ring.length; index += 2) {
          points.push(ring[index]! * scale, ring[index + 1]! * scale);
        }
        chartGraphics.poly(points).fill(LAND_COLOR);
      }

      for (const line of block.coast) {
        if (line.length < 4) continue;
        chartGraphics.moveTo(line[0]! * scale, line[1]! * scale);
        for (let index = 2; index < line.length; index += 2) {
          chartGraphics.lineTo(line[index]! * scale, line[index + 1]! * scale);
        }
        chartGraphics.stroke({
          width: settings.view.coastLinePx,
          color: INK_COLOR,
          alpha: 1,
          cap: "round",
          join: "round",
        });
      }
    }

    app.renderer.render({
      container: chartBuildLayer,
      target: chartTexture!,
      clear: true,
      clearColor: PAPER_COLOR,
    });
    chartBuiltRevision = chartRevision;
    lastChartBuild = now;
    return true;
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
      if (rebuildChartCache(now)) {
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
    const dataChanged = builtRevision !== chartRevision;

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

    const own = ships.get(ownId);
    if (!own) {
      liveMapLayer.visible = false;
      liveHalo.clear();
      return;
    }

    liveMapLayer.visible = true;
    liveBlockLayer.visible = true;
    const radiusPx = settings.fog.sightRangeKm * builtScale;
    const featherPx = settings.fog.sightFeatherKm * builtScale;
    const centre = builtScreen(own.x, own.y);
    const screenCentre = toScreen(own.x, own.y);

    liveSea.circle(centre.x, centre.y, radiusPx).fill(SEA_COLOR);
    liveMask.circle(centre.x, centre.y, radiusPx).fill(0xffffff);

    // A ring per step, each wider and fainter, softens the sight edge without
    // a texture or a filter.
    liveHalo.clear();
    const rings = settings.view.sightFeatherRings;
    for (let ring = 1; ring <= rings; ring += 1) {
      const share = ring / rings;
      liveHalo
        .circle(screenCentre.x, screenCentre.y, radiusPx + featherPx * share)
        .stroke({
          width: Math.max(1, featherPx / rings),
          color: SEA_COLOR,
          alpha: settings.view.sightFeatherAlpha * (1 - share * 0.7),
        });
    }
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

  function makeHull(own: boolean): Graphics {
    const hull = new Graphics();
    const size = own ? 1 : 0.85;

    hull
      .poly([
        0, -13 * size,
        5 * size, -4 * size,
        4.5 * size, 7 * size,
        0, 10 * size,
        -4.5 * size, 7 * size,
        -5 * size, -4 * size,
      ])
      .fill(own ? 0x244a66 : 0x2c4655)
      .stroke({ width: 1.4, color: own ? 0xf3e7cb : 0x1b2f3d });

    if (own) hull.circle(0, 0, 17).stroke({ width: 1.5, color: 0x8c1d1d });
    return hull;
  }

  function updateHud(own: [string, string, number, number, number, number] | undefined): void {
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

  function addBlock(raw: unknown): boolean {
    if (!raw || typeof raw !== "object") return false;
    const block = raw as Partial<ChartBlock>;
    if (
      typeof block.id !== "string" ||
      typeof block.x !== "number" ||
      typeof block.y !== "number" ||
      typeof block.km !== "number" ||
      !Array.isArray(block.fill) ||
      !Array.isArray(block.coast)
    ) {
      return false;
    }

    const fill = block.fill.filter(
      (ring): ring is number[] =>
        Array.isArray(ring) &&
        ring.length >= 6 &&
        ring.every((point) => typeof point === "number" && Number.isFinite(point)),
    );
    const coast = block.coast.filter(
      (line): line is number[] =>
        Array.isArray(line) &&
        line.length >= 4 &&
        line.every((point) => typeof point === "number" && Number.isFinite(point)),
    );
    if (fill.length === 0 && coast.length === 0) return false;

    blocks.set(block.id, {
      id: block.id,
      x: block.x,
      y: block.y,
      km: block.km,
      fill,
      coast,
    });
    return true;
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
      if (typeof text === "string" && text.length <= 120) showNotice(text);
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
      chartAll = chart.all === true;
      if (Array.isArray(chart.cells)) {
        for (const index of chart.cells) {
          if (Number.isInteger(index) && index >= 0 && index < chartColumns * chartRows) {
            discovered.add(index);
          }
        }
      }
      if (Array.isArray(chart.blocks)) {
        for (const block of chart.blocks) {
          dataChanged = addBlock(block) || dataChanged;
        }
      }
    }

    if (dataChanged) chartRevision += 1;

    const seen = new Set<string>();
    let own: [string, string, number, number, number, number] | undefined;

    for (const snapshot of state.ships) {
      const [id, classId, x, y, headingDeg, knots] = snapshot;
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
        const hull = makeHull(id === state.you);
        fleetLayer.addChild(hull);
        ship = {
          hull,
          classId: String(classId),
          x,
          y,
          heading: headingDeg * (Math.PI / 180),
          targetX: x,
          targetY: y,
          targetHeading: headingDeg * (Math.PI / 180),
        };
        ships.set(id, ship);
      }

      ship.classId = String(classId);
      ship.targetX = x;
      ship.targetY = y;
      ship.targetHeading = headingDeg * (Math.PI / 180);
      if (id === state.you) own = snapshot;
    }

    for (const [id, ship] of ships) {
      if (!seen.has(id)) {
        ship.hull.destroy();
        ships.delete(id);
      }
    }

    const ownShip = ships.get(ownId);
    if (ownShip && builtRevision < 0) {
      view.x = ownShip.x;
      view.y = ownShip.y;
    }

    if (own) {
      updateHud(own);
      if (target) {
        const distance = Math.hypot(own[2] - target.x, own[3] - target.y);
        if (distance <= settings.sailing.arrivalRadiusKm) {
          target = null;
          marker.visible = false;
        }
      }
    }

    lastSeen = Array.isArray(state.l) ? state.l : [];
    drawLastSeen();
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
    const url = `${scheme}://${location.host}/ws?room=${encodeURIComponent(room)}&player=${encodeURIComponent(identity.id)}${botsQuery}`;
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
    target = { x, y };
    const screen = toScreen(x, y);
    marker.position.set(screen.x, screen.y);
    marker.visible = true;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: "o", x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) }));
    } else {
      setStatus("Not connected yet; the order was not sent.", true);
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

    refreshMap(now, true);
    refreshFogPaper();
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
      const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
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

  versionNotice.addEventListener("click", () => location.reload());

  // ---- Frame loop ---------------------------------------------------------

  app.ticker.add(() => {
    const now = performance.now();
    if (app.screen.width !== lastWidth || app.screen.height !== lastHeight) {
      lastWidth = app.screen.width;
      lastHeight = app.screen.height;
      drawGrain();
      refreshMap(now, true);
    }

    const dt = Math.min(0.1, app.ticker.deltaMS / 1000);
    updateClockAndNight(now);
    const own = ships.get(ownId);

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
      ship.hull.visible =
        screen.x > -90 && screen.x < app.screen.width + 90 &&
        screen.y > -90 && screen.y < app.screen.height + 90;
    }

    refreshMap(now);
    refreshFogPaper();
    updateLiveCircles();
    updateLayerOffset();

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
