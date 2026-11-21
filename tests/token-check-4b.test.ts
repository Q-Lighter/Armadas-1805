// 4B-fix: one server token check for every caller, with the Supabase
// /auth/v1/user fallback when the JWKS has no matching key.

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

const NativeResponse = globalThis.Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new NativeResponse(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function keys(kid = "test-key") {
  const pair = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = kid;
  return {
    pair,
    jwks: { keys: [publicJwk] },
    token: (options: {
      kid?: string;
      key?: typeof pair.privateKey;
      issuer: string;
      expiresIn?: number;
      sub?: string;
    }) => new SignJWT({ user_metadata: { username: "anne" } })
      .setProtectedHeader({ alg: "ES256", kid: options.kid ?? kid })
      .setSubject(options.sub ?? "11111111-1111-4111-8111-111111111111")
      .setIssuer(options.issuer)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(options.key ?? pair.privateKey),
  };
}

type Check = (
  token: string,
  env: { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string; SUPABASE_SECRET_KEY: string },
) => Promise<
  | { ok: true; userId: string; username: string; via: "jwks" | "supabase" }
  | { ok: false; reason: string }
>;

test("the shared check accepts a valid token and names real failures", async () => {
  const base = `https://token-check-${Date.now()}.test`;
  const issuer = `${base}/auth/v1`;
  const signed = await keys();
  const other = await keys("other-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return jsonResponse(signed.jwks);
    return jsonResponse({}, 404);
  }) as typeof fetch;

  try {
    const { checkAccessToken } = await import(
      pathToFileURL(resolve("server/dist/accountAuth.js")).href
    ) as { checkAccessToken: Check };
    const env = {
      SUPABASE_URL: base,
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: "secret",
    };

    const valid = await checkAccessToken(
      await signed.token({ issuer }),
      env,
    );
    assert.equal(valid.ok, true);
    assert.equal(valid.ok && valid.via, "jwks");
    assert.equal(valid.ok && valid.userId, "11111111-1111-4111-8111-111111111111");

    const expired = await checkAccessToken(
      await signed.token({ issuer, expiresIn: -1 }),
      env,
    );
    assert.deepEqual(expired, { ok: false, reason: "Your login has expired." });

    const wrongIssuer = await checkAccessToken(
      await signed.token({ issuer: "https://other.test/auth/v1" }),
      env,
    );
    assert.deepEqual(wrongIssuer, {
      ok: false,
      reason: "The login token was issued for a different project.",
    });

    const badSignature = await checkAccessToken(
      await signed.token({ issuer, key: other.pair.privateKey }),
      env,
    );
    assert.deepEqual(badSignature, {
      ok: false,
      reason: "The login token signature is not valid.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("no matching key falls back to Supabase /auth/v1/user and accepts", async () => {
  const base = `https://token-fallback-${Date.now()}.test`;
  const issuer = `${base}/auth/v1`;
  const jwksKeys = await keys("known-key");
  const unknown = await keys("unknown-key");
  const calls: Array<{ url: string; auth: string | null; apikey: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      auth: headers.get("Authorization"),
      apikey: headers.get("apikey"),
    });
    if (url.endsWith("/.well-known/jwks.json")) return jsonResponse(jwksKeys.jwks);
    if (url.endsWith("/auth/v1/user")) {
      return jsonResponse({
        id: "22222222-2222-4222-8222-222222222222",
        email: "anne@example.test",
        user_metadata: { username: "anne" },
      });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;

  try {
    const { checkAccessToken } = await import(
      pathToFileURL(resolve("server/dist/accountAuth.js")).href
    ) as { checkAccessToken: Check };
    const token = await unknown.token({ issuer });
    const result = await checkAccessToken(token, {
      SUPABASE_URL: base,
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: "secret",
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.via, "supabase");
    assert.equal(result.ok && result.userId, "22222222-2222-4222-8222-222222222222");
    assert.equal(result.ok && result.username, "anne");
    const fallback = calls.find((call) => call.url.endsWith("/auth/v1/user"));
    assert.ok(fallback, "the fallback endpoint was called");
    assert.equal(fallback.auth, `Bearer ${token}`);
    assert.equal(fallback.apikey, "publishable");
    assert.equal(calls.some((call) => call.url.includes("access_token")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lobby endpoints return the token reason as JSON, never the token", async () => {
  const base = `https://token-api-${Date.now()}.test`;
  const issuer = `${base}/auth/v1`;
  const signed = await keys();
  const other = await keys("other-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return jsonResponse(signed.jwks);
    return jsonResponse({}, 404);
  }) as typeof fetch;

  try {
    const { default: worker } = await import(
      pathToFileURL(resolve("server/dist/worker.js")).href
    ) as { default: { fetch: (request: Request, env: unknown) => Promise<Response> } };
    const env = {
      SUPABASE_URL: base,
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: "secret",
      GAME_ROOM: { idFromName: () => "room", get: () => ({ fetch: async () => jsonResponse({}) }) },
      ASSETS: { fetch: async () => jsonResponse({}) },
    };

    const missing = await worker.fetch(new Request("https://game.test/api/lobby/create", {
      method: "POST",
    }), env);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), {
      ok: false,
      error: "No login token was sent.",
    });

    const bad = await worker.fetch(new Request("https://game.test/api/lobby/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${await signed.token({ issuer, key: other.pair.privateKey })}` },
    }), env);
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), {
      ok: false,
      error: "The login token signature is not valid.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a fallback 401 is rejected with the Supabase reason", async () => {
  const base = `https://token-refused-${Date.now()}.test`;
  const issuer = `${base}/auth/v1`;
  const jwksKeys = await keys("known-key");
  const unknown = await keys("unknown-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return jsonResponse(jwksKeys.jwks);
    if (url.endsWith("/auth/v1/user")) return jsonResponse({ error: "invalid token" }, 401);
    return jsonResponse({}, 404);
  }) as typeof fetch;

  try {
    const { checkAccessToken } = await import(
      pathToFileURL(resolve("server/dist/accountAuth.js")).href
    ) as { checkAccessToken: Check };
    const result = await checkAccessToken(await unknown.token({ issuer }), {
      SUPABASE_URL: base,
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: "secret",
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "Supabase refused the login token.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
