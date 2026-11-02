// Armada's 1805 browser client.
//
// The server owns the world. This file draws the real chart tiles, smooths
// ship movement between updates, and sends sail-to orders. It never predicts
// or changes the world on its own.

import { Application, Container, Graphics } from "pixi.js";
import { settings } from "@naval/shared/settings";
import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  lonLatToMap,
} from "@naval/shared/map";
import type { StateMessage } from "@naval/shared/world";

// ---------------------------------------------------------------------------
// Chart look.
// ---------------------------------------------------------------------------

const SEA_COLOR = 0x7c948a;
const LAND_COLOR = 0xefe3c8;
const INK_COLOR = 0x2a1c10;
const WATERLINE_COLOR = 0xb79b6b;

// ---------------------------------------------------------------------------
// UI size (small / medium / large), remembered between visits.
// ---------------------------------------------------------------------------

type UiSize = "small" | "medium" | "large";

const UI_SIZE_KEY = "armadas.uiSize";
const PLAYER_KEY = "armadas.playerId";
const SIZE_ORDER: UiSize[] = ["small", "medium", "large"];

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

// ---------------------------------------------------------------------------
// Chart tile data.
// ---------------------------------------------------------------------------

interface TileData {
  z: number;
  x: number;
  y: number;
  km: number;
  fill: number[][];
  coast: number[][];
}

interface LevelInfo {
  z: number;
  km: number;
  /** Tile existence and point count, keyed as "x_y". */
  tiles: Map<string, [number, number, number]>;
}

interface TileView {
  water: Graphics;
  fill: Graphics;
  coast: Graphics;
}

interface VisibleTile {
  key: string;
  x: number;
  y: number;
  points: number;
  distance: number;
}

// ---------------------------------------------------------------------------
// Game screen.
// ---------------------------------------------------------------------------

interface ShipView {
  hull: Graphics;
  x: number;
  y: number;
  heading: number;
  targetX: number;
  targetY: number;
  targetHeading: number;
}

