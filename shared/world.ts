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
  shipSpecFor,
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
  requestChartResume as markChartForResume,
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
import type { NavyId } from "./navies.js";
import {
  findPortByName,
  PORT_BY_ID,
  PLACED_PORTS,
  type PlacedPort,
  type PortSize,
} from "./data/ports.js";
import { SHIP_NAMES, shipTypeFor, type ShipClassId as DataShipClassId } from "./data/ships.js";
import {
  canAddShip,
  canShipSail,
  cleanShipName,
  crewHireCost,
  deliveryGameMs,
  portSellsShip,
  refillCrewPool,
  shipPrice,
} from "./shipRules.js";
import {
  isCargoGoodId,
  isGoodId,
  isResourceId,
  goodName,
  type GoodId,
} from "./data/goods.js";
import {
  addGoodToStores,
  addLimitedProduction,
  advanceProvisions,
  cargoTotal,
  cloneStores,
  createPriceState,
  emptyGoods,
  freeSpaceForGood,
  fullStores,
  goodAmount,
  initialNpcStock,
  initialPortStorage,
  portProduction,
  portStorageLimit,
  postedPrice,
  priceList,
  provisionsDaysLeft,
  quoteBuy,
  quoteSell,
  quoteTransfer,
  refillNpcStock,
  removeGoodFromStores,
  shipIsStarving,
  shipStoreCapacities,
  shiftPrices,
  totalGoods,
  type GoodsAmounts,
  type PriceState,
  type ShipStoreCapacities,
  type ShipStores,
  type TransferDirection,
} from "./trade.js";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** The short messages sent to a player when the sea refuses an order. */
export const COAST_NOTICE = "Your ship stopped at the coast.";
export const EDGE_NOTICE = "Edge of the charted world.";
export const PORT_FULL_NOTICE = "Port is full: waiting at anchor.";

/** One player's money and current selection. */
export interface OwnerState {
  money: number;
  selectedShipId: string | null;
}

/** The shared crew pool at a port. Lazy-created full. */
export interface PortCrewPool {
  crew: number;
  capacity: number;
}

export interface World {
  /** Number of world steps taken. */
  tick: number;
  /** Game seconds since the room started, for last-seen ages. */
  gameSeconds: number;
  /** Integer game milliseconds since the room started; the clock authority. */
  gameMs: number;
  /** The room code and its kind (normal, test or debug). */
  roomCode: string;
  kind: RoomKind;
  /** The navy every player in this room starts with. */
  navy: NavyId;
  /** Test/dev port start, or null for the navy's real start. */
  startPort: PlacedPort | null;
  /** All placed ports. They have no owner yet. */
  ports: ReadonlyMap<string, PlacedPort>;
  /** The first ship of each human player, kept as the old single-ship alias. */
  players: Map<string, Ship>;
  /** Every ship belonging to each human player. */
  fleets: Map<string, Ship[]>;
  /** Money and selected ship, by human player id. */
  owners: Map<string, OwnerState>;
  /** Shared crew available at each port that has been used. */
  crewPools: Map<string, PortCrewPool>;
  /** Reserved for future port ownership; empty means every port is unowned. */
  portOwners: Map<string, string>;
  /** Next internal id for a bought ship. */
  nextShipId: number;
  /** Starting money for a player joining this room. */
  startMoney: number;
  /** Class the room's first ship uses unless the join chooses another. */
  startShipClass: ShipClassId;
  /** TEMP-DEBUG: fake load-test owners and their fleets. */
  botFleets: Map<string, Ship[]>;
  /** Each player's discovered ground and last-seen records. */
  charts: Map<string, ChartState>;
  /** Short messages waiting for each player; never part of the world state. */
  notices: Map<string, string[]>;
  /** Shared storage at every capturable port, all goods together. */
  portStorage: Map<string, GoodsAmounts>;
  /** Resource stock held by NPC merchants, by port. */
  npcStocks: Map<string, GoodsAmounts>;
  /** The current regional trends and per-port price factors. */
  priceState: PriceState;
  /** Game time of the next production cycle. */
  nextProductionGameMs: number;
  /** Game time of the next regional/port price shift. */
  nextPriceShiftGameMs: number;
  /** Provisions multiplier; normal rooms always use one. */
  hungerMultiplier: number;
}

/**
 * One ship in a state message: [id, class, x, y, heading, knots, navy,
 * docked port id, waiting port id]. The two port fields are null at sea.
 */
export type ShipSnapshot = [
  id: string,
  classId: string,
  x: number,
  y: number,
  headingDeg: number,
  speedKnots: number,
  navy: NavyId,
  dockedPortId: string | null,
  waitingPortId: string | null,
];

/** What a player may see of one port's trade. */
export interface PortTradeSnapshot {
  /** Prices in pieces of eight per tonne, only when this player may know them. */
  prices: Record<GoodId, number> | null;
  /** Shared storage, only for a port this player may use. */
  storage: GoodsAmounts | null;
  storageLimit: number;
  /** NPC resources for sale, only when this player is docked there. */
  npcStock: GoodsAmounts | null;
}

/**
 * A found port: [id, name, size, npc 0/1, x, y, region, good,
 * free places or null, shipyard open 0/1, crew pool, trade or null].
 */
export type PortSnapshot = [
  id: string,
  name: string,
  size: PortSize,
  npc: 0 | 1,
  x: number,
  y: number,
  region: string,
  good: string,
  freePlaces: number | null,
  buyable: 0 | 1,
  crewAvailable: number,
  trade: PortTradeSnapshot | null,
];

/** A short event message, separate from world state. */
export interface NoticeMessage {
  /** "n" means notice. */
  t: "n";
  text: string;
}

/** Last-seen marker: class, navy, position, age in game seconds. */
export type LastSeenSnapshot = [string, string, number, number, number];

export type ShipStatus = "sailing" | "docked" | "waiting" | "delivery";

