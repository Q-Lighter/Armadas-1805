// Server-side Supabase account helpers. Secrets are read only from the Worker
// environment; none of this module is imported by the browser client.

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

import { settings } from "@naval/shared/settings";
import type { RoomKind } from "@naval/shared/fog";

export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
}

export interface AccountProfile {
  id: string;
  username: string;
  display_name: string;
}

export interface VerifiedAccount {
  userId: string;
  username: string;
  displayName: string;
}

/** How a token was accepted, for the client's developer login line. */
export type TokenCheckMethod = "jwks" | "supabase";

export type AccessTokenCheck =
  | { ok: true; userId: string; username: string; via: TokenCheckMethod }
  | { ok: false; reason: string };

export type DetailedAuth =
  | { ok: true; account: VerifiedAccount; via: TokenCheckMethod }
  | { ok: false; reason: string };

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** The public config the browser needs. The secret key never appears here. */
export function publicConfig(env: SupabaseEnv): {
  supabaseUrl: string;
  supabasePublishableKey: string;
  accountEmailDomain: string;
} {
  return {
    supabaseUrl: env.SUPABASE_URL ?? "",
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? "",
    accountEmailDomain: settings.accounts.emailDomain,
  };
}

export function supabaseBase(env: SupabaseEnv): string {
  return (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
}

export function hasSupabaseConfig(env: SupabaseEnv): boolean {
  return Boolean(
    supabaseBase(env) &&
    env.SUPABASE_PUBLISHABLE_KEY &&
    env.SUPABASE_SECRET_KEY,
  );
}

/** Headers for the server's own REST requests. Never send these to a client. */
export function secretHeaders(env: SupabaseEnv): Headers {
  const secret = env.SUPABASE_SECRET_KEY ?? "";
  return new Headers({
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  });
}

/** The token's issuer must be this project's Auth endpoint. */
export function issuerFor(env: SupabaseEnv): string {
  return `${supabaseBase(env)}/auth/v1`;
}

export function jwksUrlFor(env: SupabaseEnv): string {
  return `${issuerFor(env)}/.well-known/jwks.json`;
}

function claimString(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value ? value : null;
}

function accountFromPayload(payload: JWTPayload): { userId: string; username: string } | null {
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  const metadata = payload.user_metadata;
  const username = metadata && typeof metadata === "object"
    ? claimString(metadata as JWTPayload, "username")
    : null;
  return { userId: payload.sub, username: username ?? "" };
}

type JwksResult =
  | { ok: true; userId: string; username: string }
  | { ok: false; reason: string; noMatchingKey: boolean };

/** Turn a jose failure into a short reason without ever echoing the token. */
function verifyFailureReason(error: unknown): { reason: string; noMatchingKey: boolean } {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "";
  const claim = typeof (error as { claim?: unknown })?.claim === "string"
    ? (error as { claim: string }).claim
    : "";
  if (code === "ERR_JWT_EXPIRED" || (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && claim === "exp")) {
    return { reason: "Your login has expired.", noMatchingKey: false };
  }
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && claim === "iss") {
    return { reason: "The login token was issued for a different project.", noMatchingKey: false };
  }
  if (code === "ERR_JWKS_NO_MATCHING_KEY") {
    return { reason: "No matching signing key was found.", noMatchingKey: true };
  }
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
    return { reason: "The login token signature is not valid.", noMatchingKey: false };
  }
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    return { reason: "The login token is missing a required claim.", noMatchingKey: false };
  }
  if (code === "ERR_JWT_INVALID") {
    return { reason: "The login token is not valid.", noMatchingKey: false };
  }
  return { reason: "The login token could not be checked.", noMatchingKey: false };
}

async function verifyWithJwks(
  token: string,
  jwks: JWTVerifyGetKey,
  issuer: string,
): Promise<JwksResult> {
  try {
    const result = await jwtVerify(token, jwks, {
      issuer,
      clockTolerance: 0,
      requiredClaims: ["sub", "exp", "iss"],
    });
    const account = accountFromPayload(result.payload);
    return account
      ? { ok: true, ...account }
      : { ok: false, reason: "The login token is missing a user id.", noMatchingKey: false };
  } catch (error) {
    return { ok: false, ...verifyFailureReason(error) };
  }
}

/**
 * Verify a token against a known key set. The tests use this with generated
 * keys; production uses the cached project JWKS below.
 */
export async function verifyAccessTokenWithJwks(
  token: string,
  jwks: JWTVerifyGetKey,
  issuer: string,
): Promise<{ userId: string; username: string } | null> {
  const result = await verifyWithJwks(token, jwks, issuer);
  return result.ok ? { userId: result.userId, username: result.username } : null;
}

const remoteJwks = new Map<string, JWTVerifyGetKey>();

/** A cached remote key set, one per Supabase project URL. */
export function projectJwks(env: SupabaseEnv): JWTVerifyGetKey {
  const url = jwksUrlFor(env);
  const existing = remoteJwks.get(url);
  if (existing) return existing;
  const keys = createRemoteJWKSet(new URL(url), {
    cacheMaxAge: settings.accounts.jwksCacheSeconds * 1_000,
    cooldownDuration: 30_000,
  });
  remoteJwks.set(url, keys);
  return keys;
}

/** For tests: a local key set is an acceptable JWTVerifyGetKey. */
export function localJwks(keys: Parameters<typeof createLocalJWKSet>[0]): JWTVerifyGetKey {
  return createLocalJWKSet(keys);
}

/**
 * One token check for every caller. It first verifies signature, expiry and
 * issuer against the project JWKS. Only a missing matching key falls back to
 * Supabase's own /auth/v1/user endpoint, which covers projects whose signing
 * keys are not exposed in a way the Worker can use directly.
 */
