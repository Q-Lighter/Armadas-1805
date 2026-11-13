// Test-room setup shared by the browser, the server and the tests.
//
// The browser used to forward only some of the room options to the websocket,
// so `&enemy=` never reached the server. This module keeps the whitelist in one
// place and gives the invite link and navy choice the same rules everywhere.

import type { NavyId } from "./navies.js";

/** The design order used when two players ask for the same navy. */
export const NAVY_ORDER: readonly NavyId[] = ["British", "French", "Spanish", "Dutch"];

export type DummyBehaviour = "passive" | "fights" | "runs" | "surrenders";

export const DUMMY_BEHAVIOURS: readonly DummyBehaviour[] = [
  "passive",
  "fights",
  "runs",
  "surrenders",
];

/** Parse `&dummy=`; no value means the normal fights-back dummy. */
export function parseDummyBehaviour(raw: string | null | undefined): DummyBehaviour | null {
  if (raw === null || raw === undefined || raw.trim() === "") return "fights";
  const wanted = raw.trim().toLowerCase();
  return DUMMY_BEHAVIOURS.find((value) => value === wanted) ?? null;
}

/** The first navy in the fixed order that is not in `taken`. */
export function firstFreeNavy(taken: readonly NavyId[], fallback: NavyId): NavyId {
  return NAVY_ORDER.find((navy) => !taken.includes(navy)) ?? fallback;
}

/**
 * A second player asking for the same navy gets the next navy in the order
 * british, french, spanish, dutch. A first player keeps what they asked for.
 */
export function chooseJoinNavy(
  requested: NavyId,
  taken: readonly NavyId[],
): { navy: NavyId; changed: boolean } {
  if (!taken.includes(requested)) return { navy: requested, changed: false };
  const start = NAVY_ORDER.indexOf(requested);
  for (let step = 1; step <= NAVY_ORDER.length; step += 1) {
    const candidate = NAVY_ORDER[(start + step) % NAVY_ORDER.length]!;
    if (!taken.includes(candidate)) return { navy: candidate, changed: true };
  }
  return { navy: requested, changed: false };
}

/**
 * `&team=1` keeps a second human in an existing navy, up to the agreed two
 * players per navy. Only test and dev rooms call this.
 */
export function chooseTeamNavy(
  requested: NavyId,
  players: readonly { navy: NavyId }[],
  maxTeamPlayers = 2,
): { navy: NavyId; changed: boolean } {
  const counts = new Map<NavyId, number>();
  for (const player of players) counts.set(player.navy, (counts.get(player.navy) ?? 0) + 1);
  const requestedCount = counts.get(requested) ?? 0;
  if (requestedCount > 0 && requestedCount < maxTeamPlayers) {
    return { navy: requested, changed: false };
  }
  if (requestedCount === 0) {
    const existing = NAVY_ORDER.find((navy) => (counts.get(navy) ?? 0) < maxTeamPlayers &&
      (counts.get(navy) ?? 0) > 0);
    if (existing) return { navy: existing, changed: existing !== requested };
    return { navy: requested, changed: false };
  }
  const taken = [...counts.keys()];
  return chooseJoinNavy(requested, taken);
}

/** The next navy for the other device in the invite link. */
export function otherNavy(navy: NavyId): NavyId {
  return NAVY_ORDER.find((candidate) => candidate !== navy) ?? "French";
}

/**
 * The room options the client must pass on to /ws. Normal rooms still receive
 * them but the server ignores every one except `bots`; keeping the list here
 * means a new helper cannot be silently dropped by the page again.
 */
const FORWARDED_TEST_PARAMS = [
  "navy",
  "start",
  "ship",
  "cash",
  "hunger",
  "enemy",
  "enemynavy",
  "dummy",
  "fleet",
  "name",
  "team",
] as const;

function queryValues(search: string): Map<string, string> {
  const source = search.startsWith("?") ? search.slice(1) : search;
  const values = new Map<string, string>();
  for (const part of source.split("&")) {
    if (!part) continue;
    const at = part.indexOf("=");
    const rawKey = at < 0 ? part : part.slice(0, at);
    const rawValue = at < 0 ? "" : part.slice(at + 1);
    try {
      values.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue));
    } catch {
      // Ignore a malformed pair rather than refusing the whole room address.
    }
  }
  return values;
}

export function testJoinQuery(search: string): string {
  const source = queryValues(search);
  const out: string[] = [];
  for (const key of FORWARDED_TEST_PARAMS) {
    const value = source.get(key);
    if (value !== undefined && value !== "") {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return out.length > 0 ? `&${out.join("&")}` : "";
}

/** Build the second-device address, without this browser's player identity. */
export function inviteSecondDeviceLink(
  currentHref: string,
  options: {
    room: string;
    navy: NavyId;
    startPort: string | null;
    shipClass: string;
  },
): string {
  const base = currentHref.split("#")[0]!.split("?")[0]!;
  const query = [
    `room=${encodeURIComponent(options.room)}`,
    `navy=${encodeURIComponent(options.navy.toLowerCase())}`,
  ];
  if (options.startPort) query.push(`start=${encodeURIComponent(options.startPort)}`);
  query.push(`ship=${encodeURIComponent(options.shipClass)}`);
  return `${base}?${query.join("&")}`;
}
