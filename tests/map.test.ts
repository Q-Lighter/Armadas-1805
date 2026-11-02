// Tests for the chart projection and the server land lookup.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  MAP_HEIGHT_KM,
  MAP_WIDTH_KM,
  isInsideMapFrame,
  lonLatToMap,
  mapToLonLat,
} from "@naval/shared/map";
import { isLandAt, isSeaAt } from "@naval/shared/land";

const frame = settings.map.frame;

test("the map frame is the size the design asks for", () => {
  assert.ok(Math.abs(MAP_WIDTH_KM - 3810.96) < 1e-9, `${MAP_WIDTH_KM}`);
  assert.ok(Math.abs(MAP_HEIGHT_KM - 5640.6) < 1e-9, `${MAP_HEIGHT_KM}`);

  assert.deepEqual(lonLatToMap(frame.lonMinDeg, frame.latMaxDeg), { x: 0, y: 0 });
  assert.deepEqual(lonLatToMap(frame.lonMaxDeg, frame.latMinDeg), {
    x: MAP_WIDTH_KM,
    y: MAP_HEIGHT_KM,
  });
});

test("longitude and latitude survive a projection round trip", () => {
  const points = [
    { lonDeg: -79.5, latDeg: 13 },
    { lonDeg: -77.3, latDeg: 18.1 },
    { lonDeg: -28, latDeg: 24 },
    { lonDeg: -100, latDeg: -78 },
    { lonDeg: -63.2, latDeg: -40.5 },
    { lonDeg: -36.7, latDeg: -54.4 },
  ];

  for (const point of points) {
    const map = lonLatToMap(point.lonDeg, point.latDeg);
    const back = mapToLonLat(map.x, map.y);
    assert.ok(Math.abs(back.lonDeg - point.lonDeg) < 1e-9, `${point.lonDeg}`);
    assert.ok(Math.abs(back.latDeg - point.latDeg) < 1e-9, `${point.latDeg}`);
  }
});

test("points outside the frame are outside the chart", () => {
  assert.equal(isInsideMapFrame(0, 0), true);
  assert.equal(isInsideMapFrame(MAP_WIDTH_KM, MAP_HEIGHT_KM), true);
  assert.equal(isInsideMapFrame(-0.1, 100), false);
  assert.equal(isInsideMapFrame(100, MAP_HEIGHT_KM + 0.1), false);
});

test("known land and sea points are classified correctly", () => {
  const inlandAmazon = lonLatToMap(-60, -3);
  const jamaica = lonLatToMap(-77.3, 18.1);
  const midAtlantic = lonLatToMap(-40, 20);
  const britishStart = lonLatToMap(-79.5, 13);

  assert.equal(isLandAt(inlandAmazon.x, inlandAmazon.y), true, "inland Amazon");
  assert.equal(isLandAt(jamaica.x, jamaica.y), true, "central Jamaica");
  assert.equal(isSeaAt(midAtlantic.x, midAtlantic.y), true, "mid-Atlantic");
  assert.equal(isSeaAt(britishStart.x, britishStart.y), true, "British start");
});
