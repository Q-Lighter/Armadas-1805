// Lobby login helper. Every Create game and Join with code call asks Supabase
// for a fresh token first and handles a server 401 in one place, so the home
// screen and the Account screen can never disagree about being logged in.
//
// This module never logs or displays a token, only its expiry and the server's
// token-check result.

import type { AccountApi, AccountSession } from "./account.js";

export interface LobbyCallResult {
  code?: string;
  status?: string;
  error?: string;
  /** "jwks" or "supabase" when the server accepted the token. */
  auth?: string;
}

export interface LobbyLoginOptions {
  api: () => AccountApi | null;
  session: () => AccountSession | null;
  setSession: (session: AccountSession | null) => void;
  openAccount: (message?: string) => void;
  onExpired: (message: string) => void;
  onDebug: (step: string) => void;
  /** "accepted (JWKS)", "accepted (Supabase)" or "rejected: reason". */
  onTokenCheck: (result: string) => void;
  fetch?: typeof fetch;
}

export const LOGIN_EXPIRED_MESSAGE = "Your login has expired, please log in again.";

/** True when a token expires inside the 60-second safety window. */
export function tokenNeedsRefresh(
  expiresAtMs: number | null | undefined,
  nowMs = Date.now(),
): boolean {
  return Boolean(expiresAtMs && expiresAtMs - nowMs <= 60_000);
}

/** Read the session, refreshing only when it is inside the safety window. */
export async function freshAccessTokenFrom(
  read: () => Promise<{ accessToken: string; expiresAt?: number | null } | null>,
  refresh: () => Promise<{ accessToken: string } | null>,
  nowMs = Date.now(),
): Promise<string | null> {
  const session = await read();
  if (!session) return null;
  if (!tokenNeedsRefresh(session.expiresAt, nowMs)) return session.accessToken;
  const next = await refresh();
  return next?.accessToken ?? null;
}

export function createLobbyLogin(options: LobbyLoginOptions): {
  createGame: () => Promise<LobbyCallResult>;
  lookupGame: (code: string) => Promise<LobbyCallResult>;
} {
  const fetcher = options.fetch ?? fetch;

  function debug(step: string): void {
    options.onDebug(step);
  }

  async function freshToken(): Promise<string | null> {
    const api = options.api();
    if (!api) {
      debug("No account service is configured.");
      return null;
    }
    debug("Asking Supabase for the current login session.");
    let token: string | null = null;
    try {
      token = await api.freshAccessToken();
    } catch {
      token = null;
    }
    if (!token) {
      debug("Supabase has no valid login session.");
      return null;
    }
    // Keep the header and Account screen in step with the session that was
    // used for the call, including a token refreshed a moment ago.
    try {
      const session = await api.session();
      if (session) options.setSession(session);
    } catch {
      // The token is still usable even if the profile read fails.
    }
    debug("Login token is ready.");
    return token;
  }

  async function expire(reason: string): Promise<LobbyCallResult> {
    const api = options.api();
    debug(`Server rejected the login token: ${reason}`);
    options.onTokenCheck(`rejected: ${reason}`);
    options.setSession(null);
    // Sign out before opening Account, so it cannot briefly show the old
    // session as still logged in.
    await api?.signOut().catch(() => null);
    options.onExpired(LOGIN_EXPIRED_MESSAGE);
    options.openAccount(LOGIN_EXPIRED_MESSAGE);
    return { error: LOGIN_EXPIRED_MESSAGE };
  }

  async function send(
    path: string,
    init: RequestInit,
    missingLogin: string,
  ): Promise<LobbyCallResult> {
    const token = await freshToken();
    if (!token) return { error: missingLogin };

    let response: Response;
    try {
      response = await fetcher(path, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      debug("Could not reach the game server.");
      return { error: "Could not reach the game server. Try again." };
    }
    const data = await response.json().catch(() => null) as {
      ok?: boolean; code?: string; status?: string; found?: boolean;
      error?: string; auth?: string;
    } | null;

    if (response.status === 401) {
      return expire(data?.error || "The server refused the login token.");
    }
    if (!response.ok || data?.ok === false) {
      const error = data?.error || "The game server refused the request.";
      debug(`Game server answered ${response.status}: ${error}`);
      return { error };
    }
    if (data?.auth) {
      const accepted = `accepted (${data.auth === "supabase" ? "Supabase" : "JWKS"})`;
      options.onTokenCheck(accepted);
      debug(`Server token check: ${accepted}.`);
    } else {
      debug(`Game server answered ${response.status}.`);
    }
    return {
      code: data?.code,
      status: data?.found === false ? undefined : data?.status,
      auth: data?.auth,
    };
  }

  return {
    createGame: () => send("/api/lobby/create", { method: "POST" }, "Log in to create a game."),
    lookupGame: (code) => send(
      `/api/lobby/code?code=${encodeURIComponent(code)}`,
      { method: "GET" },
      "Log in to join a game.",
    ),
  };
}
