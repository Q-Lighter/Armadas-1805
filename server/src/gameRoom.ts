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
  recordSessionNote,
  recordWorldEvent,
  resignPlayer,
  sessionReportFor,
  scenarioStatusFor,
  endTestScenario,
  rateTestScenario,
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
  setShipStance,
  applyFleetOrder,
  applyOrder,
  applyPortOrder,
  applyShipSpecialOrder,
  attackPort,
  buildPortFortification,
  fillTestPortStock,
  fitAllDockedShips,
  fitShipUpgrades,
  giveResearchUnits,
  researchUpgradeOrder,
  resetNavyResearch,
  setCapturePoints,
  unlockAllResearch,
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
  hirePrivateer,
  lootNpcShip,
  setPrivateerMode,
  disbandPlayerFleet,
  dropAnchor,
  weighAnchor,
  removePlayer,
  removeTestDummies,
  refillPlayerShips,
  spawnTestEnemies,
  spawnTestFireShips,
  spawnTestAnchoredFleet,
  setTestTimeOfDay,
  setTestMoonPhase,
  orderFireShipIgnite,
  orderTowFireShip,
  cancelFireShipContact,
  castOffTow,
  setShipLights,
  rejoinPlayerShip,
  movePlayerFleetMember,
  updateFleetQueue,
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
  startLobbyGame,
  spawnRouteHelper,
  setTradeRoute,
  cancelTradeRoute,
  runTradeRoutesFast,
  updatePortIncome,
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
import {
  battleRateFor,
  dueAtRate,
  holdFarShips,
  parseNetworkPreference,
  type NetworkPreference,
} from "@naval/shared/net-rate";
import { RoomLoop } from "@naval/shared/room-loop";
import { GhostCleanup, PlayerSessions } from "@naval/shared/player-sessions";
import { BlockSendBudget } from "@naval/shared/block-batch";
import { findPortByName, type PlacedPort } from "@naval/shared/ports";
import { startTestScenario } from "@naval/shared/scenarios";
import { parseNavy, type NavyId } from "@naval/shared/navies";
import {
  addLobbyPlayer,
  canStartLobby,
  findLobbyPlayer,
  isJoinCode,
  isLobbyHost,
  lobbyPlayerForAccount,
  lobbySnapshot,
  lobbyStartPlayers,
  lobbyStartReason,
  newLobby,
  removeLobbyPlayer,
  setLobbyFlagshipName,
  setLobbyNavy,
  setLobbyReady,
  type Lobby,
  type LobbyResult,
} from "@naval/shared/lobby";
import { chooseJoinNavy, chooseTeamNavy, parseDummyBehaviour, type DummyBehaviour } from "@naval/shared/test-setup";
import { parseShipClass } from "@naval/shared/ship-rules";
import type { ShipClassId } from "@naval/shared/ships";
import { roomKindForCode } from "@naval/shared/fog";
import { CHART_BLOCKS } from "./chartBlocks.js";
import { authenticate, type SupabaseEnv } from "./accountAuth.js";

const playerIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

/** The same code the client uses for "another tab has this ship". */
const TAKEN_OVER_CLOSE_CODE = 4001;
/** A lobby player was removed by the host, or the lobby closed. */
const LOBBY_CLOSED_CLOSE_CODE = 4002;

interface LobbyStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm?(scheduledTime: number): Promise<void>;
}

interface RoomState {
  storage?: LobbyStorage;
  blockConcurrencyWhile?(callback: () => Promise<void>): unknown;
}

export interface RoomEnv extends SupabaseEnv {
  LOBBY_DIRECTORY?: DurableObjectNamespace;
}

interface RoomConnection {
  accountId: string;
  name: string;
  mode: "lobby" | "game" | "spectator";
  /** The world id this socket controls. Empty in the lobby. */
  playerId: string;
  /** The lobby slot id while in the lobby. */
  slotId: string;
}

interface TakeoverRequest {
  id: string;
  accountId: string;
  name: string;
  targetSlot: string;
  atMs: number;
}

function randomSlotId(): string {
  const uuid = (globalThis as unknown as { crypto?: { randomUUID?: () => string } })
    .crypto?.randomUUID?.();
  if (uuid) return `p${uuid.replace(/-/g, "").slice(0, 12)}`;
  return `p${Math.random().toString(36).slice(2, 12)}`;
}

/** Close any socket opened by a join that failed after the upgrade. */
function teardownJoin(response: Response, server: WebSocket): void {
  try {
    server.send(JSON.stringify({ t: "authError", text: "Could not join this room." }));
    server.close(4401, response.statusText || "Could not join this room.");
  } catch {
    // The socket may already be closing.
  }
}

export class GameRoom {
  private world: World = createWorld("main", { npcs: true });
  private readonly env: RoomEnv;
  private readonly storage?: LobbyStorage;
  /** The lobby for this room code, kept across a Durable Object restart. */
  private lobby: Lobby | null = null;
  private readonly lobbySockets = new Map<string, WebSocket>();
  /** Logged-in non-players watching a started game, by account id. */
  private readonly spectators = new Map<string, { socket: WebSocket; name: string }>();
  /** World player id to the account that currently controls it. */
  private readonly slotAccounts = new Map<string, string>();
  private gameHostId: string | null = null;
  private readonly pendingTakeovers: TakeoverRequest[] = [];
  private readonly connections = new Map<WebSocket, RoomConnection>();
  private emptySinceMs: number | null = null;

