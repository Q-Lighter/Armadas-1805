import assert from "node:assert/strict";
import { test } from "node:test";

import { addPlayer, createWorld, shipsForOwner, visibleStateFor } from "@naval/shared/world";

test("a light state update omits fleet detail rather than rebuilding it", () => {
  const world = createWorld("test-light-state");
  addPlayer(world, "own", "frigate", 50_000, "British");
  const full = visibleStateFor(world, "own");
  const light = visibleStateFor(world, "own", undefined, undefined, false);
  assert.ok(Array.isArray(full.fleet));
  assert.equal((light as { fleet?: unknown }).fleet, undefined);
  assert.equal((light as { fleets?: unknown }).fleets, undefined);
});

test("at most two visible fire effects are sent per ship per second", () => {
  const world = createWorld("test-fire-cap");
  addPlayer(world, "own", "frigate", 50_000, "British");
  const own = shipsForOwner(world, "own")[0];
  assert.ok(own);
  // Establish the chart cursor before adding this second's events.
  visibleStateFor(world, "own");
  for (let index = 0; index < 8; index += 1) {
    world.combatEvents.push({
      id: 10_000 + index,
      kind: "fire",
      x: own.x,
      y: own.y,
      shipId: own.id,
      side: "port",
    });
  }
  const state = visibleStateFor(world, "own");
  assert.equal(state.events?.filter((event) => event.kind === "fire").length, 2);
});
