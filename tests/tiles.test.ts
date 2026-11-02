// Checks that the committed chart tiles match their manifest and stay inside
// the limits that keep them deployable on Cloudflare.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { settings } from "@naval/shared/settings";

const tileRoot = fileURLToPath(new URL("../../client/public/tiles", import.meta.url));

interface Manifest {
  levels: Array<{ z: number; km: number; tiles: Array<[number, number, number]> }>;
}

test("the tile manifest and files stay inside the deployment limits", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(tileRoot, "index.json"), "utf8"),
  ) as Manifest;

  let files = 0;
  let bytes = 0;

  for (const level of manifest.levels) {
    for (const [x, y] of level.tiles) {
      const file = path.join(tileRoot, String(level.z), `${x}_${y}.json`);
      const size = statSync(file).size;
      files += 1;
      bytes += size;
      assert.ok(
        size <= settings.map.tileFileBudgetBytes,
        `${level.z}/${x}_${y} is ${size} bytes`,
      );
    }
  }

  const allFiles = readdirSync(tileRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .length;

  assert.equal(allFiles, files + 1, "file count should match the manifest plus index.json");
  assert.ok(files < settings.map.maxTileFiles, `${files} tile files`);
  assert.ok(bytes < settings.map.maxTileSetBytes, `${bytes} tile bytes`);
});

test("a sample tile has the shape the client expects", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(tileRoot, "index.json"), "utf8"),
  ) as Manifest;
  const level = manifest.levels[manifest.levels.length - 1]!;
  const tile = level.tiles[0]!;
  const data = JSON.parse(
    readFileSync(path.join(tileRoot, String(level.z), `${tile[0]}_${tile[1]}.json`), "utf8"),
  ) as { fill: unknown; coast: unknown; km: number };

  assert.equal(data.km, level.km);
  assert.ok(Array.isArray(data.fill));
  assert.ok(Array.isArray(data.coast));
});
