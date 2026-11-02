// The game world. Plain TypeScript, so the server runs it and the tests can
// run it without a browser or a network.
//
// The world lives in kilometres. A human player has one ship; the temporary
// load test adds multi-ship fake fleets. The server is authoritative: it checks
// every movement against the land lookup and chart frame.

import { settings } from "./settings.js";
import {
  angleOffWindDeg,
  createShip,
  sailTo,
  speedForHeading,
  stepShip,
  type Ship,
  type ShipClassId,
} from "./sailing.js";
import { isLandAt } from "./land.js";
import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  isInsideMapFrame,
  lonLatToMap,
} from "./map.js";
import {
  createChart,
  revealCircle,
  roomKindForCode,
  takeChartUpdate,
  type ChartBlock,
  type ChartState,
  type ChartUpdate,
  type RoomKind,
} from "./fog.js";
import { addBots, refreshBotOrders } from "./bots.js";
import type { DebugStats } from "./loadMetrics.js";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** The short messages sent to a player when the sea refuses an order. */
export const COAST_NOTICE = "Your ship stopped at the coast.";
export const EDGE_NOTICE = "Edge of the charted world.";

export interface World {
  /** Number of world steps taken. */
  tick: number;
  /** Game seconds since the room started. */
  gameSeconds: number;
  /** The room code and its kind (normal, test or debug). */
  roomCode: string;
  kind: RoomKind;
  /** Human ships, by player id. */
  players: Map<string, Ship>;
  /** TEMP-DEBUG: fake load-test owners and their fleets. */
  botFleets: Map<string, Ship[]>;
  /** Each player's discovered ground and last-seen records. */
  charts: Map<string, ChartState>;
  /** Short messages waiting for each player; never part of the world state. */
  notices: Map<string, string[]>;
}

/** One ship in a state message: [id, class, x, y, heading in degrees, knots]. */
export type ShipSnapshot = [
  id: string,
  classId: string,
  x: number,
  y: number,
  headingDeg: number,
  speedKnots: number,
];

/** A short event message, separate from world state. */
export interface NoticeMessage {
  /** "n" means notice. */
  t: "n";
  text: string;
}

/** Last-seen marker: class, navy, position, age in game seconds. */
export type LastSeenSnapshot = [string, string, number, number, number];

/**
 * The only shape of world information that is ever sent to a client.
 * Ships outside the player's live sight circles are omitted; chart data and
 * last-seen markers are added by `visibleStateFor` only.
 */
export interface StateMessage {
  /** "s" means world state. */
  t: "s";
  tick: number;
  /** The receiving player's own id. */
  you: string;
  /** Wind direction in compass degrees (where it blows FROM). */
  w: number;
  /** Room kind, so the client can show the dev chart correctly. */
  k: RoomKind;
  ships: ShipSnapshot[];
  /** Faded last-seen markers. */
  l: LastSeenSnapshot[];
  /** Newly discovered cells and private map blocks. */
  chart: ChartUpdate;
  /** TEMP-DEBUG: dev-room load-test counters. */
  d?: DebugStats;
}

export function createWorld(roomCode = "main"): World {
  return {
    tick: 0,
    gameSeconds: 0,
    roomCode,
    kind: roomKindForCode(roomCode),
    players: new Map(),
    botFleets: new Map(),
    charts: new Map(),
    notices: new Map(),
  };
}