  constructor(state?: RoomState, env: RoomEnv = {}) {
    this.env = env;
    this.storage = state?.storage;
    if (state?.storage && state.blockConcurrencyWhile) {
      state.blockConcurrencyWhile(async () => {
        this.lobby = (await state.storage!.get<Lobby>("lobby")) ?? null;
        this.emptySinceMs = (await state.storage!.get<number>("lobbyEmptySince")) ?? null;
      });
    }
  }
  private readonly sockets = new PlayerSessions<WebSocket>();
  private ticks = 0;
  private lastPerfSampleMs = Date.now();
  private lastSnapshotMs = 0;
  private lastStepMs = 0;
  private sentBytesSincePerf = 0;
  private lastScenarioStatusMs = 0;
  private readonly metrics = new LoadMetrics();
  private readonly streams = new Map<string, {
    seq: number;
    base: StateMessage | null;
    fleetAt: number;
    fleetRouteAt: number;
    logAt: number;
    fullAt: number;
    forceFull: boolean;
    networkMode: NetworkPreference;
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
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/account-delete" && request.method === "POST") {
      return this.deleteAccountPlayer(request);
    }
    if (requestUrl.pathname === "/lobby-create" && request.method === "POST") {
      return this.createLobby(request);
    }
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
    let npcs = true;
    let enemyCrewPercent: number | null = null;
    let fireShipCount = 0;
    let displayName: string | null = null;
    let teamJoin = false;
    const rawNpc = url.searchParams.get("npc");
    if (rawNpc !== null) {
      if (rawNpc !== "0" && rawNpc !== "1") {
        return new Response("npc must be 0 or 1.", { status: 400 });
      }
      npcs = rawNpc === "1";
    }
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

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const join = (playerId: string, trustedName: string | null, addMessageListener = true): Response => {
      if (room !== this.world.roomCode) {
        this.ghosts.clear();
        this.world = createWorld(room, {
          navy,
          startPort,
          shipClass: shipClass ?? undefined,
          startMoney,
          hungerMultiplier,
          npcs,
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
        this.world.notices.set(playerId, [
          ...(this.world.notices.get(playerId) ?? []),
          `Same navy requested: you are ${chosen.navy}.`,
        ]);
      }
      // Only a profile read by the Worker may name a player in a normal room.
      if (trustedName) setPlayerName(this.world, playerId, trustedName, true);
      else if (displayName) setPlayerName(this.world, playerId, displayName);
      if (kind !== "normal" && url.searchParams.get("routes") === "1") {
        spawnRouteHelper(this.world, playerId);
      }
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

      if (addMessageListener) {
        server.addEventListener("message", (event) => this.onMessage(playerId, event.data));
        server.addEventListener("close", () => this.dropSocket(playerId, server));
      }

      // The newest connection owns this id. Adding it first means the old
      // socket's close event cannot remove the new one.
      this.sockets.add(playerId, server);
      this.streams.delete(playerId);

      if (!this.loop.running) this.metrics.reset(Date.now());
      this.loop.start();
      this.sendState(playerId, server, true);
      return new Response(null, { status: 101, webSocket: client });
    };

    if (kind === "normal") {
      // The token travels in the first WebSocket message, never in the URL.
      // Nothing is joined or named until the Worker has checked it and read
      // the profile with the server-only key.
      let stage: "waiting" | "checking" | "joined" = "waiting";
      const queued: unknown[] = [];
      const reject = (text: string): void => {
        try {
          server.send(JSON.stringify({ t: "authError", text }));
          server.close(4401, text);
        } catch {
          // The socket may already be closing.
        }
      };
      const timer = setTimeout(() => {
        if (stage !== "waiting") return;
        stage = "joined";
        reject("Log in to play online");
      }, 5_000);
      server.addEventListener("message", (event) => {
        // Once verified, the connection's own listener (bindConnection) is
        // the only one that routes messages. Keeping this one idle avoids
        // handling every order twice.
        if (stage === "joined") return;
        if (stage === "checking") {
          queued.push(event.data);
          return;
        }
        stage = "checking";
        clearTimeout(timer);
        let message: unknown = null;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          // A malformed first message is not a token.
        }
        const token = message && typeof message === "object" &&
          typeof (message as { token?: unknown }).token === "string"
          ? (message as { token: string }).token
          : "";
        if (!token) {
          stage = "joined";
          reject("Log in to play online");
          return;
        }
        void authenticate(token, this.env).then((account) => {
          if (!account) {
            stage = "joined";
            reject("Log in to play online");
            return;
          }
          stage = "joined";
          this.ensureStartedWorld();
          const lobby = this.lobby;
          if (lobby && lobby.startedAtMs === null) {
            this.enterLobby(server, account);
          } else if (lobby && lobby.startedAtMs !== null) {
            const slot = this.slotForAccount(account.userId);
            if (!slot) {
              this.enterSpectator(server, account);
            } else {
              this.bindConnection(server, {
                accountId: account.userId,
                name: account.displayName,
                mode: "game",
                playerId: slot,
                slotId: "",
              });
              const response = join(slot, account.displayName, false);
              if (response.status !== 101) {
                teardownJoin(response, server);
                return;
              }
              this.onGameConnected(server, account.userId);
            }
          } else {
            // A normal room made before lobbies still joins straight in.
            this.bindConnection(server, {
              accountId: account.userId,
              name: account.displayName,
              mode: "game",
              playerId: account.userId,
              slotId: "",
            });
            const response = join(account.userId, account.displayName, false);
            if (response.status !== 101) {
              teardownJoin(response, server);
              return;
            }
            this.onGameConnected(server, account.userId);
          }
          for (const data of queued.splice(0)) this.routeConnectionMessage(server, data);
        }).catch(() => {
          stage = "joined";
          reject("Log in to play online");
        });
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    const playerId = url.searchParams.get("player") ?? "";
    if (!playerIdPattern.test(playerId)) {
      return new Response("Player id must be letters, numbers, dash or underscore.", {
        status: 400,
      });
    }
    return join(playerId, null);
  }

  /** A Worker-authenticated account deletion is a resignation for now. */
  private deleteAccountPlayer(request: Request): Response {
    const secret = this.env.SUPABASE_SECRET_KEY ?? "";
    if (!secret || request.headers.get("x-admin-key") !== secret) {
      return new Response("Not allowed.", { status: 403 });
    }
    const playerId = request.headers.get("x-account-id") ?? "";
    if (!playerIdPattern.test(playerId)) {
      return new Response("Account id must be letters, numbers, dash or underscore.", {
        status: 400,
      });
    }
    if (this.lobby && this.lobby.startedAtMs === null) {
      const lobbyPlayer = lobbyPlayerForAccount(this.lobby, playerId);
      if (lobbyPlayer) {
        const lobbySocket = this.lobbySockets.get(lobbyPlayer.id);
        this.lobbySockets.delete(lobbyPlayer.id);
        removeLobbyPlayer(this.lobby, lobbyPlayer.id);
        this.persistLobby();
        this.broadcastLobby();
        if (lobbySocket) {
          try {
            lobbySocket.close(LOBBY_CLOSED_CLOSE_CODE, "account deleted");
          } catch {
            // The socket may already be closing.
          }
        }
      }
    }
    const slot = this.slotForAccount(playerId) ?? playerId;
    const resigned = resignPlayer(this.world, slot, null);
    const socket = this.sockets.get(slot);
    if (socket) {
      try {
        socket.close(4403, "account deleted");
      } catch {
        // The socket may already be closing.
      }
    }
    return Response.json({ ok: true, resigned });
  }

  // ---- Online lobbies -----------------------------------------------------

  /** The Worker reserves a join code, then asks this room to host the lobby. */
  private async createLobby(request: Request): Promise<Response> {
    const secret = this.env.SUPABASE_SECRET_KEY ?? "";
    if (!secret || request.headers.get("x-admin-key") !== secret) {
      return new Response("Not allowed.", { status: 403 });
    }
    let body: Record<string, unknown> = {};
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      // A missing body is refused below.
    }
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const hostId = typeof body.hostId === "string" ? body.hostId : "";
    const hostName = typeof body.hostName === "string" ? body.hostName.trim().slice(0, 24) : "";
    if (!isJoinCode(code)) {
      return new Response("Join code must be 5 characters from A to Z and 2 to 9.", { status: 400 });
    }
    if (!playerIdPattern.test(hostId) || !hostName) {
      return new Response("A host account is needed.", { status: 400 });
    }
    if (this.lobby && this.lobby.players.length > 0) {
      return new Response("That code is already in use.", { status: 409 });
    }
    this.lobby = newLobby(code, {
      id: randomSlotId(),
      accountId: hostId,
      name: hostName,
    }, Date.now());
    this.gameHostId = hostId;
    this.persistLobby();
    this.reportDirectory("lobby", 1);
    // A game created but never opened does not sit in the directory for a day.
    this.scheduleLobbyDiscard();
    return Response.json({ ok: true, code });
  }

  private send(socket: WebSocket, message: Record<string, unknown>): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A dead socket is handled by the close path.
    }
  }

