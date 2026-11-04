// The goods carried and traded in 1805.
//
// Prices and every other tuning number live in shared/settings.ts. This file is
// only the stable identity and classification of each good.

export type TradeGoodId =
  | "hides"
  | "sugar"
  | "tobacco"
  | "coffee"
  | "rum"
  | "silver"
  | "whaleOil";

export type ResourceId =
  | "provisions"
  | "timber"
  | "cloth"
  | "repairMaterials"
  | "ammunition";

export type CargoGoodId = TradeGoodId | "timber" | "cloth";
export type GoodId = TradeGoodId | ResourceId;

export type GoodKind = "trade" | "resource";

export interface Good {
  id: GoodId;
  name: string;
  kind: GoodKind;
  /** Trade goods, timber and cloth share the cargo hold. */
  cargo: boolean;
}

export const TRADE_GOOD_IDS: readonly TradeGoodId[] = [
  "hides",
  "sugar",
  "tobacco",
  "coffee",
  "rum",
  "silver",
  "whaleOil",
];

export const RESOURCE_IDS: readonly ResourceId[] = [
  "provisions",
  "timber",
  "cloth",
  "repairMaterials",
  "ammunition",
];

export const CARGO_GOOD_IDS: readonly CargoGoodId[] = [
  ...TRADE_GOOD_IDS,
  "timber",
  "cloth",
];

export const GOOD_IDS: readonly GoodId[] = [
  ...TRADE_GOOD_IDS,
  ...RESOURCE_IDS,
];

export const GOODS: Readonly<Record<GoodId, Good>> = {
  hides: { id: "hides", name: "Hides", kind: "trade", cargo: true },
  sugar: { id: "sugar", name: "Sugar", kind: "trade", cargo: true },
  tobacco: { id: "tobacco", name: "Tobacco", kind: "trade", cargo: true },
  coffee: { id: "coffee", name: "Coffee", kind: "trade", cargo: true },
  rum: { id: "rum", name: "Rum", kind: "trade", cargo: true },
  silver: { id: "silver", name: "Silver", kind: "trade", cargo: true },
  whaleOil: { id: "whaleOil", name: "Whale oil", kind: "trade", cargo: true },
  provisions: { id: "provisions", name: "Provisions", kind: "resource", cargo: false },
  timber: { id: "timber", name: "Timber", kind: "resource", cargo: true },
  cloth: { id: "cloth", name: "Cloth", kind: "resource", cargo: true },
  repairMaterials: {
    id: "repairMaterials",
    name: "Repair materials",
    kind: "resource",
    cargo: false,
  },
  ammunition: {
    id: "ammunition",
    name: "Ammunition",
    kind: "resource",
    cargo: false,
  },
};

export function isGoodId(value: unknown): value is GoodId {
  return typeof value === "string" && Object.hasOwn(GOODS, value);
}

export function isResourceId(value: unknown): value is ResourceId {
  return typeof value === "string" && (RESOURCE_IDS as readonly string[]).includes(value);
}

export function isCargoGoodId(value: unknown): value is CargoGoodId {
  return typeof value === "string" && (CARGO_GOOD_IDS as readonly string[]).includes(value);
}

/** The label used in prices and notices. */
export function goodName(good: GoodId): string {
  return GOODS[good].name;
}

/** The regional goods that make a port buy provisions and cloth instead. */
export const CLOTH_BASIC_REGION_GOODS: readonly GoodId[] = [
  "sugar",
  "rum",
  "coffee",
  "tobacco",
  "cloth",
];
