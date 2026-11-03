// One stable player identity per browser, plus the optional `?as=` identity
// used for solo testing in test and dev rooms.
//
// This module is plain TypeScript. The client supplies browser storage objects
// and a random-id function, so the rules can be tested without a browser.

import type { RoomKind } from "./fog.js";

/** LocalStorage key. It must stay stable across builds and addresses. */
export const PLAYER_ID_KEY = "armadas.playerId";

const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const AS_NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PlayerIdentity {
  /** The id sent to the server. It includes `-as-NAME` when one was asked for. */
  id: string;
  /** The one id stored for this browser. */
  baseId: string;
  /** Where the base id came from. */
  source: "local" | "session" | "none";
  /** A short message for the player when storage is blocked. */
  warning?: string;
}

function storedId(storage: StorageLike | null): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(PLAYER_ID_KEY);
    return value && PLAYER_ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberId(storage: StorageLike | null, id: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PLAYER_ID_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * A separate test identity is the stored id plus the `as` name. Normal rooms
 * ignore `as` completely, and an invalid name is ignored rather than refused.
 */
export function playerIdForRoom(
  baseId: string,
  kind: RoomKind,
  asName: string | null | undefined,
): string {
  if (kind === "normal" || !asName || !AS_NAME_PATTERN.test(asName)) return baseId;
  // The base is 16 hex characters. Keeping 16 and capping the name at 20
  // leaves the whole id inside the server's 40-character limit.
  return `${baseId.slice(0, 16)}-as-${asName}`;
}

/**
 * Read the one stored id, or make and store it. `localStorage` is preferred;
 * `sessionStorage` is the fallback. If both refuse storage, the id still works
 * for this page and the player is told it will not survive a reload.
 */
export function resolvePlayerIdentity(
  local: StorageLike | null,
  session: StorageLike | null,
  kind: RoomKind,
  asName: string | null | undefined,
  makeId: () => string,
): PlayerIdentity {
  const fromLocal = storedId(local);
  if (fromLocal) {
    return {
      id: playerIdForRoom(fromLocal, kind, asName),
      baseId: fromLocal,
      source: "local",
    };
  }

  const fromSession = storedId(session);
  if (fromSession) {
    // Try to promote it back to local storage when that becomes available.
    rememberId(local, fromSession);
    return {
      id: playerIdForRoom(fromSession, kind, asName),
      baseId: fromSession,
      source: "session",
      warning: "Local storage is blocked; this tab's ship will not follow you to a new tab.",
    };
  }

  const baseId = makeId();
  if (rememberId(local, baseId)) {
    return {
      id: playerIdForRoom(baseId, kind, asName),
      baseId,
      source: "local",
    };
  }
  if (rememberId(session, baseId)) {
    return {
      id: playerIdForRoom(baseId, kind, asName),
      baseId,
      source: "session",
      warning: "Local storage is blocked; this tab's ship will survive a reload but not a new tab.",
    };
  }

  return {
    id: playerIdForRoom(baseId, kind, asName),
    baseId,
    source: "none",
    warning: "Storage is blocked; this ship will not survive a refresh.",
  };
}