  private bindConnection(server: WebSocket, connection: RoomConnection): void {
    this.connections.set(server, connection);
    server.addEventListener("message", (event) => this.routeConnectionMessage(server, event.data));
    server.addEventListener("close", () => this.onConnectionClose(server));
  }

  private routeConnectionMessage(server: WebSocket, data: unknown): void {
    const connection = this.connections.get(server);
    if (!connection) return;
    if (connection.mode === "lobby") {
      this.onLobbyMessage(server, connection, data);
      return;
    }
    if (connection.mode === "spectator") {
      this.onSpectatorMessage(server, connection, data);
      return;
    }
    this.onMessage(connection.playerId, data);
  }

  private onConnectionClose(server: WebSocket): void {
    const connection = this.connections.get(server);
    if (!connection) return;
    this.connections.delete(server);
    if (connection.mode === "lobby") {
      if (this.lobbySockets.get(connection.slotId) === server) {
        this.lobbySockets.delete(connection.slotId);
      }
      // Closing the lobby tab is leaving the lobby, so the host badge moves.
      this.leaveLobbyPlayer(connection.slotId);
      return;
    }
    if (connection.mode === "spectator") {
      this.spectators.delete(connection.accountId);
      this.dropPendingForAccount(connection.accountId);
      return;
    }
    this.dropSocket(connection.playerId, server);
  }

  /** A normal-room game connection is ready; hide any lobby or waiting screen. */
  private onGameConnected(server: WebSocket, accountId: string): void {
    this.send(server, { t: "gameStarted" });
    if (this.lobby?.startedAtMs && this.gameHostId === accountId) {
      for (const request of this.pendingTakeovers) {
        this.sendTakeoverPrompt(server, request);
      }
    }
  }

  private persistLobby(): void {
    if (!this.storage) return;
    if (this.lobby) void this.storage.put("lobby", this.lobby);
    else void this.storage.delete("lobby");
  }

  private reportDirectory(status: "lobby" | "playing" | "closed", players = 0): void {
    const namespace = this.env.LOBBY_DIRECTORY;
    const code = this.lobby?.code;
    if (!namespace || !code) return;
    try {
      const stub = namespace.get(namespace.idFromName("lobby-directory"));
      void stub.fetch(new Request("https://directory.internal/status", {
        method: "POST",
        body: JSON.stringify({ code, status, players }),
      })).catch(() => {
        // The directory is a convenience; a missed update expires on its own.
      });
    } catch {
      // A missing directory binding must not stop the game.
    }
  }

  private scheduleLobbyDiscard(): void {
    if (!this.lobby || this.lobby.startedAtMs !== null) return;
    this.emptySinceMs = Date.now();
    if (!this.storage) return;
    void this.storage.put("lobbyEmptySince", this.emptySinceMs);
    const minutes = settings.lobby.emptyDiscardMinutes;
    void this.storage.setAlarm?.(Date.now() + minutes * 60_000);
  }

  /** The Durable Object alarm discards a lobby that stayed empty. */
  async alarm(): Promise<void> {
    const lobby = this.lobby;
    if (!lobby || lobby.startedAtMs !== null || this.lobbySockets.size > 0) return;
    const code = lobby.code;
    this.lobby = null;
    this.emptySinceMs = null;
    if (this.storage) {
      await this.storage.delete("lobby");
      await this.storage.delete("lobbyEmptySince");
    }
    const namespace = this.env.LOBBY_DIRECTORY;
    if (namespace && code) {
      try {
        const stub = namespace.get(namespace.idFromName("lobby-directory"));
        await stub.fetch(new Request("https://directory.internal/status", {
          method: "POST",
          body: JSON.stringify({ code, status: "closed" }),
        }));
      } catch {
        // The code expires from the directory on its own.
      }
    }
  }

  private sendLobby(socket: WebSocket, viewerSlotId: string, text?: string): void {
    if (!this.lobby) return;
    this.send(socket, {
      t: "lobby",
      lobby: lobbySnapshot(this.lobby, viewerSlotId),
      text: text ?? undefined,
    });
  }

  private broadcastLobby(): void {
    if (!this.lobby) return;
    for (const [slotId, socket] of this.lobbySockets) {
      this.sendLobby(socket, slotId);
    }
  }

