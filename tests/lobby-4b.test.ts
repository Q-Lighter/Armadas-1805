// 4B: join codes, lobby rules, world start, takeover, rejoin and no leaks.
// The real GameRoom is driven through a fake WebSocket pair; no Supabase call
// ever leaves this process.

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  addLobbyPlayer,
  canStartLobby,
  flagshipNameError,
  isJoinCode,
  lobbySnapshot,
  lobbyStartReason,
  makeJoinCode,
  newLobby,
  removeLobbyPlayer,
  setLobbyFlagshipName,
  setLobbyNavy,
  setLobbyReady,
  type Lobby,
} from "@naval/shared/lobby";
import { settings } from "@naval/shared/settings";
import { lonLatToMap } from "@naval/shared/map";
import {
  addPlayer,
  resignPlayer,
  shipsForOwner,
  startLobbyGame,
} from "@naval/shared/world";

const NativeResponse = globalThis.Response;

const ANNE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const DAVE = "44444444-4444-4444-8444-444444444444";

const names = new Map<string, string>([
  [ANNE, "Captain Anne"],
  [BOB, "Captain Bob"],
  [CAROL, "Captain Carol"],
  [DAVE, "Captain Dave"],
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new NativeResponse(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class FakeServerSocket {
  listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  accept() {}
  addEventListener(type: string, callback: (event: { data?: unknown }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  send(data: string) { this.sent.push(data); }
  close(code?: number, reason?: string) {
    if (this.closed) return;
    this.closed = { code, reason };
    for (const callback of this.listeners.get("close") ?? []) callback({});
  }
  message(data: unknown) {
    for (const callback of this.listeners.get("message") ?? []) callback({ data });
  }
  disconnect() {
    for (const callback of this.listeners.get("close") ?? []) callback({});
  }
  messages(): Array<Record<string, unknown>> {
    return this.sent.flatMap((raw) => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
  }
  last(type: string): Record<string, unknown> | null {
    return [...this.messages()].reverse().find((row) => row.t === type) ?? null;
  }
}

class FakePair {
  0: { target: FakeServerSocket | null; queue: string[] };
  1: FakeServerSocket;
  constructor() {
    const server = new FakeServerSocket();
    this[0] = { target: null, queue: [] };
    this[1] = server;
    (globalThis as { __lastPair?: FakePair }).__lastPair = this;
  }
}

class FakeResponse {
  status: number;
  statusText = "";
  body: unknown;
  webSocket: unknown;
  constructor(body: unknown, init: { status?: number; webSocket?: unknown; statusText?: string } = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
    this.statusText = init.statusText ?? "";
  }
  static json(body: unknown, init: { status?: number } = {}) {
    return new FakeResponse(body, init);
  }
  async json() { return JSON.parse(String(this.body)); }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((done) => setTimeout(done, 5));
  }
}

let projectCounter = 0;
async function roomHarness() {
  projectCounter += 1;
  const projectUrl = `https://lobby-${projectCounter}.test`;
  const issuer = `${projectUrl}/auth/v1`;
  const pair = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = "lobby-key";
  const jwks = { keys: [publicJwk] };
  const tokenFor = (userId: string, username: string) => new SignJWT({
    user_metadata: { username },
  })
    .setProtectedHeader({ alg: "ES256", kid: "lobby-key" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(pair.privateKey);

  const originalFetch = globalThis.fetch;
  const originalResponse = globalThis.Response;
  const originalPair = (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (() => 1) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return jsonResponse(jwks);
    if (url.includes("/rest/v1/profiles?")) {
      const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(url)?.[1] ?? "");
      const display = names.get(id);
      return display
        ? jsonResponse([{ id, username: display.split(" ").at(-1)?.toLowerCase(), display_name: display }])
        : jsonResponse([], 200);
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
  globalThis.Response = FakeResponse as unknown as typeof Response;
  (globalThis as { WebSocketPair?: unknown }).WebSocketPair = FakePair;

  const { GameRoom } = await import(
    pathToFileURL(resolve("server/dist/gameRoom.js")).href
  ) as { GameRoom: new (state?: unknown, env?: unknown) => {
    fetch(request: Request): Promise<Response>;
    world: import("@naval/shared/world").World;
  } };

  const env = {
    SUPABASE_URL: projectUrl,
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    SUPABASE_SECRET_KEY: "secret",
  };
  const room = new GameRoom(undefined, env);

  async function createLobby(code: string, hostId = ANNE, hostName = "Captain Anne") {
    const response = await room.fetch(new Request("https://room.internal/lobby-create", {
      method: "POST",
      headers: { "x-admin-key": "secret" },
      body: JSON.stringify({ code, hostId, hostName }),
    }));
    assert.equal(response.status, 200, "lobby was created");
  }

  async function connect(code: string, userId: string, username: string) {
    const response = await room.fetch(new Request(
      `https://game.test/ws?room=${code}`,
      { headers: { Upgrade: "websocket" } },
    ));
    assert.equal(response.status, 101);
    const socket = (globalThis as unknown as { __lastPair: FakePair }).__lastPair[1];
    socket.message(JSON.stringify({ t: "auth", token: await tokenFor(userId, username) }));
    await settle();
    return socket;
  }

  return {
    room,
    createLobby,
    connect,
    restore() {
      globalThis.fetch = originalFetch;
      globalThis.Response = originalResponse;
      (globalThis as { WebSocketPair?: unknown }).WebSocketPair = originalPair;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    },
  };
}

function lobbyFor(code: string, hostName = "Captain Anne"): Lobby {
  return newLobby(code, { id: "slot-host", accountId: ANNE, name: hostName }, 1_000);
}

// ---- join codes -----------------------------------------------------------

test("join codes use 5 characters without O, I, L, 0 or 1", () => {
  assert.equal(isJoinCode("ABCDE"), true);
  assert.equal(isJoinCode("Z9Z9Z"), true);
  assert.equal(isJoinCode("AB0DE"), false, "zero is not allowed");
  assert.equal(isJoinCode("AB1DE"), false, "one is not allowed");
  assert.equal(isJoinCode("ABIDE"), false, "I is not allowed");
  assert.equal(isJoinCode("ABLDE"), false, "L is not allowed");
  assert.equal(isJoinCode("ABODE"), false, "O is not allowed");
  assert.equal(isJoinCode("ABCD"), false, "four characters is too short");
  const alphabet = new Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  for (let index = 0; index < 1_000; index += 1) {
    const code = makeJoinCode(() => index / 1_000);
    assert.equal(isJoinCode(code), true, code);
    for (const letter of code) assert.ok(alphabet.has(letter), `${letter} is allowed`);
  }
});

test("the directory keeps active codes unique and releases them", async () => {
  const { LobbyDirectory } = await import(
    pathToFileURL(resolve("server/dist/lobbyDirectory.js")).href
  ) as { LobbyDirectory: new (state?: unknown, env?: unknown) => { fetch(request: Request): Promise<Response> } };
  const directory = new LobbyDirectory(undefined, {});
  const codes = new Set<string>();
  for (let index = 0; index < 12; index += 1) {
    const response = await directory.fetch(new Request("https://directory.internal/reserve", {
      method: "POST",
      body: "{}",
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { code: string };
    assert.equal(codes.has(body.code), false, "a reserved code is unique");
    codes.add(body.code);
    assert.equal(isJoinCode(body.code), true);
  }
  const first = [...codes][0]!;
  const lookup = await directory.fetch(new Request("https://directory.internal/lookup", {
    method: "POST",
    body: JSON.stringify({ code: first }),
  }));
  assert.equal((await lookup.json() as { found: boolean }).found, true);
  await directory.fetch(new Request("https://directory.internal/release", {
    method: "POST",
    body: JSON.stringify({ code: first }),
  }));
  const gone = await directory.fetch(new Request("https://directory.internal/lookup", {
    method: "POST",
    body: JSON.stringify({ code: first }),
  }));
  assert.equal((await gone.json() as { found: boolean }).found, false);

  // Every random draw is the same code, so the second reservation must retry
  // every allowed attempt and fail instead of handing out a duplicate.
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const collisions = new LobbyDirectory(undefined, {});
    const one = await collisions.fetch(new Request("https://directory.internal/reserve", {
      method: "POST", body: "{}",
    }));
    assert.equal(one.status, 200);
    const two = await collisions.fetch(new Request("https://directory.internal/reserve", {
      method: "POST", body: "{}",
    }));
    assert.equal(two.status, 503);
  } finally {
    Math.random = originalRandom;
  }
});

// ---- lobby rules ----------------------------------------------------------

test("a navy takes at most two players and only before ready", () => {
  const lobby = lobbyFor("ABCDE");
  assert.equal(addLobbyPlayer(lobby, { id: "slot-bob", accountId: BOB, name: "Captain Bob" }).ok, true);
  assert.equal(addLobbyPlayer(lobby, { id: "slot-carol", accountId: CAROL, name: "Captain Carol" }).ok, true);

  assert.equal(setLobbyNavy(lobby, "slot-bob", "British").ok, true);
  assert.equal(setLobbyNavy(lobby, "slot-carol", "British").ok, true);
  const third = setLobbyNavy(lobby, "slot-host", "British");
  assert.equal(third.ok, false);
  assert.match((third as { error: string }).error, /already has 2 players/);

  assert.equal(setLobbyFlagshipName(lobby, "slot-bob", "Victory").ok, true);
  assert.equal(setLobbyReady(lobby, "slot-bob", true).ok, true);
  const change = setLobbyNavy(lobby, "slot-bob", "French");
  assert.equal(change.ok, false);
  assert.match((change as { error: string }).error, /Not ready/);
  const rename = setLobbyFlagshipName(lobby, "slot-bob", "Temeraire");
  assert.equal(rename.ok, false);
  assert.match((rename as { error: string }).error, /Not ready/);
  assert.equal(setLobbyReady(lobby, "slot-bob", false).ok, true);
  assert.equal(setLobbyNavy(lobby, "slot-bob", "French").ok, true);
});

test("ready and start gating give a readable reason in order", () => {
  const lobby = lobbyFor("ABCDE");
  addLobbyPlayer(lobby, { id: "slot-bob", accountId: BOB, name: "Captain Bob" });

  assert.equal(lobbyStartReason(lobby), "Every player needs a navy.");
  assert.equal(canStartLobby(lobby), false);

  assert.equal(setLobbyNavy(lobby, "slot-host", "British").ok, true);
  assert.equal(setLobbyNavy(lobby, "slot-bob", "French").ok, true);
  assert.equal(lobbyStartReason(lobby), "Every player must be ready.");

  assert.equal(setLobbyReady(lobby, "slot-host", true).ok, false, "no flagship name yet");
  assert.equal(setLobbyFlagshipName(lobby, "slot-host", "Victory").ok, true);
  assert.equal(setLobbyFlagshipName(lobby, "slot-bob", "Soleil").ok, true);
  assert.equal(setLobbyReady(lobby, "slot-host", true).ok, true);
  assert.equal(lobbyStartReason(lobby), "Every player must be ready.");
  assert.equal(setLobbyReady(lobby, "slot-bob", true).ok, true);
  assert.equal(lobbyStartReason(lobby), "");
  assert.equal(canStartLobby(lobby), true);

  // One navy is not enough at the design value of 2.
  assert.equal(setLobbyNavy(lobby, "slot-bob", "British").ok, false, "navy is full");
});

test("flagship names are 2 to 24 characters and unique without case", () => {
  const lobby = lobbyFor("ABCDE");
  addLobbyPlayer(lobby, { id: "slot-bob", accountId: BOB, name: "Captain Bob" });
  assert.match(flagshipNameError(lobby, "slot-host", "A") ?? "", /2 to 24/);
  assert.match(flagshipNameError(lobby, "slot-host", "x".repeat(25)) ?? "", /2 to 24/);
  assert.equal(setLobbyFlagshipName(lobby, "slot-host", "Victory").ok, true);
  assert.equal(flagshipNameError(lobby, "slot-bob", "vIcToRy"), "That flagship name is already taken.");
  assert.equal(setLobbyFlagshipName(lobby, "slot-bob", "VICTORY").ok, false);
  assert.equal(setLobbyFlagshipName(lobby, "slot-bob", "Temeraire").ok, true);
});

test("the host badge passes to the next player and the host can remove a captain", () => {
  const lobby = lobbyFor("ABCDE");
  addLobbyPlayer(lobby, { id: "slot-bob", accountId: BOB, name: "Captain Bob" });
  addLobbyPlayer(lobby, { id: "slot-carol", accountId: CAROL, name: "Captain Carol" });
  assert.equal(lobby.hostId, "slot-host");
  assert.equal(removeLobbyPlayer(lobby, "slot-host"), true);
  assert.equal(lobby.hostId, "slot-bob");
  assert.deepEqual(lobby.players.map((player) => player.id), ["slot-bob", "slot-carol"]);
  assert.equal(removeLobbyPlayer(lobby, "slot-bob"), true);
  assert.equal(lobby.hostId, "slot-carol");
});

test("the lobby snapshot carries no account ids, usernames or tokens", () => {
  const lobby = lobbyFor("ABCDE");
  addLobbyPlayer(lobby, { id: "slot-bob", accountId: BOB, name: "Captain Bob" });
  setLobbyNavy(lobby, "slot-bob", "French");
  setLobbyFlagshipName(lobby, "slot-bob", "Soleil");
  setLobbyReady(lobby, "slot-bob", true);
  const snapshot = lobbySnapshot(lobby, "slot-bob");
  const text = JSON.stringify(snapshot);
  assert.equal(text.includes(ANNE), false, "no account ids");
  assert.equal(text.includes(BOB), false, "no account ids");
  assert.equal(/accountId|username|token|email/i.test(text), false);
  assert.equal(snapshot.you, "slot-bob");
  assert.equal(snapshot.players.find((player) => player.id === "slot-bob")?.ready, true);
});

// ---- world start ----------------------------------------------------------

test("the lobby world starts one, two and four navies with the normal setup", () => {
  const one = startLobbyGame("ABCDE", [
    { id: "a", name: "Anne", navy: "British", flagshipName: "Victory" },
  ]);
  assert.equal(one.kind, "normal");
  assert.equal(one.players.size, 1);
  assert.deepEqual([...one.startedNavies], ["British"]);
  assert.equal(one.eliminatedNavies.size, 3);
  assert.equal(one.eliminatedNavies.has("Spanish"), true);
  assert.equal(shipsForOwner(one, "a").length, 1);
  assert.equal(shipsForOwner(one, "a")[0]?.classId, "flagship");
  assert.equal(shipsForOwner(one, "a")[0]?.name, "Victory");
  assert.equal(one.startMoney, settings.ships.startMoney.normal);

  const two = startLobbyGame("ABCDE", [
    { id: "a", name: "Anne", navy: "British", flagshipName: "Victory" },
    { id: "b", name: "Bob", navy: "French", flagshipName: "Soleil" },
  ]);
  assert.equal(two.startedNavies.size, 2);
  assert.equal(two.eliminatedNavies.has("Spanish"), true);
  assert.equal(two.eliminatedNavies.has("Dutch"), true);
  assert.equal(two.playerRecords.get("b")?.navy, "French");
  assert.equal(two.playerRecords.get("b")?.flagshipName, "Soleil");

  const four = startLobbyGame("ABCDE", [
    { id: "a", name: "Anne", navy: "British", flagshipName: "Victory" },
    { id: "b", name: "Bob", navy: "British", flagshipName: "Temeraire" },
    { id: "c", name: "Carol", navy: "French", flagshipName: "Soleil" },
    { id: "d", name: "Dan", navy: "Dutch", flagshipName: "Vrijheid" },
  ]);
  assert.equal(four.playerRecords.size, 4);
  assert.equal(four.startedNavies.size, 3, "two British captains are one navy");
  assert.equal(four.eliminatedNavies.size, 1);
  assert.equal(four.eliminatedNavies.has("Spanish"), true);
  const britishA = four.players.get("a")!;
  const britishB = four.players.get("b")!;
  assert.equal(britishA.navy, "British");
  assert.equal(britishB.navy, "British");
  const start = lonLatToMap(settings.navies.British.start.lonDeg, settings.navies.British.start.latDeg);
  const radius = settings.world.startRadiusKm * 2;
  assert.ok(Math.hypot(britishA.x - start.x, britishA.y - start.y) <= radius);
  assert.ok(Math.hypot(britishB.x - start.x, britishB.y - start.y) <= radius);
  assert.ok(Math.hypot(britishA.x - britishB.x, britishA.y - britishB.y) > 0.05);
});

test("unused navies count as eliminated and the last real navy wins", () => {
  const two = startLobbyGame("ABCDE", [
    { id: "a", name: "Anne", navy: "British", flagshipName: "Victory" },
    { id: "b", name: "Bob", navy: "French", flagshipName: "Soleil" },
  ]);
  assert.equal(two.gameOver, null);
  assert.equal(resignPlayer(two, "a", null), true);
  assert.equal(two.eliminatedNavies.has("British"), true);
  const over = two.gameOver as unknown as { navy: string; winnerIds: string[] } | null;
  assert.ok(over, "two real navies leave a winner");
  assert.equal(over.navy, "French");
  assert.deepEqual(over.winnerIds, ["b"]);

  const one = startLobbyGame("ABCDE", [
    { id: "a", name: "Anne", navy: "British", flagshipName: "Victory" },
  ]);
  assert.equal(resignPlayer(one, "a", null), true);
  assert.equal(one.gameOver, null, "a one-navy room never ends");
  assert.equal(one.eliminatedNavies.has("British"), true);
});

// ---- live room: lobby actions, start, takeover and rejoin -----------------

test("the room serves the lobby, starts two navies and passes the host badge", async () => {
  const harness = await roomHarness();
  try {
    await harness.createLobby("ABCDE");
    const anne = await harness.connect("ABCDE", ANNE, "anne");
    const bob = await harness.connect("ABCDE", BOB, "bob");
    const carol = await harness.connect("ABCDE", CAROL, "carol");

    const anneLobby = anne.last("lobby") as { lobby?: { hostId: string; players: unknown[]; startReason: string } };
    assert.ok(anneLobby?.lobby);
    assert.equal(anneLobby.lobby.players.length, 3);
    assert.equal(anneLobby.lobby.startReason, "Every player needs a navy.");
    assert.equal(JSON.stringify(anneLobby).includes(ANNE), false, "no account ids in the message");

    const anneSlot = harness.room.world; // keep the type visible; slots arrive below
    void anneSlot;
    const snapshots = anne.messages().filter((row) => row.t === "lobby") as Array<{
      lobby: { you: string; hostId: string; players: Array<{ id: string; name: string }> };
    }>;
    const latest = snapshots.at(-1)!.lobby;
    const bobSlot = latest.players.find((player) => player.name === "Captain Bob")!.id;
    const carolSlot = latest.players.find((player) => player.name === "Captain Carol")!.id;

    // Two players in British, then the third is refused with the reason.
    bob.message(JSON.stringify({ t: "lobbyNavy", navy: "British" }));
    carol.message(JSON.stringify({ t: "lobbyNavy", navy: "British" }));
    await settle();
    anne.message(JSON.stringify({ t: "lobbyNavy", navy: "British", id: "n1" }));
    await settle();
    const refused = anne.messages().find((row) => row.id === "n1" && row.t === "ack");
    assert.equal(refused?.ok, false);
    assert.match(String(refused?.text), /already has 2 players/);

    anne.message(JSON.stringify({ t: "lobbyNavy", navy: "French" }));
    for (const [socket, name] of [[anne, "Victory"], [bob, "Temeraire"], [carol, "Soleil"]] as const) {
      socket.message(JSON.stringify({ t: "lobbyFlagship", name }));
      socket.message(JSON.stringify({ t: "lobbyReady", ready: true }));
    }
    await settle();
    const ready = (anne.last("lobby") as { lobby: { startReason: string; players: Array<{ ready: boolean }> } }).lobby;
    assert.equal(ready.startReason, "");
    assert.equal(ready.players.every((player) => player.ready), true);

    // Only the host may start.
    bob.message(JSON.stringify({ t: "lobbyStart", id: "s1" }));
    await settle();
    assert.match(String(bob.messages().find((row) => row.id === "s1")?.text), /Only the host/);
    assert.equal(harness.room.world.kind, "normal");

    anne.message(JSON.stringify({ t: "lobbyStart", id: "s2" }));
    await settle();
    assert.equal(anne.messages().find((row) => row.id === "s2")?.ok, true);
    assert.equal(harness.room.world.players.size, 3);
    assert.equal(harness.room.world.gameOver, null);
    assert.equal(harness.room.world.playerRecords.get(ANNE)?.flagshipName, "Victory");
    assert.equal(harness.room.world.playerRecords.get(BOB)?.navy, "British");
    assert.equal(harness.room.world.playerRecords.get(CAROL)?.navy, "British");

    // A mid-game disconnect does not remove the captain; the host badge moves
    // only in the lobby before the start, so here the ships simply stay.
    bob.disconnect();
    await settle();
    assert.equal(harness.room.world.playerRecords.has(BOB), true);
    assert.equal(shipsForOwner(harness.room.world, BOB).length, 1);

    // The same account rejoins at once and keeps the same world id.
    const bobAgain = await harness.connect("ABCDE", BOB, "bob");
    assert.equal(harness.room.world.players.size, 3, "rejoin did not add a player");
    assert.ok(bobAgain.last("s"), "rejoin got world state");

    // Carol's slot is still connected, so a stranger sees the waiting card.
    const dave = await harness.connect("ABCDE", DAVE, "dave");
    const waiting = dave.last("gameInProgress") as { freeSlots: number; reason: string };
    assert.equal(waiting.freeSlots, 0);
    assert.equal(waiting.reason, "No free slot");
    dave.message(JSON.stringify({ t: "takeoverRequest" }));
    await settle();
    assert.match(String(dave.last("takeoverStatus")?.text), /No free slot/);

    // Not the host: no takeover answer is accepted.
    bobAgain.message(JSON.stringify({ t: "takeoverAnswer", request: "x", accept: true }));
    await settle();
    assert.match(String(bobAgain.last("takeoverStatus")?.text), /Only the host/);

    // Drop a real slot and take it over.
    carol.disconnect();
    await settle();
    dave.message(JSON.stringify({ t: "takeoverRequest" }));
    await settle();
    const prompt = anne.last("takeoverRequest") as {
      request: { id: string; name: string; targetName: string; navy: string; flagshipName: string };
    };
    assert.ok(prompt?.request.id, "host gets an urgent prompt");
    assert.equal(prompt.request.name, "Captain Dave");
    assert.equal(prompt.request.targetName, "Captain Carol");
    assert.equal(prompt.request.navy, "British");
    assert.equal(prompt.request.flagshipName, "Soleil");
    assert.equal(JSON.stringify(prompt).includes(CAROL), false, "no account id in the prompt");

    anne.message(JSON.stringify({
      t: "takeoverAnswer", request: prompt.request.id, accept: true,
    }));
    await settle();
    assert.ok(dave.last("gameStarted"), "the requester enters the game");
    const carolFlagship = harness.room.world.playerRecords.get(CAROL)!.flagshipId;
    dave.message(JSON.stringify({ t: "select", ship: carolFlagship, id: "take" }));
    await settle();
    const takeAck = dave.messages().find((row) => row.id === "take" && row.t === "ack");
    assert.equal(takeAck?.ok, true, "the requester now controls the old slot");
    assert.equal(harness.room.world.playerRecords.get(CAROL)?.flagshipName, "Soleil");
    assert.equal(shipsForOwner(harness.room.world, CAROL).length, 1);
    assert.equal(harness.room.world.playerRecords.size, 3, "the slot keeps its navy and ships");

    // The original account no longer owns that slot.
    const carolBack = await harness.connect("ABCDE", CAROL, "carol");
    assert.ok(carolBack.last("gameInProgress"), "the taken slot is not handed back");
    void bobSlot;
    void carolSlot;
  } finally {
    harness.restore();
  }
});

test("a takeover request can be declined and waits while the host is offline", async () => {
  const harness = await roomHarness();
  try {
    await harness.createLobby("FGHJK");
    const anne = await harness.connect("FGHJK", ANNE, "anne");
    const bob = await harness.connect("FGHJK", BOB, "bob");
    for (const [socket, navy, name] of [[anne, "British", "Victory"], [bob, "French", "Soleil"]] as const) {
      socket.message(JSON.stringify({ t: "lobbyNavy", navy }));
      socket.message(JSON.stringify({ t: "lobbyFlagship", name }));
      socket.message(JSON.stringify({ t: "lobbyReady", ready: true }));
    }
    await settle();
    anne.message(JSON.stringify({ t: "lobbyStart" }));
    await settle();
    assert.equal(harness.room.world.players.size, 2);

    bob.disconnect();
    await settle();

    // The host is offline: the request waits instead of failing.
    anne.disconnect();
    await settle();
    assert.equal((harness.room as unknown as { sockets: { size: number } }).sockets.size, 0);
    const dave = await harness.connect("FGHJK", DAVE, "dave");
    dave.message(JSON.stringify({ t: "takeoverRequest" }));
    await settle();
    assert.match(String(dave.last("takeoverStatus")?.text), /host is offline/i);

    // The host comes back and sees the waiting request.
    const anneAgain = await harness.connect("FGHJK", ANNE, "anne");
    const prompt = anneAgain.last("takeoverRequest") as { request: { id: string } };
    assert.ok(prompt?.request.id, "the waiting request reaches the returning host");
    anneAgain.message(JSON.stringify({
      t: "takeoverAnswer", request: prompt.request.id, accept: false,
    }));
    await settle();
    assert.match(String(dave.last("takeoverStatus")?.text), /declined/);
    assert.ok(dave.last("gameInProgress"), "the waiting card stays");

    // The declined slot is still free and still belongs to the old captain.
    assert.equal(harness.room.world.playerRecords.has(BOB), true);
    void bob;
  } finally {
    harness.restore();
  }
});

test("a lobby player removed by the host is told and leaves the lobby", async () => {
  const harness = await roomHarness();
  try {
    await harness.createLobby("MNPQR");
    const anne = await harness.connect("MNPQR", ANNE, "anne");
    const bob = await harness.connect("MNPQR", BOB, "bob");
    const snapshots = anne.messages().filter((row) => row.t === "lobby") as Array<{
      lobby: { players: Array<{ id: string; name: string }> };
    }>;
    const bobSlot = snapshots.at(-1)!.lobby.players.find((player) => player.name === "Captain Bob")!.id;

    bob.message(JSON.stringify({ t: "lobbyKick", player: bobSlot, id: "no" }));
    await settle();
    assert.match(String(bob.messages().find((row) => row.id === "no")?.text), /Only the host/);

    anne.message(JSON.stringify({ t: "lobbyKick", player: bobSlot }));
    await settle();
    assert.match(String(bob.last("lobbyKicked")?.text), /removed you/);
    const lobby = (anne.last("lobby") as { lobby: { players: Array<{ id: string }> } }).lobby;
    assert.equal(lobby.players.some((player) => player.id === bobSlot), false);
    assert.equal(bob.closed?.code, 4002);

    // The host leaving moves the badge.
    const carol = await harness.connect("MNPQR", CAROL, "carol");
    await settle();
    anne.disconnect();
    await settle();
    const after = (carol.last("lobby") as { lobby: { hostId: string; players: Array<{ id: string; host: boolean }> } }).lobby;
    const carolSlot = after.players.find((player) => player.host)?.id;
    assert.ok(carolSlot, "a host is always present");
    assert.equal(after.hostId, carolSlot);
  } finally {
    harness.restore();
  }
});
