// 3J-fix-c: one readable catalogue of the control scheme. The client builds
// the Orders sheet from this list; tests use the same data to check that every
// order is reachable and the five first-use hints exist.

export type ControlOrderTarget = "none" | "sea" | "ship" | "enemy" | "port" | "own";

export interface ControlOrder {
  id: string;
  label: string;
  group: "Move" | "Fight" | "Support" | "Special";
  target: ControlOrderTarget;
  /** Short disabled reason when the order cannot apply to the selection. */
  reason?: string;
}

export const CONTROL_ORDERS: readonly ControlOrder[] = [
  { id: "sail", label: "Sail", group: "Move", target: "sea" },
  { id: "sailToPort", label: "Sail to port", group: "Move", target: "port" },
  { id: "heading", label: "Heading and distance", group: "Move", target: "none" },
  { id: "patrol", label: "Patrol", group: "Move", target: "sea" },
  { id: "rendezvous", label: "Rendezvous", group: "Move", target: "sea" },
  { id: "hold", label: "Hold", group: "Move", target: "none" },
  { id: "anchor", label: "Anchor", group: "Move", target: "none" },
  { id: "weighAnchor", label: "Weigh anchor", group: "Move", target: "none" },
  { id: "returnPort", label: "Return to port", group: "Move", target: "none" },
  { id: "attackSink", label: "Attack ship: Sink", group: "Fight", target: "enemy" },
  { id: "attackCapture", label: "Attack ship: Capture", group: "Fight", target: "enemy" },
  { id: "loot", label: "Loot", group: "Fight", target: "enemy" },
  { id: "board", label: "Board", group: "Fight", target: "enemy" },
  { id: "attackPort", label: "Attack port", group: "Fight", target: "port" },
  { id: "run", label: "Run", group: "Fight", target: "own" },
  { id: "surrender", label: "Surrender", group: "Fight", target: "own" },
  { id: "follow", label: "Follow", group: "Support", target: "own" },
  { id: "escort", label: "Escort", group: "Support", target: "own" },
  { id: "tow", label: "Tow", group: "Support", target: "own" },
  { id: "castOff", label: "Cast off", group: "Support", target: "none" },
  { id: "crewTransfer", label: "Transfer crew", group: "Support", target: "own" },
  { id: "claim", label: "Claim abandoned ship", group: "Support", target: "ship" },
  { id: "igniteNow", label: "Ignite now", group: "Special", target: "none" },
  { id: "igniteContact", label: "Ignite on contact", group: "Special", target: "enemy" },
  { id: "lights", label: "Lights", group: "Special", target: "none" },
  { id: "fitUpgrades", label: "Fit upgrades", group: "Special", target: "none" },
];

export const CONTROL_GROUP_NAMES: readonly ControlOrder["group"][] = [
  "Move",
  "Fight",
  "Support",
  "Special",
];

export function controlOrdersInGroup(group: ControlOrder["group"]): ControlOrder[] {
  return CONTROL_ORDERS.filter((order) => order.group === group);
}

export function controlOrder(id: string): ControlOrder | null {
  return CONTROL_ORDERS.find((order) => order.id === id) ?? null;
}

/** Tap counts promised for the main flows, counting the selection tap. */
export const CONTROL_TAP_COUNTS: Readonly<Record<string, number>> = {
  attackEnemy: 3,
  fleetFormationAttack: 4,
  sailWithUndo: 2,
  claimAbandoned: 3,
  recallGroup: 1,
  selectAll: 2,
  classChip: 2,
  board: 3,
  tow: 3,
  castOff: 2,
  igniteContact: 3,
  attackPort: 3,
};

export interface ControlHint {
  id: string;
  text: string;
}

export const CONTROL_HINTS: readonly ControlHint[] = [
  { id: "select", text: "Tap a ship to select it. Tap it again for its sheet; double-tap for its whole fleet." },
  { id: "sea", text: "A tap on empty sea does nothing. Use Tools for Heading and distance, or a port, the queue or the chart to sail." },
  { id: "orders", text: "Stance arms one battle order or action; tap its target in sight. The banner tells you what is armed and lets you cancel." },
  { id: "enemy", text: "Tap an enemy to see Attack: Sink, Attack: Capture, Loot and Board. One tap starts the attack." },
  { id: "bulk", text: "Use Select all, Select nearby, class chips or a Multi box. Save a control group and recall it with one tap." },
];

export type ControlHintStage = { index: number; total: number; text: string };

export function controlHintAt(index: number): ControlHintStage | null {
  if (!Number.isInteger(index) || index < 0 || index >= CONTROL_HINTS.length) return null;
  const hint = CONTROL_HINTS[index]!;
  return { index, total: CONTROL_HINTS.length, text: hint.text };
}
