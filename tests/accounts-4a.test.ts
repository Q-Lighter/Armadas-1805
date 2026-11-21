// 4A: account validation, token verification, Worker endpoints, room
// handshakes and account deletion. No test reaches real Supabase.

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  accountEmailFor,
  accountIdentityFor,
  displayNameError,
  passwordError,
  usernameError,
} from "@naval/shared/accounts";
import { addPlayer, resignPlayer, shipsForOwner } from "@naval/shared/world";

const NativeResponse = globalThis.Response;
const issuer = "https://project.test/auth/v1";

function jsonResponse(body: unknown, status = 200): Response {
  return new NativeResponse(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let projectCounter = 0;
async function keys(tokenIssuer = issuer) {
  const pair = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = "test-key";
  return {
    privateKey: pair.privateKey,
    jwks: { keys: [publicJwk] },
    token: async (options: {
      sub?: string;
      username?: string;
      expiresIn?: number;
      signatureKey?: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
      tokenIssuer?: string;
    } = {}) => new SignJWT({
      user_metadata: { username: options.username ?? "anne" },
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(options.sub ?? "11111111-1111-4111-8111-111111111111")
      .setIssuer(options.tokenIssuer ?? tokenIssuer)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(options.signatureKey ?? pair.privateKey),
  };
}

test("username, password and display-name rules use the agreed limits", () => {
  assert.equal(usernameError("ab"), "Username must be 3 to 20 characters.");
  assert.equal(usernameError("a".repeat(21)), "Username must be 3 to 20 characters.");
  assert.equal(usernameError("Bad Name"), "Username can use letters, digits and underscore only.");
  assert.equal(usernameError("Anne_1"), null);
  assert.equal(passwordError("1234567"), "Password must be at least 8 characters.");
  assert.equal(passwordError("12345678"), null);
  assert.equal(displayNameError("A"), "Display name must be 2 to 24 characters.");
  assert.equal(displayNameError("A".repeat(25)), "Display name must be 2 to 24 characters.");
  assert.equal(displayNameError("Captain Anne"), null);
  assert.equal(displayNameError("<script>"), "Display name cannot contain control characters or angle brackets.");
});

test("usernames are case-insensitive and map to one made-up email", () => {
  assert.equal(accountEmailFor(" Anne_1 "), "anne_1@armadas-1805.carltonjamie714.workers.dev");
  assert.equal(accountEmailFor("Anne_1", "accounts.example"), "anne_1@accounts.example");
  const made = accountIdentityFor({ username: "Anne_1", password: "password" });
  assert.equal(made.identity?.email, "anne_1@armadas-1805.carltonjamie714.workers.dev");
  assert.equal(made.identity?.displayName, "Anne_1");
  assert.equal(
    accountIdentityFor({ username: "Anne_1", password: "password", displayName: "Captain Anne" })
      .identity?.displayName,
    "Captain Anne",
  );
  assert.match(accountIdentityFor({ username: "a", password: "password" }).error ?? "", /Username/);
});

test("a valid token is accepted and expired, wrong issuer, wrong signature and tampered tokens fail", async () => {
  const { localJwks, verifyAccessTokenWithJwks } = await import(
    pathToFileURL(resolve("server/dist/accountAuth.js")).href
  ) as {
    localJwks: (keys: unknown) => Parameters<typeof import("jose").jwtVerify>[1];
    verifyAccessTokenWithJwks: (
      token: string,
      jwks: Parameters<typeof import("jose").jwtVerify>[1],
      issuer: string,
    ) => Promise<{ userId: string; username: string } | null>;
  };
  const signed = await keys();
  const jwks = localJwks(signed.jwks);
  const valid = await signed.token();
  assert.equal((await verifyAccessTokenWithJwks(valid, jwks, issuer))?.userId,
    "11111111-1111-4111-8111-111111111111");
  assert.equal(await verifyAccessTokenWithJwks(
    await signed.token({ expiresIn: -1 }), jwks, issuer), null);
  assert.equal(await verifyAccessTokenWithJwks(
    await signed.token({ tokenIssuer: "https://other.test/auth/v1" }), jwks, issuer), null);

  const other = await keys();
  assert.equal(await verifyAccessTokenWithJwks(
    await signed.token({ signatureKey: other.privateKey }), jwks, issuer), null);

  const parts = valid.split(".");
  const tampered = `${parts[0]}.${parts[1]!.slice(0, -1)}A.${parts[2]}`;
  assert.equal(await verifyAccessTokenWithJwks(tampered, jwks, issuer), null);
});

test("the Worker serves config, keepalive, deletion and static pages", async () => {
  const signed = await keys();
  const token = await signed.token();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/.well-known/jwks.json")) return jsonResponse(signed.jwks);
    if (url.includes("/rest/v1/profiles?")) {
      return jsonResponse([{
        id: "11111111-1111-4111-8111-111111111111",
        username: "anne",
        display_name: "Captain Anne",
      }]);
    }
    if (url.includes("/rest/v1/keepalive")) return jsonResponse([{ id: 1 }]);
    if (url.includes("/auth/v1/admin/users/") && init?.method === "DELETE") {
      return jsonResponse({});
    }
    if (url.includes("/rest/v1/profiles?") && init?.method === "DELETE") {
      return jsonResponse({});
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;

  const roomCalls: Request[] = [];
  const env = {
    SUPABASE_URL: "https://project.test",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
    SUPABASE_SECRET_KEY: "secret",
    GAME_ROOM: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          roomCalls.push(request);
          return jsonResponse({ ok: true });
        },
      }),
    },
    ASSETS: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (path === "/privacy.html" || path === "/terms.html") {
          return new NativeResponse(`<h1>${path}</h1>`, { status: 200 });
        }
        return new NativeResponse("", { status: 404 });
      },
    },
  };
  const { default: worker } = await import(
    pathToFileURL(resolve("server/dist/worker.js")).href
  ) as { default: { fetch: (request: Request, env: unknown) => Promise<Response>; scheduled: (controller: unknown, env: unknown) => Promise<void> } };

  try {
    const config = await worker.fetch(new Request("https://game.test/api/config"), env);
    assert.deepEqual(await config.json(), {
      supabaseUrl: "https://project.test",
      supabasePublishableKey: "publishable",
      accountEmailDomain: "armadas-1805.carltonjamie714.workers.dev",
    });

    const keepalive = await worker.fetch(new Request("https://game.test/api/keepalive", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    assert.equal(keepalive.status, 200);
    assert.equal((await keepalive.json() as { ok: boolean }).ok, true);

    const deleted = await worker.fetch(new Request("https://game.test/api/account", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ room: "normal-room" }),
    }), env);
    assert.equal(deleted.status, 200);
    assert.ok(calls.some((call) => call.startsWith("DELETE https://project.test/auth/v1/admin/users/")));
    assert.ok(calls.some((call) => call.startsWith("DELETE https://project.test/rest/v1/profiles?")));
    assert.equal(roomCalls.length, 1);
    assert.equal(roomCalls[0]?.headers.get("x-account-id"),
      "11111111-1111-4111-8111-111111111111");
    assert.equal(roomCalls[0]?.headers.get("x-admin-key"), "secret");

    for (const page of ["privacy.html", "terms.html"]) {
      const response = await worker.fetch(new Request(`https://game.test/${page}`), env);
      assert.equal(response.status, 200);
    }

    await worker.scheduled({}, env);
    assert.ok(calls.filter((call) => call.includes("/rest/v1/keepalive")).length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// A tiny WebSocket pair for GameRoom's server-side handshake.
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
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  message(data: unknown) {
    for (const callback of this.listeners.get("message") ?? []) callback({ data });
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
    const original = server.send.bind(server);
    server.send = (data: string) => {
      this[0].queue.push(data);
      original(data);
    };
  }
}
class UpgradeResponse {
  status: number;
  statusText = "";
  webSocket: unknown;
  body: unknown;
  constructor(body: unknown, init: { status?: number; webSocket?: unknown; statusText?: string } = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
    this.statusText = init.statusText ?? "";
  }
  static json(body: unknown, init: { status?: number } = {}) {
    return new UpgradeResponse(body, init);
  }
  async json() { return JSON.parse(String(this.body)); }
}

async function roomHarness() {
  projectCounter += 1;
  const projectUrl = `https://room-${projectCounter}.test`;
  const projectIssuer = `${projectUrl}/auth/v1`;
  const signed = await keys(projectIssuer);
  const originalFetch = globalThis.fetch;
  const originalResponse = globalThis.Response;
  const originalPair = (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  // The room loop is irrelevant to the handshake and would keep Node alive.
  globalThis.setInterval = (() => 1) as unknown as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return jsonResponse(signed.jwks);
    if (url.includes("/rest/v1/profiles?")) {
      return jsonResponse([{
        id: "11111111-1111-4111-8111-111111111111",
        username: "anne",
        display_name: "Captain Anne",
      }]);
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
  globalThis.Response = UpgradeResponse as unknown as typeof Response;
  (globalThis as { WebSocketPair?: unknown }).WebSocketPair = FakePair;
  const { GameRoom } = await import(
    pathToFileURL(resolve("server/dist/gameRoom.js")).href
  ) as { GameRoom: new (state?: unknown, env?: unknown) => {
    fetch(request: Request): Promise<Response>;
    world: import("@naval/shared/world").World;
  } };
  const restore = () => {
    globalThis.fetch = originalFetch;
    globalThis.Response = originalResponse;
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = originalPair;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  };
  return {
    GameRoom,
    token: signed.token,
    env: {
      SUPABASE_URL: projectUrl,
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: "secret",
    },
    restore,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

test("normal rooms reject no token and accept a verified account, while test and dev rooms still accept guests", async () => {
  const harness = await roomHarness();
  try {
    const room = new harness.GameRoom(undefined, harness.env);
    const refused = await room.fetch(new Request(
      "https://game.test/ws?room=normal-room&player=guest",
      { headers: { Upgrade: "websocket" } },
    ));
    assert.equal(refused.status, 101);
    const refusedSocket = (globalThis as unknown as { __lastPair?: FakePair }).__lastPair?.[1];
    const pair = (globalThis as unknown as { __lastPair?: FakePair }).__lastPair;
    assert.ok(pair);
    pair[1].message(JSON.stringify({ t: "auth", token: null }));
    assert.equal(pair[1].closed?.code, 4401);
    assert.match(pair[1].closed?.reason ?? "", /Log in to play online/);
    assert.equal(room.world.players.size, 0);
    void refusedSocket;

    const accepted = await room.fetch(new Request(
      "https://game.test/ws?room=normal-room",
      { headers: { Upgrade: "websocket" } },
    ));
    assert.equal(accepted.status, 101);
    const acceptedPair = (globalThis as unknown as { __lastPair?: FakePair }).__lastPair!;
    acceptedPair[1].message(JSON.stringify({ t: "auth", token: await harness.token() }));
    await settle();
    assert.equal(room.world.players.has("11111111-1111-4111-8111-111111111111"), true);
    assert.equal(room.world.playerRecords.get("11111111-1111-4111-8111-111111111111")?.name,
      "Captain Anne");
    assert.equal(acceptedPair[1].closed, null);

    const guestRoom = new harness.GameRoom();
    for (const name of ["test-guest-room", "dev-guest-room"]) {
      const response = await guestRoom.fetch(new Request(
        `https://game.test/ws?room=${name}&player=guest&as=guest`,
        { headers: { Upgrade: "websocket" } },
      ));
      assert.equal(response.status, 101);
      assert.equal(guestRoom.world.players.has("guest"), true);
    }
  } finally {
    harness.restore();
  }
});

test("a newer connection for the same account takes over", async () => {
  const harness = await roomHarness();
  try {
    const room = new harness.GameRoom(undefined, harness.env);
    const token = await harness.token();
    await room.fetch(new Request(
      "https://game.test/ws?room=normal-takeover",
      { headers: { Upgrade: "websocket" } },
    ));
    const first = (globalThis as unknown as { __lastPair: FakePair }).__lastPair![1];
    first.message(JSON.stringify({ t: "auth", token }));
    await settle();

    await room.fetch(new Request(
      "https://game.test/ws?room=normal-takeover",
      { headers: { Upgrade: "websocket" } },
    ));
    const second = (globalThis as unknown as { __lastPair: FakePair }).__lastPair![1];
    second.message(JSON.stringify({ t: "auth", token }));
    await settle();

    assert.equal(first.closed?.code, 4001);
    assert.equal(second.closed, null);
    assert.equal(room.world.owners.has("11111111-1111-4111-8111-111111111111"), true);
  } finally {
    harness.restore();
  }
});

test("the account-delete room endpoint applies the resign path", async () => {
  const harness = await roomHarness();
  try {
    const room = new harness.GameRoom(undefined, harness.env);
    addPlayer(room.world, "11111111-1111-4111-8111-111111111111", "frigate", 50_000, "British");
    assert.ok(shipsForOwner(room.world, "11111111-1111-4111-8111-111111111111").length > 0);
    const response = await room.fetch(new Request("https://room.internal/account-delete", {
      method: "POST",
      headers: {
        "x-admin-key": "secret",
        "x-account-id": "11111111-1111-4111-8111-111111111111",
      },
    }));
    assert.equal(response.status, 200);
    assert.equal(
      room.world.playerRecords.get("11111111-1111-4111-8111-111111111111")?.eliminated?.reason,
      "resigned",
    );
  } finally {
    harness.restore();
  }
});

test("a direct resignation by the same helper records the same result", async () => {
  // This guards the helper the room endpoint calls, without a WebSocket.
  const harness = await roomHarness();
  try {
    const room = new harness.GameRoom(undefined, harness.env);
    addPlayer(room.world, "11111111-1111-4111-8111-111111111111", "frigate", 50_000, "British");
    assert.equal(resignPlayer(room.world, "11111111-1111-4111-8111-111111111111", null), true);
    assert.equal(
      room.world.playerRecords.get("11111111-1111-4111-8111-111111111111")?.eliminated?.reason,
      "resigned",
    );
  } finally {
    harness.restore();
  }
});
