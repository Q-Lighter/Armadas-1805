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
  acceptShipSurrender,
  giveSpareShips,
  resetTestRoom,
  resignPlayer,
  setPlayerName,
  sinkPlayerFlagship,
  boardingOddsFor,
  cancelBoarding,
  chooseCapturedCrew,
  claimPlayerShip,
  handOverPrisoners,
  orderBoarding,
  setAutoBoard,
  setFleetAutoBoard,
  spawnTestAbandoned,
  setTestEnemyCrew,
  setTestFire,
  transferPlayerCrew,
  cancelShipSurrender,
  setFleetBattleOrder,
  setShipBattleOrder,
  applyFleetOrder,
  applyOrder,
  applyPortOrder,
  applyShipSpecialOrder,
  battleZoneVisibleFor,
  createPlayerFleet,
  detachPlayerShip,
  buyGoods,
  buyShip,
  createWorld,
  hireCrew,
  disbandPlayerFleet,
  removePlayer,
  removeTestDummies,
  refillPlayerShips,
  spawnTestEnemies,
  rejoinPlayerShip,
  requestChartResume,
  resupplyShip,
  savePlayerControlGroup,
  selectShip,
  sellGoods,
  shipClassForRoom,
  repairAtPort,
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
import { chooseJoinNavy, chooseTeamNavy, parseDummyBehaviour, type DummyBehaviour } from "@naval/shared/test-setup";
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
    let enemyNavy: NavyId | null = null;
    let dummy: DummyBehaviour = "fights";
    let abandonedSpec: string | null = null;
    let enemyCrewPercent: number | null = null;
    let displayName: string | null = null;
    let teamJoin = false;
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

      const rawEnemyNavy = url.searchParams.get("enemynavy");
      if (rawEnemyNavy !== null) {
        enemyNavy = parseNavy(rawEnemyNavy);
        if (!enemyNavy) {
          return new Response("Enemy navy must be british, french, spanish or dutch.", {
            status: 400,
          });
        }
      }

      const parsedDummy = parseDummyBehaviour(url.searchParams.get("dummy"));
      if (parsedDummy === null) {
        return new Response("Dummy must be passive, fights, runs or surrenders.", {
          status: 400,
        });
      }
      dummy = parsedDummy;

      const rawName = url.searchParams.get("name");
      if (rawName !== null) {
        if (!/^[A-Za-z0-9 _-]{1,20}$/.test(rawName.trim())) {
          return new Response("Name must be 1 to 20 letters, numbers, spaces, dash or underscore.", {
            status: 400,
          });
        }
        displayName = rawName.trim();
      }
      const rawTeam = url.searchParams.get("team");
      if (rawTeam !== null) {
        if (rawTeam !== "0" && rawTeam !== "1") {
          return new Response("Team must be 0 or 1.", { status: 400 });
        }
        teamJoin = rawTeam === "1";
      }
      const rawAbandoned = url.searchParams.get("abandoned");
      if (rawAbandoned !== null) {
        if (!/^[a-zA-Z]+:\d+(?:,[a-zA-Z]+:\d+)*$/.test(rawAbandoned)) {
          return new Response("Abandoned must look like frigate:1,line:1.", { status: 400 });
        }
        abandonedSpec = rawAbandoned;
      }
      const rawEnemyCrew = url.searchParams.get("enemycrew");
      if (rawEnemyCrew !== null) {
        if (!/^\d{1,3}$/.test(rawEnemyCrew) || Number(rawEnemyCrew) > 100) {
          return new Response("Enemy crew must be a whole percent from 0 to 100.", { status: 400 });
        }
        enemyCrewPercent = Number(rawEnemyCrew);
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
    // In a test room, two devices may not both take the same navy: the second
    // gets the next navy in the fixed order and is told why.
    this.ghosts.reconnected(playerId);
    const returning = this.world.players.has(playerId);
    const takenNavies = [...this.world.players.values()].map((ship) => ship.navy);
    const chosen = returning
      ? { navy: this.world.players.get(playerId)!.navy, changed: false }
      : teamJoin && kind !== "normal"
        ? chooseTeamNavy(navy, [...this.world.playerRecords.values()])
        : chooseJoinNavy(navy, takenNavies);
    addPlayer(
      this.world,
      playerId,
      shipClass ?? shipClassForRoom(room),
      startMoney ?? this.world.startMoney,
      chosen.navy,
    );
    if (chosen.changed) {
      // The gameRoom imports the shared notice helper separately below.
      this.world.notices.set(playerId, [
        ...(this.world.notices.get(playerId) ?? []),
        `Same navy requested: you are ${chosen.navy}.`,
      ]);
    }
    if (displayName) setPlayerName(this.world, playerId, displayName);
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
      if (spawnTestEnemyFleet(this.world, playerId, rawEnemy, {
        navy: enemyNavy ?? undefined,
        dummy,
      }) < 0) {
        return new Response("Enemy must look like frigate:2,line:1 with at most 6 ships.", {
          status: 400,
        });
      }
    }
    if (abandonedSpec !== null && kind !== "normal") {
      if (spawnTestAbandoned(this.world, playerId, abandonedSpec) < 0) {
        return new Response("Abandoned must look like frigate:1,line:1.", { status: 400 });
      }
    }
    if (enemyCrewPercent !== null && kind !== "normal") {
      setTestEnemyCrew(this.world, enemyCrewPercent);
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
    const regular = this.ticks % broadcastEvery === 0;
    const battleEvery = Math.max(
      1,
      Math.round(settings.server.tickHz / settings.combat.battleSendRate),
    );
    const battleNow = this.ticks % battleEvery === 0;
    // A player who can see an engaged pair gets the battle-zone rate. Other
    // players keep the unchanged 5 Hz rate.
    this.broadcast(regular, battleNow);
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
  private broadcast(regular: boolean, battleNow: boolean): void {
    for (const [playerId, socket] of this.sockets.entries()) {
      if (regular || (battleNow && battleZoneVisibleFor(this.world, playerId))) {
        this.sendState(playerId, socket);
      }
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
      mode?: unknown;
      target?: unknown;
      donor?: unknown;
      receiver?: unknown;
      choice?: unknown;
      prisoners?: unknown;
      confirm?: unknown;
      to?: unknown;
    };

    if (this.world.gameOver && order.t !== "resetRoom") return;

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
    } else if (order.t === "portRepair") {
      repairAtPort(this.world, playerId, order.ship, order.port, order.mode);
    } else if (order.t === "spawnEnemies") {
      const classId = typeof order.type === "string" ? parseShipClass(order.type) : null;
      const chosenNavy = typeof order.name === "string" ? parseNavy(order.name) : null;
      const behaviour = parseDummyBehaviour(typeof order.mode === "string" ? order.mode : null);
      const count = typeof order.count === "number" ? order.count : 0;
      if (classId && chosenNavy && behaviour) {
        spawnTestEnemies(this.world, playerId, classId, chosenNavy, count, behaviour);
      }
    } else if (order.t === "removeEnemies") {
      removeTestDummies(this.world);
    } else if (order.t === "refillShips") {
      refillPlayerShips(this.world, playerId);
    } else if (order.t === "sinkFlagship" && this.world.kind !== "normal") {
      sinkPlayerFlagship(this.world, playerId);
    } else if (order.t === "spareShips" && this.world.kind !== "normal") {
      giveSpareShips(this.world, playerId, 3);
    } else if (order.t === "resetRoom" && this.world.kind !== "normal") {
      this.world = resetTestRoom(this.world);
      this.ghosts.clear();
    } else if (order.t === "resign") {
      const to = typeof order.to === "string" ? order.to : null;
      resignPlayer(this.world, playerId, to);
    } else if (order.t === "battleOrder") {
      setShipBattleOrder(this.world, playerId, order.ship, order.order);
    } else if (order.t === "fleetBattleOrder") {
      setFleetBattleOrder(this.world, playerId, order.fleet, order.order);
    } else if (order.t === "acceptSurrender") {
      acceptShipSurrender(this.world, playerId, order.ship);
    } else if (order.t === "cancelSurrender") {
      cancelShipSurrender(this.world, playerId, order.ship);
    } else if (order.t === "board") {
      const odds = boardingOddsFor(this.world, playerId, order.ship, order.target);
      if (order.confirm !== true) {
        const socket = this.sockets.get(playerId);
        if (socket && odds !== null) {
          socket.send(JSON.stringify({
            t: "boardOdds",
            target: order.target,
            odds: Math.round(odds * 20) * 5,
          }));
        }
      } else if (odds !== null) {
        orderBoarding(this.world, playerId, order.ship, order.target);
      }
    } else if (order.t === "cancelBoard") {
      cancelBoarding(this.world, playerId, order.ship);
    } else if (order.t === "autoBoard") {
      setAutoBoard(this.world, playerId, order.ship, order.enabled);
    } else if (order.t === "fleetAutoBoard") {
      setFleetAutoBoard(this.world, playerId, order.fleet, order.enabled);
    } else if (order.t === "crewTransfer") {
      transferPlayerCrew(this.world, playerId, order.donor, order.receiver, order.amount);
    } else if (order.t === "claim") {
      claimPlayerShip(this.world, playerId, order.ship, order.donor);
    } else if (order.t === "capturedCrew") {
      chooseCapturedCrew(this.world, playerId, order.ship, order.choice, typeof order.prisoners === "number" ? order.prisoners : 0);
    } else if (order.t === "handOverPrisoners") {
      handOverPrisoners(this.world, playerId, order.ship, order.port);
    } else if (order.t === "spawnAbandoned" && this.world.kind !== "normal") {
      if (typeof order.type === "string") spawnTestAbandoned(this.world, playerId, order.type);
    } else if (order.t === "setEnemyCrew" && this.world.kind !== "normal") {
      if (typeof order.count === "number") setTestEnemyCrew(this.world, order.count);
    } else if (order.t === "setFire" && this.world.kind !== "normal") {
      setTestFire(this.world, playerId, order.ship);
    }
  }
}