  /** A verified account opens the joining screen of this room's lobby. */
  private enterLobby(server: WebSocket, account: { userId: string; displayName: string }): void {
    const lobby = this.lobby;
    if (!lobby) return;
    let player = lobbyPlayerForAccount(lobby, account.userId);
    if (!player) {
      const result = addLobbyPlayer(lobby, {
        id: randomSlotId(),
        accountId: account.userId,
        name: account.displayName,
      });
      if (!result.ok) {
        this.send(server, { t: "lobbyError", text: result.error });
        try {
          server.close(LOBBY_CLOSED_CLOSE_CODE, result.error);
        } catch {
          // The socket may already be closing.
        }
        return;
      }
      player = lobbyPlayerForAccount(lobby, account.userId);
    }
    if (!player) return;
    const previous = this.lobbySockets.get(player.id);
    this.lobbySockets.set(player.id, server);
    if (previous && previous !== server) {
      try {
        previous.close(TAKEN_OVER_CLOSE_CODE, "another tab");
      } catch {
        // The old socket may already be closing.
      }
    }
    this.bindConnection(server, {
      accountId: account.userId,
      name: account.displayName,
      mode: "lobby",
      playerId: "",
      slotId: player.id,
    });
    this.emptySinceMs = null;
    void this.storage?.delete("lobbyEmptySince");
    this.persistLobby();
    this.reportDirectory("lobby", lobby.players.length);
    this.sendLobby(server, player.id);
    this.broadcastLobby();
  }

  private finishLobbyAction(
    socket: WebSocket,
    connection: RoomConnection,
    id: string | null,
    result: LobbyResult,
  ): boolean {
    if (!result.ok) {
      if (id) this.send(socket, { t: "ack", id, ok: false, text: result.error });
      this.sendLobby(socket, connection.slotId, result.error);
      return false;
    }
    if (id) this.send(socket, { t: "ack", id, ok: true });
    this.persistLobby();
    this.broadcastLobby();
    return true;
  }

  private onLobbyMessage(server: WebSocket, connection: RoomConnection, data: unknown): void {
    if (typeof data !== "string" || data.length > 2_000) return;
    let order: Record<string, unknown>;
    try {
      order = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!order || typeof order !== "object") return;
    const id = typeof order.id === "string" && order.id.length <= 80 ? order.id : null;
    const lobby = this.lobby;
    if (!lobby) {
      this.send(server, { t: "lobbyError", text: "This lobby has closed." });
      return;
    }
    const player = findLobbyPlayer(lobby, connection.slotId);
    if (!player) {
      this.send(server, { t: "lobbyError", text: "You are not in this lobby." });
      return;
    }

    if (order.t === "lobbyNavy") {
      this.finishLobbyAction(server, connection, id,
        setLobbyNavy(lobby, connection.slotId, typeof order.navy === "string" ? order.navy : ""));
      return;
    }
    if (order.t === "lobbyFlagship") {
      this.finishLobbyAction(server, connection, id,
        setLobbyFlagshipName(lobby, connection.slotId, typeof order.name === "string" ? order.name : ""));
      return;
    }
    if (order.t === "lobbyReady") {
      this.finishLobbyAction(server, connection, id,
        setLobbyReady(lobby, connection.slotId, order.ready !== false));
      return;
    }
    if (order.t === "lobbyLeave") {
      this.lobbySockets.delete(connection.slotId);
      this.leaveLobbyPlayer(connection.slotId);
      this.send(server, { t: "lobbyLeft" });
      if (id) this.send(server, { t: "ack", id, ok: true });
      return;
    }
    if (order.t === "lobbyKick") {
      if (!isLobbyHost(lobby, connection.slotId)) {
        this.finishLobbyAction(server, connection, id, {
          ok: false, error: "Only the host can remove players.",
        });
        return;
      }
      const target = typeof order.player === "string" ? order.player : "";
      if (!target || target === connection.slotId) {
        this.finishLobbyAction(server, connection, id, {
          ok: false, error: "The host cannot remove themselves. Use Leave.",
        });
        return;
      }
      const kicked = this.lobbySockets.get(target);
      this.lobbySockets.delete(target);
      if (!removeLobbyPlayer(lobby, target)) {
        this.finishLobbyAction(server, connection, id, {
          ok: false, error: "That player is not in the lobby.",
        });
        return;
      }
      if (kicked) {
        this.send(kicked, { t: "lobbyKicked", text: "The host removed you from the lobby." });
        try {
          kicked.close(LOBBY_CLOSED_CLOSE_CODE, "Removed by the host");
        } catch {
          // The socket may already be closing.
        }
      }
      this.finishLobbyAction(server, connection, id, { ok: true });
      this.reportDirectory("lobby", lobby.players.length);
      return;
    }
    if (order.t === "lobbySettings") {
      const which = order.setting === "items" ? "Items arrive later" : order.setting === "ai"
        ? "Arrives with AI opponents" : "That setting does not exist.";
      this.finishLobbyAction(server, connection, id, { ok: false, error: which });
      return;
    }
    if (order.t === "lobbyStart") {
      if (!isLobbyHost(lobby, connection.slotId)) {
        this.finishLobbyAction(server, connection, id, {
          ok: false, error: "Only the host can start the game.",
        });
        return;
      }
      const reason = lobbyStartReason(lobby);
      if (reason || !canStartLobby(lobby)) {
        this.finishLobbyAction(server, connection, id, {
          ok: false, error: reason || "The game cannot start yet.",
        });
        return;
      }
      const started = this.startLobbyNow();
      this.finishLobbyAction(server, connection, id,
        started.ok ? { ok: true } : { ok: false, error: started.error ?? "The game cannot start yet." });
      return;
    }
  }

  /** Leave a lobby, moving the host badge to the next player. */
  private leaveLobbyPlayer(slotId: string): void {
    const lobby = this.lobby;
    if (!lobby || lobby.startedAtMs !== null) return;
    if (!removeLobbyPlayer(lobby, slotId)) return;
    this.persistLobby();
    if (lobby.players.length === 0) {
      this.scheduleLobbyDiscard();
    } else {
      this.reportDirectory("lobby", lobby.players.length);
      this.broadcastLobby();
    }
  }

