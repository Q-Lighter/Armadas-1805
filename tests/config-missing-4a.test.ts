// 4A-fix: an empty Supabase config must still open Account and say why.
// The real home button and the real Account screen are used with an AccountApi
// that has no Supabase settings, the same way the client runs without config.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { JSDOM } from "jsdom";

const html = readFileSync("client/index.html", "utf8");

async function bundle(entry: string, name: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    globalName: name,
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  return `${result.outputFiles[0]!.text}\nwindow.${name} = ${name};`;
}

const accountCode = await bundle("client/account.ts", "AccountUi");
const lobbyCode = await bundle("client/lobby.ts", "LobbyUi");

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((done) => setTimeout(done, 5));
  }
}

interface AccountUiModule {
  ACCOUNT_CONFIG_MISSING_MESSAGE: string;
  unavailableAccountApi: (message?: string) => unknown;
  createAccountUi: (doc: any, api: unknown, options: {
    room: string;
    unavailableMessage?: string;
  }) => { open: (message?: string) => void };
}

interface LobbyUiModule {
  createLobbyUi: (doc: any, options: {
    signedIn: () => boolean;
    openAccount: (message?: string) => void;
    createGame: () => Promise<{ code?: string }>;
    lookupGame: (code: string) => Promise<{ status?: string }>;
    enterRoom: (code: string) => void;
    leaveRoom: () => void;
    send: (message: Record<string, unknown>) => void;
  }) => { showHome: (message?: string) => void };
}

test("a missing Supabase config still opens Account and names the host", async () => {
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" });
  const page = dom.window as unknown as {
    eval: (code: string) => void;
    document: any;
    AccountUi: AccountUiModule;
    LobbyUi: LobbyUiModule;
  };
  page.eval(accountCode);
  page.eval(lobbyCode);
  const { document, AccountUi, LobbyUi } = page;

  const message = "The game server is missing its Supabase settings. Tell the host.";
  assert.equal(AccountUi.ACCOUNT_CONFIG_MISSING_MESSAGE, message);

  // This is the client's no-config path: no Supabase API, and the Account
  // screen still exists so the login button has somewhere to go.
  const accountUi = AccountUi.createAccountUi(
    document,
    AccountUi.unavailableAccountApi(),
    { room: "ABCDE", unavailableMessage: message },
  );
  LobbyUi.createLobbyUi(document, {
    signedIn: () => false,
    openAccount: (text) => accountUi.open(text),
    createGame: async () => ({}),
    lookupGame: async () => ({}),
    enterRoom: () => {},
    leaveRoom: () => {},
    send: () => {},
  }).showHome();

  const loginButton = document.getElementById("home-account") as {
    click(): void;
    disabled: boolean;
  };
  assert.equal(loginButton.disabled, false);
  loginButton.click();
  await settle();
  assert.equal(document.getElementById("account-screen").hidden, false);
  assert.equal(document.getElementById("account-message").textContent, message);

  // The Account screen's own buttons answer with the same words instead of
  // doing nothing behind a form that cannot work.
  document.getElementById("account-tab-login").click();
  document.getElementById("account-login-username").value = "anne";
  document.getElementById("account-login-password").value = "password";
  document.getElementById("account-login-submit").click();
  await settle();
  assert.equal(document.getElementById("account-message").textContent, message);
});

test("the Developer sheet has a Config loaded line", () => {
  const dom = new JSDOM(html, { url: "http://localhost/" });
  const line = dom.window.document.getElementById("config-state");
  assert.ok(line, "#config-state exists");
  assert.match(line.textContent ?? "", /^Config loaded: (yes|no)/);
  assert.match(readFileSync("client/main.ts", "utf8"), /Config loaded: yes/);
});
