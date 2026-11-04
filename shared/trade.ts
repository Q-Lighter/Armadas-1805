// Pure goods, stores, production, price and trade rules.
//
// The world owns the amounts; these functions decide capacities, consumption,
// prices and legal trades without touching a socket or the browser.

import { settings } from "./settings.js";
import {
  CARGO_GOOD_IDS,
  CLOTH_BASIC_REGION_GOODS,
  GOOD_IDS,
  RESOURCE_IDS,
  isCargoGoodId,
  isGoodId,
  isResourceId,
  type CargoGoodId,
  type GoodId,
  type ResourceId,
} from "./data/goods.js";
import type { PlacedPort } from "./data/ports.js";
import type { ShipType } from "./data/ships.js";

export interface ShipStores {
  provisions: number;
  ammunition: number;
  repairMaterials: number;
  cargo: Record<CargoGoodId, number>;
}

export interface ShipStoreCapacities {
  provisions: number;
  ammunition: number;
  repairMaterials: number;
  cargo: number;
}

export type GoodsAmounts = Record<GoodId, number>;

export function emptyGoods(): GoodsAmounts {
  const out = {} as GoodsAmounts;
  for (const good of GOOD_IDS) out[good] = 0;
  return out;
}

export function emptyCargo(): Record<CargoGoodId, number> {
  const out = {} as Record<CargoGoodId, number>;
  for (const good of CARGO_GOOD_IDS) out[good] = 0;
  return out;
}

export function cargoTotal(cargo: Readonly<Record<CargoGoodId, number>>): number {
  let total = 0;
  for (const good of CARGO_GOOD_IDS) total += Math.max(0, cargo[good] ?? 0);
  return total;
}

export function emptyStores(): ShipStores {
  return {
    provisions: 0,
    ammunition: 0,
    repairMaterials: 0,
    cargo: emptyCargo(),
  };
}

/** Start-of-game stores: full provisions, ammunition and repair, empty cargo. */
export function fullStores(type: Pick<
  ShipType,
  "storesDays" | "crew" | "broadsideLb" | "hull" | "cargoTonnes"
>): ShipStores {
  const capacities = shipStoreCapacities(type);
  return {
    provisions: capacities.provisions,
    ammunition: capacities.ammunition,
    repairMaterials: capacities.repairMaterials,
    cargo: emptyCargo(),
  };
}

export function cloneStores(stores: ShipStores): ShipStores {
  const cargo = emptyCargo();
  for (const good of CARGO_GOOD_IDS) cargo[good] = stores.cargo[good] ?? 0;
  return {
    provisions: stores.provisions,
    ammunition: stores.ammunition,
    repairMaterials: stores.repairMaterials,
    cargo,
  };
}

/** The three separate store capacities plus the cargo hold. */
export function shipStoreCapacities(type: Pick<
  ShipType,
  "storesDays" | "crew" | "broadsideLb" | "hull" | "cargoTonnes"
>): ShipStoreCapacities {
  const stores = settings.ships.stores;
  return {
    provisions:
      type.storesDays * type.crew * stores.provisionsTonnesPerCrewPerGameDay,
    ammunition:
      (stores.ammunitionBroadsides * type.broadsideLb) / stores.poundsPerTonne,
    repairMaterials: type.hull / stores.repairHullPointsPerTonne,
    cargo: type.cargoTonnes,
  };
}

/** Where a good is carried: cargo hold or one of the three separate stores. */
export function storeForGood(good: GoodId): keyof ShipStoreCapacities {
  if (good === "provisions") return "provisions";
  if (good === "ammunition") return "ammunition";
  if (good === "repairMaterials") return "repairMaterials";
  return "cargo";
}

export function capacityForGood(
  capacities: ShipStoreCapacities,
  good: GoodId,
): number {
  return capacities[storeForGood(good)];
}

export function goodAmount(stores: ShipStores, good: GoodId): number {
  if (good === "provisions") return stores.provisions;
  if (good === "ammunition") return stores.ammunition;
  if (good === "repairMaterials") return stores.repairMaterials;
  return stores.cargo[good] ?? 0;
}

