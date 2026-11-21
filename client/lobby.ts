// The home screen and the online lobby. All account and network work is
// injected, so the buttons can be tested with fakes and no Supabase calls.
//
// The server sends a lobby snapshot containing only display names, navies,
// flagship names, ready flags and host badges. This module never sees an
// account id.

import { type NavyId } from "@naval/shared/navies";
import { isJoinCode, type LobbySnapshot } from "@naval/shared/lobby";
import { settings } from "@naval/shared/settings";

/** The design order of the four navy cards. */
const LOBBY_NAVIES: readonly NavyId[] = ["British", "French", "Dutch", "Spanish"];

export interface LobbyUiOptions {
  signedIn: () => boolean;
  openAccount: (message?: string) => void;
  createGame: () => Promise<{ code?: string; error?: string }>;
  lookupGame: (code: string) => Promise<{ status?: string; error?: string }>;
  enterRoom: (code: string) => void;
  leaveRoom: () => void;
  send: (message: Record<string, unknown>) => void;
}

export interface TakeoverPrompt {
  id: string;
  name: string;
  targetName: string;
  navy: string;
  flagshipName: string;
}

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const node = doc.getElementById(id);
  if (!node) throw new Error(`Lobby screen is missing #${id}`);
  return node as T;
}

function navyLabel(navy: NavyId): string {
  return navy;
}

