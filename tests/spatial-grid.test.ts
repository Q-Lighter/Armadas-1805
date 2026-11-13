import assert from "node:assert/strict";
import { test } from "node:test";

import { SpatialGrid } from "@naval/shared/spatial-grid";

test("the spatial grid returns only nearby values and ignores empty cells", () => {
  const grid = new SpatialGrid<{ x: number; y: number; id: string }>(0.1);
  grid.insert({ x: 0.02, y: 0.02, id: "near" });
  grid.insert({ x: 0.08, y: 0.08, id: "edge" });
  grid.insert({ x: 1.2, y: 1.2, id: "far" });
  assert.deepEqual(grid.query(0.02, 0.02, 0.1).map((value) => value.id).sort(), ["edge", "near"]);
  assert.deepEqual(grid.query(0.02, 0.02, 0.02).map((value) => value.id), ["near"]);
  assert.deepEqual(grid.query(9, 9, 0.1), []);
});