/** A small deterministic hash, so a returning player gets the same berth. */
function hashPlayerId(playerId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < playerId.length; i += 1) {
    hash ^= playerId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function startCentre(): { x: number; y: number } {
  return lonLatToMap(settings.world.startArea.lonDeg, settings.world.startArea.latDeg);
}

let cachedTestCentre: { x: number; y: number } | null | undefined;

/**
 * Find a test-room start about 30 km offshore from the nearest coast to the
 * normal British start. The search is done once and reused.
 */
function testCentre(): { x: number; y: number } {
  if (cachedTestCentre !== undefined) return cachedTestCentre ?? startCentre();

  const origin = startCentre();
  let coast: { x: number; y: number } | null = null;
  for (let radius = 2; radius <= 300 && !coast; radius += 2) {
    for (let ray = 0; ray < 36; ray += 1) {
      const angle = (ray / 36) * Math.PI * 2;
      const x = origin.x + Math.sin(angle) * radius;
      const y = origin.y - Math.cos(angle) * radius;
      if (isLandAt(x, y)) {
        coast = { x, y };
        break;
      }
    }
  }

  if (!coast) {
    cachedTestCentre = null;
    return origin;
  }

  const awayX = origin.x - coast.x;
  const awayY = origin.y - coast.y;
  const length = Math.hypot(awayX, awayY);
  if (length < 1e-9) {
    cachedTestCentre = null;
    return origin;
  }

  const distance = settings.fog.testStartCoastDistanceKm;
  let candidate = {
    x: coast.x + (awayX / length) * distance,
    y: coast.y + (awayY / length) * distance,
  };

  // If the chosen direction lands in a bay or on an islet, try nearby
  // seaward directions at the same distance.
  if (isLandAt(candidate.x, candidate.y)) {
    for (let turn = 1; turn <= 8; turn += 1) {
      const angle = (turn / 8) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotated = {
        x: coast.x + ((awayX / length) * cos - (awayY / length) * sin) * distance,
        y: coast.y + ((awayX / length) * sin + (awayY / length) * cos) * distance,
      };
      if (!isLandAt(rotated.x, rotated.y)) {
        candidate = rotated;
        break;
      }
    }
  }

  cachedTestCentre = candidate;
  return candidate;
}

function startCentreFor(world: World): { x: number; y: number } {
  return world.kind === "test" ? testCentre() : startCentre();
}

/** A stable spot in the start area, different for each player id. */
function startSpot(
  playerId: string,
  centre: { x: number; y: number },
): { x: number; y: number; headingRad: number } {
  const area = settings.world.startArea;
  const hash = hashPlayerId(playerId);

  const bearingRad = (hash % 360) * DEG;
  const share = 0.55 + (((hash >>> 8) % 1000) / 1000) * 0.45;
  const distanceKm = area.radiusKm * share;

  // The chart's y grows south, so a compass bearing points along
  // (sin bearing, -cos bearing).
  const x = centre.x + Math.sin(bearingRad) * distanceKm;
  const y = centre.y - Math.cos(bearingRad) * distanceKm;

  return {
    x,
    y,
    // Face the middle of the start area.
    headingRad: Math.atan2(centre.x - x, y - centre.y),
  };
}

/** Distance between two map points, in km. */
function distanceKm(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pick a berth for a new player. If the deterministic berth is too close to an
 * existing ship, walk around the start circle until there is room, so the
 * second player always starts a few kilometres away.
 */
function newPlayerSpot(world: World, playerId: string): { x: number; y: number; headingRad: number } {
  const centre = startCentreFor(world);
  const initial = startSpot(playerId, centre);
  const offsetX = initial.x - centre.x;
  const offsetY = initial.y - centre.y;
  const radius = Math.hypot(offsetX, offsetY);
  let bearing = Math.atan2(offsetX, offsetY);

  let spot = initial;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = {
      x: centre.x + Math.sin(bearing) * radius,
      y: centre.y - Math.cos(bearing) * radius,
    };

    const clear = [...world.players.values()].every(
      (ship) => distanceKm(ship, candidate) >= settings.world.startArea.minimumSeparationKm,
    );
    if (clear) {
      spot = {
        ...candidate,
        headingRad: Math.atan2(centre.x - candidate.x, candidate.y - centre.y),
      };
      break;
    }

    bearing += 137.5 * DEG;
  }

  return spot;
}

/**
 * Test and debug rooms get the faster frigate so a chart can be explored
 * quickly. Every other room keeps the flagship and its real sailing numbers.
 */
export function shipClassForRoom(roomCode: string): ShipClassId {
  return roomCode.startsWith("test") || roomCode.startsWith("dev-")
    ? "frigate"
    : "flagship";
}

/** Add a player's ship once. A returning id keeps its existing ship. */
export function addPlayer(
  world: World,
  playerId: string,
  classId: ShipClassId = shipClassForRoom(world.roomCode),
): Ship {
  const existing = world.players.get(playerId);
  if (existing) return existing;

  const spot = newPlayerSpot(world, playerId);
  const ship = createShip(playerId, classId, spot.x, spot.y, spot.headingRad);
  world.players.set(playerId, ship);

  const chart = createChart(world.kind);
  world.charts.set(playerId, chart);
  revealCircle(chart, ship.x, ship.y);
  return ship;
}

/** All ships belonging to one human or fake player. */
export function shipsForOwner(world: World, ownerId: string): Ship[] {
  const human = world.players.get(ownerId);
  if (human) return [human];
  return world.botFleets.get(ownerId) ?? [];
}

/** Add the temporary dev-room bot fleets once. */
export function addBotFleets(
  world: World,
  count: number,
  firstHumanId: string,
): number {
  return addBots(world, count, firstHumanId);
}

/** Apply a sail-to order from a player. Bad orders are simply refused. */
export function applyOrder(world: World, playerId: string, x: unknown, y: unknown): boolean {
  if (typeof x !== "number" || typeof y !== "number") return false;

  const ship = world.players.get(playerId);
  if (!ship) return false;

  return sailTo(ship, x, y);
}

/** Remember one short message for a player. Older messages are dropped. */
function pushNotice(world: World, playerId: string, text: string): void {
  const queue = world.notices.get(playerId) ?? [];
  // A ship held against the coast can be blocked on many ticks; do not flood
  // the queue with the same warning.
  if (queue[queue.length - 1] === text) return;
  queue.push(text);
  while (queue.length > 3) queue.shift();
  world.notices.set(playerId, queue);
}

/** Take the next waiting message for a player, if there is one. */
export function takeNotice(world: World, playerId: string): string | null {
  const queue = world.notices.get(playerId);
  if (!queue || queue.length === 0) return null;

  const notice = queue.shift() ?? null;
  if (queue.length === 0) world.notices.delete(playerId);
  return notice;
}

/** Where this tick's segment first leaves the chart, as a 0..1 fraction. */
function borderFraction(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number | null {
  if (fromX < 0 || fromX > MAP_WIDTH_KM || fromY < 0 || fromY > MAP_HEIGHT_KM) {
    return 0;
  }

  const dx = toX - fromX;
  const dy = toY - fromY;
  let first: number | null = null;

  const consider = (t: number): void => {
    if (t > 0 && t <= 1 && (first === null || t < first)) first = t;
  };

  if (dx < 0) consider((0 - fromX) / dx);
  else if (dx > 0) consider((MAP_WIDTH_KM - fromX) / dx);
  if (dy < 0) consider((0 - fromY) / dy);
  else if (dy > 0) consider((MAP_HEIGHT_KM - fromY) / dy);

  return first;
}

/** True when every probe direction around a point is open water. */
function hasOffshoreClearance(x: number, y: number, radiusKm: number): boolean {
  if (isLandAt(x, y) || !isInsideMapFrame(x, y)) return false;

  const rays = settings.coast.offshoreProbeRays;
  for (let ray = 0; ray < rays; ray += 1) {
    const angle = (ray / rays) * Math.PI * 2;
    const probeX = x + Math.sin(angle) * radiusKm;
    const probeY = y - Math.cos(angle) * radiusKm;
    if (isLandAt(probeX, probeY)) return false;
  }
  return true;
}

/**
 * Find a water point about one kilometre from the coast. Walking back along
 * the incoming track normally finds open water; a ring of probes handles
 * narrow bays where simply reversing would still leave the ship too close.
 */
function offshorePoint(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  boundaryFraction: number,
): { x: number; y: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  const clearance = settings.coast.offshoreClearanceKm;
  const boundaryX = fromX + dx * boundaryFraction;
  const boundaryY = fromY + dy * boundaryFraction;

  if (length > 1e-9) {
    const backX = -dx / length;
    const backY = -dy / length;
    const maxBack = clearance + settings.coast.offshoreProbeKm;
    for (let back = 0.25; back <= maxBack; back += settings.coast.pathSampleKm) {
      const x = boundaryX + backX * back;
      const y = boundaryY + backY * back;
      if (hasOffshoreClearance(x, y, clearance)) return { x, y };
    }
  }

  // A tight bay may need a side step rather than a retreat along the track.
  for (let ring = 1; ring <= 3; ring += 1) {
    const radius = clearance * ring;
    for (let ray = 0; ray < settings.coast.offshoreProbeRays; ray += 1) {
      const angle = (ray / settings.coast.offshoreProbeRays) * Math.PI * 2;
      const x = boundaryX + Math.sin(angle) * radius;
      const y = boundaryY - Math.cos(angle) * radius;
      if (hasOffshoreClearance(x, y, clearance)) return { x, y };
    }
  }

  // Last resort: the point before the collision, if it is still water.
  if (!isLandAt(fromX, fromY) && isInsideMapFrame(fromX, fromY)) {
    return { x: fromX, y: fromY };
  }
  return { x: boundaryX, y: boundaryY };
}

/** Stop a ship at a fraction along this tick's movement and warn its player. */
function haltAt(
  world: World,
  playerId: string,
  ship: Ship,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
  lengthKm: number,
  fraction: number,
  notice: string,
): void {
  if (notice === COAST_NOTICE) {
    const safe = offshorePoint(fromX, fromY, fromX + dx, fromY + dy, fraction);
    ship.x = safe.x;
    ship.y = safe.y;
  } else {
    // Keep a small margin inside the chart edge.
    const margin = settings.coast.stopMarginKm / Math.max(lengthKm, 1e-9);
    const safe = Math.max(0, Math.min(1, fraction - margin));
    ship.x = fromX + dx * safe;
    ship.y = fromY + dy * safe;
  }

  ship.speedKnots = 0;
  ship.arrived = false;

  // A short seaward order may simply need a few ticks to turn away from the
  // shore. Keep that order alive; an order whose straight path crosses land,
  // or that goes past the chart, still ends at the coast.
  if (!orderHasClearWaterPath(ship)) ship.order = null;
  // The held escape heading may itself have run into a headland. Pick a fresh
  // one at the new safe position next tick.
  ship.coastEscapeHeadingRad = null;

  // Fake players have no socket and need no paper notices.
  if (world.players.has(playerId)) pushNotice(world, playerId, notice);
}

/** True when the straight water route from the ship to its order is clear. */
function orderHasClearWaterPath(ship: Ship): boolean {
  const order = ship.order;
  if (!order) return false;
  if (!isInsideMapFrame(order.x, order.y) || isLandAt(order.x, order.y)) return false;

  const dx = order.x - ship.x;
  const dy = order.y - ship.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / settings.coast.pathSampleKm));
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    if (isLandAt(ship.x + dx * fraction, ship.y + dy * fraction)) return false;
  }
  return true;
}