  /** Turn the lobby into a real world with the normal normal-room setup. */
  private startLobbyNow(): { ok: boolean; error?: string } {
    const lobby = this.lobby;
    if (!lobby) return { ok: false, error: "This lobby has closed." };
    const players = lobbyStartPlayers(lobby);
    if (!players) {
      return { ok: false, error: lobbyStartReason(lobby) || "The game cannot start yet." };
    }
    this.world = startLobbyGame(lobby.code, players, { npcs: true });
    this.ghosts.clear();
    lobby.startedAtMs = Date.now();
    this.persistLobby();
    this.gameHostId = lobby.players.find((player) => player.id === lobby.hostId)?.accountId ?? null;
    this.slotAccounts.clear();
    for (const player of lobby.players) {
      this.slotAccounts.set(player.accountId, player.accountId);
    }
    for (const [slotId, socket] of [...this.lobbySockets]) {
      const player = findLobbyPlayer(lobby, slotId);
      if (!player) continue;
      const connection = this.connections.get(socket);
      if (connection) {
        connection.mode = "game";
        connection.playerId = player.accountId;
        connection.accountId = player.accountId;
        connection.name = player.name;
      }
      this.sockets.add(player.accountId, socket);
      this.streams.delete(player.accountId);
      this.send(socket, { t: "gameStarted" });
    }
    this.lobbySockets.clear();
    this.metrics.reset(Date.now());
    this.loop.start();
    for (const player of lobby.players) {
      // Start each chart with the useful coast around the berth, exactly as a
      // normal-room join does. Without this the first map would stay pale.
      requestChartResume(this.world, player.accountId);
      const socket = this.sockets.get(player.accountId);
      if (socket) this.sendState(player.accountId, socket, true);
    }
    this.reportDirectory("playing", lobby.players.length);
    return { ok: true };
  }

  /** Restore the started world after a Durable Object restart. */
  private ensureStartedWorld(): void {
    const lobby = this.lobby;
    if (!lobby || lobby.startedAtMs === null) return;
    if (this.world.roomCode === lobby.code && this.world.playerRecords.size > 0) return;
    const players = lobby.players
      .filter((player) => player.navy && player.flagshipName)
      .map((player) => ({
        id: player.accountId,
        name: player.name,
        navy: player.navy!,
        flagshipName: player.flagshipName,
      }));
    if (players.length === 0) return;
    this.world = startLobbyGame(lobby.code, players, { npcs: true });
    this.gameHostId = lobby.players.find((player) => player.id === lobby.hostId)?.accountId ?? null;
    this.slotAccounts.clear();
    for (const player of lobby.players) {
      this.slotAccounts.set(player.accountId, player.accountId);
    }
  }

  private slotForAccount(accountId: string): string | null {
    for (const [slotId, account] of this.slotAccounts) {
      if (account === accountId) return slotId;
    }
    // After a takeover the old account's slot is mapped to someone else, so
    // the fallback must only apply to a slot that has no owner mapping at all.
    if (!this.slotAccounts.has(accountId) && this.world.playerRecords.has(accountId)) {
      return accountId;
    }
    return null;
  }

  private freeTakeoverSlot(): string | null {
    if (!this.lobby?.startedAtMs) return null;
    const reserved = new Set(this.pendingTakeovers.map((request) => request.targetSlot));
    for (const record of this.world.playerRecords.values()) {
      if (record.eliminated) continue;
      if (this.sockets.get(record.id)) continue;
      if (reserved.has(record.id)) continue;
      return record.id;
    }
    return null;
  }

  private enterSpectator(server: WebSocket, account: { userId: string; displayName: string }): void {
    this.spectators.set(account.userId, { socket: server, name: account.displayName });
    this.bindConnection(server, {
      accountId: account.userId,
      name: account.displayName,
      mode: "spectator",
      playerId: "",
      slotId: "",
    });
    const free = this.freeTakeoverSlot();
    this.send(server, {
      t: "gameInProgress",
      code: this.lobby?.code ?? "",
      freeSlots: free ? 1 : 0,
      reason: free ? "" : "No free slot",
    });
    if (this.pendingTakeovers.some((request) => request.accountId === account.userId)) {
      this.send(server, { t: "takeoverStatus", ok: true, text: "Waiting for the host." });
    }
  }

  private onSpectatorMessage(server: WebSocket, connection: RoomConnection, data: unknown): void {
    if (typeof data !== "string" || data.length > 2_000) return;
    let order: Record<string, unknown>;
    try {
      order = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!order || typeof order !== "object") return;
    if (order.t === "takeoverRequest") {
      this.requestTakeover(server, connection);
    }
  }

  private requestTakeover(server: WebSocket, connection: RoomConnection): void {
    if (!this.lobby?.startedAtMs) {
      this.send(server, { t: "takeoverStatus", ok: false, text: "There is no game in progress." });
      return;
    }
    if (this.slotForAccount(connection.accountId)) {
      this.send(server, { t: "takeoverStatus", ok: false, text: "You are already in this game." });
      return;
    }
    const waiting = this.pendingTakeovers.find((request) => request.accountId === connection.accountId);
    if (waiting) {
      this.send(server, { t: "takeoverStatus", ok: true, text: "Waiting for the host." });
      return;
    }
    const targetSlot = this.freeTakeoverSlot();
    if (!targetSlot) {
      this.send(server, { t: "takeoverStatus", ok: false, text: "No free slot" });
      return;
    }
    const request: TakeoverRequest = {
      id: randomSlotId(),
      accountId: connection.accountId,
      name: connection.name,
      targetSlot,
      atMs: Date.now(),
    };
    this.pendingTakeovers.push(request);
    const host = this.gameHostId ? this.sockets.get(this.gameHostId) : undefined;
    if (host) {
      this.sendTakeoverPrompt(host, request);
      this.send(server, { t: "takeoverStatus", ok: true, text: "Waiting for the host." });
    } else {
      this.send(server, {
        t: "takeoverStatus",
        ok: true,
        text: "The host is offline. Your request will wait.",
      });
    }
    this.broadcastSpectatorSlots();
  }

  private sendTakeoverPrompt(socket: WebSocket, request: TakeoverRequest): void {
    const record = this.world.playerRecords.get(request.targetSlot);
    this.send(socket, {
      t: "takeoverRequest",
      request: {
        id: request.id,
        name: request.name,
        targetName: record?.name ?? "",
        navy: record?.navy ?? "",
        flagshipName: record?.flagshipName ?? "",
      },
    });
  }

