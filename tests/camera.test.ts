// Map and UI positions must come from exactly the same camera transform.

import assert from "node:assert/strict";
import { test } from "node:test";

import { screenToWorld, worldToScreen } from "@naval/shared/camera";
import { layoutPortMarkers, type PortInfo } from "@naval/shared/port-view";

const KINGSTON = { x: 1228.266, y: 336.491 };
const MONTEGO_BAY = { x: 1164.681, y: 304.31 };

function port(name: string, point: { x: number; y: number }): PortInfo {
  return {
    id: name,
    name,
    size: "L",
    npc: true,
    x: point.x,
    y: point.y,
    region: "Jamaica",
    good: "sugar",
    found: true,
  };
}

test("map and port markers use one transform at many zooms and pans", () => {
  const ports = [port("Kingston", KINGSTON), port("Montego Bay", MONTEGO_BAY)];
  const sizes = [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ];
  const zooms = [25, 60, 140, 300, 800, 4_000];

  for (const { width, height } of sizes) {
    for (const kmAcross of zooms) {
      for (const pan of [
        { x: 1200, y: 330 },
        { x: 900, y: 700 },
        { x: 1600, y: 100 },
      ]) {
        const view = { ...pan, kmAcross };
        const markers = layoutPortMarkers({
          width,
          height,
          view,
          ports,
          sight: [],
        });
        for (const marker of markers) {
          const source = ports.find((item) => item.id === marker.id)!;
          const expected = worldToScreen(source, view, width, height);
          assert.ok(Math.abs(marker.screenX - expected.x) < 1e-6);
          assert.ok(Math.abs(marker.screenY - expected.y) < 1e-6);
        }
      }
    }
  }
});

test("screenToWorld is the inverse used for tap orders", () => {
  const view = { x: 1164.681, y: 304.31, kmAcross: 60 };
  const screen = worldToScreen(KINGSTON, view, 360, 740);
  const world = screenToWorld(screen.x, screen.y, view, 360, 740);
  assert.ok(Math.abs(world.x - KINGSTON.x) < 1e-9);
  assert.ok(Math.abs(world.y - KINGSTON.y) < 1e-9);
});
