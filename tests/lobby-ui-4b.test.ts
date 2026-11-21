// 4B: the real home and lobby buttons with a fake server connection.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { JSDOM } from "jsdom";

import type { LobbySnapshot } from "@naval/shared/lobby";

interface Ui {
  refreshHome(message?: string): void;
  showHome(message?: string): void;
  showLobbyConnecting(code: string): void;
  handleMessage(message: unknown): boolean;
  audit(width: number, height: number): string[];
  visibleScreen(): string;
  currentLobby(): LobbySnapshot | null;
}

const bundle = await build({
  entryPoints: ["client/lobby.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "LobbyUi",
  platform: "browser",
  target: "es2022",
  logLevel: "silent",
});
const lobbyCode = `${bundle.outputFiles[0]!.text}\nwindow.LobbyUi = LobbyUi;`;
const html = readFileSync("client/index.html", "utf8").replace(
  "</head>",
  `<style>${readFileSync("client/paper.css", "utf8")}</style></head>`,
);

function makeWindow() {
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
  dom.window.eval(lobbyCode);
  return dom;
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((done) => setTimeout(done, 5));
  }
}

function parent(): LobbySnapshot["players"][number] {
  return {
    id: "p1",
    name: "Captain Anne",
    navy: null,
    flagshipName: "",
    ready: false,
    host: true,
  };
}

function snapshot(overrides: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    code: "ABCDE",
    you: "p1",
    hostId: "p1",
    players: [parent()],
    items: false,
    ai: false,
    minNavies: 2,
    startReason: "Every player needs a navy.",
    ...overrides,
  };
}

interface Harness {
  dom: JSDOM;
  ui: Ui;
  sent: Array<Record<string, unknown>>;
  entered: string[];
  left: number;
  setSignedIn(value: boolean): void;
}

function makeUi(): Harness {
  const dom = makeWindow();
  const { document } = dom.window;
  const sent: Array<Record<string, unknown>> = [];
  const entered: string[] = [];
  let left = 0;
  let signed = true;
  const ui = (dom.window as unknown as {
    LobbyUi: { createLobbyUi: (doc: any, options: {
      signedIn: () => boolean;
      openAccount: () => void;
      createGame: () => Promise<{ code?: string; error?: string }>;
      lookupGame: (code: string) => Promise<{ status?: string; error?: string }>;
      enterRoom: (code: string) => void;
      leaveRoom: () => void;
      send: (message: Record<string, unknown>) => void;
    }) => Ui };
  }).LobbyUi.createLobbyUi(document, {
    signedIn: () => signed,
    openAccount: () => {},
    createGame: async () => ({ code: "ABCDE" }),
    lookupGame: async (code) => code === "FGHJK" ? { status: "playing" } : {},
    enterRoom: (code) => entered.push(code),
    leaveRoom: () => { left += 1; },
    send: (message) => sent.push(message),
  });
  ui.showHome();
  return {
    dom,
    ui,
    sent,
    entered,
    get left() { return left; },
    setSignedIn: (value) => { signed = value; ui.refreshHome(); },
  };
}

function button(doc: any, id: string): any {
  const node = doc.getElementById(id);
  assert.ok(node, `#${id} exists`);
  return node;
}

function input(doc: any, id: string): any {
  const node = doc.getElementById(id);
  assert.ok(node, `#${id} exists`);
  return node;
}

test("Create game and Join with code need a login and explain why", async () => {
  const harness = makeUi();
  const { document } = harness.dom.window;
  assert.equal(harness.ui.visibleScreen(), "home");
  harness.setSignedIn(false);
  assert.equal(button(document, "home-create").disabled, true);
  assert.match(document.getElementById("home-create-reason")!.textContent ?? "", /Log in/);
  assert.equal(button(document, "home-join").disabled, true);
  assert.match(document.getElementById("home-join-reason")!.textContent ?? "", /Log in/);
  button(document, "home-create").click();
  await settle();
  assert.deepEqual(harness.entered, []);

  harness.setSignedIn(true);
  assert.equal(button(document, "home-create").disabled, false);
  assert.equal(document.getElementById("home-create-reason")!.textContent, "");
  button(document, "home-create").click();
  await settle();
  assert.deepEqual(harness.entered, ["ABCDE"]);

  // A bad code is refused in plain words and never opens a room.
  input(document, "home-code").value = "AB0DE";
  button(document, "home-join").click();
  await settle();
  assert.equal(harness.entered.length, 1);
  assert.match(document.getElementById("home-message")!.textContent ?? "", /5 characters/);

  // A code nobody uses is refused; a live code opens.
  input(document, "home-code").value = "MMMMM";
  button(document, "home-join").click();
  await settle();
  assert.equal(harness.entered.length, 1);
  assert.match(document.getElementById("home-message")!.textContent ?? "", /No active game/);
  input(document, "home-code").value = "fghjk";
  button(document, "home-join").click();
  await settle();
  assert.deepEqual(harness.entered, ["ABCDE", "FGHJK"]);
});

