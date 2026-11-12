// One Durable Object per room code. It owns the world, ticks it 10 times a
// second and sends each player an update 5 times a second.
//
// Clients only ever send sail-to orders. The world itself never leaves this
// object except through visibleStateFor().

import { settings } from "@naval/shared/settings";
import { botCountForRoom, botShipCount, setBotCount } from "@naval/shared/bots";
import { LoadMetrics } from "@naval/shared/load-metrics";
import {
  addPlayer,
  applyFleetOrder,
  applyOrder,
  applyPortOrder,
  applyShipSpecialOrder,
  createPlayerFleet,
  detachPlayerShip,
  buyGoods,
  buyShip,
  createWorld,
  hireCrew,
  disbandPlayerFleet,
  removePlayer,
  rejoinPlayerShip,
  requestChartResume,
  resupplyShip,
  savePlayerControlGroup,
  selectShip,
  sellGoods,
  shipClassForRoom,
  setPlayerRepair,
  spawnTestEnemyFleet,
  spawnTestFleet,
  stepWorld,
  updatePlayerFleet,
  takeNotice,
  transferGoods,
  undock,
  visibleStateFor,
  type NoticeMessage,
  type World,
} from "@naval/shared/world";
import { RoomLoop } from "@naval/shared/room-loop";
import { GhostCleanup, PlayerSessions } from "@naval/shared/player-sessions";
import { BlockSendBudget } from "@naval/shared/block-batch";
import { findPortByName, type PlacedPort } from "@naval/shared/ports";
import { parseNavy, type NavyId } from "@naval/shared/navies";
import { parseShipClass } from "@naval/shared/ship-rules";
import type { ShipClassId } from "@naval/shared/ships";
import { roomKindForCode } from "@naval/shared/fog";
import { CHART_BLOCKS } from "./chartBlocks.js";

const playerIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

export class GameRoom {
  private world: World = createWorld();
  private readonly sockets = new PlayerSessions<WebSocket>();
  private ticks = 0;
  private readonly metrics = new LoadMetrics();
  private readonly blockBudget = new BlockSendBudget(
    settings.fog.blockBatchPerSecond,
    settings.fog.maxBlocksPerMessage,
  );
  private readonly ghosts = new GhostCleanup(
    () => this.world.kind,
    () => settings.players.ghostRemoveAfterSeconds * 1000,
    (playerId) => {
      removePlayer(this.world, playerId);
    },
    {
      schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  );
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
    const kind = roomKindForCode(room);

    let navy: NavyId = "British";
    let startPort: PlacedPort | null = null;
    let shipClass: ShipClassId | null = null;
    let startMoney: number | undefined;
    let hungerMultiplier: number | undefined;
    if (kind !== "normal") {
      const rawNavy = url.searchParams.get("navy");
      if (rawNavy !== null) {
        const parsed = parseNavy(rawNavy);
        if (!parsed) {
          return new Response("Navy must be british, dutch, spanish or french.", {
            status: 400,
          });
        }
        navy = parsed;
      }

      const rawStart = url.searchParams.get("start");
      if (rawStart !== null) {
        startPort = findPortByName(rawStart);
        if (!startPort) {
          return new Response("Start must name a placed port.", { status: 400 });
        }
      }

      const rawShip = url.searchParams.get("ship");
      if (rawShip !== null) {
        shipClass = parseShipClass(rawShip);
        if (!shipClass) {
          return new Response("Ship must be flagship, line, frigate, escort, raider or trade.", {
            status: 400,
          });
        }
      }

      const rawCash = url.searchParams.get("cash");
      if (rawCash !== null) {
        if (!/^\d{1,9}$/.test(rawCash)) {
          return new Response("Cash must be a whole number from 0 to 999999999.", {
            status: 400,
          });
        }
        startMoney = Number(rawCash);
      }

      const rawHunger = url.searchParams.get("hunger");
      if (rawHunger !== null) {
        if (!/^\d{1,4}(?:\.\d{1,3})?$/.test(rawHunger)) {
          return new Response(
            `Hunger must be a number from 0 to ${settings.trade.maxTestHungerMultiplier}.`,
            { status: 400 },
          );
        }
        const parsed = Number(rawHunger);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > settings.trade.maxTestHungerMultiplier) {
          return new Response(
            `Hunger must be a number from 0 to ${settings.trade.maxTestHungerMultiplier}.`,
            { status: 400 },
          );
        }
        hungerMultiplier = parsed;
      }
    }

    if (room !== this.world.roomCode) {
      this.ghosts.clear();
      this.world = createWorld(room, {
        navy,
        startPort,
        shipClass: shipClass ?? undefined,
        startMoney,
        hungerMultiplier,
      });
    }

    const playerId = url.searchParams.get("player") ?? "";
    if (!playerIdPattern.test(playerId)) {
      return new Response("Player id must be letters, numbers, dash or underscore.", {
        status: 400,
      });
    }

