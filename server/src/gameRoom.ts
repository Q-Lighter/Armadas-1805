// One Durable Object per room code. It owns the world, ticks it 10 times a
// second and sends each player an update 5 times a second.
//
// Clients only ever send sail-to orders. The world itself never leaves this
// object except through visibleStateFor().

import { settings } from "@naval/shared/settings";
import {
  addPlayer,
  applyOrder,
  createWorld,
  stepWorld,
  visibleStateFor,
  type World,
} from "@naval/shared/world";

const playerIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

export class GameRoom {
  private readonly world: World = createWorld();
  private readonly sockets = new Map<string, WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket expected", { status: 426 });
    }

    const playerId = new URL(request.url).searchParams.get("player") ?? "";
    if (!playerIdPattern.test(playerId)) {
      return new Response("Player id must be letters, numbers, dash or underscore.", {
        status: 400,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    // A new player gets a flagship; a returning id keeps its ship.
    addPlayer(this.world, playerId);

    const previous = this.sockets.get(playerId);
    if (previous) {
      try {
        previous.close(4000, "replaced");
      } catch {
        // The old socket may already be closed.
      }
    }

    this.sockets.set(playerId, server);
    server.addEventListener("message", (event) => this.onMessage(playerId, event.data));
    server.addEventListener("close", () => {
      if (this.sockets.get(playerId) === server) {
        this.sockets.delete(playerId);
      }
    });

    this.startTicking();
    this.sendState(playerId, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Start the 10 Hz world loop once for the room. */
  private startTicking(): void {
    if (this.timer !== null) return;

    const tickMs = 1000 / settings.server.tickHz;
    const gameSecondsPerTick = settings.time.sailingTimeScale / settings.server.tickHz;
    const broadcastEvery = Math.max(
      1,
      Math.round(settings.server.tickHz / settings.server.broadcastHz),
    );

    this.timer = setInterval(() => {
      stepWorld(this.world, gameSecondsPerTick);
      this.ticks += 1;
      if (this.ticks % broadcastEvery === 0) {
        this.broadcast();
      }
    }, tickMs);
  }

  /** Send the world to every connected player, through visibleStateFor only. */
  private broadcast(): void {
    for (const [playerId, socket] of this.sockets) {
      this.sendState(playerId, socket);
    }
  }

  private sendState(playerId: string, socket: WebSocket): void {
    try {
      socket.send(JSON.stringify(visibleStateFor(this.world, playerId)));
    } catch {
      // A dead socket is dropped; the ship stays in the world.
      this.sockets.delete(playerId);
    }
  }

  /** Orders are untrusted: parse defensively and let the shared rules check. */
  private onMessage(playerId: string, data: unknown): void {
    if (typeof data !== "string" || data.length > 200) return;

    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if (!message || typeof message !== "object") return;

    const order = message as { t?: unknown; x?: unknown; y?: unknown };
    if (order.t !== "o") return;

    applyOrder(this.world, playerId, order.x, order.y);
  }
}
