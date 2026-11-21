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

/**
 * Verify a token against a known key set. The tests use this with generated
 * keys; production uses the cached project JWKS below.
 */
export async function verifyAccessTokenWithJwks(
  token: string,
  jwks: JWTVerifyGetKey,
  issuer: string,
): Promise<{ userId: string; username: string } | null> {
  try {
    const result = await jwtVerify(token, jwks, {
      issuer,
      clockTolerance: 0,
      requiredClaims: ["sub", "exp", "iss"],
    });
    return accountFromPayload(result.payload);
  } catch {
    return null;
  }
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

export async function verifyAccessToken(
  token: string,
  env: SupabaseEnv,
): Promise<{ userId: string; username: string } | null> {
  if (!supabaseBase(env)) return null;
  return verifyAccessTokenWithJwks(token, projectJwks(env), issuerFor(env));
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

/** Verify both the token and its profile. */
export async function authenticate(
  token: string,
  env: SupabaseEnv,
  fetcher: FetchLike = fetch,
): Promise<VerifiedAccount | null> {
  const claims = await verifyAccessToken(token, env);
  if (!claims) return null;
  const profile = await fetchProfile(claims.userId, env, fetcher);
  if (!profile) return null;
  return {
    userId: claims.userId,
    username: profile.username,
    displayName: profile.display_name || profile.username,
  };
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