  private answerTakeover(server: WebSocket, connection: RoomConnection, id: string, accept: boolean): void {
    if (!this.gameHostId || connection.accountId !== this.gameHostId) {
      this.send(server, { t: "takeoverStatus", ok: false, text: "Only the host can answer." });
      return;
    }
    const at = this.pendingTakeovers.findIndex((request) => request.id === id);
    if (at < 0) {
      this.send(server, { t: "takeoverStatus", ok: false, text: "That request is no longer waiting." });
      return;
    }
    const request = this.pendingTakeovers[at]!;
    this.pendingTakeovers.splice(at, 1);
    const watcher = this.spectators.get(request.accountId);
    if (!accept) {
      if (watcher) {
        this.send(watcher.socket, {
          t: "takeoverStatus",
          ok: false,
          text: "The host declined your request.",
        });
      }
      this.broadcastSpectatorSlots();
      return;
    }
    if (this.sockets.get(request.targetSlot)) {
      if (watcher) {
        this.send(watcher.socket, {
          t: "takeoverStatus",
          ok: false,
          text: "That player is back online.",
        });
      }
      this.broadcastSpectatorSlots();
      return;
    }
    if (!watcher) {
      this.broadcastSpectatorSlots();
      return;
    }
    this.spectators.delete(request.accountId);
    this.slotAccounts.set(request.targetSlot, request.accountId);
    const watcherConnection = this.connections.get(watcher.socket);
    if (watcherConnection) {
      watcherConnection.mode = "game";
      watcherConnection.playerId = request.targetSlot;
      watcherConnection.accountId = request.accountId;
    }
    this.sockets.add(request.targetSlot, watcher.socket);
    this.streams.delete(request.targetSlot);
    const record = this.world.playerRecords.get(request.targetSlot);
    for (const playerId of this.world.playerRecords.keys()) {
      const notices = this.world.notices.get(playerId) ?? [];
      notices.push(`${request.name} took over ${record?.name ?? "a"} slot.`);
      this.world.notices.set(playerId, notices);
    }
    this.send(watcher.socket, { t: "gameStarted", text: "You have taken over the slot." });
    this.sendState(request.targetSlot, watcher.socket, true);
    this.broadcastSpectatorSlots();
  }

  private dropPendingForAccount(accountId: string): void {
    for (let index = this.pendingTakeovers.length - 1; index >= 0; index -= 1) {
      if (this.pendingTakeovers[index]!.accountId === accountId) {
        this.pendingTakeovers.splice(index, 1);
      }
    }
    this.broadcastSpectatorSlots();
  }

