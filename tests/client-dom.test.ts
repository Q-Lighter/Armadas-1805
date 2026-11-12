// 3C-fix: the client must not start with an element lookup that the HTML
// cannot satisfy. That turns into a silent blank page before connect() runs.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createWorld, addPlayer, visibleStateFor } from "@naval/shared/world";

const main = readFileSync("client/main.ts", "utf8");
const html = readFileSync("client/index.html", "utf8");

test("every element the client looks up exists exactly once in the page", () => {
  const referenced = new Set<string>();
  for (const match of main.matchAll(/element<[^>]+>\("([^"]+)"\)/g)) {
    if (match[1]) referenced.add(match[1]);
  }
  assert.ok(referenced.size > 30);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
  const missing = [...referenced].filter((id) => !ids.includes(id));
  assert.deepEqual(missing, []);
  assert.ok(referenced.has("damage-battle"));
});

function join(room: string, options: Parameters<typeof createWorld>[1] = {}) {
  const world = createWorld(room, { shipClass: "frigate", startMoney: 50_000, ...options });
  addPlayer(world, "no-options-player", "frigate", 50_000, "British");
  return visibleStateFor(world, "no-options-player");
}

test("a bare test room and a fresh Kingston room both carry ship, wind, money and clock", () => {
  for (const state of [join("test"), join("test-30", { startPort: null })]) {
    assert.equal(state.you, "no-options-player");
    assert.equal(state.w, 315);
    assert.equal(state.m, 50_000);
    assert.equal(state.ships.length, 1);
    assert.equal(state.ships[0]?.[1], "frigate");
    assert.equal(state.fleet.length, 1);
    assert.ok((state.fleet[0]?.name.length ?? 0) > 0);
  }
  assert.equal(join("fresh-room").ships.length, 1);
});

test("a real snapshot survives missing optional 3C fields", () => {
  const state = join("test");
  const fleet = state.fleet[0]!;
  delete state.sf;
  delete state.log;
  delete state.events;
  delete fleet.battleOrder;
  delete fleet.surrendered;
  delete fleet.running;
  const parsed = JSON.parse(JSON.stringify(state)) as typeof state;
  assert.equal(parsed.ships.length, 1);
  assert.equal(parsed.fleet[0]?.id, "no-options-player");
  assert.equal(parsed.sf, undefined);
  assert.equal(parsed.fleet[0]?.battleOrder, undefined);
});
