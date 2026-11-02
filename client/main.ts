// Armada's 1805 browser client.
//
// The server owns the world. This file draws what it is sent, smooths ship
// movement between updates, and sends sail-to orders. It never predicts or
// changes the world on its own.

import { Application, Container, Graphics } from "pixi.js";
import { settings } from "@naval/shared/settings";
import type { StateMessage } from "@naval/shared/world";

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
    background: 0x7c948a,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
  });
  root.appendChild(app.canvas);

  const layer = new Container();
  const marker = new Graphics();
  marker.circle(0, 0, 9).stroke({ width: 2, color: 0x2a1c10 });
  marker.moveTo(-14, 0).lineTo(-7, 0).stroke({ width: 2, color: 0x2a1c10 });
  marker.moveTo(7, 0).lineTo(14, 0).stroke({ width: 2, color: 0x2a1c10 });
  marker.moveTo(0, -14).lineTo(0, -7).stroke({ width: 2, color: 0x2a1c10 });
  marker.moveTo(0, 7).lineTo(0, 14).stroke({ width: 2, color: 0x2a1c10 });
  marker.visible = false;
  app.stage.addChild(layer, marker);

  const view: { x: number; y: number; kmAcross: number; follow: boolean } = {
    x: settings.world.startArea.x,
    y: settings.world.startArea.y,
    kmAcross: settings.view.startKmAcross,
    follow: true,
  };

  const ships = new Map<string, ShipView>();
  let ownId = "";
  let socket: WebSocket | null = null;
  let target: { x: number; y: number } | null = null;
  let retry: number | null = null;

  const scale = (): number => app.screen.width / view.kmAcross;

  function toScreen(x: number, y: number): { x: number; y: number } {
    const s = scale();
    return {
      x: app.screen.width / 2 + (x - view.x) * s,
      y: app.screen.height / 2 - (y - view.y) * s,
    };
  }

  function toWorld(screenX: number, screenY: number): { x: number; y: number } {
    const s = scale();
    return {
      x: view.x + (screenX - app.screen.width / 2) / s,
      y: view.y - (screenY - app.screen.height / 2) / s,
    };
  }

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.dataset.state = isError ? "error" : "ok";
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
    let message: StateMessage;
    try {
      message = JSON.parse(String(event.data)) as StateMessage;
    } catch {
      return;
    }
    if (!message || message.t !== "s" || !Array.isArray(message.ships)) return;

    ownId = message.you;
    const windFrom = message.w;
    windArrow.setAttribute("transform", `rotate(${(windFrom + 180) % 360} 12 12)`);
    windLabel.textContent = `Wind from ${compassPoint(windFrom)} (${Math.round(windFrom)}°)`;

    const seen = new Set<string>();
    let own: [string, string, number, number, number, number] | undefined;

    for (const snapshot of message.ships) {
      const [id, , x, y, headingDeg, knots] = snapshot;
      seen.add(id);

      let ship = ships.get(id);
      if (!ship) {
        const hull = makeHull(id === message.you);
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
      if (id === message.you) own = snapshot;
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
    marker.position.set(...([toScreen(x, y).x, toScreen(x, y).y] as const));
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
      view.y += dy / scale();
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