/** A target in open water can be reached after the ship turns offshore. */
function orderIsInOpenWater(ship: Ship): boolean {
  const order = ship.order;
  if (!order) return false;
  return isInsideMapFrame(order.x, order.y) && !isLandAt(order.x, order.y);
}

/**
 * Check the whole path a ship moved along this tick, not just its endpoint, so
 * a fast or large step cannot skip a thin island. The ship stops at the last
 * water point before land, or inside the chart edge.
 */
function resolveMovement(
  world: World,
  playerId: string,
  ship: Ship,
  fromX: number,
  fromY: number,
): void {
  const dx = ship.x - fromX;
  const dy = ship.y - fromY;
  const lengthKm = Math.hypot(dx, dy);
  if (lengthKm < 1e-9) return;

  const edgeFraction = borderFraction(fromX, fromY, ship.x, ship.y);
  const limit = edgeFraction ?? 1;
  const steps = Math.max(1, Math.ceil((lengthKm * limit) / settings.coast.pathSampleKm));
  let previous = 0;

  for (let step = 1; step <= steps; step += 1) {
    const fraction = Math.min(limit, step / steps);
    if (fraction <= previous + 1e-9) continue;

    const x = fromX + dx * fraction;
    const y = fromY + dy * fraction;

    if (isLandAt(x, y)) {
      // Find the boundary between the last water sample and this land sample.
      let low = previous;
      let high = fraction;
      for (let i = 0; i < 24; i += 1) {
        const middle = (low + high) / 2;
        if (isLandAt(fromX + dx * middle, fromY + dy * middle)) high = middle;
        else low = middle;
      }

      haltAt(
        world,
        playerId,
        ship,
        fromX,
        fromY,
        dx,
        dy,
        lengthKm,
        low,
        COAST_NOTICE,
      );
      return;
    }

    previous = fraction;
  }

  if (edgeFraction !== null) {
    haltAt(world, playerId, ship, fromX, fromY, dx, dy, lengthKm, edgeFraction, EDGE_NOTICE);
  }
}

