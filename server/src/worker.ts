// Cloudflare Worker entry point.
//
// The Worker only does two things: send the WebSocket path to the room's
// Durable Object, and serve the built static page for everything else.

import { settings } from "@naval/shared/settings";

// The Durable Object class must be exported from the Worker entry point.
export { GameRoom } from "./gameRoom.js";

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const roomCodePattern = new RegExp(
  `^[A-Za-z0-9_-]{1,${settings.server.maxRoomCodeLength}}$`,
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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

    // Everything else is the static page built into dist/.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
