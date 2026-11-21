// Online lobbies: join codes, navy picks, flagship names, readiness and the
// rules for starting a game. Plain TypeScript, shared by the server and the
// browser. The server re-checks every one of these rules; the browser only
// uses the same functions to show a disabled button and its reason.
//
// Nothing here knows about Supabase accounts. A lobby stores an account id
// beside each captain so the server can recognise a returning player, but the
// snapshot sent to the browser contains only lobby-local slot ids, display
// names, navies, flagship names, ready flags and the host badge.

import { settings } from "./settings.js";
import { NAVY_IDS, type NavyId } from "./navies.js";

/** Join-code alphabet: A-Z without I, L and O, then 2-9 without 0 and 1. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const JOIN_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{5}$/;

export interface LobbyPlayer {
  /** A lobby-local slot id. It is never the account id. */
  id: string;
  /** Server-only account identity. Never leaves the server. */
  accountId: string;
  name: string;
  navy: NavyId | null;
  flagshipName: string;
  ready: boolean;
}

export interface Lobby {
  code: string;
  /** The slot id of the host. Hosting passes to the next player on leave. */
  hostId: string;
  players: LobbyPlayer[];
  /** Stored for later; the Items toggle is disabled for now. */
  items: boolean;
  /** Stored for later; AI opponents arrive in a later phase. */
  ai: boolean;
  createdAtMs: number;
  startedAtMs: number | null;
}

export interface LobbySnapshotPlayer {
  id: string;
  name: string;
  navy: NavyId | null;
  flagshipName: string;
  ready: boolean;
  host: boolean;
}

export interface LobbySnapshot {
  code: string;
  /** The viewer's own lobby slot, so the screen can mark its row. */
  you: string | null;
  hostId: string;
  players: LobbySnapshotPlayer[];
  items: boolean;
  ai: boolean;
  minNavies: number;
  /** Empty when the host may start, otherwise the disabled reason. */
  startReason: string;
}

export type LobbyResult = { ok: true } | { ok: false; error: string };

export function isJoinCode(value: string): boolean {
  return JOIN_CODE_PATTERN.test(value.trim().toUpperCase());
}

/** One 5-character code from a random function that returns 0 to 1. */
export function makeJoinCode(random: () => number): string {
  const length = settings.lobby.codeLength;
  let code = "";
  for (let index = 0; index < length; index += 1) {
    const pick = Math.floor(Math.max(0, Math.min(0.999999, random())) * JOIN_CODE_ALPHABET.length);
    code += JOIN_CODE_ALPHABET[pick] ?? "A";
  }
  return code;
}

export function newLobby(
  code: string,
  host: { id: string; accountId: string; name: string },
  nowMs: number,
): Lobby {
  return {
    code: code.toUpperCase(),
    hostId: host.id,
    players: [{
      id: host.id,
      accountId: host.accountId,
      name: host.name,
      navy: null,
      flagshipName: "",
      ready: false,
    }],
    items: false,
    ai: false,
    createdAtMs: nowMs,
    startedAtMs: null,
  };
}

export function findLobbyPlayer(lobby: Lobby, slotId: string): LobbyPlayer | null {
  return lobby.players.find((player) => player.id === slotId) ?? null;
}

export function lobbyPlayerForAccount(lobby: Lobby, accountId: string): LobbyPlayer | null {
  return lobby.players.find((player) => player.accountId === accountId) ?? null;
}

export function navyCount(lobby: Lobby, navy: NavyId, ignoreSlotId?: string): number {
  return lobby.players.filter((player) =>
    player.navy === navy && player.id !== ignoreSlotId).length;
}

/** Add a captain to the lobby. The caller supplies a fresh slot id. */
export function addLobbyPlayer(
  lobby: Lobby,
  player: { id: string; accountId: string; name: string },
): LobbyResult {
  if (lobby.startedAtMs !== null) return { ok: false, error: "This game has already started." };
  if (lobby.players.length >= settings.lobby.maxPlayers) {
    return { ok: false, error: "This lobby is full." };
  }
  lobby.players.push({
    id: player.id,
    accountId: player.accountId,
    name: player.name,
    navy: null,
    flagshipName: "",
    ready: false,
  });
  return { ok: true };
}

/** Pick or change a navy. A ready captain must unready first. */
export function setLobbyNavy(lobby: Lobby, slotId: string, navy: string): LobbyResult {
  const player = findLobbyPlayer(lobby, slotId);
  if (!player) return { ok: false, error: "You are not in this lobby." };
  if (lobby.startedAtMs !== null) return { ok: false, error: "The game has already started." };
  const chosen = NAVY_IDS.find((candidate) => candidate.toLowerCase() === navy.toLowerCase());
  if (!chosen) return { ok: false, error: "Choose British, French, Spanish or Dutch." };
  if (player.ready) {
    return { ok: false, error: "Press Not ready to change your navy." };
  }
  if (navyCount(lobby, chosen, slotId) >= settings.lobby.maxPlayersPerNavy) {
    return {
      ok: false,
      error: `${chosen} already has ${settings.lobby.maxPlayersPerNavy} players.`,
    };
  }
  player.navy = chosen;
  return { ok: true };
}