/** True when land is within a short distance of a candidate point. */
function isNearLand(x: number, y: number, radiusKm: number): boolean {
  for (let ray = 0; ray < settings.coast.offshoreProbeRays; ray += 1) {
    const angle = (ray / settings.coast.offshoreProbeRays) * Math.PI * 2;
    if (isLandAt(x + Math.sin(angle) * radiusKm, y - Math.cos(angle) * radiusKm)) {
      return true;
    }
  }
  return false;
}

/** How far a heading can run before reaching land or the chart edge. */
function openWaterDistance(ship: Ship, headingRad: number): number {
  let distance = 0;
  for (
    let step = settings.coast.pathSampleKm;
    step <= settings.coast.offshoreProbeKm;
    step += settings.coast.pathSampleKm
  ) {
    const x = ship.x + Math.sin(headingRad) * step;
    const y = ship.y - Math.cos(headingRad) * step;
    if (isLandAt(x, y) || !isInsideMapFrame(x, y)) break;
    distance = step;
  }
  return distance;
}

/**
 * Pick a heading with open water and some speed. Near an onshore wind the
 * direct seaward direction may be inside the no-sail angle, so try a spread
 * of headings and prefer the one that gets furthest from this coast.
 */
function chooseCoastEscapeHeading(ship: Ship, windFromDeg: number): number | null {
  const spec = settings.ships.types[ship.classId];
  const order = ship.order;
  const targetBearing = order
    ? Math.atan2(order.x - ship.x, -(order.y - ship.y))
    : 0;
  let bestHeading: number | null = null;
  let bestScore = -Infinity;

  for (let ray = 0; ray < 32; ray += 1) {
    const heading = (ray / 32) * Math.PI * 2;
    if (speedForHeading(spec, heading, windFromDeg) <= 0) continue;

    const distance = openWaterDistance(ship, heading);
    if (distance < settings.coast.offshoreClearanceKm) continue;

    // Open water comes first; progress towards the order only breaks ties.
    // Trying to point straight at the target too early can keep a ship in a
    // bay, so escape the land before resuming the normal upwind zigzag.
    const progress = Math.cos(heading - targetBearing);
    const score = distance * 1000 + progress;
    if (score > bestScore) {
      bestScore = score;
      bestHeading = heading;
    }
  }

  return bestHeading;
}

