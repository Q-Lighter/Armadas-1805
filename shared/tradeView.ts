// Browser-free trade presentation: rows, limits, prices and plain text.
//
// The client only turns these decisions into paper controls. Keeping the
// quantities here means the phone layout and the tests agree on every limit.

import {
  CARGO_GOOD_IDS,
  GOODS,
  GOOD_IDS,
  RESOURCE_IDS,
  type GoodId,
} from "./data/goods.js";
import type { PortInfo } from "./portView.js";
import type { OwnShipSnapshot } from "./world.js";
import {
  cargoTotal,
  freeSpaceForGood,
  goodAmount,
} from "./trade.js";
import { formatMoney, formatTonnes, formatTonnesWithUnit } from "./format.js";
export { formatTonnes, formatTonnesWithUnit } from "./format.js";
export function formatPrice(price: number): string {
  return formatMoney(price);
}

export interface BuyRow {
  good: GoodId;
  name: string;
  price: number;
  stock: number;
  freeSpace: number;
  max: number;
  regional: boolean;
}

/** Resources an NPC merchant sells, with every limit already applied. */
export function buildBuyRows(
  port: PortInfo,
  ship: OwnShipSnapshot,
  money: number,
): BuyRow[] {
  if (!port.npc || !port.prices || !port.npcStock) return [];
  const rows: BuyRow[] = [];
  for (const good of RESOURCE_IDS) {
    const price = port.prices[good];
    const stock = port.npcStock[good];
    if (typeof price !== "number" || typeof stock !== "number") continue;
    const freeSpace = freeSpaceForGood(ship.stores, ship.capacities, good);
    const max = Math.max(
      0,
      Math.min(
        Math.floor(stock),
        Math.floor(freeSpace),
        price > 0 ? Math.floor(money / price) : 0,
      ),
    );
    rows.push({
      good,
      name: GOODS[good].name,
      price,
      stock,
      freeSpace,
      max,
      regional: port.good === good,
    });
  }
  return rows;
}

export interface SellRow {
  good: GoodId;
  name: string;
  price: number;
  hold: number;
  max: number;
  regional: boolean;
}

/** Cargo goods currently in the hold. Empty goods need no sell row. */
export function buildSellRows(
  port: PortInfo,
  ship: OwnShipSnapshot,
): SellRow[] {
  if (!port.prices) return [];
  const portFree = port.storage && port.storageLimit !== undefined
    ? Math.max(0, port.storageLimit - totalRecord(port.storage))
    : null;
  const rows: SellRow[] = [];
  for (const good of CARGO_GOOD_IDS) {
    const price = port.prices[good];
    const hold = goodAmount(ship.stores, good);
    if (typeof price !== "number" || hold <= 0) continue;
    const max = portFree === null
      ? Math.floor(hold)
      : Math.min(Math.floor(hold), Math.floor(portFree));
    rows.push({
      good,
      name: GOODS[good].name,
      price,
      hold,
      max,
      regional: port.good === good,
    });
  }
  return rows;
}

function totalRecord(goods: Partial<Record<GoodId, number>>): number {
  let total = 0;
  for (const good of GOOD_IDS) total += Math.max(0, goods[good] ?? 0);
  return total;
}

export interface StorageRow {
  good: GoodId;
  name: string;
  portAmount: number;
  shipAmount: number;
  shipFree: number;
  portFree: number;
  loadMax: number;
  unloadMax: number;
}

/** Every good in the shared port storage and in the docked ship. */
export function buildStorageRows(
  port: PortInfo,
  ship: OwnShipSnapshot,
): StorageRow[] {
  if (!port.storage || port.storageLimit === undefined) return [];
  const portFree = Math.max(
    0,
    port.storageLimit - totalRecord(port.storage),
  );
  return GOOD_IDS.map((good) => {
    const portAmount = port.storage?.[good] ?? 0;
    const shipAmount = goodAmount(ship.stores, good);
    const shipFree = freeSpaceForGood(ship.stores, ship.capacities, good);
    return {
      good,
      name: GOODS[good].name,
      portAmount,
      shipAmount,
      shipFree,
      portFree,
      loadMax: Math.max(0, Math.min(portAmount, shipFree)),
      unloadMax: Math.max(0, Math.min(shipAmount, portFree)),
    };
  });
}

export interface PriceBookRow {
  good: GoodId;
  name: string;
  price: number;
  cheap: boolean;
}

/** Every posted price at the port, with its regional good marked cheap. */
export function priceBookRows(port: PortInfo): PriceBookRow[] {
  if (!port.prices) return [];
  const rows: PriceBookRow[] = [];
  for (const good of GOOD_IDS) {
    const price = port.prices[good];
    if (typeof price !== "number") continue;
    rows.push({
      good,
      name: GOODS[good].name,
      price,
      cheap: port.good === good,
    });
  }
  return rows;
}

/** A compact summary of free room in each of the four stores. */
export function freeSpaceText(ship: OwnShipSnapshot): string {
  const c = ship.capacities;
  return [
    `Hold ${formatTonnesWithUnit(Math.max(0, c.cargo - cargoTotal(ship.stores.cargo)))} free`,
    `provisions ${formatTonnesWithUnit(Math.max(0, c.provisions - ship.stores.provisions))} free`,
    `repair ${formatTonnesWithUnit(Math.max(0, c.repairMaterials - ship.stores.repairMaterials))} free`,
    `ammunition ${formatTonnesWithUnit(Math.max(0, c.ammunition - ship.stores.ammunition))} free`,
  ].join(" · ");
}

/** The regional-good note used by the trade panel and price book. */
export function regionalGoodNote(port: PortInfo): string {
  const good = GOODS[port.good as GoodId];
  return good ? `${good.name} is the regional good and sells cheap here.` : "";
}
