// The Account screen. This file only talks to an AccountApi, so the same
// buttons can be tested with a fake service and no Supabase calls.

import {
  displayNameError,
  normalizeUsername,
  passwordError,
  usernameError,
} from "@naval/shared/accounts";

export interface AccountUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AccountSession {
  accessToken: string;
  user: AccountUser;
  /** Unix milliseconds, when the access token stops being valid. */
  expiresAt?: number | null;
}

export interface AccountApi {
  signUp(input: { username: string; password: string; displayName: string }): Promise<string | null>;
  signIn(username: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  session(): Promise<AccountSession | null>;
  /** Current token, refreshing inside 60 seconds of expiry. */
  freshAccessToken(): Promise<string | null>;
  updateDisplayName(displayName: string): Promise<string | null>;
  changePassword(currentPassword: string, newPassword: string): Promise<string | null>;
  deleteAccount(username: string, room: string): Promise<string | null>;
  keepalive(): Promise<{ ok: boolean; text: string }>;
}

/** Shown when /api/config had no Supabase URL or publishable key. */
export const ACCOUNT_CONFIG_MISSING_MESSAGE =
  "The game server is missing its Supabase settings. Tell the host.";

/**
 * An AccountApi for a server without Supabase settings. The screen still
 * opens, so the login button is never a dead end, and every action says what
 * the host has to fix.
 */
export function unavailableAccountApi(
  message = ACCOUNT_CONFIG_MISSING_MESSAGE,
): AccountApi {
  return {
    async signUp() { return message; },
    async signIn() { return message; },
    async signOut() {},
    async session() { return null; },
    async freshAccessToken() { return null; },
    async updateDisplayName() { return message; },
    async changePassword() { return message; },
    async deleteAccount() { return message; },
    async keepalive() { return { ok: false, text: message }; },
  };
}

export interface AccountUiOptions {
  room: string;
  onSession?: (session: AccountSession | null) => void;
  /** Shown whenever Account opens without a message, e.g. no Supabase config. */
  unavailableMessage?: string;
}

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const node = doc.getElementById(id);
  if (!node) throw new Error(`Account screen is missing #${id}`);
  return node as T;
}

function friendlyError(raw: string): string {
  if (/invalid login credentials/i.test(raw)) return "Wrong username or password.";
  if (/user already registered|database error/i.test(raw)) {
    return "That username is already taken or the profile could not be created.";
  }
  if (/password should be at least/i.test(raw)) return "Password must be at least 8 characters.";
  return raw || "That did not work. Try again.";
}

