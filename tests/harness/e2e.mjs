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
import { addPlayer, shipsForOwner, spawnTestFireShips } from "@naval/shared/world";
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
tapWorld(alpha, towerWorld.x, pairTargetY);
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
litWorld.x = betaOwn[0].x + 4;
advanceMs(4_000);
assert.ok(drawShip(beta, secondFireWorld.id),
  "second client sees the same ship within 5 km at night");
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
tapWorld(alpha, approachX, approachY);
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
// Open the real enemy order menu and press Attack: Sink.
alpha.window.__armadaTest.openOrders(enemyCentre.x, enemyCentre.y);
const sinkButton = [...alpha.document.querySelectorAll("#order-menu-actions button")]
  .find((button) => (button.textContent ?? "").trim().startsWith("Attack: Sink"));
assert.ok(sinkButton, "Attack: Sink appears on the enemy menu");
sinkButton.click();
advanceMs(1_000);
const flagshipNow = shipById(alpha, flagship.id);
assert.equal(flagshipNow?.engagement?.targetId, enemyCentre.id, "Attack order accepted on the enemy");

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

console.log("HARNESS OK");
process.exit(0);
