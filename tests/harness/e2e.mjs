// Real-client end-to-end harness.
//
// - jsdom runs the actual built client bundle.
// - PixiJS is replaced by tests/harness/pixi-stub.mjs, which keeps a display
//   tree and records drawings.
// - The socket is an in-memory bridge to a real GameRoom, world loop and world.
// - Buttons are found by visible text and clicked; the canvas is tapped by
//   converting a world position through the client's own camera.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

import { settings } from "@naval/shared/settings";
import { addPlayer, removeTestDummies, shipsForOwner, spawnTestFireShips } from "@naval/shared/world";
import { towSpeedKnots } from "../../shared/dist/fireShip.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { GameRoom } = await import(resolve(root, "server/dist/gameRoom.js"));

const bundle = await build({
  entryPoints: [resolve(root, "client/main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  alias: { "pixi.js": resolve(here, "pixi-stub.mjs") },
  logLevel: "silent",
});
const clientCode = bundle.outputFiles[0].text;
const html = readFileSync(resolve(root, "client/index.html"), "utf8");

let virtualNow = 0;
let roomInterval = null;
const clientWindows = [];
const sockets = new Set();

class PairClient {
  constructor() { this.target = null; this.queue = []; }
  _deliver(data) {
    if (this.target) this.target._receive(data);
    else this.queue.push(data);
  }
  _emitClose() { this.target?._closeFromServer(); }
}
class ServerSocket {
  constructor(client) {
    this.client = client;
    this.listeners = new Map();
    this.bufferedAmount = 0;
  }
  accept() {}
  addEventListener(type, callback) {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  send(data) { this.client._deliver(data); }
  close() {
    for (const callback of this.listeners.get("close") ?? []) callback();
  }
  _message(data) {
    for (const callback of this.listeners.get("message") ?? []) callback({ data });
  }
}
class WebSocketPair {
  constructor() {
    const client = new PairClient();
    const server = new ServerSocket(client);
    this[0] = client;
    this[1] = server;
    globalThis.__lastPair = this;
  }
}
class InMemoryWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  constructor(url) {
    this.url = url;
    this.readyState = InMemoryWebSocket.CONNECTING;
    this.listeners = new Map();
    sockets.add(this);
    void this._connect();
  }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  _emit(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }
  _receive(data) { this._emit("message", { data }); }
  _closeFromServer() {
    this.readyState = InMemoryWebSocket.CLOSED;
    this._emit("close", {});
  }
  async _connect() {
    try {
      const response = await bootRoom.fetch(new Request(this.url, {
        headers: { Upgrade: "websocket" },
      }));
      this.pair = globalThis.__lastPair;
      this.pair[0].target = this;
      this.readyState = InMemoryWebSocket.OPEN;
      for (const data of this.pair[0].queue.splice(0)) this._receive(data);
      this._emit("open", {});
      this.send(JSON.stringify({ t: "resync" }));
    } catch (error) {
      console.error("harness socket failed", error);
      this._emit("error", { error });
    }
  }
  send(data) {
    if (this.readyState !== InMemoryWebSocket.OPEN) return;
    this.pair[1]._message(data);
  }
  close() {
    this.readyState = InMemoryWebSocket.CLOSED;
    this.pair?.[1]?.close();
    this._emit("close", {});
  }
}

let bootRoom = null;
function installVirtualClock() {
  virtualNow = 1_000_000;
  Date.now = () => virtualNow;
  globalThis.setInterval = (callback) => {
    roomInterval = callback;
    return 1;
  };
  globalThis.clearInterval = () => { roomInterval = null; };
}
function advanceMs(ms) {
  const steps = Math.max(1, Math.round(ms / 100));
  for (let step = 0; step < steps; step += 1) {
    virtualNow += 100;
    // Some client messages can stop the room's real interval in their own
    // timer bookkeeping while the socket still lives; drive the real room tick
    // directly so simulated time keeps moving.
    if (roomInterval) roomInterval();
    else bootRoom?.tick?.();
    for (const window of clientWindows) {
      for (const callback of window.__pixiTickerCallbacks ?? []) callback();
    }
  }
}

async function bootClient(query, width = 1280, height = 800) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.sendTo(console);
  const dom = new JSDOM(html, {
    url: `http://localhost/?${query}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  clientWindows.push(window);
  window.innerWidth = width;
  window.innerHeight = height;
  window.devicePixelRatio = 1;
  window.matchMedia = () => ({ matches: width <= 640, addEventListener() {}, removeEventListener() {} });
  window.confirm = () => true;
  window.WebSocket = InMemoryWebSocket;
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.ArrayBuffer = ArrayBuffer;
  window.Uint8Array = Uint8Array;
  window.DataView = DataView;
  window.crypto ??= globalThis.crypto;
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.HTMLCanvasElement.prototype.releasePointerCapture = () => {};
  // jsdom has no layout engine. The 3K shell writes real px rectangles into
  // inline styles, so the harness can measure those same boxes. A browser uses
  // the real getBoundingClientRect() without this shim.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hidden) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const style = this.style;
    const left = Number.parseFloat(style.left);
    const top = Number.parseFloat(style.top);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    if (style.position === "fixed" && Number.isFinite(left) && Number.isFinite(top) &&
        Number.isFinite(width) && Number.isFinite(height)) {
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
    const slot = this.closest(".game-slot");
    const slotStyle = slot && slot !== this ? slot.style : null;
    const slotLeft = Number.parseFloat(slotStyle?.left ?? "");
    const slotTop = Number.parseFloat(slotStyle?.top ?? "");
    if (Number.isFinite(slotLeft) && Number.isFinite(slotTop)) {
      return { left: slotLeft + 6, top: slotTop + 6, width: 44, height: 44,
        right: slotLeft + 50, bottom: slotTop + 50 };
    }
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  window.Date.now = () => virtualNow;
  Object.defineProperty(window.performance, "now", { value: () => virtualNow });
  window.eval(clientCode);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
  return { dom, window, document: window.document };
}

function buttonByText(client, text) {
  const matches = [...client.document.querySelectorAll("button")].filter((button) =>
    (button.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(text),
  );
  return matches[0] ?? null;
}
function clickButton(client, text) {
  const button = buttonByText(client, text);
  assert.ok(button, `button starting with "${text}" exists`);
  assert.equal(button.disabled, false, `button "${text}" is enabled`);
  button.click();
  return button;
}
function tapWorld(client, x, y) {
  // The harness taps through the real map-tap handler. The canvas pointer
  // events themselves are covered by the client's own browser use; jsdom has
  // no PointerEvent implementation.
  client.window.__armadaTest.tapWorld(x, y);
}
function zoomBy(client, deltaY) {
  const canvas = client.document.querySelector("canvas");
  canvas.dispatchEvent(new client.window.WheelEvent("wheel", {
    bubbles: true, cancelable: true, deltaY,
  }));
}
function shipById(client, id) {
  return client.window.__armadaTest.fleet().find((ship) => ship.id === id);
}
function selectedFleetIdForTest(client) {
  const id = client.window.__armadaTest.selectedShipId();
  const row = client.window.__armadaTest.fleet().find((ship) => ship.id === id);
  return row?.fleetId ?? null;
}
function drawShip(client, id) {
  return client.window.__armadaTest.drawPlan().find((ship) => ship.id === id);
}
function worldFleet(room, playerId) {
  return shipsForOwner(room.world, playerId);
}
function notices(client) {
  return client.document.getElementById("notice")?.textContent ?? "";
}

// ---- Boot one real room and one real client ------------------------------

installVirtualClock();
bootRoom = new GameRoom();
const realResponse = globalThis.Response;
globalThis.WebSocketPair = WebSocketPair;
const alphaResponseClass = class CapturingResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
};
globalThis.Response = alphaResponseClass;
const alpha = await bootClient("room=test-fix-a&fireship=2&perf=1&as=alpha");

await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
advanceMs(1_000);
globalThis.Response = realResponse;

assert.ok(alpha.window.__armadaTest, "client test surface exists");
assert.ok(alpha.window.__armadaTest.tick() > 0, "real GameRoom sent a real tick");
let fleet = alpha.window.__armadaTest.fleet();
assert.equal(fleet.filter((ship) => ship.classId === "fireShip").length, 2, "two fire ships spawned");
const alphaId = [...bootRoom.world.fleets.keys()][0];
assert.ok(alphaId, "real room has the client player");
// Keep the second fire ship clear of the first burn.
const secondFireWorld = worldFleet(bootRoom, alphaId).filter((ship) => ship.classId === "fireShip")[1];
assert.ok(secondFireWorld);
secondFireWorld.x += 5;
secondFireWorld.y += 2;
// A second anchored fleet, 80 m downwind, to prove the hulk can spread fire.
addPlayer(bootRoom.world, "downwind", "frigate", 50_000, "Spanish");
spawnTestFireShips(bootRoom.world, "downwind", 2);
const downwindFleet = worldFleet(bootRoom, "downwind").filter((ship) => ship.classId === "fireShip");
assert.equal(downwindFleet.length, 2, "second fleet spawned");

// ---- a. Ignite now: the hulk must remain drawn and then sink ------------

const fire = fleet.find((ship) => ship.classId === "fireShip");
tapWorld(alpha, fire.x, fire.y);
assert.equal(alpha.window.__armadaTest.selectedShipId(), fire.id, "tapped the fire ship");
clickButton(alpha, "Ignite now");
advanceMs(300);

// Place the second fleet 80 m downwind of the burning hulk.
const hulkWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === fire.id);
assert.ok(hulkWorld, "hulk is still in the fleet after ignition");
for (const [index, ship] of downwindFleet.entries()) {
  ship.x = hulkWorld.x + 0.08;
  ship.y = hulkWorld.y + (index - 0.5) * 0.01;
  ship.speedKnots = 0;
  ship.hoveTo = true;
  ship.order = null;
}
advanceMs(500);
let spreadSeen = false;
const table = [];
let sawDrawnBurning = 0;
for (let second = 10; second <= 240; second += 10) {
  advanceMs(10_000);
  const row = shipById(alpha, fire.id);
  const drawn = drawShip(alpha, fire.id);
  const serverHulk = worldFleet(bootRoom, alphaId).find((ship) => ship.id === fire.id);
  if (row?.burning && drawn?.visible && drawn?.burning) sawDrawnBurning += 1;
  if (downwindFleet.some((ship) => ship.fire?.burning)) spreadSeen = true;
  table.push({
    second,
    present: Boolean(row),
    burning: row?.burning === true,
    hull: serverHulk ? Math.round(serverHulk.damage.hull) : null,
    drawn: drawn?.visible === true,
  });
}
console.log("Ignite now state every 10 s");
console.table(table);
assert.ok(sawDrawnBurning >= 15, "burning hulk stayed present and drawn for at least 150 s");
assert.equal(table.at(-1).present, false, "hulk sank by 240 s");
assert.equal(spreadSeen, true, "fire spread to the anchored fleet 80 m downwind");

// ---- f. UI persistence across 100 state updates -------------------------

const secondFire = worldFleet(bootRoom, alphaId).find((ship) => ship.classId === "fireShip");
assert.ok(secondFire, "second fire ship survived the first burn");
tapWorld(alpha, secondFire.x, secondFire.y);
clickButton(alpha, "Ignite on contact");
const targetTextBefore = alpha.document.getElementById("fire-target-text").textContent;
advanceMs(10_000);
assert.equal(alpha.document.getElementById("fire-ship-target").hidden, false, "target mode stayed open");
assert.equal(alpha.document.getElementById("fire-target-text").textContent, targetTextBefore,
  "target sheet was not wiped by 100 updates");
alpha.document.getElementById("fire-target-cancel").click();
assert.equal(alpha.document.getElementById("fire-ship-target").hidden, true, "cancel closes target mode");

// ---- c. Tow: visible disabled reason, order, persistence, cast off -------

const tower = worldFleet(bootRoom, alphaId).find((ship) => ship.classId === "frigate");
assert.ok(tower, "a player frigate exists for towing");
assert.equal(secondFireWorld.towerShipId ?? null, null, "fire ship starts free");
// Too far: the Tow button must stay visible and explain itself.
tower.x = secondFireWorld.x - 0.4;
tower.y = secondFireWorld.y;
tower.order = null;
tower.route = null;
tower.speedKnots = 0;
zoomBy(alpha, -1_800);
advanceMs(3_000);
let towerDraw = drawShip(alpha, tower.id);
assert.ok(towerDraw, "tower is drawn");
alpha.window.__armadaTest.tapScreen(towerDraw.screenX, towerDraw.screenY);
advanceMs(300);
assert.equal(alpha.window.__armadaTest.selectedShipId(), tower.id, "tapped the tower");
let towButton = buttonByText(alpha, "Tow fire ship");
assert.ok(towButton, "Tow stays visible when no fire ship is within 300 m");
assert.equal(towButton.disabled, true, "Tow is disabled while out of range");
assert.match(towButton.textContent ?? "", /No unlit fire ship within 300 m/, "Tow shows its disabled reason");
// In range: the same button becomes enabled.
tower.x = secondFireWorld.x - 0.1;
tower.y = secondFireWorld.y;
advanceMs(3_000);
towButton = buttonByText(alpha, "Tow fire ship");
assert.ok(towButton && !towButton.disabled, "Tow enables within 300 m");
clickButton(alpha, "Tow fire ship");
assert.equal(alpha.document.getElementById("fire-target-text").textContent,
  "Tow: tap one of your fire ships within 300 m.", "Tow target mode opens");
const fireDraw = drawShip(alpha, secondFireWorld.id);
alpha.window.__armadaTest.tapScreen(fireDraw.screenX, fireDraw.screenY);
advanceMs(2_000);
let towWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === secondFireWorld.id);
let towerWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === tower.id);
assert.equal(towerWorld.towedShipId, secondFireWorld.id, "server stores the tow");
assert.equal(towWorld.towerShipId, tower.id, "fire ship knows its tower");
// Sail the pair: both move at the same pair speed, tower speed less 2 knots.
const pairTargetY = towerWorld.y - 0.6;
alpha.window.__armadaTest.sailTo(towerWorld.x, pairTargetY);
advanceMs(3_000);
towerWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === tower.id);
towWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === secondFireWorld.id);
assert.ok(towerWorld.speedKnots > 0, "tower is under way");
assert.equal(towWorld.speedKnots, towerWorld.speedKnots, "tow moves at the tower's speed");
assert.equal(towerWorld.stationSpeedLimit, towWorld.speedKnots, "pair speed is the tower limit");
assert.equal(towSpeedKnots(towerWorld.stationSpeedLimit + 2), towerWorld.stationSpeedLimit,
  "pair speed is the tower's speed minus two knots");
// 100 consecutive state updates: the open card and Cast off never disappear.
for (let update = 0; update < 100; update += 1) {
  advanceMs(100);
  const row = shipById(alpha, tower.id);
  assert.equal(row?.towingId, secondFireWorld.id, `tow persisted on update ${update + 1}`);
  const cast = alpha.document.querySelector('button[data-fire-action="castOff"]');
  assert.ok(cast, `Cast off stayed on screen on update ${update + 1}`);
  assert.equal(cast.disabled, false, `Cast off enabled on update ${update + 1}`);
}
clickButton(alpha, "Cast off");
advanceMs(1_000);
towerWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === tower.id);
towWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === secondFireWorld.id);
assert.equal(towerWorld.towedShipId, null, "Cast off clears the tower");
assert.equal(towWorld.towerShipId, null, "Cast off clears the tow");

// ---- d. Lights: card state, server state and a second real client --------

const betaResponse = globalThis.Response;
globalThis.Response = alphaResponseClass;
const beta = await bootClient("room=test-fix-a&fireship=0&as=beta");
await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
globalThis.Response = betaResponse;
advanceMs(1_000);
const betaId = [...bootRoom.world.fleets.keys()].find((id) => id !== alphaId && id !== "downwind");
assert.ok(betaId, "second client joined the real room");
const betaOwn = worldFleet(bootRoom, betaId);
assert.ok(betaOwn.length > 0, "second client has ships");
// Select the (unlit) fire ship and switch its lights off.
advanceMs(2_000);
const fireNow = worldFleet(bootRoom, alphaId).find((ship) => ship.id === secondFireWorld.id);
const fireCardDraw = drawShip(alpha, secondFireWorld.id);
alpha.window.__armadaTest.tapScreen(fireCardDraw.screenX, fireCardDraw.screenY);
advanceMs(500);
assert.equal(alpha.window.__armadaTest.selectedShipId(), secondFireWorld.id, "tapped the fire ship");
clickButton(alpha, "Lights off");
advanceMs(1_000);
const litWorld = worldFleet(bootRoom, alphaId).find((ship) => ship.id === secondFireWorld.id);
assert.equal(litWorld.lightsOff, true, "server stores lights off");
assert.equal(shipById(alpha, secondFireWorld.id)?.lightsOn, false, "client card parses lights off");
assert.match(alpha.document.getElementById("fire-ship-status").textContent ?? "",
  /Lights: Off/, "ship card says Lights: Off");
// Night: hide from the second client beyond 5 km, show it within 5 km.
alpha.document.getElementById("test-tools-btn").click();
alpha.document.getElementById("test-time-hour").value = "23";
clickButton(alpha, "Set time of day");
litWorld.x = betaOwn[0].x + 8;
litWorld.y = betaOwn[0].y;
advanceMs(4_000);
assert.equal(drawShip(alpha, secondFireWorld.id)?.lantern, false, "lights-off ship has no lantern");
assert.equal(drawShip(alpha, secondFireWorld.id) !== undefined, true, "owner still draws its own ship");
assert.equal(drawShip(alpha, tower.id)?.lantern, true, "lights-on ship has a lantern at night");
assert.equal(drawShip(beta, secondFireWorld.id), undefined,
  "second client does not see a lights-off ship beyond 5 km at night");
litWorld.x = betaOwn[0].x + 1.4;
advanceMs(4_000);
assert.ok(drawShip(beta, secondFireWorld.id),
  "second client sees a lights-off ship inside the new-moon night sight");
litWorld.x = betaOwn[0].x + 8;
alpha.document.getElementById("test-time-hour").value = "12";
clickButton(alpha, "Set time of day");
advanceMs(4_000);
assert.ok(drawShip(beta, secondFireWorld.id),
  "by day the lights-off ship is visible beyond 5 km");


alpha.document.getElementById("test-tools-btn").click();
assert.equal(alpha.document.getElementById("test-tools").hidden, false, "Test tools opened");
clickButton(alpha, "Spawn anchored enemy fleet");
advanceMs(500);
const enemyFleet = [...bootRoom.world.botFleets.values()].flat();
assert.equal(enemyFleet.length, 5, "five anchored enemies spawned");
const flagship = worldFleet(bootRoom, alphaId).find((ship) => ship.classId === "frigate");
assert.ok(flagship, "player frigate exists");
const enemyCentre = enemyFleet[0];
const approachX = enemyCentre.x - 0.5;
const approachY = enemyCentre.y;
zoomBy(alpha, -1_800);
advanceMs(300);
tapWorld(alpha, flagship.x, flagship.y);
advanceMs(300);
const ownDraw = drawShip(alpha, flagship.id);
alpha.window.__armadaTest.sailTo(approachX, approachY);
advanceMs(1_000);
const serverFlagship = worldFleet(bootRoom, alphaId).find((ship) => ship.id === flagship.id);
let closestKm = Number.POSITIVE_INFINITY;
for (let elapsed = 0; elapsed < 159_000; elapsed += 500) {
  advanceMs(500);
  const candidate = worldFleet(bootRoom, alphaId).find((ship) => ship.id === flagship.id);
  if (candidate) {
    closestKm = Math.min(closestKm, Math.hypot(candidate.x - enemyCentre.x, candidate.y - enemyCentre.y));
  }
}
const sailedFlagship = worldFleet(bootRoom, alphaId).find((ship) => ship.id === flagship.id);
assert.ok(sailedFlagship);
assert.ok(closestKm < 0.6, `frigate sailed within 600 m (${Math.round(closestKm * 1000)} m)`);
// Back off so the enemy marker is clear of the frigate for the menu tap.
sailedFlagship.x -= 2;
sailedFlagship.order = null;
sailedFlagship.route = null;
advanceMs(2_000);
// Tap the enemy to select it, then use the battle bar's Attack: Sink.
tapWorld(alpha, enemyCentre.x, enemyCentre.y);
advanceMs(300);
const sinkButton = [...alpha.document.querySelectorAll("#battle-bar button")]
  .find((button) => (button.textContent ?? "").trim().startsWith("Attack: Sink"));
assert.ok(sinkButton, "Attack: Sink appears on the enemy battle bar");
sinkButton.click();
advanceMs(1_000);
const flagshipNow = shipById(alpha, flagship.id);
assert.equal(flagshipNow?.engagement?.targetId, enemyCentre.id, "Attack order accepted on the enemy");

// ---- 3K-b: stance sheet, Sink toggle and its feedback --------------------

clickButton(alpha, "Stance");
assert.equal(alpha.document.getElementById("stance-sheet").hidden, false, "Stance sheet opens");
assert.equal(alpha.document.querySelectorAll("#stance-options [data-stance]").length, 4,
  "four stance choices");
assert.equal(alpha.document.querySelector("#stance-options [data-stance=\"fightIfAttacked\"]").getAttribute("aria-pressed"),
  "true", "the current stance is marked");
const sinkToggle = alpha.document.querySelector('#battle-orders [data-order="attackSink"]');
assert.ok(sinkToggle, "Sink toggle is visible");
assert.equal(sinkToggle.disabled, false, "Sink is enabled with an enemy in sight");
sinkToggle.click();
assert.equal(alpha.document.getElementById("armed-order").hidden, false, "Sink shows the armed banner");
assert.match(alpha.document.getElementById("armed-order-text").textContent, /Sink armed: tap an enemy ship in sight/,
  "the banner names the target rule");
tapWorld(alpha, enemyCentre.x, enemyCentre.y);
advanceMs(1_000);
assert.equal(alpha.document.getElementById("armed-order").hidden, true, "the toggle switches off after the order");
assert.equal(alpha.document.querySelector('#battle-orders [data-order="attackSink"]').getAttribute("aria-pressed"),
  "false", "Sink is no longer armed");
assert.equal(shipById(alpha, flagship.id)?.engagement?.targetId, enemyCentre.id,
  "the Sink order reached the server");
clickButton(alpha, "Close");

// An empty sea tap never sails the selected ship and never opens a palette.
const beforeSeaTap = worldFleet(bootRoom, alphaId).find((ship) => ship.id === flagship.id);
const seaTarget = { x: beforeSeaTap.x + 4, y: beforeSeaTap.y + 4 };
tapWorld(alpha, seaTarget.x, seaTarget.y);
advanceMs(500);
const afterSeaTap = worldFleet(bootRoom, alphaId).find((ship) => ship.id === flagship.id);
assert.equal(afterSeaTap.route, null, "empty sea tap left the route alone");
assert.equal(alpha.document.getElementById("order-menu"), null, "the sea-tap palette no longer exists");

// ---- b. Ignite on contact ------------------------------------------------

// Move the flagship away so the enemy is the only ship near the fire target.
const movedFlagship = worldFleet(bootRoom, alphaId).find((ship) => ship.id === flagship.id);
assert.ok(movedFlagship);
movedFlagship.x = secondFireWorld.x - 2;
movedFlagship.y = secondFireWorld.y;
movedFlagship.order = null;
movedFlagship.route = null;
movedFlagship.speedKnots = 0;
// Put one real enemy 3 km from the fire ship and hold it still.
const liveEnemy = enemyFleet.find((ship) => ship.damage.hull > 0) ?? enemyFleet[0];
liveEnemy.x = secondFireWorld.x + 3;
liveEnemy.y = secondFireWorld.y;
liveEnemy.speedKnots = 0;
liveEnemy.hoveTo = true;
liveEnemy.order = null;
advanceMs(4_000);
zoomBy(alpha, 2_200);
advanceMs(300);
tapWorld(alpha, secondFireWorld.x, secondFireWorld.y);
clickButton(alpha, "Ignite on contact");
const targetDraw = drawShip(alpha, liveEnemy.id);
alpha.window.__armadaTest.tapScreen(targetDraw.screenX, targetDraw.screenY);
clickButton(alpha, "Confirm ignition");
advanceMs(2_000);
const serverSecond = worldFleet(bootRoom, alphaId).find((ship) => ship.id === secondFire.id);
assert.equal(shipById(alpha, secondFire.id)?.fireShipMode, "contact", "contact order accepted");
advanceMs(100_000);
assert.equal(shipById(alpha, secondFire.id)?.fireShipIgnited, true,
  "fire ship reached and ignited on the target");

// ---- 3K-b: Run, Surrender and the exact heading order --------------------

const runEnemy = enemyFleet.find((ship) => ship.damage.hull > 0) ?? enemyFleet[0];
const runFlagshipWorld = worldFleet(bootRoom, alphaId)
  .find((ship) => ship.id !== flagship.id && !ship.dockedPortId && ship.damage.crew > 20) ??
  worldFleet(bootRoom, alphaId).find((ship) => ship.id === flagship.id);
assert.ok(runEnemy && runFlagshipWorld, "a live enemy and a crewing ship exist for Run");
runEnemy.x = runFlagshipWorld.x + 2;
runEnemy.y = runFlagshipWorld.y;
runEnemy.speedKnots = 0;
runEnemy.hoveTo = true;
advanceMs(1_000);
clickButton(alpha, "Stance");
const runToggle = alpha.document.querySelector('#battle-orders [data-order="run"]');
assert.ok(runToggle && !runToggle.disabled, "Run is available");
runToggle.click();
const runTarget = shipById(alpha, runFlagshipWorld.id);
assert.ok(runTarget, "my ship is still drawn");
tapWorld(alpha, runTarget.x, runTarget.y);
advanceMs(500);
assert.notEqual(worldFleet(bootRoom, alphaId).find((ship) => ship.id === runFlagshipWorld.id)?.runState, undefined,
  "Run on my ship reached the server");
assert.equal(alpha.document.getElementById("armed-order").hidden, true, "Run switches off after the order");

alpha.window.__armadaTest.selectShip(flagship.id);
advanceMs(300);
const surrenderToggle = alpha.document.querySelector('#battle-orders [data-order="surrender"]');
surrenderToggle.click();
const cameraCentre = alpha.window.__armadaTest.centreScreen();
alpha.window.__armadaTest.tapScreen(cameraCentre.x, cameraCentre.y);
advanceMs(200);
assert.equal(alpha.document.getElementById("surrender-confirm").hidden, false, "Surrender asks first");
assert.match(alpha.document.getElementById("surrender-confirm-text").textContent, /flagship.*eliminates you/i,
  "the confirm warns about a flagship");
clickButton(alpha, "Keep fighting");
assert.equal(alpha.document.getElementById("surrender-confirm").hidden, true, "Keep fighting closes the confirm");
clickButton(alpha, "Close");

clickButton(alpha, "Tools");
assert.equal(alpha.document.getElementById("tools-sheet").hidden, false, "Tools opens the Tools sheet");
clickButton(alpha, "Heading and distance");
assert.equal(alpha.document.getElementById("heading-sheet").hidden, false, "Heading and distance opens from Tools");
const headingInput = alpha.document.getElementById("heading-degrees");
const distanceInput = alpha.document.getElementById("heading-distance");
headingInput.value = "90";
headingInput.dispatchEvent(new alpha.window.Event("input", { bubbles: true }));
distanceInput.value = "6";
distanceInput.dispatchEvent(new alpha.window.Event("input", { bubbles: true }));
clickButton(alpha, "Set course");
advanceMs(500);
removeTestDummies(bootRoom.world);
advanceMs(1_000);
clickButton(alpha, "Stance");
const noEnemySink = alpha.document.querySelector('#battle-orders [data-order="attackSink"]');
assert.equal(noEnemySink.disabled, true, "Sink is disabled when no enemy is in sight");
assert.match(noEnemySink.title, /No enemy in sight/, "the disabled reason names the missing enemy");
clickButton(alpha, "Close");

const headingCommand = alpha.window.__armadaTest.lastCommand();
assert.ok(headingCommand.t === "fleetOrder" || headingCommand.t === "shipOrder",
  `the heading was sent for the selection (${headingCommand.t})`);
assert.equal(headingCommand.order?.type, "heading", "a heading order was sent");
assert.equal(headingCommand.order?.headingDeg, 90, "the exact heading left the client");
assert.equal(headingCommand.order?.distanceKm, 6, "the exact distance left the client");

// ---- 3K-c: Sailor's Log tabs, grid, ruler and lists ----------------------

const log = alpha.window.__armadaTest;
log.openLog("chart");
assert.equal(alpha.document.getElementById("sailors-log").hidden, false, "Sailor's Log opens");
assert.equal(log.logTab(), "chart", "Chart opens first");
assert.ok(log.logGridLabels().length > 0, "the chart draws coordinate labels");
assert.ok(log.logGridLabels().some((label) => /°\s*[NSEW]/.test(label)),
  `labels use degrees and hemispheres (${log.logGridLabels().slice(0, 5).join(", ")})`);
assert.ok(alpha.document.querySelector("#log-ports-host .known-ports-panel"), "Port list lives in the log");
const logShipButtons = [...alpha.document.querySelectorAll("#log-ships button")];
assert.ok(logShipButtons.length > 0, "Ship list has a selectable ship");
const logShipButton = logShipButtons.find((button) => button.getAttribute("aria-pressed") !== "true") ?? logShipButtons[0];
logShipButton.click();
advanceMs(200);
assert.equal(log.selectedShipId(), logShipButton.dataset.shipId, "Ship list selects that ship");
assert.equal(alpha.document.getElementById("sailors-log").hidden, true, "selecting a ship returns to the game");
log.openLog("chart");
const logPortButton = alpha.document.querySelector("#known-ports-list .known-port");
if (logPortButton) {
  logPortButton.click();
  advanceMs(50);
  assert.equal(alpha.document.getElementById("port-panel").hidden, false, "Port list opens that port");
  alpha.document.getElementById("port-close").click();
  assert.equal(alpha.document.getElementById("port-panel").hidden, true, "port panel closes");
} else {
  assert.equal(alpha.document.getElementById("known-ports-empty").hidden, false,
    "with no discovered port the list shows its empty reason");
}

log.openLog("queued");
assert.equal(log.logTab(), "queued", "Queued orders tab opens");
alpha.document.querySelector('[data-log-tab="chart"]').click();
assert.equal(log.logTab(), "chart", "Chart tab switches");
alpha.document.querySelector('[data-log-tab="queued"]').click();
assert.equal(log.logTab(), "queued", "Queued tab switches back");
advanceMs(500);
assert.equal(alpha.document.getElementById("sailors-log").hidden, false, "state updates do not wipe the log");
assert.equal(log.logTab(), "queued", "the chosen tab survives state updates");
alpha.document.querySelector('[data-log-tab="fleets"]').click();
assert.ok(alpha.document.querySelector("#log-fleets-host .fleet-panel"), "Fleet panel lives in the log");
alpha.document.querySelector('[data-log-tab="trade"]').click();
assert.match(alpha.document.getElementById("log-panel-trade").textContent, /Arrives with trade links/,
  "trade links are disabled with the agreed reason");
assert.equal(alpha.document.querySelector("#log-trade-links button").disabled, true, "Trade links is disabled");

log.openLog("chart");
log.armLogRuler();
const rulerA = { x: 120, y: 220 };
const rulerB = { x: 320, y: 220 };
log.tapScreen(rulerA.x, rulerA.y);
log.tapScreen(rulerB.x, rulerB.y);
assert.equal(log.logRuler().points, 2, "the ruler takes two points");
assert.match(log.logRuler().text, /^90° · /, `the ruler reports an east bearing (${log.logRuler().text})`);
const rulerKm = Number(log.logRuler().text.split("·")[1].replace("km", "").trim());
assert.ok(rulerKm > 0, "the ruler reports a distance");
clickButton(alpha, "Use this course");
assert.equal(alpha.document.getElementById("heading-sheet").hidden, false, "Use this course opens the heading tool");
assert.equal(Number(alpha.document.getElementById("heading-degrees").value), 90, "the ruler course bearing fills Heading");
assert.ok(Math.abs(Number(alpha.document.getElementById("heading-distance").value) - rulerKm) < 0.2,
  "the ruler distance fills Heading and distance");
clickButton(alpha, "Close");

// ---- 3K-d: Tools rows, wind, range check and real sight circles ----------

clickButton(alpha, "Tools");
assert.equal(alpha.document.getElementById("tools-sheet").hidden, false, "Tools sheet opens");
const disabledTools = [...alpha.document.querySelectorAll("#tools-sheet button:disabled")];
assert.equal(disabledTools.length, 7, "all seven unbuilt tools stay visible and disabled");
for (const tool of disabledTools) {
  assert.match(tool.textContent, /Not built yet|Item only/, `disabled reason for ${tool.textContent}`);
}
clickButton(alpha, "Wind");
assert.equal(alpha.window.__armadaTest.windTool(), true, "Wind tool toggles on");
assert.equal(alpha.document.getElementById("tool-wind-marker").hidden, false, "local wind marker is shown");
clickButton(alpha, "Wind");
assert.equal(alpha.window.__armadaTest.windTool(), false, "Wind tool toggles off");
assert.equal(alpha.document.getElementById("tool-wind-marker").hidden, true, "local wind marker hides");
clickButton(alpha, "Range check");
assert.equal(alpha.window.__armadaTest.rangeCheck(), true, "Range check toggles on");
clickButton(alpha, "Range check");
assert.equal(alpha.window.__armadaTest.rangeCheck(), false, "Range check toggles off");
alpha.document.getElementById("developer-btn").click();
assert.equal(alpha.document.getElementById("test-tools").hidden, false, "Developer opens Test tools");
alpha.document.getElementById("test-moon-phase").value = "0.5";
clickButton(alpha, "Set moon phase");
advanceMs(500);
assert.ok(Math.abs(alpha.window.__armadaTest.moonPhase() - 0.5) < 0.01,
  "Developer sets the moon phase used by sight");
alpha.document.getElementById("test-tools-close").click();
const sightCircle = alpha.window.__armadaTest.sightCircle();
assert.ok(sightCircle.km > 0, "selected ship has a sight radius");
assert.ok(Math.abs(sightCircle.px - sightCircle.km * sightCircle.scale) < 1e-6,
  "circle pixels equal kilometres times the zoom scale");
clickButton(alpha, "Scale ruler");
assert.equal(alpha.document.getElementById("sailors-log").hidden, false, "Scale ruler opens the chart");
assert.equal(alpha.window.__armadaTest.logTab(), "chart", "Scale ruler opens the chart tab");
assert.equal(alpha.window.__armadaTest.logRuler().points, 0, "Scale ruler waits for two points");
alpha.window.__armadaTest.closeLog();

// ---- 3K-a: fixed slots, measured audit and centred camera ----------------

for (const id of ["action-bar", "bottom-dock", "dock", "dock-tabs", "tap-btn", "follow-btn", "orders-list-btn", "group-bar"]) {
  assert.equal(alpha.document.getElementById(id), null, `old toolbar ${id} is gone`);
}
for (const id of ["top-right-slot", "ship-panel", "bottom-left-slot", "wordmark"]) {
  assert.ok(alpha.document.getElementById(id), `3K slot ${id} exists`);
}
assert.ok(alpha.document.getElementById("sailors-log-btn"), "Sailor's Log button exists");
assert.ok(alpha.document.getElementById("formations-btn"), "Formations button exists");
assert.ok(alpha.document.getElementById("tools-btn"), "Tools button exists");
assert.ok(alpha.document.getElementById("stance-btn"), "Stance button exists");

const layoutFleet = alpha.window.__armadaTest.fleet().filter((ship) => ship.status !== "delivery");
assert.ok(layoutFleet.length > 0, "a live ship exists for the camera test");
const cameraShip = layoutFleet[0];
assert.equal(alpha.window.__armadaTest.selectShip(cameraShip.id), true, "camera ship selected");
advanceMs(300);
const centre = alpha.window.__armadaTest.centreScreen();
let drawn = drawShip(alpha, cameraShip.id);
assert.ok(Math.abs(drawn.screenX - centre.x) <= 1, `ship is centred x (${drawn.screenX} vs ${centre.x})`);
assert.ok(Math.abs(drawn.screenY - centre.y) <= 1, `ship is centred y (${drawn.screenY} vs ${centre.y})`);
zoomBy(alpha, -500);
advanceMs(300);
drawn = drawShip(alpha, cameraShip.id);
assert.ok(Math.abs(drawn.screenX - centre.x) <= 1 && Math.abs(drawn.screenY - centre.y) <= 1,
  "ship stays centred while zooming");

const beforeTab = alpha.window.__armadaTest.selectedShipId();
alpha.document.dispatchEvent(new alpha.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
advanceMs(200);
assert.notEqual(alpha.window.__armadaTest.selectedShipId(), beforeTab, "Tab cycles to another ship");

for (const size of [
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 412, height: 915 },
  { width: 740, height: 360 },
]) {
  alpha.window.innerWidth = size.width;
  alpha.window.innerHeight = size.height;
  alpha.window.dispatchEvent(new alpha.window.Event("resize"));
  advanceMs(300);
  const issues = alpha.window.__armadaTest.layoutAudit();
  assert.equal(issues.length, 0, `${size.width}x${size.height} measured layout: ${JSON.stringify(issues)}`);
}

console.log("HARNESS OK");
process.exit(0);
