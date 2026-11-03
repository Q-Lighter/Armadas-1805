// Tests for the stable player id and the test-room `?as=` identity.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PLAYER_ID_KEY,
  playerIdForRoom,
  resolvePlayerIdentity,
  type StorageLike,
} from "@naval/shared/player-identity";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  blocked = false;

  getItem(key: string): string | null {
    if (this.blocked) throw new Error("storage blocked");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.blocked) throw new Error("storage blocked");
    this.values.set(key, value);
  }
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `unexpected-${index}`;
}

test("a refresh reads the same stored id instead of making a new one", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const first = resolvePlayerIdentity(local, session, "test", null, ids("base-one"));
  const second = resolvePlayerIdentity(local, session, "test", null, ids("base-two"));

  assert.equal(first.id, "base-one");
  assert.equal(second.id, "base-one");
  assert.equal(local.values.get(PLAYER_ID_KEY), "base-one");
  assert.equal(second.source, "local");
  assert.equal(second.warning, undefined);
});

test("localStorage failure falls back to one session id and says so", () => {
  const local = new MemoryStorage();
  local.blocked = true;
  const session = new MemoryStorage();
  const make = ids("base-session");

  const first = resolvePlayerIdentity(local, session, "test", null, make);
  const second = resolvePlayerIdentity(local, session, "test", null, make);

  assert.equal(first.id, "base-session");
  assert.equal(second.id, "base-session");
  assert.equal(second.source, "session");
  assert.match(second.warning ?? "", /Local storage is blocked/);
  assert.equal(session.values.get(PLAYER_ID_KEY), "base-session");
});

test("with no storage the id is still usable and the player is warned", () => {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  local.blocked = true;
  session.blocked = true;

  const result = resolvePlayerIdentity(local, session, "normal", null, ids("base-none"));
  assert.equal(result.id, "base-none");
  assert.equal(result.source, "none");
  assert.match(result.warning ?? "", /will not survive a refresh/);
});

test("?as gives a second tab a separate stable id only in test and dev rooms", () => {
  assert.equal(playerIdForRoom("0123456789abcdef", "test", "b"), "0123456789abcdef-as-b");
  assert.equal(playerIdForRoom("0123456789abcdef", "dev", "b"), "0123456789abcdef-as-b");
  assert.equal(playerIdForRoom("0123456789abcdef", "normal", "b"), "0123456789abcdef");
  assert.equal(playerIdForRoom("0123456789abcdef", "test", "bad name!"), "0123456789abcdef");
  assert.ok(playerIdForRoom("0123456789abcdef", "test", "x".repeat(20)).length <= 40);
});
