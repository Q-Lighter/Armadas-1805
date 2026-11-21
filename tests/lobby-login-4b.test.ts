// 4B-fix: the home screen must refresh a login before each lobby call, show
// the server's reason, and sign out with the Account screen open on a 401.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { JSDOM } from "jsdom";

interface AccountUser { id: string; username: string; displayName: string }
interface Session { accessToken: string; user: AccountUser; expiresAt?: number }

const NativeResponse = globalThis.Response;

const bundle = await build({
  stdin: {
    contents: `
      import { createAccountUi } from "./client/account.ts";
      import { createLobbyUi } from "./client/lobby.ts";
      import { createLobbyLogin, freshAccessTokenFrom, tokenNeedsRefresh } from "./client/lobbyLogin.ts";
      window.__mods = { createAccountUi, createLobbyUi, createLobbyLogin, freshAccessTokenFrom, tokenNeedsRefresh };
    `,
    resolveDir: process.cwd(),
    sourcefile: "lobby-login-test.ts",
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "silent",
});
const code = bundle.outputFiles[0]!.text;
const html = readFileSync("client/index.html", "utf8").replace(
  "</head>",
  `<style>${readFileSync("client/paper.css", "utf8")}</style></head>`,
);

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((done) => setTimeout(done, 5));
  }
}

function makeDocument() {
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
  dom.window.eval(code);
  return dom;
}

function fakeApi(state: { session: Session | null; signedOut: number }) {
  return {
    async signUp() { return null; },
    async signIn() { return null; },
    async signOut() { state.signedOut += 1; state.session = null; },
    async session() { return state.session; },
    async freshAccessToken() { return state.session?.accessToken ?? null; },
    async updateDisplayName() { return null; },
    async changePassword() { return null; },
    async deleteAccount() { return null; },
    async keepalive() { return { ok: true, text: "ran" }; },
  };
}