    // TEMP-DEBUG: a dev room accepts bots=0..300 on every join. An absent
    // value leaves the room's current bot count alone.
    const rawBots = url.searchParams.get("bots");
    const botCount = rawBots === null ? null : botCountForRoom(room, rawBots);
    if (rawBots !== null && botCount === null) {
      return new Response("Bot count must be a whole number from 0 to 300.", {
        status: 400,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    // A new player gets the room's first ship; a returning id keeps its fleet.
    this.ghosts.reconnected(playerId);
    addPlayer(
      this.world,
      playerId,
      shipClass ?? shipClassForRoom(room),
      startMoney ?? this.world.startMoney,
    );
    const rawFleet = url.searchParams.get("fleet");
    if (kind !== "normal" && rawFleet !== null) {
      if (spawnTestFleet(this.world, playerId, rawFleet) < 0) {
        return new Response("Fleet must look like frigate:4,trade:3,line:1.", {
          status: 400,
        });
      }
    }
    const rawEnemy = url.searchParams.get("enemy");
    if (kind !== "normal" && rawEnemy !== null) {
      if (spawnTestEnemyFleet(this.world, playerId, rawEnemy) < 0) {
        return new Response("Enemy must look like frigate:2,line:1.", {
          status: 400,
        });
      }
    }
    // A refresh, a new tab or a reconnect starts with an empty client chart.
    // Replay the stored record and all block geometry before normal changes.
    requestChartResume(this.world, playerId);

    // TEMP-DEBUG: every join with bots=N sets the target count. This is what
    // lets a second tab change 25 bots to 50, or 100 bots down to 10.
    if (botCount !== null) {
      setBotCount(this.world, botCount, playerId);
    }

    server.addEventListener("message", (event) => this.onMessage(playerId, event.data));
    server.addEventListener("close", () => this.dropSocket(playerId, server));

    // The newest connection owns this id. Adding it first means the old
    // socket's close event cannot remove the new one.
    this.sockets.add(playerId, server);

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

  /** Drop one socket and, in test/dev rooms, schedule its ship's removal. */
  private dropSocket(playerId: string, socket: WebSocket): void {
    if (!this.sockets.remove(playerId, socket)) return;
    this.ghosts.disconnected(playerId);
    this.stopWhenEmpty();
  }

  /** Stop the world timer as soon as the room has no players. */
  private stopWhenEmpty(): void {
    if (this.sockets.size === 0) this.loop.stop();
  }

  /** Send the world to every connected player, through visibleStateFor only. */
  private broadcast(): void {
    for (const [playerId, socket] of this.sockets.entries()) {
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
      const now = Date.now();
      const allowed = this.blockBudget.take(now);
      const state = visibleStateFor(this.world, playerId, CHART_BLOCKS, allowed);
      this.blockBudget.note(state.chart.blocks.length, now);
      // TEMP-DEBUG: dev rooms carry the live load-test counters.
      if (this.world.kind === "dev") {
        state.d = this.metrics.snapshot(
          this.world.players.size + botShipCount(this.world),
          botShipCount(this.world),
          now,
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
      // A dead socket is dropped. Test and dev rooms remove its ship after
      // the disconnect delay; normal rooms keep it in the world.
      this.dropSocket(playerId, socket);
    }
  }

  /** Orders are untrusted: parse defensively and let the shared rules check. */
  private onMessage(playerId: string, data: unknown): void {
    if (typeof data !== "string" || data.length > 4_000) return;

    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if (!message || typeof message !== "object") return;

    const order = message as {
      t?: unknown;
      x?: unknown;
      y?: unknown;
      port?: unknown;
      ship?: unknown;
      type?: unknown;
      name?: unknown;
      count?: unknown;
      good?: unknown;
      amount?: unknown;
      fleet?: unknown;
      ships?: unknown;
      formation?: unknown;
      stance?: unknown;
      leader?: unknown;
      order?: unknown;
      queue?: unknown;
      slot?: unknown;
      ids?: unknown;
      enabled?: unknown;
    };

    if (order.t === "o") {
      applyOrder(this.world, playerId, order.x, order.y, order.ship);
    } else if (order.t === "createFleet") {
      createPlayerFleet(this.world, playerId, order.ships, order.name);
    } else if (order.t === "fleetUpdate") {
      updatePlayerFleet(this.world, playerId, order.fleet, {
        name: order.name,
        formation: order.formation,
        stance: order.stance,
        leaderId: order.leader,
      });
    } else if (order.t === "fleetDisband") {
      disbandPlayerFleet(this.world, playerId, order.fleet);
    } else if (order.t === "fleetDetach") {
      detachPlayerShip(this.world, playerId, order.ship);
    } else if (order.t === "fleetRejoin") {
      rejoinPlayerShip(this.world, playerId, order.ship);
    } else if (order.t === "fleetOrder") {
      applyFleetOrder(this.world, playerId, order.fleet, order.order, order.queue === true);
    } else if (order.t === "shipOrder") {
      applyShipSpecialOrder(this.world, playerId, order.ship, order.order);
    } else if (order.t === "saveGroup") {
      savePlayerControlGroup(this.world, playerId, order.slot, order.ids);
    } else if (order.t === "sailToPort") {
      applyPortOrder(this.world, playerId, order.port, order.ship);
    } else if (order.t === "undock") {
      undock(this.world, playerId, order.ship);
    } else if (order.t === "select") {
      selectShip(this.world, playerId, order.ship);
    } else if (order.t === "buy") {
      buyShip(this.world, playerId, order.port, order.type, order.name);
    } else if (order.t === "hire") {
      hireCrew(this.world, playerId, order.ship, order.port, order.count);
    } else if (order.t === "buyGoods") {
      buyGoods(this.world, playerId, order.ship, order.port, order.good, order.amount);
    } else if (order.t === "sellGoods") {
      sellGoods(this.world, playerId, order.ship, order.port, order.good, order.amount);
    } else if (order.t === "load") {
      transferGoods(this.world, playerId, order.ship, order.port, order.good, order.amount, "load");
    } else if (order.t === "unload") {
      transferGoods(this.world, playerId, order.ship, order.port, order.good, order.amount, "unload");
    } else if (order.t === "resupply") {
      resupplyShip(this.world, playerId, order.ship, order.port);
    } else if (order.t === "repair") {
      setPlayerRepair(this.world, playerId, order.ship, order.enabled);
    }
  }
}