test("the lobby buttons pick a navy, name the flagship, get ready and start", async () => {
  const harness = makeUi();
  const { document, Event } = harness.dom.window;
  harness.ui.handleMessage({ t: "lobby", lobby: snapshot() });
  assert.equal(harness.ui.visibleScreen(), "lobby");
  assert.equal(document.getElementById("lobby-code")!.textContent, "ABCDE");

  // No navy yet: Ready stays visible, disabled, and says what is missing.
  assert.equal(button(document, "lobby-ready").disabled, true);
  assert.match(document.getElementById("lobby-ready-reason")!.textContent ?? "", /Choose a navy/);

  // Pick French.
  const french = document.querySelector('#lobby-navies button[data-navy="French"]');
  assert.ok(french, "French card has a choose button");
  french.click();
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "lobbyNavy", navy: "French" });

  // Name the flagship on change.
  const name = input(document, "lobby-flagship");
  name.value = "Soleil";
  name.dispatchEvent(new Event("change", { bubbles: true }));
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "lobbyFlagship", name: "Soleil" });

  // The server sends the new view: Ready is now enabled.
  harness.ui.handleMessage({
    t: "lobby",
    lobby: snapshot({
      players: [{ ...parent(), navy: "French", flagshipName: "Soleil" }],
      startReason: "Every player must be ready.",
    }),
  });
  assert.equal(button(document, "lobby-ready").disabled, false);
  button(document, "lobby-ready").click();
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "lobbyReady", ready: true });

  // Host cannot start while anyone is not ready, and the reason is visible.
  assert.equal(button(document, "lobby-start").disabled, true);
  assert.match(document.getElementById("lobby-start-reason")!.textContent ?? "", /ready/);

  // Everyone ready: the host starts.
  harness.ui.handleMessage({
    t: "lobby",
    lobby: snapshot({
      players: [{ ...parent(), navy: "French", flagshipName: "Soleil", ready: true }],
      startReason: "",
    }),
  });
  assert.equal(button(document, "lobby-start").disabled, false);
  button(document, "lobby-start").click();
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "lobbyStart" });

  // A ready captain's navy and name are locked, with the reason on screen.
  const lockedNavy = document.querySelector('#lobby-navies button[data-navy="Dutch"]');
  assert.ok(lockedNavy);
  assert.equal(lockedNavy.disabled, true);
  assert.match(document.querySelector("#lobby-navies .lobby-navy-reason")?.textContent ?? "", /Not ready/);
  assert.equal(input(document, "lobby-flagship").disabled, true);
});

test("navy limits, host-only controls and takeover messages show their reasons", async () => {
  const harness = makeUi();
  const { document } = harness.dom.window;
  const twoOthers = [
    { id: "p2", name: "Captain Bob", navy: "British" as const, flagshipName: "Temeraire", ready: false, host: false },
    { id: "p3", name: "Captain Carol", navy: "British" as const, flagshipName: "Soleil", ready: false, host: false },
    parent(),
  ];
  harness.ui.handleMessage({
    t: "lobby",
    lobby: snapshot({ players: twoOthers, startReason: "Every player needs a navy." }),
  });
  const british = document.querySelector('#lobby-navies button[data-navy="British"]');
  assert.ok(british);
  assert.equal(british.disabled, true);
  assert.equal(
    document.querySelector('#lobby-navies [data-navy="British"] .lobby-navy-reason')?.textContent,
    "Full: 2 players",
  );

  // The host may remove another captain; only the host sees an enabled button.
  const remove = document.querySelector('[data-remove="p2"]');
  assert.ok(remove);
  assert.equal(remove.disabled, false);
  remove.click();
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "lobbyKick", player: "p2" });

  // A non-host keeps every button visible, disabled with the reason.
  harness.ui.handleMessage({
    t: "lobby",
    lobby: snapshot({
      you: "p2",
      hostId: "p1",
      players: [
        { ...parent(), host: true },
        { ...twoOthers[0]!, host: false },
      ],
      startReason: "Every player must be ready.",
    }),
  });
  assert.equal(button(document, "lobby-start").disabled, true);
  assert.match(document.getElementById("lobby-start-reason")!.textContent ?? "", /Only the host/);
  const memberRemove = document.querySelector('[data-remove="p1"]');
  assert.ok(memberRemove);
  assert.equal(memberRemove.disabled, true);
  assert.match(document.querySelector(".lobby-inline-reason")?.textContent ?? "", /Only the host/);

  // Host settings stay visible and disabled with their reasons.
  assert.equal(document.getElementById("lobby-items").disabled, true);
  assert.equal(document.getElementById("lobby-items-reason")!.textContent, "Items arrive later");
  assert.equal(document.getElementById("lobby-ai").disabled, true);
  assert.equal(document.getElementById("lobby-ai-reason")!.textContent, "Arrives with AI opponents");

  // A rejected lobby action is shown, never swallowed.
  harness.ui.handleMessage({ t: "lobbyError", text: "British already has 2 players." });
  assert.match(document.getElementById("lobby-message")!.textContent ?? "", /already has 2 players/);
});