export function createLobbyUi(doc: Document, options: LobbyUiOptions): {
  refreshHome: (message?: string) => void;
  showHome: (message?: string) => void;
  showLobbyConnecting: (code: string) => void;
  handleMessage: (message: unknown) => boolean;
  audit: (width: number, height: number) => string[];
  visibleScreen: () => string;
  currentLobby: () => LobbySnapshot | null;
} {
  const home = byId<HTMLElement>(doc, "home-screen");
  const lobby = byId<HTMLElement>(doc, "lobby-screen");
  const progress = byId<HTMLElement>(doc, "progress-screen");
  const prompt = byId<HTMLElement>(doc, "takeover-prompt");
  const homeCreate = byId<HTMLButtonElement>(doc, "home-create");
  const homeCreateReason = byId<HTMLElement>(doc, "home-create-reason");
  const homeJoin = byId<HTMLButtonElement>(doc, "home-join");
  const homeJoinReason = byId<HTMLElement>(doc, "home-join-reason");
  const homeCode = byId<HTMLInputElement>(doc, "home-code");
  const homeMessage = byId<HTMLElement>(doc, "home-message");
  const homeAccount = byId<HTMLButtonElement>(doc, "home-account");
  const homeAccountReason = byId<HTMLElement>(doc, "home-account-reason");
  const lobbyCode = byId<HTMLElement>(doc, "lobby-code");
  const lobbyCopy = byId<HTMLButtonElement>(doc, "lobby-copy");
  const lobbyMessage = byId<HTMLElement>(doc, "lobby-message");
  const lobbyPlayers = byId<HTMLElement>(doc, "lobby-players");
  const lobbyNavies = byId<HTMLElement>(doc, "lobby-navies");
  const lobbyFlagship = byId<HTMLInputElement>(doc, "lobby-flagship");
  const lobbyFlagshipReason = byId<HTMLElement>(doc, "lobby-flagship-reason");
  const lobbyReady = byId<HTMLButtonElement>(doc, "lobby-ready");
  const lobbyReadyReason = byId<HTMLElement>(doc, "lobby-ready-reason");
  const lobbyStart = byId<HTMLButtonElement>(doc, "lobby-start");
  const lobbyStartReason = byId<HTMLElement>(doc, "lobby-start-reason");
  const lobbyLeave = byId<HTMLButtonElement>(doc, "lobby-leave");
  const lobbyItems = byId<HTMLInputElement>(doc, "lobby-items");
  const lobbyItemsReason = byId<HTMLElement>(doc, "lobby-items-reason");
  const lobbyAi = byId<HTMLInputElement>(doc, "lobby-ai");
  const lobbyAiReason = byId<HTMLElement>(doc, "lobby-ai-reason");
  const progressCode = byId<HTMLElement>(doc, "progress-code");
  const progressMessage = byId<HTMLElement>(doc, "progress-message");
  const progressStatus = byId<HTMLElement>(doc, "progress-status");
  const progressRequest = byId<HTMLButtonElement>(doc, "progress-request");
  const progressRequestReason = byId<HTMLElement>(doc, "progress-request-reason");
  const progressHome = byId<HTMLButtonElement>(doc, "progress-home");
  const promptText = byId<HTMLElement>(doc, "takeover-text");
  const promptAccept = byId<HTMLButtonElement>(doc, "takeover-accept");
  const promptDecline = byId<HTMLButtonElement>(doc, "takeover-decline");

  let view: LobbySnapshot | null = null;
  let pendingRequestId: string | null = null;
  let requestFrame = 0;

  function hideScreens(): void {
    home.hidden = true;
    lobby.hidden = true;
    progress.hidden = true;
  }

  function setMessage(node: HTMLElement, text: string): void {
    node.textContent = text;
    node.dataset.state = text ? "error" : "ok";
  }

  function refreshHome(message = ""): void {
    const signed = options.signedIn();
    homeCreate.disabled = !signed;
    homeCreateReason.textContent = signed ? "" : "Log in to create a game.";
    homeJoin.disabled = !signed;
    homeJoinReason.textContent = signed ? "" : "Log in to join with code.";
    homeAccount.textContent = signed ? "Account" : "Log in or sign up";
    homeAccountReason.textContent = signed ? "" : "An account is needed for online games.";
    if (message) setMessage(homeMessage, message);
    else homeMessage.textContent = "";
  }

  function showHome(message = ""): void {
    view = null;
    pendingRequestId = null;
    prompt.hidden = true;
    hideScreens();
    home.hidden = false;
    refreshHome(message);
  }

  function showLobbyConnecting(code: string): void {
    hideScreens();
    lobby.hidden = false;
    lobbyCode.textContent = code;
    setMessage(lobbyMessage, "Connecting to the lobby…");
    lobbyPlayers.replaceChildren();
    lobbyNavies.replaceChildren();
    lobbyFlagship.value = "";
    lobbyFlagship.disabled = true;
  }

  function currentPlayer(): LobbySnapshot["players"][number] | null {
    if (!view || !view.you) return null;
    return view.players.find((player) => player.id === view!.you) ?? null;
  }

  function renderLobby(text = ""): void {
    if (!view) return;
    hideScreens();
    lobby.hidden = false;
    lobbyCode.textContent = view.code;
    if (text) setMessage(lobbyMessage, text);
    else lobbyMessage.textContent = "";

    const me = currentPlayer();
    const host = view.you !== null && view.you === view.hostId;

    // Player rows: display name, navy, flagship name, ready flag and host badge.
    lobbyPlayers.replaceChildren();
    for (const player of view.players) {
      const row = doc.createElement("li");
      row.className = "lobby-player";
      row.dataset.player = player.id;
      const name = doc.createElement("span");
      name.className = "lobby-player-name";
      name.textContent = player.name;
      row.append(name);
      if (player.host) {
        const badge = doc.createElement("span");
        badge.className = "lobby-host-badge";
        badge.textContent = "Host";
        row.append(badge);
      }
      const detail = doc.createElement("span");
      detail.className = "lobby-player-detail";
      detail.textContent = `${player.navy ?? "No navy"} · ${player.flagshipName || "No flagship name"}`;
      row.append(detail);
      const ready = doc.createElement("span");
      ready.className = "lobby-ready-flag";
      ready.textContent = player.ready ? "Ready" : "Not ready";
      row.append(ready);
      if (player.id !== view.you) {
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "btn lobby-remove";
        remove.dataset.remove = player.id;
        remove.textContent = "Remove";
        remove.disabled = !host;
        remove.title = host ? `Remove ${player.name}` : "Only the host can remove players";
        remove.setAttribute("aria-label", host
          ? `Remove ${player.name}`
          : `Remove ${player.name}: only the host can remove players`);
        if (!host) {
          const reason = doc.createElement("span");
          reason.className = "lobby-inline-reason";
          reason.textContent = "Only the host can remove players";
          row.append(reason);
        }
        remove.addEventListener("click", () => {
          options.send({ t: "lobbyKick", player: player.id });
        });
        row.append(remove);
      }
      lobbyPlayers.append(row);
    }

    // Four navy cards. A full navy and a ready player keep the button visible.
    lobbyNavies.replaceChildren();
    for (const navy of LOBBY_NAVIES) {
      const card = doc.createElement("article");
      card.className = "lobby-navy-card";
      card.dataset.navy = navy;
      const title = doc.createElement("h3");
      title.textContent = navyLabel(navy);
      card.append(title);
      const members = view.players.filter((player) => player.navy === navy);
      const list = doc.createElement("ul");
      list.className = "lobby-navy-players";
      if (members.length === 0) {
        const empty = doc.createElement("li");
        empty.className = "lobby-navy-empty";
        empty.textContent = "No players";
        list.append(empty);
      }
      for (const member of members) {
        const row = doc.createElement("li");
        row.textContent = member.name;
        list.append(row);
      }
      card.append(list);
      const choose = doc.createElement("button");
      choose.type = "button";
      choose.className = "btn lobby-navy-pick";
      choose.dataset.navy = navy;
      choose.textContent = `Choose ${navy}`;
      choose.setAttribute("aria-pressed", String(me?.navy === navy));
      const full = members.filter((player) => player.id !== view!.you).length >=
        settings.lobby.maxPlayersPerNavy;
      const locked = !me || me.ready;
      choose.disabled = full || locked;
      const reason = full
        ? `Full: ${settings.lobby.maxPlayersPerNavy} players`
        : locked
          ? me?.ready ? "Press Not ready to change your navy." : "Join the lobby to choose a navy."
          : "";
      choose.title = reason;
      if (reason) {
        const note = doc.createElement("span");
        note.className = "lobby-navy-reason";
        note.textContent = reason;
        card.append(note);
      }
      choose.addEventListener("click", () => {
        options.send({ t: "lobbyNavy", navy });
      });
      card.append(choose);
      lobbyNavies.append(card);
    }

    // Flagship name stays editable until Ready.
    if (doc.activeElement !== lobbyFlagship) {
      lobbyFlagship.value = me?.flagshipName ?? "";
    }
    lobbyFlagship.disabled = !me || me.ready;
    lobbyFlagshipReason.textContent = me?.ready
      ? "Flagship name is locked while you are ready."
      : me
        ? `${settings.lobby.flagshipNameMin} to ${settings.lobby.flagshipNameMax} characters, unique in this game.`
        : "Join the lobby to name a flagship.";

    const nameTyped = lobbyFlagship.value.trim().length >= settings.lobby.flagshipNameMin;
    const readyDisabled = !me || (!me.ready && (!me.navy || !nameTyped));
    lobbyReady.disabled = readyDisabled;
    lobbyReady.textContent = me?.ready ? "Not ready" : "Ready";
    const readyReason = !me
      ? "Join the lobby to get ready."
      : me.ready
        ? ""
        : !me.navy
          ? "Choose a navy first."
          : !nameTyped
            ? "Name your flagship first."
            : "";
    lobbyReady.title = readyReason;
    lobbyReadyReason.textContent = readyReason;

    lobbyStart.disabled = !host || view.startReason !== "";
    lobbyStart.title = !host ? "Only the host can start the game." : view.startReason;
    lobbyStartReason.textContent = !host
      ? "Only the host can start the game."
      : view.startReason;

    lobbyItems.checked = view.items;
    lobbyItems.disabled = true;
    lobbyItemsReason.textContent = "Items arrive later";
    lobbyAi.checked = view.ai;
    lobbyAi.disabled = true;
    lobbyAiReason.textContent = "Arrives with AI opponents";
  }

  function showProgress(info: {
    code?: string;
    freeSlots?: number;
    reason?: string;
  }): void {
    hideScreens();
    progress.hidden = false;
    progressCode.textContent = info.code ?? "";
    progressMessage.textContent = "Game in progress";
    const free = info.freeSlots ?? 0;
    progressRequest.disabled = free <= 0;
    const reason = free > 0 ? "" : info.reason || "No free slot";
    progressRequestReason.textContent = reason;
    progressRequest.title = reason;
    if (!progressStatus.textContent) {
      progressStatus.textContent = free > 0
        ? "A disconnected captain's slot can be taken over."
        : "Every captain is online. Watch this screen for a free slot.";
    }
  }

  function showTakeoverPrompt(request: TakeoverPrompt): void {
    pendingRequestId = request.id;
    promptText.textContent =
      `${request.name} asks to take over ${request.targetName} (${request.navy}, ` +
      `${request.flagshipName || "no flagship name"}). Accept?`;
    prompt.hidden = false;
  }

  homeCreate.addEventListener("click", () => {
    if (!options.signedIn()) return refreshHome("Log in to create a game.");
    homeCreate.disabled = true;
    setMessage(homeMessage, "Creating a game…");
    void options.createGame().then((result) => {
      if (result.code) {
        setMessage(homeMessage, `Game ${result.code} created.`);
        options.enterRoom(result.code);
        return;
      }
      homeCreate.disabled = false;
      refreshHome(result.error || "That game could not be created. Try again.");
    }).catch(() => {
      homeCreate.disabled = false;
      refreshHome("Could not reach the game server. Try again.");
    });
  });

  homeJoin.addEventListener("click", () => {
    if (!options.signedIn()) return refreshHome("Log in to join with code.");
    const code = homeCode.value.trim().toUpperCase();
    if (!isJoinCode(code)) {
      return refreshHome("Code must be 5 characters: A to Z and 2 to 9, without O, I, L, 0 or 1.");
    }
    homeJoin.disabled = true;
    setMessage(homeMessage, `Looking for ${code}…`);
    void options.lookupGame(code).then((result) => {
      homeJoin.disabled = false;
      if (result.error) return refreshHome(result.error);
      if (result.status === undefined) {
        return refreshHome("No active game uses that code.");
      }
      homeCode.value = code;
      options.enterRoom(code);
    }).catch(() => {
      homeJoin.disabled = false;
      refreshHome("Could not reach the game server. Try again.");
    });
  });

  homeAccount.addEventListener("click", () => options.openAccount());

  lobbyCopy.addEventListener("click", () => {
    const code = view?.code ?? lobbyCode.textContent ?? "";
    const clipboard = (doc.defaultView?.navigator as Navigator | undefined)?.clipboard;
    if (clipboard?.writeText) {
      void clipboard.writeText(code).then(() => {
        setMessage(lobbyMessage, `Copied ${code}.`);
      }).catch(() => {
        setMessage(lobbyMessage, `Copy failed. Select the code ${code}.`);
      });
      return;
    }
    setMessage(lobbyMessage, `Copy failed. Select the code ${code}.`);
  });

  function sendFlagship(): void {
    if (!currentPlayer() || currentPlayer()?.ready) return;
    options.send({ t: "lobbyFlagship", name: lobbyFlagship.value.trim() });
  }
  lobbyFlagship.addEventListener("change", sendFlagship);
  lobbyFlagship.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") {
      event.preventDefault();
      sendFlagship();
    }
  });
  lobbyFlagship.addEventListener("input", () => {
    if (requestFrame) cancelAnimationFrame(requestFrame);
    const run = () => {
      requestFrame = 0;
      if (view) renderLobby();
    };
    requestFrame = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(run)
      : (setTimeout(run, 0) as unknown as number);
  });

  lobbyReady.addEventListener("click", () => {
    const me = currentPlayer();
    if (!me) return;
    if (!me.ready) {
      // Commit a typed name first; the server checks it is free and valid.
      if (lobbyFlagship.value.trim() !== me.flagshipName) sendFlagship();
      options.send({ t: "lobbyReady", ready: true });
      return;
    }
    options.send({ t: "lobbyReady", ready: false });
  });

  lobbyStart.addEventListener("click", () => {
    if (view?.you === view?.hostId) options.send({ t: "lobbyStart" });
  });

  lobbyLeave.addEventListener("click", () => {
    options.send({ t: "lobbyLeave" });
    options.leaveRoom();
    showHome();
  });

  progressRequest.addEventListener("click", () => {
    if (progressRequest.disabled) return;
    progressStatus.textContent = "Request sent. Waiting for the host.";
    options.send({ t: "takeoverRequest" });
  });

  progressHome.addEventListener("click", () => {
    options.leaveRoom();
    showHome();
  });

  promptAccept.addEventListener("click", () => {
    if (!pendingRequestId) return;
    options.send({ t: "takeoverAnswer", request: pendingRequestId, accept: true });
    pendingRequestId = null;
    prompt.hidden = true;
  });
  promptDecline.addEventListener("click", () => {
    if (!pendingRequestId) return;
    options.send({ t: "takeoverAnswer", request: pendingRequestId, accept: false });
    pendingRequestId = null;
    prompt.hidden = true;
  });

  function handleMessage(message: unknown): boolean {
    if (!message || typeof message !== "object") return false;
    const type = (message as { t?: unknown }).t;
    if (type === "lobby") {
      const snapshot = (message as { lobby?: LobbySnapshot }).lobby;
      if (!snapshot || !Array.isArray(snapshot.players)) return true;
      view = snapshot;
      const text = (message as { text?: unknown }).text;
      renderLobby(typeof text === "string" ? text : "");
      return true;
    }
    if (type === "lobbyError") {
      const text = (message as { text?: unknown }).text;
      if (view) renderLobby(typeof text === "string" ? text : "The lobby refused that.");
      else refreshHome(typeof text === "string" ? text : "The lobby refused that.");
      return true;
    }
    if (type === "lobbyKicked" || type === "lobbyLeft") {
      const text = (message as { text?: unknown }).text;
      options.leaveRoom();
      showHome(typeof text === "string" ? text : "");
      return true;
    }
    if (type === "gameStarted") {
      hideScreens();
      prompt.hidden = true;
      view = null;
      return true;
    }
    if (type === "gameInProgress") {
      const row = message as { code?: unknown; freeSlots?: unknown; reason?: unknown };
      progressStatus.textContent = "";
      showProgress({
        code: typeof row.code === "string" ? row.code : undefined,
        freeSlots: typeof row.freeSlots === "number" ? row.freeSlots : 0,
        reason: typeof row.reason === "string" ? row.reason : undefined,
      });
      return true;
    }
    if (type === "takeoverStatus") {
      const row = message as { ok?: unknown; text?: unknown };
      const text = typeof row.text === "string" ? row.text : "";
      if (!progress.hidden) {
        progressStatus.textContent = text;
        if (row.ok === false && text === "No free slot") {
          progressRequest.disabled = true;
          progressRequestReason.textContent = "No free slot";
        }
      }
      return true;
    }
    if (type === "takeoverRequest") {
      const request = (message as { request?: Partial<TakeoverPrompt> }).request;
      if (request && typeof request.id === "string") {
        showTakeoverPrompt({
          id: request.id,
          name: typeof request.name === "string" ? request.name : "A captain",
          targetName: typeof request.targetName === "string" ? request.targetName : "a captain",
          navy: typeof request.navy === "string" ? request.navy : "No navy",
          flagshipName: typeof request.flagshipName === "string" ? request.flagshipName : "",
        });
      }
      return true;
    }
    return false;
  }

  function audit(width: number, height: number): string[] {
    const screen = !home.hidden ? home : !lobby.hidden ? lobby : !progress.hidden ? progress : null;
    if (!screen) return ["No lobby or home screen is visible."];
    const issues: string[] = [];
    const style = doc.defaultView?.getComputedStyle(screen);
    const declaredWidth = Number.parseFloat(style?.width ?? "");
    if (Number.isFinite(declaredWidth) && declaredWidth > width) {
      issues.push(`${screen.id} is ${declaredWidth}px wide in ${width}px`);
    }
    if (screen.scrollWidth > screen.clientWidth + 1) {
      issues.push(`${screen.id} content is ${screen.scrollWidth}px wide in ${screen.clientWidth}px`);
    }
    for (const node of screen.querySelectorAll<HTMLElement>("button, input, select")) {
      if (node.hidden || node.closest("[hidden]")) continue;
      if (node instanceof HTMLInputElement && node.type === "checkbox") continue;
      const computed = doc.defaultView?.getComputedStyle(node);
      const raw = computed?.minHeight ?? "";
      const minimum = raw === "var(--tap)" ? 44 : Number.parseFloat(raw);
      if (Number.isFinite(minimum) && minimum < 44) {
        issues.push(`${node.id || node.tagName} has a ${minimum}px target`);
      }
    }
    if (height < 360) issues.push("screen is below the smallest supported height");
    return issues;
  }

  refreshHome();
  return {
    refreshHome,
    showHome,
    showLobbyConnecting,
    handleMessage,
    audit,
    visibleScreen: () => !home.hidden ? "home" : !lobby.hidden ? "lobby"
      : !progress.hidden ? "progress" : "none",
    currentLobby: () => view,
  };
}