  private broadcastSpectatorSlots(): void {
    const free = this.freeTakeoverSlot();
    for (const watcher of this.spectators.values()) {
      this.send(watcher.socket, {
        t: "gameInProgress",
        code: this.lobby?.code ?? "",
        freeSlots: free ? 1 : 0,
        reason: free ? "" : "No free slot",
      });
    }
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
    this.lastStepMs = performance.now() - stepStarted;
    this.metrics.noteWorldStep(this.lastStepMs, now);
    this.samplePerformance(now);
    this.sendScenarioStatus(now);
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
    // A watcher waiting for a slot is still someone online.
    if (this.sockets.size === 0 && this.spectators.size === 0) this.loop.stop();
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
  private broadcast(regular: boolean, _battleNow: boolean): void {
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
      const mode = stream?.networkMode ?? "auto";
      const battleDue = dueAtRate(
        this.ticks,
        battleRateFor(mode),
        settings.server.tickHz,
      ) && battleZoneNear(
        this.world,
        playerId,
        this.battleFocus(playerId),
        settings.network.battleZoneRadiusKm,
      );
      if (regular || battleDue) {
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

  /** 3J-b: one scoreboard update per second while a scenario runs. */
  private sendScenarioStatus(now: number): void {
    if (!this.world.testScenario || now - this.lastScenarioStatusMs < 1_000) return;
    this.lastScenarioStatusMs = now;
    for (const [playerId, socket] of this.sockets.entries()) {
      const status = scenarioStatusFor(this.world, playerId);
      if (!status) continue;
      try {
        socket.send(JSON.stringify({ t: "scenarioStatus", status }));
      } catch {
        // A dead socket is handled by the state sender.
      }
    }
  }

  /** 3J: one cheap sample every 5 real seconds, inside test and dev rooms only. */
  private samplePerformance(now: number): void {
    if (this.world.kind === "normal") {
      this.sentBytesSincePerf = 0;
      this.lastPerfSampleMs = now;
      return;
    }
    const windowMs = now - this.lastPerfSampleMs;
    if (windowMs < settings.testing.perfSampleRealSeconds * 1000) return;
    const seconds = Math.max(0.001, windowMs / 1000);
    const players = this.sockets.size;
    const bytesPerPlayer = players > 0 ? this.sentBytesSincePerf / players / seconds : 0;
    const snapshotAge = this.lastSnapshotMs > 0 ? Math.max(0, now - this.lastSnapshotMs) : -1;
    recordWorldEvent(this.world, "perf",
      `step ${this.lastStepMs.toFixed(1)}ms, ${Math.round(bytesPerPlayer)} B/player/s, ` +
      `snapshot ${Math.round(snapshotAge)}ms`, {
        audience: [...this.sockets.entries()].map(([id]) => id),
        data: {
          stepMs: this.lastStepMs,
          bytesPerPlayerSecond: bytesPerPlayer,
          snapshotAgeMs: snapshotAge,
          players,
          clientFrameMs: -1,
        },
      });
    this.lastPerfSampleMs = now;
    this.sentBytesSincePerf = 0;
  }

  private sendState(playerId: string, socket: WebSocket, forceFull = false): void {
    try {
      const now = Date.now();
      let stream = this.streams.get(playerId);
      if (!stream) {
        stream = {
          seq: 0,
          base: null,
          fleetAt: 0,
          fleetRouteAt: 0,
          logAt: 0,
          fullAt: 0,
          forceFull: true,
          networkMode: "auto",
        };
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
      const includeFleetRoutes = forceFull || stream.forceFull || stream.base === null ||
        now - stream.fleetRouteAt >= settings.network.fleetRouteSeconds * 1000;
      const includeLog = forceFull || stream.forceFull || stream.base === null ||
        now - stream.logAt >= settings.network.battleLogSeconds * 1000;
      const state = visibleStateFor(this.world, playerId, CHART_BLOCKS, allowed, includeFleet);
      if (!includeFleet && stream.base?.fleet) state.fleet = stream.base.fleet;
      if (!includeLog && stream.base) state.log = stream.base.log;
      this.blockBudget.note(state.chart.blocks.length, now);
      const eventLimit = stream.networkMode === "saver"
        ? settings.network.dataSaverEffectEvents
        : settings.network.maxCombatEventsPerMessage;
      if ((state.events?.length ?? 0) > eventLimit) {
        state.events = state.events!.slice(-eventLimit);
      }
      if (!forceFull && !stream.forceFull && stream.base && stream.networkMode !== "full") {
        const ownIds = new Set(shipsForOwner(this.world, playerId).map((ship) => ship.id));
        state.ships = holdFarShips(
          stream.base.ships,
          state.ships,
          ownIds,
          this.battleFocus(playerId),
          stream.networkMode,
          this.ticks,
          settings.server.tickHz,
        );
      }
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
        const payload = JSON.stringify(state);
        this.sentBytesSincePerf += payload.length;
        socket.send(payload);
        stream.base = state;
        stream.fullAt = now;
        stream.fleetAt = now;
        stream.fleetRouteAt = now;
        stream.logAt = now;
        stream.forceFull = false;
      } else {
        const delta = buildStateDelta(stream.base, state, stream.seq, includeFleet, includeFleetRoutes);
        const binary = encodeStateDelta(delta);
        this.sentBytesSincePerf += binary.byteLength;
        socket.send(binary);
        stream.base = state;
      }
      if (includeFleet) stream.fleetAt = now;
      if (includeFleetRoutes) stream.fleetRouteAt = now;
      if (includeLog) stream.logAt = now;
      this.lastSnapshotMs = now;

      // Notices are short events, not world state, so they travel separately.
      const notice = takeNotice(this.world, playerId);
      if (notice) {
        const message: NoticeMessage = { t: "n", text: notice };
        const payload = JSON.stringify(message);
        this.sentBytesSincePerf += payload.length;
        socket.send(payload);
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
      case "hirePrivateer": case "privateerMode": return "That privateer contract is not available.";
      case "loot": return "There is nothing to loot there.";
      case "dropAnchor": return "Cannot drop anchor now.";
      case "weighAnchor": return "Cannot weigh anchor now.";
      case "battleOrder": case "fleetBattleOrder": return "That battle order is not allowed.";
      case "fleetOrder": return "That fleet cannot take that order.";
      case "research": return "Cannot research that upgrade.";
      case "fitShip": return "Cannot upgrade that ship.";
      case "fitAllShips": return "No docked ship can be upgraded.";
      case "testResearch": return "Research tools are only available in test and dev rooms.";
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
      route?: unknown;
      portA?: unknown;
      portB?: unknown;
      tonnes?: unknown;
      minutes?: unknown;
      fleet?: unknown;
      ships?: unknown;
      formation?: unknown;
      stance?: unknown;
      leader?: unknown;
      order?: unknown;
      queue?: unknown;
      action?: unknown;
      index?: unknown;
      delta?: unknown;
      slot?: unknown;
      ids?: unknown;
      enabled?: unknown;
      on?: unknown;
      hour?: unknown;
      phase?: unknown;
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
      upgrade?: unknown;
      level?: unknown;
      units?: unknown;
      points?: unknown;
      text?: unknown;
      zoom?: unknown;
      layout?: unknown;
      width?: unknown;
      height?: unknown;
      build?: unknown;
      seed?: unknown;
      scenario?: unknown;
      where?: unknown;
      rating?: unknown;
      note?: unknown;
      request?: unknown;
      accept?: unknown;
    };

    if (order.t === "networkMode") {
      const mode = parseNetworkPreference(order.mode);
      if (mode) {
        const stream = this.streams.get(playerId);
        if (stream) stream.networkMode = mode;
      }
      return;
    }
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

    const testOnly = this.world.kind !== "normal";
    const socket = this.sockets.get(playerId);
    if (order.t === "takeoverAnswer") {
      const connection = socket ? this.connections.get(socket) : undefined;
      if (socket && connection) {
        this.answerTakeover(
          socket,
          connection,
          typeof order.request === "string" ? order.request : "",
          order.accept === true,
        );
      }
      return;
    }
    const ack = (ok: boolean, text?: string): void => {
      if (typeof order.id === "string" && order.id.length <= 80) {
        socket?.send(JSON.stringify({ t: "ack", id: order.id, ok, text }));
      }
    };
    if (order.t === "scenario") {
      if (!testOnly) {
        ack(false, "Test tools are removed in normal rooms.");
        return;
      }
      const result = startTestScenario(this.world, playerId, order.scenario);
      if (result.error || !result.status) {
        ack(false, result.error ?? "Scenario could not start.");
        return;
      }
      this.world = result.world;
      this.ghosts.clear();
      for (const stream of this.streams.values()) stream.forceFull = true;
      socket?.send(JSON.stringify({ t: "scenarioStatus", status: result.status }));
      recordWorldEvent(this.world, "order", `scenario: accepted`, {
        privateTo: playerId,
        data: { type: "scenario", accepted: true, reason: "" },
      });
      ack(true);
      return;
    }
    if (order.t === "endScenario") {
      if (!testOnly) {
        ack(false, "Test tools are removed in normal rooms.");
        return;
      }
      const status = endTestScenario(this.world, playerId);
      if (!status) {
        ack(false, "No scenario is running.");
        return;
      }
      socket?.send(JSON.stringify({ t: "scenarioStatus", status }));
      ack(true);
      return;
    }
    if (order.t === "scenarioRating") {
      if (!testOnly) {
        ack(false, "Test tools are removed in normal rooms.");
        return;
      }
      const rated = rateTestScenario(this.world, playerId, order.rating, order.note);
      ack(rated, rated ? undefined : "End the scenario before rating it.");
      return;
    }
    if (order.t === "sessionReport") {
      if (!testOnly) {
        ack(false, "Test tools are removed in normal rooms.");
        return;
      }
      const text = sessionReportFor(this.world, playerId, {
        buildId: order.build,
        layout: order.layout,
        width: order.width,
        height: order.height,
        seed: order.seed,
        scenario: order.scenario,
      });
      socket?.send(JSON.stringify({ t: "sessionReport", text }));
      ack(true);
      return;
    }
    if (order.t === "clearRecorder") {
      if (!testOnly) {
        ack(false, "Test tools are removed in normal rooms.");
        return;
      }
      this.world.recorder.length = 0;
      this.world.sessionNotes.length = 0;
      recordWorldEvent(this.world, "tools", `recorder cleared by ${playerId}`);
      ack(true);
      return;
    }
    if (order.t === "sessionNote") {
      if (!testOnly) {
        ack(false, "Test tools are removed in normal rooms.");
        return;
      }
      const note = recordSessionNote(this.world, playerId, order.text, {
        zoomKm: order.zoom,
        layout: order.layout,
      });
      ack(note !== null, note ? undefined : "Note was empty.");
      return;
    }
    if (order.t === "clientError") {
      if (testOnly) {
        recordWorldEvent(this.world, "clientError",
          String(order.text ?? "client error").slice(0, 180), {
            privateTo: playerId,
            data: { where: typeof order.where === "string" ? order.where : "client" },
          });
      }
      ack(true);
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
    } else if (order.t === "fleetMove") {
      accepted = movePlayerFleetMember(this.world, playerId, order.fleet, order.ship, order.delta);
    } else if (order.t === "queueUpdate") {
      accepted = updateFleetQueue(this.world, playerId, order.fleet, order.action, order.index, order.to);
    } else if (order.t === "fleetDetach") {
      accepted = detachPlayerShip(this.world, playerId, order.ship);
    } else if (order.t === "fleetRejoin") {
      accepted = rejoinPlayerShip(this.world, playerId, order.ship);
    } else if (order.t === "fleetOrder") {
      accepted = applyFleetOrder(this.world, playerId, order.fleet, order.order, order.queue === true);
    } else if (order.t === "shipOrder") {
      accepted = applyShipSpecialOrder(this.world, playerId, order.ship, order.order);
    } else if (order.t === "dropAnchor") {
      accepted = dropAnchor(this.world, playerId, order.ship);
    } else if (order.t === "weighAnchor") {
      accepted = weighAnchor(this.world, playerId, order.ship);
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
    } else if (order.t === "research") {
      accepted = researchUpgradeOrder(this.world, playerId, order.upgrade, order.level);
    } else if (order.t === "fitShip") {
      accepted = fitShipUpgrades(this.world, playerId, order.ship);
    } else if (order.t === "fitAllShips") {
      accepted = fitAllDockedShips(this.world, playerId) > 0;
    } else if (order.t === "testResearch") {
      if (this.world.kind === "normal") {
        reject("Research tools are only available in test and dev rooms.");
      } else if (order.mode === "giveUnits") {
        accepted = giveResearchUnits(this.world, playerId, typeof order.units === "number" ? order.units : 0) > 0;
      } else if (order.mode === "unlockAll") {
        accepted = unlockAllResearch(this.world, playerId) > 0;
      } else if (order.mode === "capturePoints" && typeof order.upgrade === "string") {
        accepted = setCapturePoints(this.world, playerId, order.upgrade, typeof order.points === "number" ? order.points : 0);
      } else if (order.mode === "reset") {
        accepted = resetNavyResearch(this.world, playerId);
      }
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
    } else if (order.t === "routeNew" || order.t === "routeEdit") {
      accepted = setTradeRoute(this.world, playerId, {
        id: order.route,
        ship: order.ship,
        portA: order.portA,
        portB: order.portB,
        good: order.good,
        tonnes: order.tonnes,
        minutes: order.minutes,
      }) !== null;
    } else if (order.t === "routeCancel") {
      accepted = cancelTradeRoute(this.world, playerId, order.route);
    } else if (order.t === "routeFast" && this.world.kind !== "normal") {
      accepted = runTradeRoutesFast(this.world, playerId) > 0;
    } else if (order.t === "portIncomeNow" && this.world.kind !== "normal") {
      accepted = updatePortIncome(this.world, true) > 0;
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
    } else if (order.t === "shipStance") {
      accepted = setShipStance(this.world, playerId, order.ship, order.stance);
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
    } else if (order.t === "hirePrivateer") {
      accepted = hirePrivateer(this.world, playerId, order.ship, order.mode, order.target);
    } else if (order.t === "privateerMode") {
      accepted = setPrivateerMode(this.world, playerId, order.ship, order.mode, order.target);
    } else if (order.t === "loot") {
      accepted = lootNpcShip(this.world, playerId, order.target, order.ship);
    } else if (order.t === "testAnchoredFleet" && this.world.kind !== "normal") {
      const stance = order.stance === "engage" ? "engage" : "fightIfAttacked";
      spawnTestAnchoredFleet(this.world, playerId, stance);
    } else if (order.t === "testTimeOfDay" && this.world.kind !== "normal") {
      if (typeof order.hour === "number") setTestTimeOfDay(this.world, order.hour);
    } else if (order.t === "testMoonPhase" && this.world.kind !== "normal") {
      accepted = setTestMoonPhase(this.world, order.phase);
    }

    if (!accepted) {
      const latest = this.world.notices.get(playerId)?.at(-1);
      if (latest && latest !== beforeNotice) reason = latest;
      reason ??= this.orderReason(order.t);
    }
    if (this.world.kind !== "normal" && typeof order.t === "string" &&
        order.t !== "ping" && order.t !== "focus" && order.t !== "resync") {
      recordWorldEvent(this.world, "order",
        `${order.t}: ${accepted ? "accepted" : reason ?? "rejected"}`, {
          privateTo: playerId,
          data: { type: order.t, accepted, reason: reason ?? "" },
        });
    }
    if (typeof order.id === "string" && order.id.length <= 80) {
      this.sockets.get(playerId)?.send(JSON.stringify({
        t: "ack",
        id: order.id,
        ok: accepted,
        text: reason ?? undefined,
      }));
      // 3J-fix-b: the ship readout catches up with the acknowledgement now,
      // instead of waiting for the next half-second fleet detail.
      if (accepted && socket) {
        const stream = this.streams.get(playerId);
        if (stream) stream.fleetAt = 0;
        this.sendState(playerId, socket);
      }
    }
  }
}