/** Update every owner's discovered ground from all of that owner's ships. */
function updateFog(world: World): void {
  for (const [ownerId, chart] of world.charts) {
    if (chart.all) continue;
    for (const ship of shipsForOwner(world, ownerId)) {
      revealCircle(chart, ship.x, ship.y);
    }
  }
}

/** Advance every ship by a number of game seconds. */
function stepOwnerShip(
  world: World,
  ownerId: string,
  ship: Ship,
  dtGameSeconds: number,
  windFromDeg: number,
): void {
  // A ship close to a coast first turns and sails for open water. This gives
  // a new seaward order a way out even when the wind is blowing onshore.
  if (
    ship.order &&
    orderHasClearWaterPath(ship) &&
    isNearLand(ship.x, ship.y, settings.coast.tackAwarenessKm)
  ) {
    ship.coastEscapeHeadingRad ??= chooseCoastEscapeHeading(ship, windFromDeg);
  } else {
    ship.coastEscapeHeadingRad = null;
  }

  const fromX = ship.x;
  const fromY = ship.y;
  stepShip(
    ship,
    dtGameSeconds,
    windFromDeg,
    undefined,
    ship.coastEscapeHeadingRad ?? undefined,
  );
  resolveMovement(world, ownerId, ship, fromX, fromY);
}

