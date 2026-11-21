// Cloudflare Worker entry point.
//
// The Worker serves the small account API, routes the WebSocket path to a
// room, and serves the built static page for everything else.

import { settings } from "@naval/shared/settings";
import { roomKindForCode } from "@naval/shared/fog";
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

// The Durable Object class must be exported from the Worker entry point.
export { GameRoom } from "./gameRoom.js";

export interface Env extends SupabaseEnv {
  GAME_ROOM: DurableObjectNamespace;
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