export async function checkAccessToken(
  token: string,
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<AccessTokenCheck> {
  const base = supabaseBase(env);
  if (!base) return { ok: false, reason: "Accounts are not configured." };
  const jwks = await verifyWithJwks(token, projectJwks(env), issuerFor(env));
  if (jwks.ok) {
    return { ok: true, userId: jwks.userId, username: jwks.username, via: "jwks" };
  }
  if (!jwks.noMatchingKey) return { ok: false, reason: jwks.reason };

  // The key set has no key for this token. Let Supabase decide instead of
  // rejecting a session that Supabase still considers valid.
  if (!env.SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, reason: "No matching signing key was found." };
  }
  let response: Response;
  try {
    response = await fetcher(`${base}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
      },
    });
  } catch {
    return { ok: false, reason: "Supabase could not be reached to check the login." };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: response.status === 401 || response.status === 403
        ? "Supabase refused the login token."
        : `Supabase could not check the login token (${response.status}).`,
    };
  }
  const user = await response.json().catch(() => null) as {
    id?: unknown;
    email?: unknown;
    user_metadata?: unknown;
  } | null;
  if (!user || typeof user.id !== "string" || !user.id) {
    return { ok: false, reason: "Supabase returned no user for the login token." };
  }
  const metadata = user.user_metadata && typeof user.user_metadata === "object"
    ? user.user_metadata as JWTPayload
    : null;
  const username = metadata ? claimString(metadata, "username") : null;
  return {
    ok: true,
    userId: user.id,
    username: username ?? (typeof user.email === "string" ? user.email.split("@")[0] ?? "" : ""),
    via: "supabase",
  };
}

/** Backwards-compatible account-only view of the shared token check. */
export async function verifyAccessToken(
  token: string,
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<{ userId: string; username: string } | null> {
  const check = await checkAccessToken(token, env, fetcher);
  return check.ok ? { userId: check.userId, username: check.username } : null;
}

/** Read the profile with the secret key. Names never come from the client. */
export async function fetchProfile(
  userId: string,
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<AccountProfile | null> {
  const base = supabaseBase(env);
  if (!base || !env.SUPABASE_SECRET_KEY) return null;
  const response = await fetcher(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,username,display_name&limit=1`,
    { headers: secretHeaders(env) },
  );
  if (!response.ok) return null;
  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] as Partial<AccountProfile>;
  if (typeof row.id !== "string" || typeof row.username !== "string" ||
      typeof row.display_name !== "string") {
    return null;
  }
  return { id: row.id, username: row.username, display_name: row.display_name };
}

/** Verify the token with the shared check, then read its profile. */
export async function authenticateDetailed(
  token: string,
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<DetailedAuth> {
  const check = await checkAccessToken(token, env, fetcher);
  if (!check.ok) return check;
  const profile = await fetchProfile(check.userId, env, fetcher);
  if (!profile) return { ok: false, reason: "The account profile could not be read." };
  return {
    ok: true,
    via: check.via,
    account: {
      userId: check.userId,
      username: profile.username,
      displayName: profile.display_name || profile.username,
    },
  };
}

/** Account-or-null form used where only the result matters. */
export async function authenticate(
  token: string,
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<VerifiedAccount | null> {
  const result = await authenticateDetailed(token, env, fetcher);
  return result.ok ? result.account : null;
}

export async function readBearerToken(request: Request): Promise<string | null> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** Delete the profile row, then the Auth user, with the secret key. */
export async function deleteSupabaseAccount(
  userId: string,
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = supabaseBase(env);
  if (!base || !env.SUPABASE_SECRET_KEY) {
    return { ok: false, error: "Accounts are not configured." };
  }
  // Delete the Auth user first; the profile foreign key cascades with it. A
  // second explicit profile delete also cleans up any profile left behind.
  const user = await fetcher(
    `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: secretHeaders(env) },
  );
  if (!user.ok) {
    return { ok: false, error: "The account could not be deleted." };
  }
  const profile = await fetcher(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: secretHeaders(env) },
  );
  if (!profile.ok) {
    return { ok: false, error: "The profile could not be deleted." };
  }
  return { ok: true };
}

/** One tiny read a day keeps a free Supabase project awake. */
export async function runKeepalive(
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<{ ok: boolean; text: string }> {
  const base = supabaseBase(env);
  if (!base || !env.SUPABASE_SECRET_KEY) {
    return { ok: false, text: "Accounts are not configured." };
  }
  try {
    const response = await fetcher(
      `${base}/rest/v1/keepalive?select=id&limit=1`,
      { headers: secretHeaders(env) },
    );
    if (!response.ok) {
      return { ok: false, text: `Keepalive failed (${response.status}).` };
    }
    return { ok: true, text: "Keepalive ran. Supabase answered." };
  } catch {
    return { ok: false, text: "Keepalive could not reach Supabase." };
  }
}

/** Ask one room to apply the account-deletion resignation. */
export async function resignInRoom(
  roomId: string,
  userId: string,
  env: SupabaseEnv,
  roomFetch: (request: Request) => Promise<Response>,
  roomKind: RoomKind,
): Promise<boolean> {
  if (roomKind === "normal" && !roomId) return false;
  if (!roomId || !env.SUPABASE_SECRET_KEY) return false;
  try {
    const response = await roomFetch(new Request("https://room.internal/account-delete", {
      method: "POST",
      headers: {
        "x-account-id": userId,
        "x-admin-key": env.SUPABASE_SECRET_KEY,
      },
    }));
    return response.ok;
  } catch {
    return false;
  }
}