/** Full private detail for one of the receiving player's own ships. */
export interface OwnShipSnapshot {
  id: string;
  name: string;
  classId: ShipClassId;
  navy: NavyId;
  crew: number;
  fullCrew: number;
  status: ShipStatus;
  portId: string | null;
  deliveryLeftMs: number;
  x: number;
  y: number;
  stores: ShipStores;
  capacities: ShipStoreCapacities;
  cargoUsed: number;
  provisionsDays: number;
  starving: boolean;
}

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
  /** Game time in milliseconds since the room started. */
  g: number;
  ships: ShipSnapshot[];
  /** Faded last-seen markers. */
  l: LastSeenSnapshot[];
  /** Newly discovered cells and private map blocks. */
  chart: ChartUpdate;
  /** Only ports this player has found. */
  ports: PortSnapshot[];
  /** This player's money in pieces of eight. Never another player's. */
  m: number;
  /** This player's selected ship id, if one is selectable. */
  sel: string | null;
  /** Full private detail for this player's own fleet only. */
  fleet: OwnShipSnapshot[];
  /** Test/dev provisions multiplier, shown by TEMP-DEBUG only. */
  h?: number;
  /** TEMP-DEBUG: dev-room load-test counters. */
  d?: DebugStats;
}

export interface WorldOptions {
  navy?: NavyId;
  startPort?: PlacedPort | null;
  shipClass?: ShipClassId;
  startMoney?: number;
  /** Test/dev only; normal rooms force one. */
  hungerMultiplier?: number;
  /** Fixed room seed for repeatable prices. */
  priceSeed?: number;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function gameCycleMs(gameDays: number): number {
  return gameDays * settings.time.hoursPerDay * 60 * 60 * 1_000;
}

/** All port economies start with local production in their stores. */
function startingPortStorage(): Map<string, GoodsAmounts> {
  const storage = new Map<string, GoodsAmounts>();
  for (const port of PLACED_PORTS) {
    if (!port.npc) storage.set(port.id, initialPortStorage(port));
  }
  return storage;
}

function startingNpcStocks(): Map<string, GoodsAmounts> {
  const stocks = new Map<string, GoodsAmounts>();
  for (const port of PLACED_PORTS) {
    if (port.npc) stocks.set(port.id, initialNpcStock(port));
  }
  return stocks;
}

export function createWorld(roomCode = "main", options: WorldOptions = {}): World {
  const kind = roomKindForCode(roomCode);
  const navy = kind === "normal" ? "British" : options.navy ?? "British";
  const firstPort = findPortByName(settings.navies[navy].firstNpcPort);
  const startPort =
    kind === "test"
      ? options.startPort ?? firstPort
      : kind === "dev"
        ? options.startPort ?? null
        : null;

  const defaultClass: ShipClassId = kind === "normal" ? "flagship" : "frigate";
  const startMoney = kind === "normal"
    ? settings.ships.startMoney.normal
    : options.startMoney ?? settings.ships.startMoney[kind];
  const hungerMultiplier = kind === "normal"
    ? settings.trade.normalHungerMultiplier
    : options.hungerMultiplier ?? settings.trade.testHungerMultiplier;
  const priceSeed = options.priceSeed ?? hashText(roomCode);

  return {
    tick: 0,
    gameSeconds: 0,
    gameMs: 0,
    roomCode,
    kind,
    navy,
    startPort,
    ports: PORT_BY_ID,
    players: new Map(),
    fleets: new Map(),
    owners: new Map(),
    crewPools: new Map(),
    portOwners: new Map(),
    nextShipId: 1,
    startMoney,
    startShipClass: kind === "normal" ? "flagship" : options.shipClass ?? defaultClass,
    botFleets: new Map(),
    charts: new Map(),
    notices: new Map(),
    portStorage: startingPortStorage(),
    npcStocks: startingNpcStocks(),
    priceState: createPriceState(priceSeed),
    nextProductionGameMs: gameCycleMs(settings.trade.production.cycleGameDays),
    nextPriceShiftGameMs: gameCycleMs(settings.trade.pricesCycle.shiftGameDays),
    hungerMultiplier: Math.max(0, hungerMultiplier),
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

const navyStartCentres = new Map<string, { x: number; y: number }>();
const portStartCentres = new Map<string, { x: number; y: number }>();

function navyStartCentre(world: World): { x: number; y: number } {
  const cached = navyStartCentres.get(world.navy);
  if (cached) return cached;
  const start = settings.navies[world.navy].start;
  const centre = lonLatToMap(start.lonDeg, start.latDeg);
  navyStartCentres.set(world.navy, centre);
  return centre;
}

/** A sea point exactly the port-start distance from a port's anchorage. */
function portStartCentre(port: PlacedPort): { x: number; y: number } {
  const cached = portStartCentres.get(port.id);
  if (cached) return cached;

  const distance = settings.ports.startDistanceKm;
  let fallback: { x: number; y: number } | null = null;
  for (let ray = 0; ray < 72; ray += 1) {
    const angle = (ray / 72) * Math.PI * 2;
    const candidate = {
      x: port.anchorage.x + Math.sin(angle) * distance,
      y: port.anchorage.y - Math.cos(angle) * distance,
    };
    if (!isInsideMapFrame(candidate.x, candidate.y) || isLandAt(candidate.x, candidate.y)) {
      continue;
    }
    fallback ??= candidate;
    if (hasOffshoreClearance(candidate.x, candidate.y, settings.world.startRadiusKm + 2)) {
      portStartCentres.set(port.id, candidate);
      return candidate;
    }
  }

  const centre = fallback ?? port.anchorage;
  portStartCentres.set(port.id, centre);
  return centre;
}

function startCentreFor(world: World): { x: number; y: number } {
  return world.startPort && world.kind !== "normal"
    ? portStartCentre(world.startPort)
    : navyStartCentre(world);
}

/** A stable spot in the start area, different for each player id. */
function startSpot(
  playerId: string,
  centre: { x: number; y: number },
): { x: number; y: number; headingRad: number } {
  const hash = hashPlayerId(playerId);

  const bearingRad = (hash % 360) * DEG;
  const share = 0.55 + (((hash >>> 8) % 1000) / 1000) * 0.45;
  const distanceKm = settings.world.startRadiusKm * share;

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
 * existing ship, or on land, walk around the start circle until there is room.
 */
function newPlayerSpot(world: World, playerId: string): { x: number; y: number; headingRad: number } {
  const centre = startCentreFor(world);
  const initial = startSpot(playerId, centre);
  const offsetX = initial.x - centre.x;
  const offsetY = initial.y - centre.y;
  const radius = Math.hypot(offsetX, offsetY);
  let bearing = Math.atan2(offsetX, offsetY);

  let spot = initial;
  for (let attempt = 0; attempt < 72; attempt += 1) {
    const candidate = {
      x: centre.x + Math.sin(bearing) * radius,
      y: centre.y - Math.cos(bearing) * radius,
    };

    const occupied = [...world.players.values()];
    for (const fleet of world.fleets.values()) occupied.push(...fleet);
    for (const fleet of world.botFleets.values()) occupied.push(...fleet);
    const clear =
      isInsideMapFrame(candidate.x, candidate.y) &&
      !isLandAt(candidate.x, candidate.y) &&
      occupied.every(
        (ship) => distanceKm(ship, candidate) >= settings.world.minimumSeparationKm,
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

function initialShipName(world: World, playerId: string): string {
  const pool = SHIP_NAMES[world.navy];
  return pool[hashPlayerId(playerId) % pool.length] ?? shipTypeFor(world.navy, "flagship").name;
}

/** Add a player's first ship once. A returning id keeps its fleet and chart. */
export function addPlayer(
  world: World,
  playerId: string,
  classId: ShipClassId = world.startShipClass,
  startMoney: number = world.startMoney,
): Ship {
  const existing = world.players.get(playerId);
  if (existing) {
    // A returning player keeps the same chart. This also repairs an old
    // room created before charts or fleets existed.
    if (!world.fleets.has(playerId)) world.fleets.set(playerId, [existing]);
    if (!world.owners.has(playerId)) {
      world.owners.set(playerId, { money: startMoney, selectedShipId: existing.id });
    }
    if (!world.charts.has(playerId)) {
      const chart = createChart(world.kind);
      world.charts.set(playerId, chart);
      revealCircle(chart, existing.x, existing.y);
    }
    return existing;
  }

  const spot = newPlayerSpot(world, playerId);
  const ship = createShip(
    playerId,
    classId,
    spot.x,
    spot.y,
    spot.headingRad,
    world.navy,
    initialShipName(world, playerId),
  );
  // Starting ships are ready for sea at once. Only bought ships arrive empty.
  ship.crew = ship.fullCrew;
  ship.stores = fullStores(shipTypeFor(world.navy, classId));
  world.players.set(playerId, ship);
  world.fleets.set(playerId, [ship]);
  world.owners.set(playerId, { money: startMoney, selectedShipId: ship.id });

  const chart = createChart(world.kind);
  world.charts.set(playerId, chart);
  revealCircle(chart, ship.x, ship.y);
  return ship;
}

/** Remove a human player's fleet, chart and waiting messages. */
/** A new socket gets the player's whole discovered record, then changes. */
export function requestChartResume(world: World, playerId: string): boolean {
  const chart = world.charts.get(playerId);
  if (!chart) return false;
  markChartForResume(chart);
  return true;
}

export function removePlayer(world: World, playerId: string): boolean {
  const removedPrimary = world.players.delete(playerId);
  const removedFleet = world.fleets.delete(playerId);
  const removedShip = removedPrimary || removedFleet;
  world.owners.delete(playerId);
  world.botFleets.delete(playerId);
  world.charts.delete(playerId);
  world.notices.delete(playerId);
  return removedShip;
}

/** All ships belonging to one human or fake player. */
export function shipsForOwner(world: World, ownerId: string): Ship[] {
  const fleet = world.fleets.get(ownerId);
  if (fleet) return fleet;
  const human = world.players.get(ownerId);
  if (human) return [human];
  return world.botFleets.get(ownerId) ?? [];
}

/** The player's selected ship, or its first ship if the selection went stale. */
export function selectedShip(world: World, playerId: string): Ship | null {
  const fleet = shipsForOwner(world, playerId);
  if (fleet.length === 0) return null;
  const owner = world.owners.get(playerId);
  const selected = fleet.find((ship) => ship.id === owner?.selectedShipId);
  return selected ?? fleet[0] ?? null;
}

/** Select one of the player's ships. Ships still being delivered cannot win. */
export function selectShip(world: World, playerId: string, shipId: unknown): boolean {
  if (typeof shipId !== "string") return false;
  const ship = shipsForOwner(world, playerId).find((candidate) => candidate.id === shipId);
  if (!ship || ship.deliveryPortId) return false;
  const owner = world.owners.get(playerId);
  if (!owner) return false;
  owner.selectedShipId = ship.id;
  return true;
}

function shipForOrder(world: World, playerId: string, shipId?: unknown): Ship | null {
  if (shipId === undefined || shipId === null) return selectedShip(world, playerId);
  if (typeof shipId !== "string") return null;
  return shipsForOwner(world, playerId).find((ship) => ship.id === shipId) ?? null;
}

/** The public status derived from the ship's position and delivery. */
export function shipStatus(ship: Ship): ShipStatus {
  if (ship.deliveryPortId) return "delivery";
  if (ship.dockedPortId) return "docked";
  if (ship.waitingPortId) return "waiting";
  return "sailing";
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
export function applyOrder(
  world: World,
  playerId: string,
  x: unknown,
  y: unknown,
  shipId?: unknown,
): boolean {
  if (typeof x !== "number" || typeof y !== "number") return false;

  const ship = shipForOrder(world, playerId, shipId);
  if (!ship || ship.deliveryPortId) return false;
  if (!canShipSail(ship)) {
    if (world.players.has(playerId)) pushNotice(world, playerId, "Needs crew.");
    return false;
  }
  if (ship.dockedPortId) return false;
  if (!sailTo(ship, x, y)) return false;

  ship.waitingPortId = null;
  ship.waitingSinceGameMs = 0;
  ship.portOrderId = null;
  return true;
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

function allShips(world: World): Array<{ ownerId: string; ship: Ship }> {
  const ships: Array<{ ownerId: string; ship: Ship }> = [];
  for (const [ownerId, fleet] of world.fleets) {
    for (const ship of fleet) ships.push({ ownerId, ship });
  }
  for (const [ownerId, fleet] of world.botFleets) {
    for (const ship of fleet) ships.push({ ownerId, ship });
  }
  return ships;
}

/** Docking places at a port size. */
export function portCapacity(port: Pick<PlacedPort, "size">): number {
  return settings.ports.sizes[port.size].dockingCapacity;
}

/** Docked ships of every owner, including temporary bot ships. */
function dockedCount(world: World, portId: string): number {
  let count = 0;
  for (const { ship } of allShips(world)) {
    if (ship.dockedPortId === portId) count += 1;
  }
  return count;
}

function dockAt(
  world: World,
  ownerId: string,
  ship: Ship,
  port: PlacedPort,
): void {
  ship.x = port.anchorage.x;
  ship.y = port.anchorage.y;
  ship.order = null;
  ship.speedKnots = 0;
  ship.dockedPortId = port.id;
  ship.waitingPortId = null;
  ship.portOrderId = null;
  ship.arrived = true;
  if (world.players.has(ownerId)) pushNotice(world, ownerId, `Docked at ${port.name}.`);
}

function arriveAtPort(
  world: World,
  ownerId: string,
  ship: Ship,
  port: PlacedPort,
): void {
  if (dockedCount(world, port.id) < portCapacity(port)) {
    dockAt(world, ownerId, ship, port);
    return;
  }

  ship.order = null;
  ship.speedKnots = 0;
  ship.portOrderId = null;
  ship.dockedPortId = null;
  ship.waitingPortId = port.id;
  ship.waitingSinceGameMs = world.gameMs;
  ship.arrived = true;
  if (world.players.has(ownerId)) pushNotice(world, ownerId, PORT_FULL_NOTICE);
}

/** Order a found port. Unfound or non-placed ports are refused. */
export function applyPortOrder(
  world: World,
  playerId: string,
  portId: unknown,
  shipId?: unknown,
): boolean {
  if (typeof portId !== "string") return false;
  const ship = shipForOrder(world, playerId, shipId);
  const port = world.ports.get(portId);
  if (!ship || !port || ship.deliveryPortId) return false;
  if (!canShipSail(ship)) {
    pushNotice(world, playerId, "Needs crew.");
    return false;
  }
  if (ship.dockedPortId) return false;
  if (!world.charts.get(playerId)?.foundPorts.has(portId)) return false;

  ship.waitingPortId = null;
  ship.waitingSinceGameMs = 0;
  ship.portOrderId = port.id;

  if (distanceKm(ship, port.anchorage) <= settings.sailing.arrivalRadiusKm) {
    ship.order = null;
    arriveAtPort(world, playerId, ship, port);
    return true;
  }

  if (!sailTo(ship, port.anchorage.x, port.anchorage.y)) {
    ship.portOrderId = null;
    return false;
  }
  return true;
}

/** Free a docking place. The ship stays at the anchorage and may sail again. */
export function undock(world: World, playerId: string, shipId?: unknown): boolean {
  const ship = shipForOrder(world, playerId, shipId);
  const portId = ship?.dockedPortId;
  if (!ship || !portId) return false;
  const port = world.ports.get(portId);

  ship.dockedPortId = null;
  ship.speedKnots = 0;
  ship.order = null;
  ship.portOrderId = null;
  ship.waitingPortId = null;
  ship.arrived = true;
  pushNotice(world, playerId, port ? `Undocked from ${port.name}.` : "Undocked.");
  return true;
}

/** The player's money. Unknown and fake owners have none. */
export function ownerMoney(world: World, playerId: string): number {
  return world.owners.get(playerId)?.money ?? 0;
}

/** The shared pool at a port. The first look starts it full. */
export function portCrewPool(world: World, port: PlacedPort): PortCrewPool {
  let pool = world.crewPools.get(port.id);
  if (!pool) {
    pool = { crew: settings.ports.sizes[port.size].crewPool, capacity: settings.ports.sizes[port.size].crewPool };
    world.crewPools.set(port.id, pool);
  }
  return pool;
}

/**
 * Whether this player may use the port's shipyard today.
 *
 * There are no port owners yet, so a normal room sells nothing. Test and dev
 * rooms treat every placed capturable port as usable. When ownership arrives,
 * `portOwners` is the single flag the rest of the game already reads.
 */
export function portUsableForBuying(
  world: World,
  port: PlacedPort,
  playerId: string,
): boolean {
  if (port.npc) return false;
  const owner = world.portOwners.get(port.id);
  if (owner) return owner === playerId;
  return world.kind !== "normal";
}

/**
 * Buy a ship. Money is taken immediately and the hull is delivered later at
 * the port, empty of crew. Returns the new ship, or null after a paper notice.
 */
export function buyShip(
  world: World,
  playerId: string,
  portId: unknown,
  classId: unknown,
  rawName: unknown,
): Ship | null {
  if (typeof portId !== "string" || typeof classId !== "string" || typeof rawName !== "string") {
    return null;
  }
  const port = world.ports.get(portId);
  const owner = world.owners.get(playerId);
  const fleet = world.fleets.get(playerId);
  if (!port || !owner || !fleet) return null;

  if (!world.charts.get(playerId)?.foundPorts.has(port.id)) {
    pushNotice(world, playerId, "You have not found this port.");
    return null;
  }
  if (port.npc) {
    pushNotice(world, playerId, "This port does not sell ships.");
    return null;
  }
  if (!portUsableForBuying(world, port, playerId)) {
    pushNotice(world, playerId, "You must own a port to buy ships here.");
    return null;
  }

  const price = shipPrice(classId as DataShipClassId);
  const portStockSize = port.size === "S" ? "small" : port.size === "M" ? "mid" : "large";
  if (price === null || !portSellsShip(portStockSize, classId as DataShipClassId)) {
    pushNotice(world, playerId, "This port does not sell that ship.");
    return null;
  }
  if (owner.money < price) {
    pushNotice(world, playerId, "Not enough money.");
    return null;
  }
  if (!canAddShip(fleet.length)) {
    pushNotice(world, playerId, `Your fleet is full (${settings.ships.maxShipsPerPlayer} ships).`);
    return null;
  }
  const name = cleanShipName(rawName);
  if (!name) {
    pushNotice(world, playerId, "That ship name cannot be used.");
    return null;
  }

  owner.money -= price;
  const ship = createShip(
    `ship-${world.nextShipId}`,
    classId as DataShipClassId,
    port.anchorage.x,
    port.anchorage.y,
    0,
    world.navy,
    name,
    0,
  );
  world.nextShipId += 1;
  ship.deliveryPortId = port.id;
  ship.deliveryReadyGameMs = world.gameMs + deliveryGameMs(world.kind, ship.classId);
  fleet.push(ship);
  pushNotice(world, playerId, `Ship ordered: ${name}.`);
  return ship;
}

/**
 * Hire sailors from one port's shared pool into a docked ship.
 * The ship, pool and complement all have to cover the whole request.
 */
export function hireCrew(
  world: World,
  playerId: string,
  shipId: unknown,
  portId: unknown,
  requested: unknown,
): boolean {
  if (typeof portId !== "string" || typeof requested !== "number") return false;
  const count = Math.floor(requested);
  if (!Number.isInteger(count) || count <= 0) return false;

  const ship = shipForOrder(world, playerId, shipId);
  const port = world.ports.get(portId);
  const owner = world.owners.get(playerId);
  if (!ship || !port || !owner || ship.deliveryPortId) return false;
  if (ship.dockedPortId !== port.id) return false;
  if (!world.charts.get(playerId)?.foundPorts.has(port.id)) return false;

  const wanted = ship.crew + count;
  if (wanted > ship.fullCrew) {
    pushNotice(world, playerId, "That is more crew than the ship can carry.");
    return false;
  }

  const pool = portCrewPool(world, port);
  if (pool.crew < count) {
    pushNotice(world, playerId, "Not enough sailors at this port.");
    return false;
  }

  const cost = crewHireCost(count);
  if (owner.money < cost) {
    pushNotice(world, playerId, "Not enough money.");
    return false;
  }

  owner.money -= cost;
  pool.crew -= count;
  ship.crew = wanted;
  pushNotice(world, playerId, `Hired ${count} sailors for ${cost} pieces of eight.`);
  return true;
}

/** The shared storage at one capturable port. It starts half full. */
export function portStorageFor(world: World, port: PlacedPort): GoodsAmounts {
  let storage = world.portStorage.get(port.id);
  if (!storage) {
    storage = initialPortStorage(port);
    world.portStorage.set(port.id, storage);
  }
  return storage;
}

/** The five resource amounts an NPC merchant has for sale. */
export function npcStockFor(world: World, port: PlacedPort): GoodsAmounts {
  let stock = world.npcStocks.get(port.id);
  if (!stock) {
    stock = initialNpcStock(port);
    world.npcStocks.set(port.id, stock);
  }
  return stock;
}

function localPrice(world: World, port: PlacedPort, good: GoodId): number {
  return postedPrice(good, port, world.priceState);
}

function tonnesText(tonnes: number): string {
  const rounded = Math.round(tonnes * 100) / 100;
  return `${rounded} t`;
}

function refreshStarving(ship: Ship): void {
  ship.starving = shipIsStarving(ship.stores, ship.crew);
}

/** Resolve the ship and port for an order, requiring a berth at that port. */
function shipDockedAt(
  world: World,
  playerId: string,
  shipId: unknown,
  portId: unknown,
): { ship: Ship; port: PlacedPort; owner: OwnerState } | null {
  if (typeof portId !== "string") return null;
  const ship = shipForOrder(world, playerId, shipId);
  const port = world.ports.get(portId);
  const owner = world.owners.get(playerId);
  if (!ship || !port || !owner || ship.deliveryPortId) return null;
  if (ship.dockedPortId !== port.id) return null;
  if (!world.charts.get(playerId)?.foundPorts.has(port.id)) return null;
  return { ship, port, owner };
}

/**
 * Buy a resource from an NPC merchant. Stock, money and the right ship store
 * all limit the trade; a partial purchase is allowed and reported.
 */
export function buyGoods(
  world: World,
  playerId: string,
  shipId: unknown,
  portId: unknown,
  rawGood: unknown,
  requested: unknown,
): boolean {
  const found = shipDockedAt(world, playerId, shipId, portId);
  if (!found) return false;
  const { ship, port, owner } = found;
  if (!isResourceId(rawGood)) return false;
  const good = rawGood;
  if (!port.npc) {
    pushNotice(world, playerId, "This port does not sell supplies.");
    return false;
  }
  if (typeof requested !== "number" || !Number.isFinite(requested)) return false;

  const stock = npcStockFor(world, port);
  const unitPrice = localPrice(world, port, good);
  const quote = quoteBuy({
    good,
    requested,
    stock: stock[good],
    money: owner.money,
    stores: ship.stores,
    capacities: shipStoreCapacities(shipSpecFor(ship)),
    unitPrice,
  });
  if (quote.amount <= 0) {
    if (quote.reason) pushNotice(world, playerId, quote.reason);
    return false;
  }

  stock[good] = Math.max(0, stock[good] - quote.amount);
  owner.money -= quote.total;
  addGoodToStores(ship.stores, good, quote.amount);
  refreshStarving(ship);
  pushNotice(
    world,
    playerId,
    `Bought ${tonnesText(quote.amount)} of ${goodName(good)} for ${quote.total} pieces of eight.`,
  );
  return true;
}

/** Sell cargo at an NPC, or into a usable port's shared storage. */
export function sellGoods(
  world: World,
  playerId: string,
  shipId: unknown,
  portId: unknown,
  rawGood: unknown,
  requested: unknown,
): boolean {
  const found = shipDockedAt(world, playerId, shipId, portId);
  if (!found) return false;
  const { ship, port, owner } = found;
  if (!isCargoGoodId(rawGood) || typeof requested !== "number" || !Number.isFinite(requested)) {
    return false;
  }
  const good = rawGood;
  const usable = portUsableForBuying(world, port, playerId);
  if (!port.npc && !usable) {
    pushNotice(world, playerId, "You cannot trade at this port.");
    return false;
  }

  const storage = usable ? portStorageFor(world, port) : null;
  const portFree = storage
    ? Math.max(0, portStorageLimit(port) - totalGoods(storage))
    : null;
  const unitPrice = localPrice(world, port, good);
  const quote = quoteSell({
    good,
    requested,
    hold: goodAmount(ship.stores, good),
    unitPrice,
    portFreeSpace: portFree,
  });
  if (quote.amount <= 0) {
    if (quote.reason) pushNotice(world, playerId, quote.reason);
    return false;
  }

  removeGoodFromStores(ship.stores, good, quote.amount);
  if (storage) storage[good] += quote.amount;
  owner.money += quote.total;
  pushNotice(
    world,
    playerId,
    `Sold ${tonnesText(quote.amount)} of ${goodName(good)} for ${quote.total} pieces of eight.`,
  );
  return true;
}

/** Load from a usable port's storage, or unload into it. This is free. */
export function transferGoods(
  world: World,
  playerId: string,
  shipId: unknown,
  portId: unknown,
  rawGood: unknown,
  requested: unknown,
  direction: TransferDirection,
): boolean {
  const found = shipDockedAt(world, playerId, shipId, portId);
  if (!found) return false;
  const { ship, port } = found;
  if (!isGoodId(rawGood) || typeof requested !== "number" || !Number.isFinite(requested)) {
    return false;
  }
  if (direction !== "load" && direction !== "unload") return false;
  if (!portUsableForBuying(world, port, playerId)) {
    pushNotice(world, playerId, "You cannot use this port's storage.");
    return false;
  }
  const good = rawGood;
  const storage = portStorageFor(world, port);
  const capacities = shipStoreCapacities(shipSpecFor(ship));
  const portFree = Math.max(0, portStorageLimit(port) - totalGoods(storage));
  const quote = quoteTransfer({
    direction,
    good,
    requested,
    shipAmount: goodAmount(ship.stores, good),
    portAmount: storage[good],
    shipFree: freeSpaceForGood(ship.stores, capacities, good),
    portFree,
  });
  if (quote.amount <= 0) {
    if (quote.reason) pushNotice(world, playerId, quote.reason);
    return false;
  }

  if (direction === "load") {
    storage[good] = Math.max(0, storage[good] - quote.amount);
    addGoodToStores(ship.stores, good, quote.amount);
  } else {
    removeGoodFromStores(ship.stores, good, quote.amount);
    storage[good] += quote.amount;
  }
  refreshStarving(ship);
  pushNotice(
    world,
    playerId,
    `${direction === "load" ? "Loaded" : "Unloaded"} ${tonnesText(quote.amount)} of ${goodName(good)}.`,
  );
  return true;
}

/**
 * Fill provisions, repair materials and ammunition from the docked port. NPC
 * ports sell them at posted prices; usable ports give them from storage. The
 * summary says what moved and, at an NPC, what it cost.
 */
export function resupplyShip(
  world: World,
  playerId: string,
  shipId: unknown,
  portId: unknown,
): boolean {
  const found = shipDockedAt(world, playerId, shipId, portId);
  if (!found) return false;
  const { ship, port, owner } = found;
  const usable = portUsableForBuying(world, port, playerId);
  if (!port.npc && !usable) {
    pushNotice(world, playerId, "You cannot resupply at this port.");
    return false;
  }

  const capacities = shipStoreCapacities(shipSpecFor(ship));
  const stock = npcStockFor(world, port);
  const storage = usable ? portStorageFor(world, port) : null;
  const taken: string[] = [];
  let cost = 0;

  for (const good of ["provisions", "repairMaterials", "ammunition"] as const) {
    const cap = capacities[good];
    const needed = Math.max(0, cap - goodAmount(ship.stores, good));
    if (needed <= 0) continue;
    if (port.npc) {
      const quote = quoteBuy({
        good,
        requested: needed,
        stock: stock[good],
        money: owner.money,
        stores: ship.stores,
        capacities,
        unitPrice: localPrice(world, port, good),
      });
      if (quote.amount <= 0) continue;
      stock[good] -= quote.amount;
      owner.money -= quote.total;
      addGoodToStores(ship.stores, good, quote.amount);
      cost += quote.total;
      taken.push(`${tonnesText(quote.amount)} ${goodName(good).toLowerCase()}`);
    } else if (storage) {
      const amount = Math.min(needed, storage[good]);
      if (amount <= 0) continue;
      storage[good] -= amount;
      addGoodToStores(ship.stores, good, amount);
      taken.push(`${tonnesText(amount)} ${goodName(good).toLowerCase()}`);
    }
  }

  refreshStarving(ship);
  if (taken.length === 0) {
    pushNotice(world, playerId, "No supplies available.");
    return false;
  }
  const costText = cost > 0 ? ` for ${cost} pieces of eight` : " free";
  pushNotice(world, playerId, `Resupplied: ${taken.join(", ")}${costText}.`);
  return true;
}

/** One production cycle for every port and NPC merchant in the room. */
function runProductionCycle(world: World): void {
  for (const port of PLACED_PORTS) {
    if (port.npc) {
      refillNpcStock(npcStockFor(world, port), port);
    } else {
      addLimitedProduction(
        portStorageFor(world, port),
        portStorageLimit(port),
        portProduction(port),
      );
    }
  }
}

/** Advance production and price shifts to the new game time. */
function updatePortEconomy(world: World): void {
  const productionEvery = gameCycleMs(settings.trade.production.cycleGameDays);
  while (world.gameMs >= world.nextProductionGameMs) {
    runProductionCycle(world);
    world.nextProductionGameMs += productionEvery;
  }

  const pricesEvery = gameCycleMs(settings.trade.pricesCycle.shiftGameDays);
  while (world.gameMs >= world.nextPriceShiftGameMs) {
    world.priceState = shiftPrices(world.priceState, PLACED_PORTS);
    world.nextPriceShiftGameMs += pricesEvery;
  }
}

/** Consume human crews' provisions. Bots keep their full larder untouched. */
function updateHunger(world: World, dtGameSeconds: number): void {
  const gameDays = dtGameSeconds /
    (settings.time.hoursPerDay * 60 * 60);
  if (!(gameDays > 0)) return;

  for (const [ownerId, fleet] of world.fleets) {
    for (const ship of fleet) {
      if (ship.crew <= 0) {
        ship.starving = false;
        continue;
      }
      const wasStarving = ship.starving;
      const result = advanceProvisions(
        ship.stores.provisions,
        ship.crew,
        gameDays,
        world.hungerMultiplier,
      );
      ship.stores.provisions = result.provisions;
      ship.crew = result.crew;
      ship.starving = result.starving && ship.crew > 0;
      if (ship.starving && !wasStarving) {
        pushNotice(world, ownerId, "Starving: no provisions left.");
      }
    }
  }
}

/** Refill every pool that has been used, from real time while occupied. */
function updateCrewPools(world: World, dtGameSeconds: number): void {
  const realSeconds = dtGameSeconds / settings.time.sailingTimeScale;
  if (!(realSeconds > 0)) return;
  for (const pool of world.crewPools.values()) {
    pool.crew = refillCrewPool(pool.crew, pool.capacity, realSeconds);
  }
}

/** Finish any delivery whose game-time moment has arrived. */
function deliverReadyShips(world: World): void {
  for (const [ownerId, fleet] of world.fleets) {
    for (const ship of fleet) {
      if (!ship.deliveryPortId || ship.deliveryReadyGameMs > world.gameMs) continue;
      const port = world.ports.get(ship.deliveryPortId);
      ship.deliveryPortId = null;
      ship.deliveryReadyGameMs = 0;
      if (!port) continue;

      ship.x = port.anchorage.x;
      ship.y = port.anchorage.y;
      ship.headingRad = 0;
      ship.speedKnots = 0;
      ship.order = null;
      pushNotice(world, ownerId, `Ship delivered: ${ship.name} at ${port.name}.`);
      arriveAtPort(world, ownerId, ship, port);
    }
  }
}

/** Dock an arriving port order, or clear the order if it ended at a coast. */
function finishPortOrder(world: World, ownerId: string, ship: Ship): void {
  if (!ship.portOrderId || ship.order) return;
  const port = world.ports.get(ship.portOrderId);
  ship.portOrderId = null;
  if (!port || !ship.arrived) return;
  if (distanceKm(ship, port.anchorage) > settings.sailing.arrivalRadiusKm + 0.1) return;
  arriveAtPort(world, ownerId, ship, port);
}

/** Retry waiting ships oldest first, once per configured retry interval. */
function tryWaitingShips(world: World): void {
  const waitingPortIds = new Set<string>();
  for (const { ship } of allShips(world)) {
    if (ship.waitingPortId) waitingPortIds.add(ship.waitingPortId);
  }

  for (const portId of waitingPortIds) {
    const port = world.ports.get(portId);
    if (!port) continue;
    let free = portCapacity(port) - dockedCount(world, portId);
    if (free <= 0) continue;

    const waiting = allShips(world)
      .filter(({ ship }) => ship.waitingPortId === portId)
      .sort((a, b) =>
        a.ship.waitingSinceGameMs - b.ship.waitingSinceGameMs ||
        (a.ship.id < b.ship.id ? -1 : a.ship.id > b.ship.id ? 1 : 0),
      );

    for (const { ownerId, ship } of waiting) {
      const retryAfterMs =
        settings.ports.dockingRetrySeconds * settings.time.sailingTimeScale * 1_000;
      if (world.gameMs - ship.waitingSinceGameMs < retryAfterMs) {
        continue;
      }
      if (free <= 0) break;
      dockAt(world, ownerId, ship, port);
      free -= 1;
    }
  }
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
  const spec = shipSpecFor(ship);
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
      if (ship.deliveryPortId) continue;
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
  if (ship.deliveryPortId) {
    ship.speedKnots = 0;
    ship.order = null;
    return;
  }

  if (ship.dockedPortId) {
    ship.speedKnots = 0;
    ship.order = null;
    return;
  }

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
  finishPortOrder(world, ownerId, ship);
}

export function stepWorld(
  world: World,
  dtGameSeconds: number,
  windFromDeg: number = settings.weather.windFromDeg,
): void {
  for (const [playerId, fleet] of world.fleets) {
    for (const ship of fleet) {
      stepOwnerShip(world, playerId, ship, dtGameSeconds, windFromDeg);
    }
  }

  // TEMP-DEBUG: load-test ships use the same movement path as players.
  for (const [ownerId, fleet] of world.botFleets) {
    for (const ship of fleet) {
      stepOwnerShip(world, ownerId, ship, dtGameSeconds, windFromDeg);
    }
  }

  refreshBotOrders(world);
  world.tick += 1;
  // Integer milliseconds avoid a slowly drifting clock. A tick always adds the
  // same amount, and nothing is added while the room has no players.
  const elapsedMs = Number.isFinite(dtGameSeconds)
    ? Math.round(Math.max(0, dtGameSeconds) * 1000)
    : 0;
  world.gameMs += elapsedMs;
  world.gameSeconds = world.gameMs / 1000;
  updateHunger(world, dtGameSeconds);
  updatePortEconomy(world);
  updateCrewPools(world, dtGameSeconds);
  deliverReadyShips(world);
  updateFog(world);
  tryWaitingShips(world);
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
  maxBlocks: number = settings.fog.maxBlocksPerMessage,
): StateMessage {
  const own = shipsForOwner(world, playerId);
  const ownIds = new Set(own.map((ship) => ship.id));
  const sightSq = settings.fog.sightRangeKm ** 2;
  const activeOwn = own.filter((ship) => !ship.deliveryPortId);
  const isVisible = (ship: Ship): boolean =>
    activeOwn.some((mine) => (ship.x - mine.x) ** 2 + (ship.y - mine.y) ** 2 <= sightSq);

  const chart = world.charts.get(playerId) ?? createChart(world.kind);
  world.charts.set(playerId, chart);

  // A port is found by its anchorage, not its coast. Dev rooms know them all.
  if (chart.all) {
    for (const port of PLACED_PORTS) chart.foundPorts.add(port.id);
  } else {
    for (const port of PLACED_PORTS) {
      if (chart.foundPorts.has(port.id)) continue;
      if (
        activeOwn.some(
          (ship) =>
            (ship.x - port.anchorage.x) ** 2 + (ship.y - port.anchorage.y) ** 2 <= sightSq,
        )
      ) {
        chart.foundPorts.add(port.id);
      }
    }
  }

  const ships: ShipSnapshot[] = [];
  const visibleIds = new Set<string>();

  // A fleet owner sees every one of its own ships plus foreign ships inside
  // the sight circle of any of them. The client uses the same path for one
  // ship; this only exists for the temporary load test.
  const allShips: Ship[] = [];
  for (const fleet of world.fleets.values()) allShips.push(...fleet);
  for (const fleet of world.botFleets.values()) allShips.push(...fleet);

  for (const ship of allShips) {
    if (ship.deliveryPortId) continue;
    if (!ownIds.has(ship.id) && !isVisible(ship)) continue;

    visibleIds.add(ship.id);
    ships.push([
      ship.id,
      ship.classId,
      Number(ship.x.toFixed(2)),
      Number(ship.y.toFixed(2)),
      headingDegrees(ship.headingRad),
      Number(ship.speedKnots.toFixed(1)),
      ship.navy,
      ship.dockedPortId,
      ship.waitingPortId,
    ]);
  }

  const near = activeOwn[0] ? { x: activeOwn[0].x, y: activeOwn[0].y } : undefined;

  // Remember foreign ships while they are visible; when they leave the circle
  // their last position becomes a faded marker with an age in game time.
  for (const ship of allShips) {
    if (ownIds.has(ship.id) || !visibleIds.has(ship.id)) continue;
    chart.seen.set(ship.id, {
      classId: ship.classId,
      navy: ship.navy,
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

  // Free places are only for a port where this player already has a berth.
  // Prices need a berth or a usable port. Storage needs a usable port.
  const ports: PortSnapshot[] = [];
  for (const port of PLACED_PORTS) {
    if (!chart.foundPorts.has(port.id)) continue;
    const dockedHere = own.some((ship) => ship.dockedPortId === port.id);
    const usable = portUsableForBuying(world, port, playerId);
    const pool = portCrewPool(world, port);
    const storage = usable ? roundedGoods(portStorageFor(world, port)) : null;
    const trade: PortTradeSnapshot = {
      prices: dockedHere || usable
        ? priceList(port, world.priceState)
        : null,
      storage,
      storageLimit: portStorageLimit(port),
      npcStock: port.npc && dockedHere
        ? roundedGoods(npcStockFor(world, port))
        : null,
    };
    const snapshot: PortSnapshot = [
      port.id,
      port.name,
      port.size,
      port.npc ? 1 : 0,
      Number(port.anchorage.x.toFixed(2)),
      Number(port.anchorage.y.toFixed(2)),
      port.region,
      port.good,
      dockedHere ? Math.max(0, portCapacity(port) - dockedCount(world, port.id)) : null,
      usable ? 1 : 0,
      Math.floor(pool.crew),
      trade,
    ];
    ports.push(snapshot);
  }

  const owner = world.owners.get(playerId);
  const fleet: OwnShipSnapshot[] = own.map((ship) => {
    const capacities = shipStoreCapacities(shipSpecFor(ship));
    const days = provisionsDaysLeft(
      ship.stores.provisions,
      ship.crew,
      world.hungerMultiplier,
    );
    return {
      id: ship.id,
      name: ship.name,
      classId: ship.classId,
      navy: ship.navy,
      crew: ship.crew,
      fullCrew: ship.fullCrew,
      status: shipStatus(ship),
      portId: ship.deliveryPortId ?? ship.dockedPortId ?? ship.waitingPortId,
      deliveryLeftMs: ship.deliveryPortId
        ? Math.max(0, Math.round(ship.deliveryReadyGameMs - world.gameMs))
        : 0,
      x: Number(ship.x.toFixed(2)),
      y: Number(ship.y.toFixed(2)),
      stores: cloneStores(ship.stores),
      capacities,
      cargoUsed: Number(cargoTotal(ship.stores.cargo).toFixed(2)),
      provisionsDays: Number.isFinite(days)
        ? Number(days.toFixed(2))
        : 9_999,
      starving: ship.starving,
    };
  });

  const state: StateMessage = {
    t: "s",
    tick: world.tick,
    you: playerId,
    w: settings.weather.windFromDeg,
    k: world.kind,
    g: Math.round(world.gameMs),
    ships,
    l: lastSeen,
    chart: takeChartUpdate(chart, blockLookup, maxBlocks, near),
    ports,
    m: owner?.money ?? 0,
    sel: owner?.selectedShipId ?? null,
    fleet,
  };
  if (world.kind !== "normal") state.h = world.hungerMultiplier;
  return state;
}

function roundedGoods(goods: Readonly<GoodsAmounts>): GoodsAmounts {
  const out = emptyGoods();
  for (const good of Object.keys(goods) as GoodId[]) {
    out[good] = Number(Math.max(0, goods[good]).toFixed(3));
  }
  return out;
}