async function start(): Promise<void> {
  const root = element<HTMLDivElement>("game-root");
  const status = element<HTMLParagraphElement>("status");
  const speedOut = element<HTMLElement>("speed");
  const headingOut = element<HTMLElement>("heading");
  const windLabel = element<HTMLElement>("wind-label");
  const windArrow = element<SVGGElement>("wind-arrow");
  const compassNeedle = element<SVGGElement>("compass-needle");
  const followButton = element<HTMLButtonElement>("follow-btn");
  const roomOut = element<HTMLElement>("room-code");
  const charting = element<HTMLParagraphElement>("charting");
  const notice = element<HTMLParagraphElement>("notice");

  const room = new URLSearchParams(location.search).get("room") ?? "test";
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
    background: SEA_COLOR,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
  });
  root.appendChild(app.canvas);

  const mapLayer = new Container();
  const waterLayer = new Container();
  const fillLayer = new Container();
  const coastLayer = new Container();
  mapLayer.addChild(waterLayer, fillLayer, coastLayer);
  mapLayer.eventMode = "none";

  const layer = new Container();
  const marker = new Graphics();
  marker.circle(0, 0, 9).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(-14, 0).lineTo(-7, 0).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(7, 0).lineTo(14, 0).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(0, -14).lineTo(0, -7).stroke({ width: 2, color: INK_COLOR });
  marker.moveTo(0, 7).lineTo(0, 14).stroke({ width: 2, color: INK_COLOR });
  marker.visible = false;
  app.stage.addChild(mapLayer, layer, marker);

  const startPoint = lonLatToMap(
    settings.world.startArea.lonDeg,
    settings.world.startArea.latDeg,
  );
  const view: { x: number; y: number; kmAcross: number; follow: boolean } = {
    x: startPoint.x,
    y: startPoint.y,
    kmAcross: settings.view.startKmAcross,
    follow: true,
  };

  const ships = new Map<string, ShipView>();
  let ownId = "";
  let socket: WebSocket | null = null;
  let target: { x: number; y: number } | null = null;
  let retry: number | null = null;
  let noticeTimer = 0;
  let noticeHideTimer = 0;

  const levels: LevelInfo[] = [];
  const tileData = new Map<string, TileData>();
  const tileViews = new Map<string, TileView>();
  const loadingTiles = new Set<string>();
  const missingTiles = new Set<string>();

  // The map graphics are drawn in screen coordinates for one snapshot of the
  // camera. Panning only shifts the layer; a zoom rebuilds it.
  let builtView = { x: view.x, y: view.y };
  let builtScale = 0;
  let lastMapBuild = 0;
  let currentLevelZ = -1;

  const scale = (): number => app.screen.width / view.kmAcross;

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

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.dataset.state = isError ? "error" : "ok";
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

  // ---- Chart tiles ---------------------------------------------------------

  async function loadManifest(): Promise<void> {
    charting.hidden = false;
    try {
      const response = await fetch("./tiles/index.json");
      if (!response.ok) throw new Error(`tiles ${response.status}`);
      const body = (await response.json()) as {
        levels?: Array<{ z?: unknown; km?: unknown; tiles?: unknown }>;
      };

      if (!Array.isArray(body.levels)) throw new Error("tile index has no levels");

      for (const rawLevel of body.levels) {
        const z = Number(rawLevel.z);
        const km = Number(rawLevel.km);
        if (!Number.isInteger(z) || !(km > 0) || !Array.isArray(rawLevel.tiles)) continue;

        const tiles = new Map<string, [number, number, number]>();
        for (const rawTile of rawLevel.tiles) {
          if (!Array.isArray(rawTile) || rawTile.length < 3) continue;
          const x = Number(rawTile[0]);
          const y = Number(rawTile[1]);
          const points = Number(rawTile[2]);
          if (Number.isInteger(x) && Number.isInteger(y) && Number.isFinite(points)) {
            tiles.set(`${x}_${y}`, [x, y, points]);
          }
        }
        levels.push({ z, km, tiles });
      }

      levels.sort((a, b) => a.z - b.z);
    } catch (error) {
      charting.hidden = true;
      setStatus(
        `The chart could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }

  function visibleTiles(level: LevelInfo): VisibleTile[] {
    const halfWidth = view.kmAcross / 2;
    const halfHeight = halfWidth * (app.screen.height / app.screen.width);
    const left = view.x - halfWidth;
    const right = view.x + halfWidth;
    const top = view.y - halfHeight;
    const bottom = view.y + halfHeight;

    const columns = Math.ceil(MAP_WIDTH_KM / level.km);
    const rows = Math.ceil(MAP_HEIGHT_KM / level.km);
    const firstColumn = Math.max(0, Math.floor(left / level.km));
    const lastColumn = Math.min(columns - 1, Math.floor(right / level.km));
    const firstRow = Math.max(0, Math.floor(top / level.km));
    const lastRow = Math.min(rows - 1, Math.floor(bottom / level.km));

    const result: VisibleTile[] = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const entry = level.tiles.get(`${column}_${row}`);
        if (!entry) continue;

        const centreX = (column + 0.5) * level.km;
        const centreY = (row + 0.5) * level.km;
        result.push({
          key: `${level.z}/${column}_${row}`,
          x: column,
          y: row,
          points: entry[2],
          distance: Math.hypot(centreX - view.x, centreY - view.y),
        });
      }
    }

    result.sort((a, b) => a.distance - b.distance);
    return result;
  }

  function pickLevel(): LevelInfo | null {
    if (levels.length === 0) return null;

    const desired =
      levels.find((level) => level.km <= view.kmAcross * settings.view.tileLevelPickFactor) ??
      levels[levels.length - 1]!;
    const desiredIndex = levels.indexOf(desired);

    // Start at the right detail level; step coarser only if this view would
    // otherwise draw too many points.
    for (let index = desiredIndex; index >= 0; index -= 1) {
      const level = levels[index]!;
      const points = visibleTiles(level).reduce((total, tile) => total + tile.points * 2, 0);
      if (points <= settings.view.maxDrawnPoints) return level;
    }

    return desired;
  }

  function screenPoint(x: number, y: number): [number, number] {
    return [
      app.screen.width / 2 + (x - builtView.x) * builtScale,
      app.screen.height / 2 + (y - builtView.y) * builtScale,
    ];
  }

  function drawSmoothPath(graphics: Graphics, points: number[]): void {
    if (points.length < 4) return;

    graphics.moveTo(points[0]!, points[1]!);
    if (points.length === 4) {
      graphics.lineTo(points[2]!, points[3]!);
      return;
    }

    for (let index = 2; index < points.length - 2; index += 2) {
      const midX = (points[index]! + points[index + 2]!) / 2;
      const midY = (points[index + 1]! + points[index + 3]!) / 2;
      graphics.quadraticCurveTo(points[index]!, points[index + 1]!, midX, midY);
    }

    graphics.lineTo(points[points.length - 2]!, points[points.length - 1]!);
  }

  function addTileView(key: string, data: TileData): void {
    const water = new Graphics();
    const fill = new Graphics();
    const coast = new Graphics();

    for (const ring of data.fill) {
      if (ring.length < 6) continue;
      const points: number[] = [];
      for (let index = 0; index < ring.length; index += 2) {
        const [x, y] = screenPoint(ring[index]!, ring[index + 1]!);
        points.push(x, y);
      }
      fill.poly(points).fill(LAND_COLOR);
    }

    for (const line of data.coast) {
      if (line.length < 4) continue;
      const points: number[] = [];
      for (let index = 0; index < line.length; index += 2) {
        const [x, y] = screenPoint(line[index]!, line[index + 1]!);
        points.push(x, y);
      }

      drawSmoothPath(water, points);
      drawSmoothPath(coast, points);
    }

    if (data.coast.length > 0) {
      water.stroke({
        width: settings.view.waterLinePx,
        color: WATERLINE_COLOR,
        alpha: 0.55,
        cap: "round",
        join: "round",
      });
      coast.stroke({
        width: settings.view.coastLinePx,
        color: INK_COLOR,
        cap: "round",
        join: "round",
      });
    }

    waterLayer.addChild(water);
    fillLayer.addChild(fill);
    coastLayer.addChild(coast);
    tileViews.set(key, { water, fill, coast });
  }

  function destroyTileView(key: string): void {
    const view = tileViews.get(key);
    if (!view) return;

    view.water.destroy();
    view.fill.destroy();
    view.coast.destroy();
    tileViews.delete(key);
  }

  function clearTileViews(): void {
    for (const key of [...tileViews.keys()]) destroyTileView(key);
  }

  function requestTile(level: LevelInfo, tile: VisibleTile): void {
    if (tileData.has(tile.key) || loadingTiles.has(tile.key) || missingTiles.has(tile.key)) {
      return;
    }

    loadingTiles.add(tile.key);
    void fetch(`./tiles/${tile.key}.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`tile ${response.status}`);
        const data = (await response.json()) as TileData;
        if (!data || !Array.isArray(data.fill) || !Array.isArray(data.coast)) {
          throw new Error("tile has no geometry");
        }
        tileData.set(tile.key, data);
      })
      .catch(() => {
        // A missing tile is simply open sea; the rest of the chart stays usable.
        missingTiles.add(tile.key);
      })
      .finally(() => {
        loadingTiles.delete(tile.key);
      });
  }

  function updateMapOffset(): void {
    mapLayer.position.set(
      (builtView.x - view.x) * builtScale,
      (builtView.y - view.y) * builtScale,
    );
  }

  function refreshChart(now: number, force = false): void {
    if (levels.length === 0 || app.screen.width <= 0) return;

    const currentScale = scale();
    const zoomChanged = Math.abs(currentScale - builtScale) > 1e-9;
    const farPan =
      builtScale > 0 &&
      (Math.abs(view.x - builtView.x) * builtScale > app.screen.width * 1.5 ||
        Math.abs(view.y - builtView.y) * builtScale > app.screen.height * 1.5);

    if (force || zoomChanged || farPan) {
      // Throttle pinch rebuilds so a phone is not re-tessellating every frame.
      if (!force && !farPan && now - lastMapBuild < 120) {
        updateMapOffset();
        return;
      }
      clearTileViews();
      builtView = { x: view.x, y: view.y };
      builtScale = currentScale;
      lastMapBuild = now;
    }

    if (Math.abs(currentScale - builtScale) > 1e-9) {
      updateMapOffset();
      return;
    }

    const level = pickLevel();
    if (!level) return;

    if (level.z !== currentLevelZ) {
      clearTileViews();
      currentLevelZ = level.z;
    }

    const visible = visibleTiles(level);
    let points = 0;
    const selected: VisibleTile[] = [];
    for (const tile of visible) {
      const cost = tile.points * 2;
      if (points + cost > settings.view.maxDrawnPoints) continue;
      points += cost;
      selected.push(tile);
    }

    const wanted = new Set(selected.map((tile) => tile.key));
    for (const key of [...tileViews.keys()]) {
      if (!wanted.has(key)) destroyTileView(key);
    }

    let waiting = false;
    for (const tile of selected) {
      const data = tileData.get(tile.key);
      if (data) {
        if (!tileViews.has(tile.key)) addTileView(tile.key, data);
      } else if (!missingTiles.has(tile.key)) {
        waiting = true;
        requestTile(level, tile);
      }
    }

    charting.hidden = !waiting;
    updateMapOffset();
  }

  // ---- Ships and HUD -------------------------------------------------------

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

    if (own) {
      // A wax-red ring marks your own ship.
      hull.circle(0, 0, 17).stroke({ width: 1.5, color: 0x8c1d1d });
    }
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

    ownId = state.you;
    const windFrom = state.w;
    windArrow.setAttribute("transform", `rotate(${(windFrom + 180) % 360} 12 12)`);
    windLabel.textContent = `Wind from ${compassPoint(windFrom)} (${Math.round(windFrom)}°)`;

    const seen = new Set<string>();
    let own: [string, string, number, number, number, number] | undefined;

    for (const snapshot of state.ships) {
      const [id, , x, y, headingDeg, knots] = snapshot;
      seen.add(id);

      let ship = ships.get(id);
      if (!ship) {
        const hull = makeHull(id === state.you);
        layer.addChild(hull);
        ship = {
          hull,
          x,
          y,
          heading: headingDeg * (Math.PI / 180),
          targetX: x,
          targetY: y,
          targetHeading: headingDeg * (Math.PI / 180),
        };
        ships.set(id, ship);
      }

      ship.targetX = x;
      ship.targetY = y;
      ship.targetHeading = headingDeg * (Math.PI / 180);
      if (id === state.you) own = snapshot;
    }

    // Ships that left the room are removed from the view.
    for (const [id, ship] of ships) {
      if (!seen.has(id)) {
        ship.hull.destroy();
        ships.delete(id);
      }
    }

    if (own) {
      updateHud(own);

      // Hide the marker once we are close enough to count as arrived.
      if (target) {
        const distance = Math.hypot(own[2] - target.x, own[3] - target.y);
        if (distance <= settings.sailing.arrivalRadiusKm) {
          target = null;
          marker.visible = false;
        }
      }
    }

    setStatus("Connected");
  }

  function connect(): void {
    if (!location.host) {
      setStatus("Open this page from the game server to sail.", true);
      return;
    }

    setStatus("Connecting…");
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const url = `${scheme}://${location.host}/ws?room=${encodeURIComponent(room)}&player=${encodeURIComponent(playerId())}`;
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

  // ---- Camera and input ---------------------------------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  let dragDistance = 0;
  let downAt = 0;
  let multiTouch = false;
  let pinchStartDistance = 0;
  let pinchStartKm = view.kmAcross;

  function setFollow(on: boolean): void {
    view.follow = on;
    followButton.setAttribute("aria-pressed", String(on));
  }

  function zoomTo(kmAcross: number): void {
    view.kmAcross = clamp(kmAcross, settings.view.minKmAcross, settings.view.maxKmAcross);
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

  followButton.addEventListener("click", () => setFollow(!view.follow));

  // ---- Frame loop ---------------------------------------------------------

  app.ticker.add(() => {
    refreshChart(performance.now());

    const dt = Math.min(0.1, app.ticker.deltaMS / 1000);
    const own = ships.get(ownId);

    if (view.follow && own) {
      view.x = own.x;
      view.y = own.y;
    }

    const k = 1 - Math.exp(-7 * dt);
    for (const ship of ships.values()) {
      ship.x += (ship.targetX - ship.x) * k;
      ship.y += (ship.targetY - ship.y) * k;
      ship.heading += shortestRadians(ship.targetHeading - ship.heading) * k;

      const screen = toScreen(ship.x, ship.y);
      ship.hull.position.set(screen.x, screen.y);
      ship.hull.rotation = ship.heading;
      ship.hull.visible =
        screen.x > -80 && screen.x < app.screen.width + 80 &&
        screen.y > -80 && screen.y < app.screen.height + 80;
    }

    if (target && marker.visible) {
      const screen = toScreen(target.x, target.y);
      marker.position.set(screen.x, screen.y);
    }
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-size]")) {
    button.addEventListener("click", () => {
      const size = button.dataset.size;
      if (size === "small" || size === "medium" || size === "large") setUiSize(size);
    });
  }

  await loadManifest();
  refreshChart(performance.now(), true);
  connect();
}

setUiSize(readSavedSize());
void start().catch((error: unknown) => {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = `The sea could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
    status.dataset.state = "error";
  }
});
