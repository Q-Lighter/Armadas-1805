// Part 3C-a: test-room navy choice, dummy parsing, forwarding and invite links.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chooseJoinNavy,
  inviteSecondDeviceLink,
  otherNavy,
  parseDummyBehaviour,
  testJoinQuery,
} from "@naval/shared/test-setup";

test("a second player asking for the same navy gets the next one in order", () => {
  assert.deepEqual(chooseJoinNavy("British", ["British"]), { navy: "French", changed: true });
  assert.deepEqual(chooseJoinNavy("French", ["British"]), { navy: "French", changed: false });
  assert.deepEqual(chooseJoinNavy("French", ["British", "French"]), { navy: "Spanish", changed: true });
  assert.equal(otherNavy("British"), "French");
  assert.equal(otherNavy("Dutch"), "British");
});

test("dummy behaviour defaults to fights and rejects unknown values", () => {
  assert.equal(parseDummyBehaviour(null), "fights");
  assert.equal(parseDummyBehaviour("passive"), "passive");
  assert.equal(parseDummyBehaviour("RUNS"), "runs");
  assert.equal(parseDummyBehaviour("surrenders"), "surrenders");
  assert.equal(parseDummyBehaviour("chase"), null);
});

test("the exact two-device address forwards the enemy and other test options", () => {
  const address = "?room=test-13&start=Kingston&ship=frigate&enemy=frigate:2";
  const query = testJoinQuery(address);
  const parsed = new URLSearchParams(query.slice(1));
  assert.equal(parsed.get("start"), "Kingston");
  assert.equal(parsed.get("ship"), "frigate");
  assert.equal(parsed.get("enemy"), "frigate:2");
  assert.equal(parsed.get("room"), null);
});

test("the invite link swaps the navy and keeps the room, port and ship", () => {
  const link = inviteSecondDeviceLink(
    "https://example.test/game/?room=test-13&navy=british&start=Kingston&ship=frigate&player=abc",
    { room: "test-13", navy: "French", startPort: "Kingston", shipClass: "frigate" },
  );
  const url = new URL(link);
  assert.equal(url.searchParams.get("room"), "test-13");
  assert.equal(url.searchParams.get("navy"), "french");
  assert.equal(url.searchParams.get("start"), "Kingston");
  assert.equal(url.searchParams.get("ship"), "frigate");
  assert.equal(url.searchParams.get("player"), null);
});
