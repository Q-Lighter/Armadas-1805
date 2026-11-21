// 4A: real buttons on the Account screen, with a fake account service.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";
import { JSDOM } from "jsdom";

interface AccountUser { id: string; username: string; displayName: string }
interface AccountSession { accessToken: string; user: AccountUser }
interface AccountApi {
  signUp(input: { username: string; password: string; displayName: string }): Promise<string | null>;
  signIn(username: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  session(): Promise<AccountSession | null>;
  freshAccessToken(): Promise<string | null>;
  updateDisplayName(displayName: string): Promise<string | null>;
  changePassword(currentPassword: string, newPassword: string): Promise<string | null>;
  deleteAccount(username: string, room: string): Promise<string | null>;
  keepalive(): Promise<{ ok: boolean; text: string }>;
}
interface Ui {
  open(): void;
  close(): void;
  refresh(): Promise<void>;
  afterDeveloperKeepalive(): Promise<{ ok: boolean; text: string }>;
  audit(width: number, height: number): string[];
}

const bundle = await build({
  entryPoints: ["client/account.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "AccountUi",
  platform: "browser",
  target: "es2022",
  logLevel: "silent",
});
const accountCode = `${bundle.outputFiles[0]!.text}\nwindow.AccountUi = AccountUi;`;
const html = readFileSync("client/index.html", "utf8").replace(
  "</head>",
  `<style>${readFileSync("client/paper.css", "utf8")}</style></head>`,
);

function makeWindow() {
  const dom = new JSDOM(html, { url: "http://localhost/?room=test", runScripts: "outside-only" });
  dom.window.eval(accountCode);
  return dom;
}

const sessionFor = (username: string): AccountSession => ({
  accessToken: "token",
  user: { id: "11111111-1111-4111-8111-111111111111", username, displayName: "Captain Anne" },
});

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

test("account buttons sign up, reject a wrong password, log in, log out, change and delete", async () => {
  const dom = makeWindow();
  const { document, Event } = dom.window;
  let current: AccountSession | null = null;
  const calls: string[] = [];
  const api: AccountApi = {
    async signUp(input) {
      calls.push(`signup:${input.username}:${input.password}:${input.displayName}`);
      current = sessionFor(input.username);
      return null;
    },
    async signIn(username, password) {
      calls.push(`login:${username}:${password}`);
      if (password !== "password") return "Invalid login credentials";
      current = sessionFor(username);
      return null;
    },
    async signOut() { calls.push("logout"); current = null; },
    async session() { return current; },
    async freshAccessToken() { return current?.accessToken ?? null; },
    async updateDisplayName(name) { calls.push(`display:${name}`); return null; },
    async changePassword(currentPassword, nextPassword) {
      calls.push(`password:${currentPassword}:${nextPassword}`);
      return null;
    },
    async deleteAccount(username) {
      calls.push(`delete:${username}`);
      current = null;
      return null;
    },
    async keepalive() { calls.push("keepalive"); return { ok: true, text: "ran" }; },
  };
  const sessionEvents: Array<string | null> = [];
  const ui = (dom.window as unknown as {
    AccountUi: { createAccountUi: (doc: unknown, api: AccountApi, options: {
      room: string; onSession?: (session: AccountSession | null) => void;
    }) => Ui };
  }).AccountUi.createAccountUi(document, api, {
      room: "test-account",
      onSession: (session) => sessionEvents.push(session?.user.username ?? null),
    });
  ui.open();
  await settle();
  assert.equal(document.getElementById("account-screen")!.hidden, false);

  // Terms must be ticked.
  (document.getElementById("account-signup-username") as unknown as { value: string; checked: boolean }).value = "anne";
  (document.getElementById("account-signup-password") as unknown as { value: string; checked: boolean }).value = "password";
  (document.getElementById("account-signup-submit") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.match(document.getElementById("account-message")!.textContent ?? "", /Terms and Privacy/);

  (document.getElementById("account-signup-terms") as unknown as { value: string; checked: boolean }).checked = true;
  (document.getElementById("account-signup-submit") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.ok(calls.includes("signup:anne:password:anne"));
  assert.match(document.getElementById("account-message")!.textContent ?? "", /Account created/);
  assert.equal(document.getElementById("account-member")!.hidden, false);
  assert.equal(document.getElementById("account-menu-name")!.textContent, "Account: Captain Anne");

  (document.getElementById("account-logout") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.equal(document.getElementById("account-guest")!.hidden, false);

  // Wrong password shows a readable message.
  (document.getElementById("account-tab-login") as unknown as { click(): void; disabled: boolean }).click();
  (document.getElementById("account-login-username") as unknown as { value: string; checked: boolean }).value = "anne";
  (document.getElementById("account-login-password") as unknown as { value: string; checked: boolean }).value = "wrongpass";
  (document.getElementById("account-login-submit") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.match(document.getElementById("account-message")!.textContent ?? "", /Wrong username or password/);

  (document.getElementById("account-login-password") as unknown as { value: string; checked: boolean }).value = "password";
  (document.getElementById("account-login-submit") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.equal(document.getElementById("account-member")!.hidden, false);

  (document.getElementById("account-display-name") as unknown as { value: string; checked: boolean }).value = "Captain Anne";
  (document.getElementById("account-save-display") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.ok(calls.includes("display:Captain Anne"));

  (document.getElementById("account-current-password") as unknown as { value: string; checked: boolean }).value = "password";
  (document.getElementById("account-new-password") as unknown as { value: string; checked: boolean }).value = "newpassword";
  (document.getElementById("account-change-password") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.ok(calls.includes("password:password:newpassword"));

  (document.getElementById("account-delete-confirm") as unknown as { value: string; checked: boolean }).value = "wrong";
  (document.getElementById("account-delete") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.match(document.getElementById("account-message")!.textContent ?? "", /Type your username exactly/);

  (document.getElementById("account-delete-confirm") as unknown as { value: string; checked: boolean }).value = "anne";
  (document.getElementById("account-delete") as unknown as { click(): void; disabled: boolean }).click();
  await settle();
  assert.ok(calls.includes("delete:anne"));
  assert.match(document.getElementById("account-message")!.textContent ?? "", /Account deleted/);

  // The layout audit covers the Account screen at the four review sizes.
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 412, height: 915 },
    { width: 740, height: 360 },
  ]) {
    dom.window.innerWidth = size.width;
    dom.window.innerHeight = size.height;
    ui.open();
    await settle();
    assert.equal(ui.audit(size.width, size.height).length, 0,
      `Account layout ${size.width}x${size.height}: ${JSON.stringify(ui.audit(size.width, size.height))}`);
  }

  document.getElementById("account-close")!.dispatchEvent(new Event("click", { bubbles: true }));
  assert.equal(document.getElementById("account-screen")!.hidden, true);
  assert.ok(sessionEvents.includes(null));
});

test("privacy and terms pages exist and explain the account", () => {
  const privacy = readFileSync("client/privacy.html", "utf8");
  const terms = readFileSync("client/terms.html", "utf8");
  assert.match(privacy, /username/i);
  assert.match(privacy, /display name/i);
  assert.match(privacy, /hashed/i);
  assert.match(privacy, /no email/i);
  assert.match(privacy, /Delete account/i);
  assert.match(privacy, /not a legal contract/i);
  assert.match(terms, /lost password cannot be recovered/i);
  assert.match(terms, /not a legal contract/i);
  assert.match(readFileSync("scripts/build.mjs", "utf8"), /privacy\.html/);
  assert.match(readFileSync("server/src/worker.ts", "utf8"), /ASSETS\.fetch/);
});
