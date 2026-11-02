// Armada's 1805 browser client.
//
// The server owns the world and the private chart. This client only draws what
// visibleStateFor() sends: the ship view, the remembered chart, live sight
// circles and short-lived last-seen markers. It never predicts the world.

import { Application, Container, Graphics, Text } from "pixi.js";
import { settings } from "@naval/shared/settings";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM, lonLatToMap } from "@naval/shared/map";
import {
  chartCellKm,
  chartColumns,
  chartRows,
  type ChartBlock,
  type RoomKind,
} from "@naval/shared/fog";
import type { LastSeenSnapshot, StateMessage } from "@naval/shared/world";
import {
  cellNeedsPaper,
  fogDebugLine,
  type FogDebugInfo,
} from "@naval/shared/fog-view";

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

const WHOLE_MAP_MARGIN = 1.03;
const CHART_REBUILD_MS = 360;

// ---------------------------------------------------------------------------
// UI size, remembered between visits.
// ---------------------------------------------------------------------------

type UiSize = "small" | "medium" | "large";

const UI_SIZE_KEY = "armadas.uiSize";
const PLAYER_KEY = "armadas.playerId";

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

function playerId(): string {
  try {
    const saved = localStorage.getItem(PLAYER_KEY);
    if (saved && /^[A-Za-z0-9_-]{1,40}$/.test(saved)) return saved;
  } catch {
    // Fall through and make a fresh id.
  }

  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(PLAYER_KEY, id);
  } catch {
    // The id still works for this visit.
  }
  return id;
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
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
  });
  root.appendChild(app.canvas);

  // The screen layers are in screen pixels. The three chart layers (known
  // land, live land and the live mask) are built for one camera snapshot and
  // then shifted while the player pans.
  const grainLayer = new Container();
  const grain = new Graphics();
  grainLayer.addChild(grain);

  const knownSea = new Graphics();
  const unknownPaper = new Graphics();
  const liveHalo = new Graphics();

  const mapLayer = new Container();
  const mapFill = new Graphics();
  const mapWater = new Graphics();
  const mapCoast = new Graphics();
  mapLayer.addChild(mapFill, mapWater, mapCoast);

  const liveMapLayer = new Container();
  const liveSea = new Graphics();
  const liveFill = new Graphics();
  const liveWater = new Graphics();
  const liveCoast = new Graphics();
  const liveMaskLayer = new Container();
  const liveMask = new Graphics();
  liveMask.renderable = false;
  liveMaskLayer.addChild(liveMask);
  liveMapLayer.addChild(liveSea, liveFill, liveWater, liveCoast);
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
  const rulerLayer = new Container();
  const rulerLine = new Graphics();
  const rulerText = new Text({
    text: "",
    style: { fontFamily: "Source Sans 3", fontSize: 12, fill: INK_COLOR },
  });
  rulerLayer.addChild(rulerLine, rulerText);
  rulerLayer.visible = false;

  app.stage.addChild(
    knownSea,
    mapLayer,
    unknownPaper,
    liveHalo,
    liveMapLayer,
    liveMaskLayer,
    lastSeenLayer,
    fleetLayer,
    windLayer,
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

  let roomKind: RoomKind = "normal";
  let chartAll = false;
  let debugInfo: FogDebugInfo = {};
  const receivedAt: number[] = [];
  let receivedGapMaxMs = 0;
  let ownId = "";
  let socket: WebSocket | null = null;
  let target: { x: number; y: number } | null = null;
  let retry: number | null = null;
  let noticeTimer = 0;
  let noticeHideTimer = 0;
  let windFrom: number = settings.weather.windFromDeg;

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

  function visibleCellRange(): {
    firstColumn: number;
    lastColumn: number;
    firstRow: number;
    lastRow: number;
  } {
    const s = scale();
    const halfWidth = app.screen.width / (2 * s);
    const halfHeight = app.screen.height / (2 * s);
    return {
      firstColumn: Math.max(0, Math.floor((view.x - halfWidth) / chartCellKm)),
      lastColumn: Math.min(
        chartColumns - 1,
        Math.floor((view.x + halfWidth) / chartCellKm),
      ),
      firstRow: Math.max(0, Math.floor((view.y - halfHeight) / chartCellKm)),
      lastRow: Math.min(chartRows - 1, Math.floor((view.y + halfHeight) / chartCellKm)),
    };
  }

  function screenCellRect(column: number, row: number): [number, number, number, number] {
    const left = toScreen(column * chartCellKm, row * chartCellKm);
    const right = toScreen((column + 1) * chartCellKm, (row + 1) * chartCellKm);
    return [left.x, left.y, right.x - left.x, right.y - left.y];
  }

  /**
   * Paint remembered sea and cover everything still unknown in paper. The live
   * circles are excluded from the paper cover; they are painted brightly above.
   */
  function refreshFogPaper(): void {
    knownSea.clear();
    unknownPaper.clear();

    if (mode === "chart" || app.screen.width <= 0) return;

    const range = visibleCellRange();

    for (let row = range.firstRow; row <= range.lastRow; row += 1) {
      for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
        const index = row * chartColumns + column;
        const [x, y, width, height] = screenCellRect(column, row);

        if (chartAll || discovered.has(index)) {
          knownSea
            .rect(x, y, width + 0.5, height + 0.5)
            .fill({ color: SEA_COLOR, alpha: settings.view.fogDimAlpha + 0.22 });
        } else if (cellNeedsPaper(index, chartAll, discovered)) {
          // Paint every unknown cell. The bright live layer is drawn above
          // this paper, so a circle never needs a cell-shaped hole.
          unknownPaper
            .rect(x, y, width + 0.5, height + 0.5)
            .fill({ color: PAPER_COLOR, alpha: 1 });
        }
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

  function drawFill(graphics: Graphics, block: ChartBlock): void {
    for (const ring of block.fill) {
      if (ring.length < 6) continue;
      const points: number[] = [];
      for (let index = 0; index < ring.length; index += 2) {
        const point = builtScreen(ring[index]!, ring[index + 1]!);
        points.push(point.x, point.y);
      }
      graphics.poly(points).fill(LAND_COLOR);
    }
  }

  function drawLines(graphics: Graphics, block: ChartBlock, width: number, color: number, alpha: number): void {
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

  function drawMap(now: number): void {
    const s = scale();
    builtView = { x: view.x, y: view.y };
    builtScale = s;
    builtRevision = chartRevision;

    mapFill.clear();
    mapWater.clear();
    mapCoast.clear();
    liveSea.clear();
    liveFill.clear();
    liveWater.clear();
    liveCoast.clear();
    liveMask.clear();

    if (app.screen.width <= 0) return;

    const left = view.x - app.screen.width / (2 * s);
    const right = view.x + app.screen.width / (2 * s);
    const top = view.y - app.screen.height / (2 * s);
    const bottom = view.y + app.screen.height / (2 * s);

    // A generous margin lets a pan move the built chart before it is rebuilt.
    const marginX = (right - left) * 1.5;
    const marginY = (bottom - top) * 1.5;
    const withMargin = {
      left: left - marginX,
      right: right + marginX,
      top: top - marginY,
      bottom: bottom + marginY,
    };

    for (const block of blocks.values()) {
      if (!blockInView(block, withMargin.left, withMargin.top, withMargin.right, withMargin.bottom)) {
        continue;
      }

      drawFill(mapFill, block);
      drawLines(mapWater, block, settings.view.waterLinePx, WATERLINE_COLOR, 0.55);
      drawLines(mapCoast, block, settings.view.coastLinePx, INK_COLOR, 1);

      if (mode === "ship") {
        drawFill(liveFill, block);
        drawLines(liveWater, block, settings.view.waterLinePx, WATERLINE_COLOR, 0.55);
        drawLines(liveCoast, block, settings.view.coastLinePx, INK_COLOR, 1);
      }
    }

    mapLayer.alpha = mode === "chart" ? 1 : settings.view.fogDimAlpha;
    lastMapBuild = now;

    // The chart is a static painted sheet. Cache it after each rebuild, and
    // leave the live ship view uncached so sight circles can move every frame.
    if (mode === "chart") {
      if (mapLayer.isCachedAsTexture) mapLayer.updateCacheTexture();
      else mapLayer.cacheAsTexture(true);
    } else if (mapLayer.isCachedAsTexture) {
      mapLayer.cacheAsTexture(false);
    }
  }

  function updateLayerOffset(): void {
    const x = (builtView.x - view.x) * builtScale;
    const y = (builtView.y - view.y) * builtScale;
    mapLayer.position.set(x, y);
    liveMapLayer.position.set(x, y);
    liveMaskLayer.position.set(x, y);
  }

  function refreshMap(now: number, force = false): void {
    if (app.screen.width <= 0 || app.screen.height <= 0) return;

    const currentScale = scale();
    const zoomChanged = Math.abs(currentScale - builtScale) > 1e-9;
    const farPan =
      builtScale > 0 &&
      (Math.abs(view.x - builtView.x) * builtScale > app.screen.width * 1.5 ||
        Math.abs(view.y - builtView.y) * builtScale > app.screen.height * 1.5);
    const dataChanged = builtRevision !== chartRevision;

    if (!force && !zoomChanged && !farPan && !dataChanged) {
      updateLayerOffset();
      return;
    }

    // A chart with every block arriving in batches should not repaint the
    // whole sheet for each batch. This throttle is only for the chart view.
    if (
      !force &&
      dataChanged &&
      !zoomChanged &&
      !farPan &&
      mode === "chart" &&
      now - lastMapBuild < CHART_REBUILD_MS
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
    const radiusPx = settings.fog.sightRangeKm * builtScale;
    const featherPx = settings.fog.sightFeatherKm * builtScale;
    const centre = builtScreen(own.x, own.y);
    const screenCentre = toScreen(own.x, own.y);

    liveSea.circle(centre.x, centre.y, radiusPx).fill(SEA_COLOR);
    liveMask.circle(centre.x, centre.y, radiusPx).fill(0xffffff);

    // A faint sea-coloured rim softens the line between sight and paper.
    liveHalo.clear();
    if (featherPx > 1) {
      liveHalo
        .circle(screenCentre.x, screenCentre.y, radiusPx + featherPx * 0.35)
        .stroke({ width: featherPx * 0.7, color: SEA_COLOR, alpha: 0.38 });
      liveHalo
        .circle(screenCentre.x, screenCentre.y, radiusPx + featherPx * 0.8)
        .stroke({ width: featherPx * 0.55, color: SEA_COLOR, alpha: 0.18 });
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
        buildCommit,
        receivedHz,
        receivedGapMaxMs: receivedAt.length >= 2 ? receivedGapMaxMs : undefined,
      },
    );
    fogDebugOut.textContent = line ?? "";
    fogDebugOut.hidden = line === null;
  }

  /**
   * Read the small version file, never from cache. The first read learns this
   * page's build; later reads only show the reload notice when it changes.
   */
  async function checkForNewVersion(first: boolean): Promise<void> {
    try {
      const response = await fetch("./version.json", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { id?: unknown; commit?: unknown };
      if (typeof data.id !== "string") return;

      if (first || !pageBuildId) pageBuildId = data.id;
      if (typeof data.commit === "string") {
        buildCommit = data.commit;
        updateDebugLine();
      }
      if (!first && data.id !== pageBuildId) versionNotice.hidden = false;
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
    if (state.k === "dev" && Array.isArray(state.d) && state.d.length >= 6) {
      const [ships, worldHz, gapAvgMs, gapMaxMs, bytesAvg, bytesMax] = state.d;
      if (
        [ships, worldHz, gapAvgMs, gapMaxMs, bytesAvg, bytesMax]
          .every((value) => typeof value === "number" && Number.isFinite(value))
      ) {
        debugInfo = { ships, worldHz, gapAvgMs, gapMaxMs, bytesAvg, bytesMax };
      }
    }

    ownId = state.you;
    windFrom = Number.isFinite(state.w) ? state.w : settings.weather.windFromDeg;
    roomKind = validRoomKind(state.k) ? state.k : "normal";
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
    const url = `${scheme}://${location.host}/ws?room=${encodeURIComponent(room)}&player=${encodeURIComponent(playerId())}${botsQuery}`;
    const next = new WebSocket(url);
    socket = next;

    next.addEventListener("open", () => setStatus("Connected"));
    next.addEventListener("message", onState);
    next.addEventListener("error", () => setStatus("Could not reach the ship. Retrying…", true));
    next.addEventListener("close", () => {
      if (socket !== next) return;
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
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
    button.addEventListener("click", () => {
      const size = button.dataset.size;
      if (size === "small" || size === "medium" || size === "large") setUiSize(size);
    });
  }

  drawGrain();
  connect();
  void checkForNewVersion(true);
  window.setInterval(
    () => void checkForNewVersion(false),
    settings.client.versionCheckMs,
  );
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkForNewVersion(false);
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
