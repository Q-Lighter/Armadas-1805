// 3L-b: the chart camera, discovery boundary and port projection.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cameraScale, worldToScreen } from "@naval/shared/camera";
import { clampChartView, fitDiscoveredChart } from "@naval/shared/chart-view";
import { chartCellKm, chartColumns } from "@naval/shared/fog";
import { layoutPortMarkers, type PortInfo } from "@naval/shared/port-view";
import { settings } from "@naval/shared/settings";

const PORT: PortInfo = {
  id: "port",
  name: "Kingston",
  size: "L",
  npc: false,
  x: 1_700,
  y: 450,
  region: "Greater Antilles",
  good: "sugar",
};

test("a known port sits exactly under its marker at three zoom levels", () => {
  const viewport = { width: 1280, height: 800 };
  for (const kmAcross of [25, 300, 5_000]) {
    const view = { x: PORT.x, y: PORT.y, kmAcross };
    const marker = layoutPortMarkers({
      width: viewport.width,
      height: viewport.height,
      view,
      ports: [PORT],
      sight: [],
    })[0]!;
    const expected = worldToScreen(PORT, view, viewport.width, viewport.height);
    assert.equal(marker.screenX, expected.x);
    assert.equal(marker.screenY, expected.y);
    assert.equal(marker.labelVisible, true);
  }
});

test("unfound ports never get a marker", () => {
  const markers = layoutPortMarkers({
    width: 800,
    height: 600,
    view: { x: PORT.x, y: PORT.y, kmAcross: 200 },
    ports: [{ ...PORT, found: false }],
    sight: [],
  });
  assert.deepEqual(markers, []);
});

test("chart zoom stays between the paper and 25 km", () => {
  assert.equal(settings.view.chartMinKmAcross, 25);
  const clamped = clampChartView(
    { x: -500, y: -500, kmAcross: 1 },
    3_800,
    5_600,
    1280,
    800,
    25,
  );
  assert.equal(clamped.kmAcross, 25);
  assert.ok(clamped.x >= 12.5 && clamped.x <= 3_800 - 12.5);
  assert.ok(clamped.y >= clamped.kmAcross * 800 / 1280 / 2 - 1e-9);
});

test("fit discovered area includes every charted cell and leaves paper margin", () => {
  const discovered = new Set([0, 1, chartColumns + 1, 3 * chartColumns + 4]);
  const fit = fitDiscoveredChart(discovered, 200, 300, chartCellKm, 1280, 800)!;
  assert.ok(fit);
  assert.ok(fit.x > 2 * chartCellKm);
  assert.ok(fit.kmAcross > 4 * chartCellKm);
  assert.equal(fitDiscoveredChart(new Set(), 200, 300, chartCellKm, 1280, 800), null);
});

test("the chart scale sharpens with zoom", () => {
  assert.ok(cameraScale(1280, 800, 25) > cameraScale(1280, 800, 3_800));
});