export function createAccountUi(
  doc: Document,
  api: AccountApi,
  options: AccountUiOptions,
): {
  open: (message?: string) => void;
  close: () => void;
  refresh: () => Promise<void>;
  afterDeveloperKeepalive: () => Promise<{ ok: boolean; text: string }>;
  audit: (width: number, height: number) => string[];
} {
  const screen = byId<HTMLElement>(doc, "account-screen");
  const closeButton = byId<HTMLButtonElement>(doc, "account-close");
  const message = byId<HTMLElement>(doc, "account-message");
  const menuName = byId<HTMLElement>(doc, "account-menu-name");
  const guestPanel = byId<HTMLElement>(doc, "account-guest");
  const memberPanel = byId<HTMLElement>(doc, "account-member");
  const signedInAs = byId<HTMLElement>(doc, "account-signed-in-as");
  const signupForm = byId<HTMLFormElement>(doc, "account-signup-form");
  const loginForm = byId<HTMLFormElement>(doc, "account-login-form");
  const signupUsername = byId<HTMLInputElement>(doc, "account-signup-username");
  const signupPassword = byId<HTMLInputElement>(doc, "account-signup-password");
  const signupDisplay = byId<HTMLInputElement>(doc, "account-signup-display");
  const signupTerms = byId<HTMLInputElement>(doc, "account-signup-terms");
  const loginUsername = byId<HTMLInputElement>(doc, "account-login-username");
  const loginPassword = byId<HTMLInputElement>(doc, "account-login-password");
  const displayInput = byId<HTMLInputElement>(doc, "account-display-name");
  const saveDisplay = byId<HTMLButtonElement>(doc, "account-save-display");
  const currentPassword = byId<HTMLInputElement>(doc, "account-current-password");
  const newPassword = byId<HTMLInputElement>(doc, "account-new-password");
  const changePasswordButton = byId<HTMLButtonElement>(doc, "account-change-password");
  const deleteConfirm = byId<HTMLInputElement>(doc, "account-delete-confirm");
  const deleteButton = byId<HTMLButtonElement>(doc, "account-delete");
  const logoutButton = byId<HTMLButtonElement>(doc, "account-logout");
  const signupTab = byId<HTMLButtonElement>(doc, "account-tab-signup");
  const loginTab = byId<HTMLButtonElement>(doc, "account-tab-login");
  let session: AccountSession | null = null;

  function say(text: string, error = false): void {
    message.textContent = text;
    message.dataset.state = error ? "error" : "ok";
  }

  function setTab(tab: "signup" | "login"): void {
    signupForm.hidden = tab !== "signup";
    loginForm.hidden = tab !== "login";
    signupTab.setAttribute("aria-pressed", String(tab === "signup"));
    loginTab.setAttribute("aria-pressed", String(tab === "login"));
  }

  function render(): void {
    const member = session !== null;
    guestPanel.hidden = member;
    memberPanel.hidden = !member;
    menuName.textContent = session
      ? `Account: ${session.user.displayName}`
      : "Account (guest)";
    if (session) {
      signedInAs.textContent = `Signed in as @${session.user.username}`;
      displayInput.value = session.user.displayName;
    }
    deleteButton.disabled = !member;
    deleteButton.title = member ? "" : "Log in to delete an account.";
  }

  async function run(action: () => Promise<string | null>, success: string): Promise<void> {
    try {
      const error = await action();
      if (error) say(friendlyError(error), true);
      else say(success);
    } catch {
      say("Could not reach the account service. Try again.", true);
    }
  }

  signupTab.addEventListener("click", () => setTab("signup"));
  loginTab.addEventListener("click", () => setTab("login"));
  closeButton.addEventListener("click", () => {
    screen.hidden = true;
  });

  signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = signupUsername.value.trim();
    const error = usernameError(username) ??
      passwordError(signupPassword.value) ??
      displayNameError(signupDisplay.value.trim() || username);
    if (error) return say(error, true);
    if (!signupTerms.checked) {
      return say("Tick I agree to the Terms and Privacy page.", true);
    }
    void api.signUp({
      username,
      password: signupPassword.value,
      displayName: signupDisplay.value.trim() || username,
    }).then(async (failure) => {
      if (failure) return say(friendlyError(failure), true);
      await refresh();
      if (!session) {
        return say(
          "Account created, but sign-in is not available. Email confirmation must be off in Supabase.",
          true,
        );
      }
      signupForm.reset();
      signupDisplay.value = "";
      say("Account created. You are logged in.");
    }).catch(() => say("Could not reach the account service. Try again.", true));
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = loginUsername.value.trim();
    const error = usernameError(username);
    if (error) return say(error, true);
    void api.signIn(username, loginPassword.value)
      .then(async (failure) => {
        if (failure) return say(friendlyError(failure), true);
        await refresh();
        loginForm.reset();
        say("Logged in.");
        options.onSession?.(session);
      })
      .catch(() => say("Could not reach the account service. Try again.", true));
  });

  logoutButton.addEventListener("click", () => {
    void api.signOut().then(async () => {
      await refresh();
      say("Logged out. Guests can only use test rooms.");
      options.onSession?.(null);
    });
  });

  saveDisplay.addEventListener("click", () => {
    const name = displayInput.value.trim();
    const error = displayNameError(name);
    if (error) return say(error, true);
    void run(() => api.updateDisplayName(name), "Display name saved.").then(refresh);
  });

  changePasswordButton.addEventListener("click", () => {
    const error = passwordError(newPassword.value);
    if (error) return say(error, true);
    if (!currentPassword.value) return say("Enter your current password.", true);
    void run(
      () => api.changePassword(currentPassword.value, newPassword.value),
      "Password changed.",
    ).then(() => {
      currentPassword.value = "";
      newPassword.value = "";
    });
  });

  deleteButton.addEventListener("click", () => {
    if (!session) return say("Log in to delete an account.", true);
    if (normalizeUsername(deleteConfirm.value) !== normalizeUsername(session.user.username)) {
      return say("Type your username exactly to confirm deletion.", true);
    }
    deleteButton.disabled = true;
    void api.deleteAccount(session.user.username, options.room)
      .then(async (error) => {
        deleteButton.disabled = false;
        if (error) return say(error, true);
        session = null;
        deleteConfirm.value = "";
        render();
        say("Account deleted.");
        options.onSession?.(null);
      })
      .catch(() => {
        deleteButton.disabled = false;
        say("Could not reach the account service. Try again.", true);
      });
  });

  async function refresh(): Promise<void> {
    session = await api.session().catch(() => null);
    render();
    options.onSession?.(session);
  }

  render();
  setTab("signup");

  return {
    open: (message = "") => {
      screen.hidden = false;
      const text = message || options.unavailableMessage || "";
      say(text, Boolean(text));
      void refresh();
    },
    close: () => {
      screen.hidden = true;
    },
    refresh,
    afterDeveloperKeepalive: () => api.keepalive(),
    audit: (width, height) => {
      if (screen.hidden) return ["Account screen is hidden."];
      const issues: string[] = [];
      const style = doc.defaultView?.getComputedStyle(screen);
      const declaredWidth = Number.parseFloat(style?.width ?? "");
      if (Number.isFinite(declaredWidth) && declaredWidth > width) {
        issues.push(`screen is ${declaredWidth}px wide in ${width}px`);
      }
      for (const node of screen.querySelectorAll<HTMLElement>("button, input")) {
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
    },
  };
}