test("the waiting card and the host takeover prompt use real buttons", async () => {
  const harness = makeUi();
  const { document } = harness.dom.window;
  harness.ui.handleMessage({
    t: "gameInProgress",
    code: "ABCDE",
    freeSlots: 0,
    reason: "No free slot",
  });
  assert.equal(harness.ui.visibleScreen(), "progress");
  assert.equal(document.getElementById("progress-message")!.textContent, "Game in progress");
  assert.equal(button(document, "progress-request").disabled, true);
  assert.equal(document.getElementById("progress-request-reason")!.textContent, "No free slot");

  harness.ui.handleMessage({
    t: "gameInProgress",
    code: "ABCDE",
    freeSlots: 1,
    reason: "",
  });
  assert.equal(button(document, "progress-request").disabled, false);
  assert.equal(document.getElementById("progress-request-reason")!.textContent, "");
  button(document, "progress-request").click();
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "takeoverRequest" });
  assert.match(document.getElementById("progress-status")!.textContent ?? "", /Request sent/);

  harness.ui.handleMessage({
    t: "takeoverRequest",
    request: {
      id: "r1",
      name: "Captain Dave",
      targetName: "Captain Carol",
      navy: "French",
      flagshipName: "Soleil",
    },
  });
  assert.equal(document.getElementById("takeover-prompt")!.hidden, false);
  assert.match(document.getElementById("takeover-text")!.textContent ?? "", /Captain Dave/);
  button(document, "takeover-accept").click();
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "takeoverAnswer", request: "r1", accept: true });
  assert.equal(document.getElementById("takeover-prompt")!.hidden, true);

  // Leaving the lobby asks for the room to close and shows the menu.
  harness.ui.handleMessage({ t: "lobby", lobby: snapshot() });
  button(document, "lobby-leave").click();
  assert.deepEqual(plain(harness.sent.at(-1)), { t: "lobbyLeave" });
  assert.equal(harness.left, 1);
  assert.equal(harness.ui.visibleScreen(), "home");
});

test("the home and lobby layout audit passes at the four review sizes", async () => {
  const harness = makeUi();
  const { document, window } = harness.dom.window;
  const sizes = [
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 412, height: 915 },
    { width: 740, height: 360 },
  ];
  for (const size of sizes) {
    window.innerWidth = size.width;
    window.innerHeight = size.height;
    harness.ui.showHome();
    const homeIssues = harness.ui.audit(size.width, size.height);
    assert.equal(homeIssues.length, 0,
      `home ${size.width}x${size.height}: ${JSON.stringify(homeIssues)}`);
    harness.ui.handleMessage({
      t: "lobby",
      lobby: snapshot({
        players: [
          { ...parent(), navy: "British", flagshipName: "Victory" },
          {
            id: "p2", name: "Captain Bob", navy: "British", flagshipName: "Temeraire",
            ready: true, host: false,
          },
        ],
        startReason: "Every player needs a navy.",
      }),
    });
    const issues = harness.ui.audit(size.width, size.height);
    assert.equal(issues.length, 0, `lobby ${size.width}x${size.height}: ${JSON.stringify(issues)}`);
  }
  void document;
});
