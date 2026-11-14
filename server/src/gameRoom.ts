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
  attackPort,
  buildPortFortification,
  fillTestPortStock,
  finishTestPortBuild,
  setTestPortHealth,
  setTestPortOwner,
  setTestPortTier,
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
  spawnTestFireShips,
  spawnTestAnchoredFleet,
  setTestTimeOfDay,
  orderFireShipIgnite,
  orderTowFireShip,
  cancelFireShipContact,
  castOffTow,
  setShipLights,
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
  endPlayerJourney,
  clearPlayerTrails,
  visibleStateFor,
  battleZoneNear,
  shipsForOwner,
  type NoticeMessage,
  type StateMessage,
  type World,
} from "@naval/shared/world";
import { buildStateDelta, encodeStateDelta } from "@naval/shared/state-delta";
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
  private readonly streams = new Map<string, {
    seq: number;
    base: StateMessage | null;
    fleetAt: number;
    fullAt: number;
    forceFull: boolean;
  }>();
  private readonly focus = new Map<string, { x: number; y: number }>();
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
    let fireShipCount = 0;
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
      const rawFireShips = url.searchParams.get("fireship");
      if (rawFireShips !== null) {
        if (!/^\d{1,2}$/.test(rawFireShips) || Number(rawFireShips) > settings.testing.maxEnemySpawn) {
          return new Response("Fire ships must be a whole number from 0 to 20.", { status: 400 });
        }
        fireShipCount = Number(rawFireShips);
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
    if (kind !== "normal") {
      const rawHold = url.searchParams.get("capturehold");
      const hold = rawHold === null ? NaN : Number(rawHold);
      if (Number.isFinite(hold) && hold > 0) {
        this.world.captureHoldRealSeconds = Math.min(3_600, hold);
      }
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
    if (fireShipCount > 0 && kind !== "normal") {
      spawnTestFireShips(this.world, playerId, fireShipCount);
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
    this.streams.delete(playerId);

    if (!this.loop.running) this.metrics.reset(Date.now());
    this.loop.start();
    this.sendState(playerId, server, true);

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

    const stepStarted = performance.now();
    stepWorld(this.world, gameSecondsPerTick);
    this.metrics.noteWorldStep(performance.now() - stepStarted, now);
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
    this.streams.delete(playerId);
    this.ghosts.disconnected(playerId);
    this.stopWhenEmpty();
  }

  /** Stop the world timer as soon as the room has no players. */
  private stopWhenEmpty(): void {
    if (this.sockets.size === 0) this.loop.stop();
  }

  private bufferedBytes(socket: WebSocket): number {
    const value = (socket as unknown as { bufferedAmount?: unknown }).bufferedAmount;
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  private battleFocus(playerId: string): { x: number; y: number } | null {
    const focused = this.focus.get(playerId);
    if (focused) return focused;
    const own = shipsForOwner(this.world, playerId);
    const selectedId = this.world.owners.get(playerId)?.selectedShipId;
    const selected = selectedId ? own.find((ship) => ship.id === selectedId) : undefined;
    const fallback = selected ?? own[0];
    return fallback ? { x: fallback.x, y: fallback.y } : null;
  }

  /** Send the world to every connected player, through visibleStateFor only. */
  private broadcast(regular: boolean, battleNow: boolean): void {
    for (const [playerId, socket] of this.sockets.entries()) {
      const stream = this.streams.get(playerId);
      // A client that was skipped for backpressure gets one fresh state as
      // soon as its send buffer drains, without replaying stale snapshots.
      if (stream?.forceFull) {
        if (this.bufferedBytes(socket) <= settings.network.slowClientBufferBytes) {
          this.sendState(playerId, socket);
        }
        continue;
      }
      if (
        regular ||
        (battleNow && battleZoneNear(
          this.world,
          playerId,
          this.battleFocus(playerId),
          settings.network.battleZoneRadiusKm,
        ))
      ) {
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

  private sendState(playerId: string, socket: WebSocket, forceFull = false): void {
    try {
      const now = Date.now();
      let stream = this.streams.get(playerId);
      if (!stream) {
        stream = { seq: 0, base: null, fleetAt: 0, fullAt: 0, forceFull: true };
        this.streams.set(playerId, stream);
      }
      if (!forceFull && this.bufferedBytes(socket) > settings.network.slowClientBufferBytes) {
        stream.forceFull = true;
        return;
      }
      if (now - stream.fullAt > settings.network.fullStateEverySeconds * 1000) {
        stream.forceFull = true;
      }
      const allowed = this.blockBudget.take(now);
      const includeFleet = forceFull || stream.forceFull || stream.base === null ||
        now - stream.fleetAt >= settings.network.fleetDetailSeconds * 1000;
      const state = visibleStateFor(this.world, playerId, CHART_BLOCKS, allowed, includeFleet);
      this.blockBudget.note(state.chart.blocks.length, now);
      // TEMP-DEBUG: dev rooms carry the live load-test counters.
      if (this.world.kind === "dev") {
        state.d = this.metrics.snapshot(
          this.world.players.size + botShipCount(this.world),
          botShipCount(this.world),
          now,
        );
      }
      state.sv = this.metrics.worldStepAverage(now);
      stream.seq += 1;
      state.seq = stream.seq;
      if (forceFull || stream.forceFull || stream.base === null) {
        state.full = true;
        socket.send(JSON.stringify(state));
        stream.base = state;
        stream.fullAt = now;
        stream.fleetAt = now;
        stream.forceFull = false;
      } else {
        const delta = buildStateDelta(stream.base, state, stream.seq, includeFleet);
        const binary = encodeStateDelta(delta);
        socket.send(binary);
        stream.base = state;
      }
      if (includeFleet) stream.fleetAt = now;

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

  /** A plain-English fallback when a rejected order did not write its own. */
  private orderReason(type: unknown): string {
    switch (type) {
      case "o": return "Cannot sail there.";
      case "sailToPort": return "Cannot sail to that port.";
      case "attackPort": return "Cannot attack that port.";
      case "buildFortification": return "Cannot build there.";
      case "buy": return "That ship cannot be bought here.";
      case "hire": return "Cannot hire crew there.";
      case "buyGoods": case "sellGoods": case "load": case "unload": return "That trade is not possible.";
      case "resupply": return "Cannot resupply there.";
      case "repair": case "portRepair": return "Cannot repair that ship.";
      case "board": return "Cannot board that ship.";
      case "claim": return "Cannot claim that ship.";
      case "crewTransfer": return "Cannot move that crew.";
      case "igniteFireShip": return "That ship cannot be set alight.";
      case "cancelIgnite": return "No contact attack to cancel.";
      case "towShip": return "Cannot tow that ship.";
      case "castOff": return "No tow to cast off.";
      case "lights": return "Cannot change that ship's lights.";
      case "battleOrder": case "fleetBattleOrder": return "That battle order is not allowed.";
      case "fleetOrder": return "That fleet cannot take that order.";
      default: return "Order rejected.";
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
      id?: unknown;
      at?: unknown;
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
      on?: unknown;
      hour?: unknown;
      mode?: unknown;
      target?: unknown;
      deg?: unknown;
      knots?: unknown;
      donor?: unknown;
      receiver?: unknown;
      choice?: unknown;
      prisoners?: unknown;
      confirm?: unknown;
      to?: unknown;
      owner?: unknown;
      health?: unknown;
      tier?: unknown;
    };

    if (order.t === "ping") {
      const at = typeof order.at === "number" ? order.at : Date.now();
      this.sockets.get(playerId)?.send(JSON.stringify({ t: "pong", at }));
      return;
    }
    if (order.t === "focus" && typeof order.x === "number" && typeof order.y === "number") {
      if (Number.isFinite(order.x) && Number.isFinite(order.y)) {
        this.focus.set(playerId, { x: order.x, y: order.y });
      }
      const socket = this.sockets.get(playerId);
      if (socket) this.sendState(playerId, socket, false);
      return;
    }
    if (order.t === "resync") {
      const socket = this.sockets.get(playerId);
      if (socket) {
        const stream = this.streams.get(playerId);
        if (stream) stream.forceFull = true;
        this.sendState(playerId, socket, true);
      }
      return;
    }

    const beforeNotice = this.world.notices.get(playerId)?.at(-1);
    let accepted = true;
    let reason: string | null = null;
    const reject = (text: string): void => {
      accepted = false;
      reason = text;
      this.world.notices.set(playerId, [...(this.world.notices.get(playerId) ?? []), text]);
    };

    if (this.world.gameOver && order.t !== "resetRoom") {
      reject("The game is over.");
    } else if (this.world.playerRecords.get(playerId)?.eliminated && order.t !== "resetRoom") {
      reject("You are eliminated and can only reset the room.");
    } else if (order.t === "o") {
      accepted = applyOrder(this.world, playerId, order.x, order.y, order.ship);
    } else if (order.t === "createFleet") {
      accepted = createPlayerFleet(this.world, playerId, order.ships, order.name) !== null;
    } else if (order.t === "fleetUpdate") {
      accepted = updatePlayerFleet(this.world, playerId, order.fleet, {
        name: order.name,
        formation: order.formation,
        stance: order.stance,
        leaderId: order.leader,
      });
    } else if (order.t === "fleetDisband") {
      accepted = disbandPlayerFleet(this.world, playerId, order.fleet);
    } else if (order.t === "fleetDetach") {
      accepted = detachPlayerShip(this.world, playerId, order.ship);
    } else if (order.t === "fleetRejoin") {
      accepted = rejoinPlayerShip(this.world, playerId, order.ship);
    } else if (order.t === "fleetOrder") {
      accepted = applyFleetOrder(this.world, playerId, order.fleet, order.order, order.queue === true);
    } else if (order.t === "shipOrder") {
      accepted = applyShipSpecialOrder(this.world, playerId, order.ship, order.order);
    } else if (order.t === "saveGroup") {
      accepted = savePlayerControlGroup(this.world, playerId, order.slot, order.ids);
    } else if (order.t === "sailToPort") {
      accepted = applyPortOrder(this.world, playerId, order.port, order.ship);
    } else if (order.t === "attackPort") {
      accepted = attackPort(this.world, playerId, order.port, order.ship);
    } else if (order.t === "fleetAttackPort" && typeof order.fleet === "string") {
      const fleet = this.world.fleetModels.get(playerId)?.get(order.fleet);
      if (!fleet) reject("That fleet does not exist.");
      else {
        accepted = false;
        for (const id of fleet.members) {
          if (this.world.portAttackTargets.has(id)) continue;
          accepted = attackPort(this.world, playerId, order.port, id, true) || accepted;
        }
        if (!accepted) reject("None of that fleet can attack this port.");
      }
    } else if (order.t === "buildFortification") {
      accepted = buildPortFortification(this.world, playerId, order.port);
    } else if (order.t === "testPort" && this.world.kind !== "normal") {
      if (typeof order.port !== "string") return;
      if (typeof order.owner === "string") {
        setTestPortOwner(this.world, playerId, order.port, order.owner);
      }
      if (typeof order.health === "number") {
        setTestPortHealth(this.world, order.port, order.health);
      }
      if (typeof order.tier === "number") {
        setTestPortTier(this.world, order.port, order.tier);
      }
      if (order.mode === "finishBuild") finishTestPortBuild(this.world, order.port);
      if (order.mode === "fillStock") fillTestPortStock(this.world, order.port);
    } else if (order.t === "undock") {
      accepted = undock(this.world, playerId, order.ship);
    } else if (order.t === "endJourney") {
      if (typeof order.ship === "string") accepted = endPlayerJourney(this.world, playerId, order.ship);
    } else if (order.t === "clearTrails") {
      clearPlayerTrails(this.world, playerId);
    } else if (order.t === "routeLine") {
      const owner = this.world.owners.get(playerId);
      if (owner && typeof order.enabled === "boolean") {
        owner.routeLineEnabled = order.enabled;
        if (!order.enabled) this.world.routePredictions.clear();
        const socket = this.sockets.get(playerId);
        if (socket) this.sendState(playerId, socket, false);
      }
    } else if (order.t === "testWind" && this.world.kind !== "normal") {
      const deg = typeof order.deg === "number" ? order.deg : NaN;
      const knots = typeof order.knots === "number" ? order.knots : NaN;
      if (Number.isFinite(deg)) {
        this.world.windFromDeg = ((deg % 360) + 360) % 360;
      }
      if (Number.isFinite(knots)) {
        this.world.windSpeedKnots = Math.max(
          settings.weather.minStrengthKnots,
          Math.min(settings.weather.maxStrengthKnots, knots),
        );
      }
      this.world.routePredictions.clear();
    } else if (order.t === "select") {
      accepted = selectShip(this.world, playerId, order.ship);
    } else if (order.t === "buy") {
      accepted = buyShip(this.world, playerId, order.port, order.type, order.name) !== null;
    } else if (order.t === "hire") {
      accepted = hireCrew(this.world, playerId, order.ship, order.port, order.count);
    } else if (order.t === "buyGoods") {
      accepted = buyGoods(this.world, playerId, order.ship, order.port, order.good, order.amount);
    } else if (order.t === "sellGoods") {
      accepted = sellGoods(this.world, playerId, order.ship, order.port, order.good, order.amount);
    } else if (order.t === "load") {
      accepted = transferGoods(this.world, playerId, order.ship, order.port, order.good, order.amount, "load");
    } else if (order.t === "unload") {
      accepted = transferGoods(this.world, playerId, order.ship, order.port, order.good, order.amount, "unload");
    } else if (order.t === "resupply") {
      accepted = resupplyShip(this.world, playerId, order.ship, order.port);
    } else if (order.t === "repair") {
      accepted = setPlayerRepair(this.world, playerId, order.ship, order.enabled);
    } else if (order.t === "portRepair") {
      accepted = repairAtPort(this.world, playerId, order.ship, order.port, order.mode);
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
      for (const stream of this.streams.values()) stream.forceFull = true;
    } else if (order.t === "resign") {
      const to = typeof order.to === "string" ? order.to : null;
      resignPlayer(this.world, playerId, to);
    } else if (order.t === "battleOrder") {
      accepted = setShipBattleOrder(this.world, playerId, order.ship, order.order);
    } else if (order.t === "fleetBattleOrder") {
      accepted = setFleetBattleOrder(this.world, playerId, order.fleet, order.order);
    } else if (order.t === "acceptSurrender") {
      accepted = acceptShipSurrender(this.world, playerId, order.ship);
    } else if (order.t === "cancelSurrender") {
      accepted = cancelShipSurrender(this.world, playerId, order.ship);
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
        accepted = orderBoarding(this.world, playerId, order.ship, order.target);
      } else {
        reject("Target is not an enemy ship.");
      }
    } else if (order.t === "cancelBoard") {
      accepted = cancelBoarding(this.world, playerId, order.ship);
    } else if (order.t === "autoBoard") {
      accepted = setAutoBoard(this.world, playerId, order.ship, order.enabled);
    } else if (order.t === "fleetAutoBoard") {
      accepted = setFleetAutoBoard(this.world, playerId, order.fleet, order.enabled);
    } else if (order.t === "crewTransfer") {
      accepted = transferPlayerCrew(this.world, playerId, order.donor, order.receiver, order.amount);
    } else if (order.t === "claim") {
      accepted = claimPlayerShip(this.world, playerId, order.ship, order.donor);
    } else if (order.t === "capturedCrew") {
      accepted = chooseCapturedCrew(this.world, playerId, order.ship, order.choice, typeof order.prisoners === "number" ? order.prisoners : 0);
    } else if (order.t === "handOverPrisoners") {
      accepted = handOverPrisoners(this.world, playerId, order.ship, order.port);
    } else if (order.t === "spawnAbandoned" && this.world.kind !== "normal") {
      if (typeof order.type === "string") spawnTestAbandoned(this.world, playerId, order.type);
    } else if (order.t === "setEnemyCrew" && this.world.kind !== "normal") {
      if (typeof order.count === "number") setTestEnemyCrew(this.world, order.count);
    } else if (order.t === "setFire" && this.world.kind !== "normal") {
      setTestFire(this.world, playerId, order.ship);
    } else if (order.t === "igniteFireShip") {
      accepted = orderFireShipIgnite(this.world, playerId, order.ship, order.mode,
        typeof order.target === "string" ? order.target : undefined);
    } else if (order.t === "cancelIgnite") {
      accepted = cancelFireShipContact(this.world, playerId, order.ship);
    } else if (order.t === "towShip") {
      accepted = orderTowFireShip(this.world, playerId, order.ship, order.target);
    } else if (order.t === "castOff") {
      accepted = castOffTow(this.world, playerId, order.ship);
    } else if (order.t === "lights") {
      accepted = setShipLights(this.world, playerId, order.ship, order.on);
    } else if (order.t === "testAnchoredFleet" && this.world.kind !== "normal") {
      const stance = order.stance === "engage" ? "engage" : "fightIfAttacked";
      spawnTestAnchoredFleet(this.world, playerId, stance);
    } else if (order.t === "testTimeOfDay" && this.world.kind !== "normal") {
      if (typeof order.hour === "number") setTestTimeOfDay(this.world, order.hour);
    }

    if (!accepted) {
      const latest = this.world.notices.get(playerId)?.at(-1);
      if (latest && latest !== beforeNotice) reason = latest;
      reason ??= this.orderReason(order.t);
    }
    if (typeof order.id === "string" && order.id.length <= 80) {
      this.sockets.get(playerId)?.send(JSON.stringify({
        t: "ack",
        id: order.id,
        ok: accepted,
        text: reason ?? undefined,
      }));
    }
  }
}