test("a lobby call asks for a fresh token first and shows the server reason", async () => {
  const dom = makeDocument();
  const { document } = dom.window;
  const mods = (dom.window as unknown as { __mods: any }).__mods;
  const state = {
    session: {
      accessToken: "fresh-token",
      expiresAt: Date.now() + 30_000,
      user: { id: "11111111-1111-4111-8111-111111111111", username: "anne", displayName: "Captain Anne" },
    } as Session | null,
    signedOut: 0,
  };
  const api = fakeApi(state);
  const order: string[] = [];
  const debug: string[] = [];
  const checks: string[] = [];
  const fresh = api.freshAccessToken;
  api.freshAccessToken = async () => {
    order.push("fresh");
    return fresh();
  };
  const login = mods.createLobbyLogin({
    api: () => api,
    session: () => state.session,
    setSession: (next: Session | null) => { state.session = next; },
    openAccount: () => { throw new Error("must not open Account for a good token"); },
    onExpired: () => { throw new Error("must not expire a good token"); },
    onDebug: (step: string) => debug.push(step),
    onTokenCheck: (result: string) => checks.push(result),
    fetch: async (_input: string, init: RequestInit) => {
      order.push("fetch");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Authorization"), "Bearer fresh-token");
      return new NativeResponse(JSON.stringify({ ok: true, code: "ABCDE", auth: "jwks" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const result = await login.createGame();
  assert.equal(result.code, "ABCDE");
  assert.deepEqual(order, ["fresh", "fetch"]);
  assert.equal(checks.at(-1), "accepted (JWKS)");
  assert.ok(debug.some((line: string) => /Login token is ready/.test(line)));

  // The 60-second window is the rule used by supabaseAccount.
  assert.equal(mods.tokenNeedsRefresh(Date.now() + 30_000), true);
  assert.equal(mods.tokenNeedsRefresh(Date.now() + 120_000), false);

  // A session expiring inside 60 seconds refreshes before its token is used.
  let refreshes = 0;
  const expiring = await mods.freshAccessTokenFrom(
    async () => ({ accessToken: "old-token", expiresAt: Date.now() + 30_000 }),
    async () => { refreshes += 1; return { accessToken: "refreshed-token" }; },
  );
  assert.equal(expiring, "refreshed-token");
  assert.equal(refreshes, 1);
  const stillValid = await mods.freshAccessTokenFrom(
    async () => ({ accessToken: "current-token", expiresAt: Date.now() + 120_000 }),
    async () => { throw new Error("a valid session must not refresh"); },
  );
  assert.equal(stillValid, "current-token");
  assert.equal(document.getElementById("account-screen")!.hidden, true);
});

test("a 401 signs out, shows the expired message and opens Account", async () => {
  const dom = makeDocument();
  const { document } = dom.window;
  const mods = (dom.window as unknown as { __mods: any }).__mods;
  const state = {
    session: {
      accessToken: "stale-token",
      expiresAt: Date.now() + 120_000,
      user: { id: "11111111-1111-4111-8111-111111111111", username: "anne", displayName: "Captain Anne" },
    } as Session | null,
    signedOut: 0,
  };
  const api = fakeApi(state);
  const debug: string[] = [];
  const checks: string[] = [];
  const accountUi = mods.createAccountUi(document, api, { room: "" });
  let ui: any = null;
  const login = mods.createLobbyLogin({
    api: () => api,
    session: () => state.session,
    setSession: (next: Session | null) => { state.session = next; },
    openAccount: (message?: string) => accountUi.open(message),
    onExpired: (message: string) => ui.showHome(message),
    onDebug: (step: string) => debug.push(step),
    onTokenCheck: (result: string) => checks.push(result),
    fetch: async () => new NativeResponse(
      JSON.stringify({ ok: false, error: "The login token signature is not valid." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ),
  });
  ui = mods.createLobbyUi(document, {
    signedIn: () => state.session !== null,
    openAccount: (message?: string) => accountUi.open(message),
    createGame: () => login.createGame(),
    lookupGame: (joinCode: string) => login.lookupGame(joinCode),
    enterRoom: () => { throw new Error("a 401 must not enter a room"); },
    leaveRoom: () => {},
    send: () => {},
  });
  ui.showHome();
  (document.getElementById("home-create") as unknown as { click(): void }).click();
  await settle();

  assert.equal(state.session, null);
  assert.equal(state.signedOut, 1);
  assert.equal(document.getElementById("account-screen")!.hidden, false);
  assert.match(document.getElementById("account-message")!.textContent ?? "",
    /Your login has expired, please log in again/);
  assert.match(document.getElementById("home-message")!.textContent ?? "",
    /Your login has expired, please log in again/);
  assert.equal(checks.at(-1),
    "rejected: The login token signature is not valid.");
  assert.ok(debug.some((line: string) => /Server rejected the login token/.test(line)));
  assert.equal(debug.join(" ").includes("stale-token"), false);
});

test("a non-401 server error is shown on the home screen", async () => {
  const dom = makeDocument();
  const { document } = dom.window;
  const mods = (dom.window as unknown as { __mods: any }).__mods;
  const state = {
    session: {
      accessToken: "good-token",
      expiresAt: Date.now() + 120_000,
      user: { id: "11111111-1111-4111-8111-111111111111", username: "anne", displayName: "Captain Anne" },
    } as Session | null,
    signedOut: 0,
  };
  const api = fakeApi(state);
  const login = mods.createLobbyLogin({
    api: () => api,
    session: () => state.session,
    setSession: (next: Session | null) => { state.session = next; },
    openAccount: () => {},
    onExpired: () => {},
    onDebug: () => {},
    onTokenCheck: () => {},
    fetch: async () => new NativeResponse(
      JSON.stringify({ ok: false, error: "That game could not be created. Try again." }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ),
  });
  const ui = mods.createLobbyUi(document, {
    signedIn: () => state.session !== null,
    openAccount: () => {},
    createGame: () => login.createGame(),
    lookupGame: (joinCode: string) => login.lookupGame(joinCode),
    enterRoom: () => { throw new Error("a failed create must not enter a room"); },
    leaveRoom: () => {},
    send: () => {},
  });
  ui.showHome();
  (document.getElementById("home-create") as unknown as { click(): void }).click();
  await settle();
  assert.match(document.getElementById("home-message")!.textContent ?? "",
    /That game could not be created/);
  assert.equal(document.getElementById("home-create")!.hasAttribute("disabled"), false);
});
