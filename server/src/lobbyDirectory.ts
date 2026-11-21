// One Durable Object that keeps join codes unique among active games.
//
// A room cannot see the other rooms, so this small directory owns the code
// list. It is reserved when the host creates a game, looked up when someone
// joins with a code, and updated when the lobby starts. Codes are held for a
// day after their last change so an abandoned game does not reuse one at once.

import { settings } from "@naval/shared/settings";
import { isJoinCode, makeJoinCode } from "@naval/shared/lobby";

export type DirectoryStatus = "lobby" | "playing";

export interface DirectoryRow {
  code: string;
  status: DirectoryStatus;
  players: number;
  updatedAtMs: number;
  expiresAtMs: number;
}

interface DirectoryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DirectoryState {
  storage?: DirectoryStorage;
  blockConcurrencyWhile?(callback: () => Promise<void>): unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function randomCode(): string {
  return makeJoinCode(() => Math.random());
}

function activeUntil(nowMs: number): number {
  return nowMs + settings.lobby.codeActiveHours * 60 * 60 * 1000;
}

export class LobbyDirectory {
  private rows = new Map<string, DirectoryRow>();
  private readonly storage?: DirectoryStorage;

  constructor(state?: DirectoryState, _env: unknown = {}) {
    this.storage = state?.storage;
    if (state?.storage && state.blockConcurrencyWhile) {
      state.blockConcurrencyWhile(async () => {
        const stored = await state.storage!.get<Record<string, DirectoryRow>>("codes");
        this.rows = new Map(Object.entries(stored ?? {}));
      });
    }
  }

  private persist(): void {
    if (!this.storage) return;
    const plain: Record<string, DirectoryRow> = {};
    for (const [code, row] of this.rows) plain[code] = row;
    void this.storage.put("codes", plain);
  }

  /** Forget codes that were last touched more than a day ago. */
  private prune(nowMs: number): void {
    for (const [code, row] of [...this.rows]) {
      if (row.expiresAtMs <= nowMs) this.rows.delete(code);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const nowMs = Date.now();
    this.prune(nowMs);

    if (url.pathname === "/reserve" && request.method === "POST") {
      let attempts = 0;
      while (attempts < settings.lobby.codeAttempts) {
        attempts += 1;
        const code = randomCode();
        if (!isJoinCode(code) || this.rows.has(code)) continue;
        this.rows.set(code, {
          code,
          status: "lobby",
          players: 1,
          updatedAtMs: nowMs,
          expiresAtMs: activeUntil(nowMs),
        });
        this.persist();
        return json({ ok: true, code });
      }
      return json({ ok: false, error: "No join code is free. Try again." }, 503);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      // A missing body is an empty request.
    }
    const rawCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const code = isJoinCode(rawCode) ? rawCode : "";

    if (url.pathname === "/lookup") {
      const row = code ? this.rows.get(code) : null;
      if (!row) return json({ ok: true, found: false });
      return json({
        ok: true,
        found: true,
        status: row.status,
        players: row.players,
      });
    }

    if (url.pathname === "/status" && code) {
      const row = this.rows.get(code);
      const status = body.status === "playing" ? "playing" : body.status === "lobby" ? "lobby" : "closed";
      if (status === "closed") {
        this.rows.delete(code);
        this.persist();
        return json({ ok: true });
      }
      if (!row) return json({ ok: true, found: false });
      row.status = status;
      row.players = typeof body.players === "number" && Number.isFinite(body.players)
        ? Math.max(0, Math.floor(body.players))
        : row.players;
      row.updatedAtMs = nowMs;
      row.expiresAtMs = activeUntil(nowMs);
      this.persist();
      return json({ ok: true, found: true });
    }

    if (url.pathname === "/release" && code) {
      this.rows.delete(code);
      this.persist();
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown directory request." }, 404);
  }
}
