import assert from "node:assert/strict";
import { test } from "node:test";

import { runDrawLayer } from "@naval/shared/draw-layer";

test("a thrown draw layer keeps the ships and runs the next layer", () => {
  const ships = ["flagship", "enemy"];
  const errors: unknown[] = [];

  const first = runDrawLayer(
    () => { throw new Error("bad flagship pennant"); },
    (error) => errors.push(error),
  );
  const second = runDrawLayer(
    () => { ships.push("friendly"); },
    (error) => errors.push(error),
  );

  assert.equal(first, false);
  assert.equal(second, true);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /bad flagship pennant/);
  assert.deepEqual(ships, ["flagship", "enemy", "friendly"]);
});