export function stepWorld(
  world: World,
  dtGameSeconds: number,
  windFromDeg: number = settings.weather.windFromDeg,
): void {
  for (const [playerId, ship] of world.players) {
    stepOwnerShip(world, playerId, ship, dtGameSeconds, windFromDeg);
  }

  // TEMP-DEBUG: load-test ships use the same movement path as players.
  for (const [ownerId, fleet] of world.botFleets) {
    for (const ship of fleet) {
      stepOwnerShip(world, ownerId, ship, dtGameSeconds, windFromDeg);
    }
  }

  refreshBotOrders(world);
  world.tick += 1;
  world.gameSeconds += Math.max(0, dtGameSeconds);
  updateFog(world);
}

/** Normalise a heading in radians to whole compass degrees. */
function headingDegrees(headingRad: number): number {
  return Math.round(((headingRad * RAD) % 360 + 360) % 360) % 360;
}

/**
 * Turn the world into the update one player may see.
 *
 * This is the ONLY function that world information may leave through. The
 * server sends its result and nothing else; when hidden information arrives,
 * this is the one place that filters it.
 */
export function visibleStateFor(
  world: World,
  playerId: string,
  blockLookup?: ReadonlyMap<string, ChartBlock>,
): StateMessage {
  const own = shipsForOwner(world, playerId);
  const ownIds = new Set(own.map((ship) => ship.id));
  const sightSq = settings.fog.sightRangeKm ** 2;
  const isVisible = (ship: Ship): boolean =>
    own.some((mine) => (ship.x - mine.x) ** 2 + (ship.y - mine.y) ** 2 <= sightSq);

  const ships: ShipSnapshot[] = [];
  const visibleIds = new Set<string>();

  // A fleet owner sees every one of its own ships plus foreign ships inside
  // the sight circle of any of them. The client uses the same path for one
  // ship; this only exists for the temporary load test.
  const allShips: Ship[] = [...world.players.values()];
  for (const fleet of world.botFleets.values()) allShips.push(...fleet);

  for (const ship of allShips) {
    if (!ownIds.has(ship.id) && !isVisible(ship)) continue;

    visibleIds.add(ship.id);
    ships.push([
      ship.id,
      ship.classId,
      Number(ship.x.toFixed(2)),
      Number(ship.y.toFixed(2)),
      headingDegrees(ship.headingRad),
      Number(ship.speedKnots.toFixed(1)),
    ]);
  }

  const chart = world.charts.get(playerId) ?? createChart(world.kind);
  world.charts.set(playerId, chart);

  // Remember foreign ships while they are visible; when they leave the circle
  // their last position becomes a faded marker with an age in game time.
  for (const ship of allShips) {
    if (ownIds.has(ship.id) || !visibleIds.has(ship.id)) continue;
    chart.seen.set(ship.id, {
      classId: ship.classId,
      navy: "British",
      x: Number(ship.x.toFixed(2)),
      y: Number(ship.y.toFixed(2)),
      atGameSeconds: world.gameSeconds,
    });
  }

  const lastSeen: LastSeenSnapshot[] = [];
  for (const [id, seen] of chart.seen) {
    if (visibleIds.has(id)) continue;
    lastSeen.push([
      seen.classId,
      seen.navy,
      seen.x,
      seen.y,
      Math.max(0, Math.round(world.gameSeconds - seen.atGameSeconds)),
    ]);
  }

  return {
    t: "s",
    tick: world.tick,
    you: playerId,
    w: settings.weather.windFromDeg,
    k: world.kind,
    ships,
    l: lastSeen,
    chart: takeChartUpdate(chart, blockLookup),
  };
}
