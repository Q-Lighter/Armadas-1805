// One Durable Object per room code. It owns the world, ticks it 10 times a
// second and sends each player an update 5 times a second.
//
// Clients only ever send sail-to orders. The world itself never leaves this
// object except through visibleStateFor().

import { settings } from "@naval/shared/settings";
import { botCountForRoom, botShipCount } from "@naval/shared/bots";
import { LoadMetrics } from "@naval/shared/load-metrics";
import {
  addBotFleets,
  addPlayer,
  applyOrder,
  createWorld,
  stepWorld,
  takeNotice,
  visibleStateFor,
  type NoticeMessage,
  type World,
} from "@naval/shared/world";
import { RoomLoop } from "@naval/shared/room-loop";
import { CHART_BLOCKS } from "./chartBlocks.js";

const playerIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

export class GameRoom {
  private world: World = createWorld();
  private readonly sockets = new Map<string, WebSocket>();
  private ticks = 0;
  private readonly metrics = new LoadMetrics();
  private readonly loop = new RoomLoop(
    () => this.tick(),
    1000 / settings.server.tickHz,
    {
      every: (callback, milliseconds) => setInterval(callback, milliseconds),
      cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    },
  );

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket expected", { status: 426 });
    }

    const url = new URL(request.url);
    const room = url.searchParams.get("room") ?? this.world.roomCode;
    if (room !== this.world.roomCode) this.world = createWorld(room);

    const playerId = url.searchParams.get("player") ?? "";
    if (!playerIdPattern.test(playerId)) {
      return new Response("Player id must be letters, numbers, dash or underscore.", {
        status: 400,
      });
    }

    // TEMP-DEBUG: only a dev room accepts bots, and the range is strict.
    const botCount = botCountForRoom(room, url.searchParams.get("bots"));
    if (botCount === null) {
      return new Response("Bot count must be a whole number from 1 to 300.", {
        status: 400,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    // A new player gets a flagship; a returning id keeps its ship.
    addPlayer(this.world, playerId);

    // TEMP-DEBUG: create the fake fleets once, after the first human exists.
    if (botCount > 0 && this.world.botFleets.size === 0) {
      addBotFleets(this.world, botCount, playerId);
    }

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
        this.stopWhenEmpty();
      }
    });

    if (!this.loop.running) this.metrics.reset(Date.now());
    this.loop.start();
    this.sendState(playerId, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** One 10 Hz world update. The RoomLoop only calls this while occupied. */
  private tick(): void {
    const now = Date.now();
    this.metrics.noteTick(now);
    const gameSecondsPerTick = settings.time.sailingTimeScale / settings.server.tickHz;
    const broadcastEvery = Math.max(
      1,
      Math.round(settings.server.tickHz / settings.server.broadcastHz),
    );

    stepWorld(this.world, gameSecondsPerTick);
    this.ticks += 1;
    if (this.ticks % broadcastEvery === 0) {
      this.broadcast();
    }
  }

  /** Stop the world timer as soon as the room has no players. */
  private stopWhenEmpty(): void {
    if (this.sockets.size === 0) this.loop.stop();
  }

  /** Send the world to every connected player, through visibleStateFor only. */
  private broadcast(): void {
    for (const [playerId, socket] of this.sockets) {
      this.sendState(playerId, socket);
    }

    // TEMP-DEBUG: build the same full updates a human would receive, for every
    // fake owner, and throw the bytes away. Nothing here is sent to a socket.
    if (this.world.kind === "dev" && this.world.botFleets.size > 0) {
      const now = Date.now();
      for (const ownerId of this.world.botFleets.keys()) {
        const update = visibleStateFor(this.world, ownerId, CHART_BLOCKS);
        this.metrics.notePlayerUpdate(
          ownerId,
          JSON.stringify(update).length,
          now,
        );
      }
    }
  }

  private sendState(playerId: string, socket: WebSocket): void {
    try {
      const state = visibleStateFor(this.world, playerId, CHART_BLOCKS);
      // TEMP-DEBUG: dev rooms carry the live load-test counters.
      if (this.world.kind === "dev") {
        state.d = this.metrics.snapshot(
          this.world.players.size + botShipCount(this.world),
          Date.now(),
        );
      }
      socket.send(JSON.stringify(state));

      // Notices are short events, not world state, so they travel separately.
      const notice = takeNotice(this.world, playerId);
      if (notice) {
        const message: NoticeMessage = { t: "n", text: notice };
        socket.send(JSON.stringify(message));
      }
    } catch {
      // A dead socket is dropped; the ship stays in the world. The room pauses
      // if that was the last player, so it can go to sleep.
      this.sockets.delete(playerId);
      this.stopWhenEmpty();
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