/** Used space in the store that carries this good. */
export function usedForGood(stores: ShipStores, good: GoodId): number {
  return storeForGood(good) === "cargo"
    ? cargoTotal(stores.cargo)
    : goodAmount(stores, good);
}

export function freeSpaceForGood(
  stores: ShipStores,
  capacities: ShipStoreCapacities,
  good: GoodId,
): number {
  return Math.max(
    0,
    capacityForGood(capacities, good) - usedForGood(stores, good),
  );
}

/** Add a good to its store without checking capacity. Callers quote first. */
export function addGoodToStores(
  stores: ShipStores,
  good: GoodId,
  amount: number,
): void {
  const value = Math.max(0, amount);
  if (good === "provisions") stores.provisions += value;
  else if (good === "ammunition") stores.ammunition += value;
  else if (good === "repairMaterials") stores.repairMaterials += value;
  else if (isCargoGoodId(good)) stores.cargo[good] += value;
}

/** Remove a good from its store, never below zero. */
export function removeGoodFromStores(
  stores: ShipStores,
  good: GoodId,
  amount: number,
): void {
  const value = Math.max(0, amount);
  if (good === "provisions") stores.provisions = Math.max(0, stores.provisions - value);
  else if (good === "ammunition") {
    stores.ammunition = Math.max(0, stores.ammunition - value);
  } else if (good === "repairMaterials") {
    stores.repairMaterials = Math.max(0, stores.repairMaterials - value);
  } else if (isCargoGoodId(good)) {
    stores.cargo[good] = Math.max(0, stores.cargo[good] - value);
  }
}

/** 0 for an empty hold, 1 for a full one. */
export function cargoHoldFraction(
  stores: Pick<ShipStores, "cargo">,
  cargoCapacity: number,
): number {
  if (!(cargoCapacity > 0)) return 0;
  return Math.max(0, Math.min(1, cargoTotal(stores.cargo) / cargoCapacity));
}

/** A full cargo hold removes up to the configured share of sailing speed. */
export function cargoSpeedMultiplier(
  stores: Pick<ShipStores, "cargo">,
  cargoCapacity: number,
): number {
  const fraction = cargoHoldFraction(stores, cargoCapacity);
  return 1 - settings.ships.stores.fullCargoSpeedLoss * fraction;
}

/** Tonnes one ship eats in one game day at the room's hunger multiplier. */
export function provisionsUsePerGameDay(
  crew: number,
  hungerMultiplier: number = 1,
): number {
  return Math.max(0, crew) *
    settings.ships.stores.provisionsTonnesPerCrewPerGameDay *
    Math.max(0, hungerMultiplier);
}