/** Display the rule about a full navy, for a disabled navy card. */
export function navyFullReason(
  lobby: Lobby,
  navy: NavyId,
  slotId: string | null,
): string {
  if (slotId && navyCount(lobby, navy, slotId) >= settings.lobby.maxPlayersPerNavy) {
    return `Full: ${settings.lobby.maxPlayersPerNavy} players`;
  }
  return "";
}

export function flagshipNameError(
  lobby: Lobby,
  slotId: string,
  rawName: string,
): string | null {
  const name = rawName.trim();
  if (name.length < settings.lobby.flagshipNameMin ||
      name.length > settings.lobby.flagshipNameMax) {
    return `Flagship name must be ${settings.lobby.flagshipNameMin} to ${settings.lobby.flagshipNameMax} characters.`;
  }
  if (/[\u0000-\u001f\u007f<>]/.test(name)) {
    return "Flagship name cannot contain control characters or angle brackets.";
  }
  const key = name.toLowerCase();
  if (lobby.players.some((player) =>
    player.id !== slotId && player.flagshipName.toLowerCase() === key)) {
    return "That flagship name is already taken.";
  }
  return null;
}

/** Name or rename the flagship. Locked once the captain is ready. */
export function setLobbyFlagshipName(lobby: Lobby, slotId: string, rawName: string): LobbyResult {
  const player = findLobbyPlayer(lobby, slotId);
  if (!player) return { ok: false, error: "You are not in this lobby." };
  if (lobby.startedAtMs !== null) return { ok: false, error: "The game has already started." };
  if (player.ready) return { ok: false, error: "Press Not ready to rename your flagship." };
  const error = flagshipNameError(lobby, slotId, rawName);
  if (error) return { ok: false, error };
  player.flagshipName = rawName.trim();
  return { ok: true };
}

/** Ready needs a navy and a flagship name; unready is always allowed. */
export function setLobbyReady(lobby: Lobby, slotId: string, ready: boolean): LobbyResult {
  const player = findLobbyPlayer(lobby, slotId);
  if (!player) return { ok: false, error: "You are not in this lobby." };
  if (lobby.startedAtMs !== null) return { ok: false, error: "The game has already started." };
  if (!ready) {
    player.ready = false;
    return { ok: true };
  }
  if (!player.navy) return { ok: false, error: "Choose a navy first." };
  if (!player.flagshipName) return { ok: false, error: "Name your flagship first." };
  player.ready = true;
  return { ok: true };
}

/** The reason the host cannot start yet, or an empty string when they can. */
export function lobbyStartReason(lobby: Lobby): string {
  if (lobby.players.length === 0) return "No players in the lobby.";
  if (lobby.players.some((player) => !player.navy)) return "Every player needs a navy.";
  if (lobby.players.some((player) => !player.ready)) return "Every player must be ready.";
  const used = new Set(lobby.players.map((player) => player.navy));
  if (used.size < settings.lobby.minNavies) {
    return `Need at least ${settings.lobby.minNavies} navies with players.`;
  }
  return "";
}

export function canStartLobby(lobby: Lobby): boolean {
  return lobbyStartReason(lobby) === "";
}

/** Remove a captain. The host passes to the next player in the list. */
export function removeLobbyPlayer(lobby: Lobby, slotId: string): boolean {
  const at = lobby.players.findIndex((player) => player.id === slotId);
  if (at < 0) return false;
  lobby.players.splice(at, 1);
  if (lobby.players.length === 0) {
    lobby.hostId = "";
    return true;
  }
  if (!lobby.players.some((player) => player.id === lobby.hostId)) {
    lobby.hostId = lobby.players[0]!.id;
  }
  return true;
}

/** The host removed a captain; that captain is not simply leaving. */
export function isLobbyHost(lobby: Lobby, slotId: string): boolean {
  return lobby.players.some((player) => player.id === slotId) && lobby.hostId === slotId;
}

/** Everything the browser may know. Account ids and tokens never appear. */
export function lobbySnapshot(lobby: Lobby, viewerSlotId: string | null): LobbySnapshot {
  return {
    code: lobby.code,
    you: viewerSlotId && lobby.players.some((player) => player.id === viewerSlotId)
      ? viewerSlotId
      : null,
    hostId: lobby.hostId,
    players: lobby.players.map((player) => ({
      id: player.id,
      name: player.name,
      navy: player.navy,
      flagshipName: player.flagshipName,
      ready: player.ready,
      host: player.id === lobby.hostId,
    })),
    items: lobby.items,
    ai: lobby.ai,
    minNavies: settings.lobby.minNavies,
    startReason: lobbyStartReason(lobby),
  };
}

/** The players a started lobby puts into the world, in joined order. */
export interface LobbyStartPlayer {
  id: string;
  name: string;
  navy: NavyId;
  flagshipName: string;
}

export function lobbyStartPlayers(lobby: Lobby): LobbyStartPlayer[] | null {
  if (!canStartLobby(lobby)) return null;
  return lobby.players.map((player) => ({
    id: player.accountId,
    name: player.name,
    navy: player.navy!,
    flagshipName: player.flagshipName,
  }));
}
