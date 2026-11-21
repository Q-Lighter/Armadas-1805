// Supabase-backed implementation of the AccountApi used by the Account screen.
// The publishable key is public. The secret key is never part of the bundle.

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { accountEmailFor, normalizeUsername } from "@naval/shared/accounts";
import type { AccountApi, AccountSession } from "./account.js";

export interface AccountConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  accountEmailDomain: string;
}

export async function loadAccountConfig(): Promise<AccountConfig | null> {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) return null;
    const config = await response.json() as Partial<AccountConfig>;
    if (!config.supabaseUrl || !config.supabasePublishableKey) return null;
    return {
      supabaseUrl: config.supabaseUrl,
      supabasePublishableKey: config.supabasePublishableKey,
      accountEmailDomain: config.accountEmailDomain ?? "armadas-1805.carltonjamie714.workers.dev",
    };
  } catch {
    return null;
  }
}

function metadataString(user: User, key: string): string {
  const value = user.user_metadata?.[key];
  return typeof value === "string" ? value : "";
}

export function createSupabaseAccountApi(
  config: AccountConfig,
  fetcher: typeof fetch = fetch,
): AccountApi {
  const client: SupabaseClient = createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  );

  async function profileFor(user: User): Promise<AccountSession["user"]> {
    let username = metadataString(user, "username");
    let displayName = metadataString(user, "display_name");
    try {
      const { data } = await client
        .from("profiles")
        .select("username,display_name")
        .eq("id", user.id)
        .maybeSingle();
      if (data && typeof data.username === "string") {
        username = data.username;
        displayName = typeof data.display_name === "string" ? data.display_name : username;
      }
    } catch {
      // Login still works if the profile read is temporarily unavailable.
    }
    username ||= user.email?.split("@")[0] ?? "sailor";
    return { id: user.id, username, displayName: displayName || username };
  }

  async function currentSession(): Promise<AccountSession | null> {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) return null;
    return {
      accessToken: data.session.access_token,
      user: await profileFor(data.session.user),
    };
  }

  async function accessToken(): Promise<string | null> {
    const session = await currentSession();
    return session?.accessToken ?? null;
  }

  return {
    async signUp({ username, password, displayName }) {
      const { error } = await client.auth.signUp({
        email: accountEmailFor(username, config.accountEmailDomain),
        password,
        options: {
          data: { username: username.trim(), display_name: displayName.trim() },
        },
      });
      if (!error) return null;
      if (/user already registered|database error/i.test(error.message)) {
        return "That username is already taken or the profile could not be created.";
      }
      return error.message;
    },

    async signIn(rawUsername, password) {
      const { error } = await client.auth.signInWithPassword({
        email: accountEmailFor(rawUsername, config.accountEmailDomain),
        password,
      });
      return error?.message ?? null;
    },

    async signOut() {
      await client.auth.signOut({ scope: "local" });
    },

    session: currentSession,

    async updateDisplayName(displayName) {
      const session = await currentSession();
      if (!session) return "Log in to change your display name.";
      const { error } = await client
        .from("profiles")
        .update({ display_name: displayName.trim() })
        .eq("id", session.user.id);
      if (error) return error.message;
      await client.auth.updateUser({ data: { display_name: displayName.trim() } });
      return null;
    },

    async changePassword(current, next) {
      const session = await currentSession();
      if (!session) return "Log in to change your password.";
      // Prove the current password by signing in again before changing it.
      const email = accountEmailFor(session.user.username, config.accountEmailDomain);
      const check = await client.auth.signInWithPassword({ email, password: current });
      if (check.error) {
        return /invalid login credentials/i.test(check.error.message)
          ? "Wrong current password."
          : check.error.message;
      }
      const { error } = await client.auth.updateUser({ password: next });
      return error?.message ?? null;
    },

    async deleteAccount(username, room) {
      const token = await accessToken();
      if (!token) return "Log in to delete an account.";
      try {
        const response = await fetcher("/api/account", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ room, username: normalizeUsername(username) }),
        });
        const result = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !result.ok) {
          return result.error ?? "The account could not be deleted.";
        }
        await client.auth.signOut({ scope: "local" });
        return null;
      } catch {
        return "Could not reach the account service. Try again.";
      }
    },

    async keepalive() {
      const token = await accessToken();
      if (!token) return { ok: false, text: "Log in to run keepalive." };
      try {
        const response = await fetcher("/api/keepalive", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        return await response.json() as { ok: boolean; text: string };
      } catch {
        return { ok: false, text: "Could not reach the keepalive service." };
      }
    },
  };
}