/** How many game days the current provisions last, or Infinity with no crew. */
export function provisionsDaysLeft(
  provisions: number,
  crew: number,
  hungerMultiplier: number = 1,
): number {
  const dailyUse = provisionsUsePerGameDay(crew, hungerMultiplier);
  if (!(dailyUse > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(0, provisions) / dailyUse;
}

export interface ProvisionAdvance {
  provisions: number;
  crew: number;
  consumed: number;
  crewLost: number;
  starving: boolean;
}

/**
 * Consume provisions for a period. When the stock runs out partway through,
 * only the unfed part of the period kills crew. The loss compounds at the
 * configured daily share, so one full day always removes exactly 8%.
 */
export function advanceProvisions(
  provisions: number,
  crew: number,
  gameDays: number,
  hungerMultiplier: number = 1,
): ProvisionAdvance {
  const days = Math.max(0, gameDays);
  const dailyUse = provisionsUsePerGameDay(crew, hungerMultiplier);
  const need = dailyUse * days;
  const stock = Math.max(0, provisions);

  if (days <= 0 || crew <= 0) {
    return {
      provisions: stock,
      crew: Math.max(0, crew),
      consumed: 0,
      crewLost: 0,
      starving: stock <= 1e-9 && crew > 0,
    };
  }

  if (stock >= need) {
    return {
      provisions: Math.max(0, stock - need),
      crew: Math.max(0, crew),
      consumed: need,
      crewLost: 0,
      starving: stock - need <= 1e-9 && crew > 0,
    };
  }

  const fedDays = dailyUse > 0 ? stock / dailyUse : 0;
  const unfedDays = Math.max(0, days - fedDays);
  const lostShare = 1 - (1 - settings.ships.stores.starvationCrewSharePerGameDay) ** unfedDays;
  const crewLost = Math.max(0, crew * lostShare);
  return {
    provisions: 0,
    crew: Math.max(0, crew - crewLost),
    consumed: stock,
    crewLost,
    starving: crew - crewLost > 0,
  };
}

export function shipIsStarving(
  stores: Pick<ShipStores, "provisions">,
  crew: number,
): boolean {
  return stores.provisions <= 1e-9 && crew > 0;
}

// ---------------------------------------------------------------------------
// Port storage, production and NPC stock.
// ---------------------------------------------------------------------------

export function portStorageLimit(port: Pick<PlacedPort, "size">): number {
  return settings.ports.sizes[port.size].storageTonnes;
}

export function npcStockCap(port: Pick<PlacedPort, "size">): number {
  return settings.trade.production.npcStockCapTonnes[port.size];
}

export function totalGoods(goods: Readonly<GoodsAmounts>): number {
  let total = 0;
  for (const good of GOOD_IDS) total += Math.max(0, goods[good] ?? 0);
  return total;
}

export function addGoodsAmounts(
  into: GoodsAmounts,
  from: Readonly<Partial<GoodsAmounts>>,
): void {
  for (const good of GOOD_IDS) into[good] += Math.max(0, from[good] ?? 0);
}

export function regionalGoodForPort(good: string): GoodId | null {
  return isGoodId(good) ? good : null;
}

/** The bundle a usable port produces into storage in one cycle. */
export function portProduction(
  port: Pick<PlacedPort, "good">,
): GoodsAmounts {
  return productionBundle(port, true);
}

/** NPC stock uses the same regional and basic amounts, with larger stores. */
export function npcRefillProduction(
  port: Pick<PlacedPort, "good">,
): GoodsAmounts {
  return productionBundle(port, false);
}

function productionBundle(
  port: Pick<PlacedPort, "good">,
  storage: boolean,
): GoodsAmounts {
  const bundle = emptyGoods();
  const regional = regionalGoodForPort(port.good);
  const production = settings.trade.production;
  if (regional) bundle[regional] += production.regionalGoodTonnes;

  const basic = production.basicResourceTonnes;
  bundle.provisions += basic;
  if (regional && CLOTH_BASIC_REGION_GOODS.includes(regional)) {
    bundle.cloth += basic;
  } else {
    bundle.timber += basic;
  }

  if (storage) {
    bundle.repairMaterials += production.repairMaterialsTonnes;
    bundle.ammunition += production.ammunitionTonnes;
  } else {
    bundle.repairMaterials += production.npcRefillRepairMaterialsTonnes;
    bundle.ammunition += production.npcRefillAmmunitionTonnes;
  }
  return bundle;
}

/**
 * Add production until the shared storage limit is reached. An item that would
 * cross the limit is cut short and later items in the bundle are not added.
 */
export function addLimitedProduction(
  storage: GoodsAmounts,
  capacity: number,
  bundle: Readonly<Partial<GoodsAmounts>>,
): GoodsAmounts {
  const produced = emptyGoods();
  let used = totalGoods(storage);
  for (const good of GOOD_IDS) {
    const room = Math.max(0, capacity - used);
    if (room <= 0) break;
    const amount = Math.min(Math.max(0, bundle[good] ?? 0), room);
    if (amount <= 0) continue;
    storage[good] += amount;
    produced[good] += amount;
    used += amount;
  }
  return produced;
}

/** A port storage started half full from its own production mix. */
export function initialPortStorage(port: PlacedPort): GoodsAmounts {
  const storage = emptyGoods();
  const target = portStorageLimit(port) * settings.trade.production.storageStartShare;
  const bundle = portProduction(port);
  let total = 0;
  for (let cycle = 0; cycle < 1_000 && total < target - 1e-9; cycle += 1) {
    for (const good of GOOD_IDS) {
      const room = target - total;
      if (room <= 1e-9) break;
      const amount = Math.min(bundle[good], room);
      storage[good] += amount;
      total += amount;
    }
  }
  return storage;
}

export function npcStockCapacities(port: Pick<PlacedPort, "size">): GoodsAmounts {
  const caps = emptyGoods();
  const cap = npcStockCap(port);
  for (const good of RESOURCE_IDS) caps[good] = cap;
  return caps;
}

/** NPC merchants begin with a full stock of the five resources. */
export function initialNpcStock(port: Pick<PlacedPort, "size">): GoodsAmounts {
  const stock = emptyGoods();
  const cap = npcStockCap(port) * settings.trade.production.npcStartStockShare;
  for (const good of RESOURCE_IDS) stock[good] = cap;
  return stock;
}

/** Add one cycle to an NPC stock, respecting each resource's own cap. */
export function refillNpcStock(
  stock: GoodsAmounts,
  port: Pick<PlacedPort, "size" | "good">,
): void {
  const caps = npcStockCapacities(port);
  const bundle = npcRefillProduction(port);
  for (const good of RESOURCE_IDS) {
    stock[good] = Math.min(caps[good], stock[good] + bundle[good]);
  }
}

// ---------------------------------------------------------------------------
// Prices.
// ---------------------------------------------------------------------------

export interface PriceState {
  seed: number;
  /** Completed price shifts. Zero means the untouched starting prices. */
  shift: number;
  regionTrends: ReadonlyMap<string, number>;
  portRandoms: ReadonlyMap<string, number>;
}

/** A tiny deterministic PRNG for repeatable room prices. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createPriceState(seed: number): PriceState {
  return {
    seed: Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 1,
    shift: 0,
    regionTrends: new Map(),
    portRandoms: new Map(),
  };
}

/** Move every region and port to its next repeatable price factor. */
export function shiftPrices(
  state: PriceState,
  ports: readonly Pick<PlacedPort, "id" | "region">[],
): PriceState {
  const shift = state.shift + 1;
  const random = mulberry32(
    (state.seed ^ Math.imul(shift, 0x9e3779b9)) >>> 0,
  );
  const regions = [...new Set(ports.map((port) => port.region))].sort();
  const orderedPorts = [...ports].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const regionTrends = new Map<string, number>();
  const portRandoms = new Map<string, number>();
  const trendMax = settings.trade.pricesCycle.regionalTrendMax;
  const randomMax = settings.trade.pricesCycle.portRandomMax;

  for (const region of regions) {
    regionTrends.set(region, 1 + (random() * 2 - 1) * trendMax);
  }
  for (const port of orderedPorts) {
    portRandoms.set(port.id, 1 + (random() * 2 - 1) * randomMax);
  }

  return {
    seed: state.seed,
    shift,
    regionTrends,
    portRandoms,
  };
}

export function priceTrendFor(
  state: PriceState,
  region: string,
): number {
  return state.regionTrends.get(region) ?? 1;
}

export function priceRandomFor(state: PriceState, portId: string): number {
  return state.portRandoms.get(portId) ?? 1;
}

/** The full multiplier before rounding, including the producer discount. */
export function priceMultiplier(
  port: Pick<PlacedPort, "id" | "region" | "good">,
  state: PriceState,
  good?: GoodId,
): number {
  const producer = good !== undefined && port.good === good
    ? settings.trade.pricesCycle.producerFactor
    : 1;
  return priceTrendFor(state, port.region) *
    priceRandomFor(state, port.id) *
    producer;
}

/** A posted price in whole pieces of eight per tonne. */
export function postedPrice(
  good: GoodId,
  port: Pick<PlacedPort, "id" | "region" | "good">,
  state: PriceState,
): number {
  return Math.max(
    settings.trade.pricesCycle.minimumPrice,
    Math.round(settings.trade.prices[good] * priceMultiplier(port, state, good)),
  );
}

/** A full price list for the trade screen, in display order. */
export function priceList(
  port: Pick<PlacedPort, "id" | "region" | "good">,
  state: PriceState,
): Record<GoodId, number> {
  const prices = {} as Record<GoodId, number>;
  for (const good of GOOD_IDS) prices[good] = postedPrice(good, port, state);
  return prices;
}

// ---------------------------------------------------------------------------
// Legal trade quantities.
// ---------------------------------------------------------------------------

export const NO_STOCK_REASON = "No stock at this port.";
export const NOT_ENOUGH_MONEY_REASON = "Not enough money.";
export const NO_SHIP_SPACE_REASON = "No space in the ship's stores.";
export const NO_PORT_SPACE_REASON = "No space in the port's storage.";

export interface TradeQuote {
  amount: number;
  unitPrice: number;
  total: number;
  reason: string | null;
}

function amountFloor(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * The legal part of a buy: resources only, limited together by stock, money and
 * free space in the correct store. Buying a cargo resource checks the cargo hold
 * as a whole, not one good in isolation.
 */
export function quoteBuy(input: {
  good: GoodId;
  requested: number;
  stock: number;
  money: number;
  stores: ShipStores;
  capacities: ShipStoreCapacities;
  unitPrice: number;
}): TradeQuote {
  if (!isResourceId(input.good)) {
    return { amount: 0, unitPrice: input.unitPrice, total: 0, reason: NO_STOCK_REASON };
  }
  const byStock = amountFloor(input.stock);
  const byMoney = input.unitPrice > 0
    ? amountFloor(input.money / input.unitPrice)
    : amountFloor(input.requested);
  const bySpace = amountFloor(freeSpaceForGood(input.stores, input.capacities, input.good));
  const amount = Math.min(
    amountFloor(input.requested),
    byStock,
    byMoney,
    bySpace,
  );
  let reason: string | null = null;
  if (amount <= 0) {
    if (byStock <= 0) reason = NO_STOCK_REASON;
    else if (byMoney <= 0) reason = NOT_ENOUGH_MONEY_REASON;
    else if (bySpace <= 0) reason = NO_SHIP_SPACE_REASON;
  }
  return {
    amount,
    unitPrice: input.unitPrice,
    total: amount * input.unitPrice,
    reason,
  };
}

/**
 * The legal part of a sell: cargo goods only. A usable port has storage space
 * to respect; an NPC buyer has no displayed storage limit.
 */
export function quoteSell(input: {
  good: GoodId;
  requested: number;
  hold: number;
  unitPrice: number;
  portFreeSpace?: number | null;
}): TradeQuote {
  if (!isCargoGoodId(input.good)) {
    return { amount: 0, unitPrice: input.unitPrice, total: 0, reason: NO_STOCK_REASON };
  }
  const byHold = amountFloor(input.hold);
  const byPort = input.portFreeSpace === null || input.portFreeSpace === undefined
    ? Number.POSITIVE_INFINITY
    : amountFloor(input.portFreeSpace);
  const amount = Math.min(amountFloor(input.requested), byHold, byPort);
  let reason: string | null = null;
  if (amount <= 0) {
    reason = byHold <= 0 ? NO_STOCK_REASON : NO_PORT_SPACE_REASON;
  }
  return {
    amount,
    unitPrice: input.unitPrice,
    total: amount * input.unitPrice,
    reason,
  };
}

export type TransferDirection = "load" | "unload";

export interface TransferQuote {
  amount: number;
  reason: string | null;
}

/**
 * Load moves a good from port storage into the ship; unload moves it back.
 * Both directions respect the ship store and the port's shared storage limit.
 */
export function quoteTransfer(input: {
  direction: TransferDirection;
  good: GoodId;
  requested: number;
  shipAmount: number;
  portAmount: number;
  shipFree: number;
  portFree: number;
}): TransferQuote {
  const requested = amountFloor(input.requested);
  const available = input.direction === "load" ? input.portAmount : input.shipAmount;
  const space = input.direction === "load" ? input.shipFree : input.portFree;
  const amount = Math.min(requested, amountFloor(available), amountFloor(space));
  let reason: string | null = null;
  if (amount <= 0) {
    reason = available <= 0
      ? NO_STOCK_REASON
      : input.direction === "load"
        ? NO_SHIP_SPACE_REASON
        : NO_PORT_SPACE_REASON;
  }
  return { amount, reason };
}
