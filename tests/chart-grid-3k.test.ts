// 3K-c: chart grid projection, discovered-ground clipping and scale ruler.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bearingDegrees,
  chartGridLines,
  gridStepDegrees,
  scaleRuler,
} from "@naval/shared/chart-grid";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM, lonLatToMap, mapToLonLat } from "@naval/shared/map";

test("chart grid labels land on the game projection", () => {
  const point = lonLatToMap(-70, 15);
  const view = {
    xMin: point.x - 200,
    xMax: point.x + 200,
    yMin: point.y - 200,
    yMax: point.y + 200,
  };
  const lines = chartGridLines({ ...view, step: 5, isDiscovered: () => true });
  const lon = lines.find((line) => line.axis === "lon" && line.deg === -70);
  const lat = lines.find((line) => line.axis === "lat" && line.deg === 15);
  assert.ok(lon, "70 W line exists");
  assert.ok(lat, "15 N line exists");
  assert.ok(Math.abs(lon.at - point.x) < 1e-9);
  assert.ok(Math.abs(lat.at - point.y) < 1e-9);
  assert.match(lon.label, /70/);
  assert.match(lon.label, /W/);
  assert.match(lat.label, /15/);
  assert.match(lat.label, /N/);
  const back = mapToLonLat(lon.at, lat.at);
  assert.ok(Math.abs(back.lonDeg - -70) < 1e-6);
  assert.ok(Math.abs(back.latDeg - 15) < 1e-6);
});

test("grid lines exist only over discovered cells", () => {
  const centre = lonLatToMap(-40, 10);
  const discoveryLeft = centre.x - 60;
  const discoveryRight = centre.x + 60;
  const lines = chartGridLines({
    xMin: 0,
    xMax: MAP_WIDTH_KM,
    yMin: 0,
    yMax: MAP_HEIGHT_KM,
    step: 5,
    isDiscovered: (x) => x >= discoveryLeft && x <= discoveryRight,
  });
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(line.segments.length > 0, `${line.label} has a discovered run`);
    for (const segment of line.segments) {
      if (line.axis === "lon") {
        assert.ok(segment.from >= 0 && segment.to <= MAP_HEIGHT_KM + 1e-9);
      } else {
        assert.ok(segment.from >= discoveryLeft - 5);
        assert.ok(segment.to <= discoveryRight + 5);
      }
    }
  }
  assert.ok(lines.every((line) => line.label.length > 0));
});

test("grid spacing follows zoom from ten degrees to half a degree", () => {
  const wide = gridStepDegrees(0, MAP_WIDTH_KM, 0, MAP_HEIGHT_KM);
  assert.equal(wide, 10);
  const narrow = gridStepDegrees(1000, 1012, 1000, 1012);
  assert.equal(narrow, 0.5);
});

test("scale ruler gives true bearing and distance", () => {
  // Map y grows southward.
  const north = scaleRuler({ x: 10, y: 20 }, { x: 10, y: 10 });
  assert.equal(north.bearingDeg, 0);
  assert.equal(north.distanceKm, 10);
  const east = scaleRuler({ x: 10, y: 10 }, { x: 20, y: 10 });
  assert.equal(east.bearingDeg, 90);
  const south = scaleRuler({ x: 10, y: 10 }, { x: 10, y: 20 });
  assert.equal(south.bearingDeg, 180);
  assert.ok(Math.abs(bearingDegrees({ x: 0, y: 0 }, { x: 10, y: -10 }) - 45) < 1e-9);
});
