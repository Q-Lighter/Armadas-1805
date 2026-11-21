// Cloudflare Worker entry point.
//
// The Worker serves the small account API, routes the WebSocket path to a
// room, and serves the built static page for everything else.

import { settings } from "@naval/shared/settings";
import { roomKindForCode } from "@naval/shared/fog";
import { isJoinCode } from "@naval/shared/lobby";
import {
  authenticate,
  deleteSupabaseAccount,
  publicConfig,
  readBearerToken,
  resignInRoom,
  runKeepalive,
  verifyAccessToken,
  type SupabaseEnv,
} from "./accountAuth.js";

// The Durable Object classes must be exported from the Worker entry point.
export { GameRoom } from "./gameRoom.js";
export { LobbyDirectory } from "./lobbyDirectory.js";

export interface Env extends SupabaseEnv {
  GAME_ROOM: DurableObjectNamespace;
  LOBBY_DIRECTORY?: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const roomCodePattern = new RegExp(
  `^[A-Za-z0-9_-]{1,${settings.server.maxRoomCodeLength}}$`,
);

// These files decide which hashed bundle the browser loads. They must never be
// reused from a cache, or an update could mix old HTML with new files.
const alwaysFresh = new Set(["/", "/index.html", "/version.json"]);

function withoutCaching(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function accountDelete(request: Request, env: Env): Promise<Response> {
  if (!settings.server) return json({ ok: false, error: "Not available." }, 503);
  const token = await readBearerToken(request);
  if (!token) return json({ ok: false, error: "Log in to delete an account." }, 401);
  const account = await verifyAccessToken(token, env).catch(() => null);
  if (!account) return json({ ok: false, error: "Log in to delete an account." }, 401);

  let body: { room?: unknown } = {};
  try {
    body = await request.json() as { room?: unknown };
  } catch {
    // A missing body is fine; it just means no room resignation.
  }
  const room = typeof body.room === "string" ? body.room : "";
  if (room && roomCodePattern.test(room)) {
    const id = env.GAME_ROOM.idFromName(room);
    const stub = env.GAME_ROOM.get(id);
    await resignInRoom(room, account.userId, env, (next) => stub.fetch(next), roomKindForCode(room));
  }

  const result = await deleteSupabaseAccount(account.userId, env).catch(() => ({
    ok: false as const,
    error: "The account could not be deleted.",
  }));
  return result.ok
    ? json({ ok: true })
    : json({ ok: false, error: result.error }, 500);
}

/** Create a game: reserve a unique code, then open its lobby. */
async function lobbyCreate(request: Request, env: Env): Promise<Response> {
  const token = await readBearerToken(request);
  if (!token) return json({ ok: false, error: "Log in to create a game." }, 401);
  const account = await authenticate(token, env).catch(() => null);
  if (!account) return json({ ok: false, error: "Log in to create a game." }, 401);
  if (!env.LOBBY_DIRECTORY) {
    return json({ ok: false, error: "Lobbies are not configured." }, 503);
  }
  if (!env.SUPABASE_SECRET_KEY) {
    return json({ ok: false, error: "Lobbies are not configured." }, 503);
  }
  try {
    const directory = env.LOBBY_DIRECTORY.get(
      env.LOBBY_DIRECTORY.idFromName("lobby-directory"),
    );
    const reserved = await directory.fetch(new Request("https://directory.internal/reserve", {
      method: "POST",
      body: "{}",
    }));
    const reservation = await reserved.json() as { ok?: boolean; code?: string; error?: string };
    if (!reservation.ok || !reservation.code || !isJoinCode(reservation.code)) {
      return json({ ok: false, error: reservation.error ?? "No join code is free. Try again." }, 503);
    }
    const code = reservation.code;
    const room = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
    const created = await room.fetch(new Request("https://room.internal/lobby-create", {
      method: "POST",
      headers: {
        "x-admin-key": env.SUPABASE_SECRET_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, hostId: account.userId, hostName: account.displayName }),
    }));
    if (!created.ok) {
      await directory.fetch(new Request("https://directory.internal/release", {
        method: "POST",
        body: JSON.stringify({ code }),
      })).catch(() => null);
      return json({ ok: false, error: "That game could not be created. Try again." }, 502);
    }
    return json({ ok: true, code });
  } catch {
    return json({ ok: false, error: "That game could not be created. Try again." }, 502);
  }
}

/** Join with a code: say whether an active game uses it. */
async function lobbyLookup(request: Request, env: Env): Promise<Response> {
  const token = await readBearerToken(request);
  if (!token) return json({ ok: false, error: "Log in to join a game." }, 401);
  const account = await verifyAccessToken(token, env).catch(() => null);
  if (!account) return json({ ok: false, error: "Log in to join a game." }, 401);
  const code = (new URL(request.url).searchParams.get("code") ?? "").trim().toUpperCase();
  if (!isJoinCode(code)) {
    return json({
      ok: false,
      error: "Join code must be 5 characters from A to Z and 2 to 9.",
    }, 400);
  }
  if (!env.LOBBY_DIRECTORY) {
    return json({ ok: false, error: "Lobbies are not configured." }, 503);
  }
  try {
    const directory = env.LOBBY_DIRECTORY.get(
      env.LOBBY_DIRECTORY.idFromName("lobby-directory"),
    );
    const response = await directory.fetch(new Request("https://directory.internal/lookup", {
      method: "POST",
      body: JSON.stringify({ code }),
    }));
    const row = await response.json() as {
      ok?: boolean; found?: boolean; status?: string; error?: string;
    };
    if (!row.ok) return json({ ok: false, error: row.error ?? "Could not look up that code." }, 502);
    return json({ ok: true, found: row.found === true, status: row.status ?? "lobby", code });
  } catch {
    return json({ ok: false, error: "Could not look up that code." }, 502);
  }
}

async function keepalive(request: Request, env: Env): Promise<Response> {
  const token = await readBearerToken(request);
  if (!token) return json({ ok: false, text: "Log in to run keepalive." }, 401);
  const account = await authenticate(token, env).catch(() => null);
  if (!account) return json({ ok: false, text: "Log in to run keepalive." }, 401);
  const result = await runKeepalive(env);
  return json(result, result.ok ? 200 : 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return json(publicConfig(env));
    }
    if (url.pathname === "/api/account" && request.method === "DELETE") {
      return accountDelete(request, env);
    }
    if (url.pathname === "/api/keepalive" && request.method === "POST") {
      return keepalive(request, env);
    }
    if (url.pathname === "/api/lobby/create" && request.method === "POST") {
      return lobbyCreate(request, env);
    }
    if (url.pathname === "/api/lobby/code" && request.method === "GET") {
      return lobbyLookup(request, env);
    }
    if (url.pathname === "/ws") {
      const room = url.searchParams.get("room") ?? "";
      if (!roomCodePattern.test(room)) {
        return new Response("Room code must be letters, numbers, dash or underscore.", {
          status: 400,
        });
      }

      // Each room code maps to one Durable Object, which owns that world.
      const id = env.GAME_ROOM.idFromName(room);
      return env.GAME_ROOM.get(id).fetch(request);
    }

    // Everything else is the static page built into dist/. The entry page and
    // version file are revalidated every time; the hashed bundle is immutable.
    const response = await env.ASSETS.fetch(request);
    return alwaysFresh.has(url.pathname) ? withoutCaching(response) : response;
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runKeepalive(env);
  },
} satisfies ExportedHandler<Env>;
