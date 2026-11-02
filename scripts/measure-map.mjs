// Measure the worst chart view without a browser.
//
// Run: npm run build && npm run measure-map
//
// It uses the same tile-level choice and point cap as client/main.ts, walks
// every land tile centre as a possible camera position at a range of zoom
// levels, and reports the view that draws the most chart points. It also
// reports the bytes of the tiles that view would load.
//
// This measures geometry, not GPU frame time. No browser is available in this
// workspace, so real phone and Chromebook frame rates are still unmeasured.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { settings } = await import(path.join(root, "shared/dist/settings.js"));
const { MAP_WIDTH_KM, MAP_HEIGHT_KM, mapToLonLat } = await import(
  path.join(root, "shared/dist/map.js")
);

const tileRoot = path.join(root, "client/public/tiles");
const manifest = JSON.parse(readFileSync(path.join(tileRoot, "index.json"), "utf8"));
const levels = manifest.levels
  .map((level) => ({
    z: level.z,
    km: level.km,
    tiles: new Map(level.tiles.map((tile) => [`${tile[0]}_${tile[1]}`, tile])),
  }))
  .sort((a, b) => a.z - b.z);

const finest = levels[levels.length - 1];
const centres = [...finest.tiles.values()].map((tile) => ({
  x: (tile[0] + 0.5) * finest.km,
  y: (tile[1] + 0.5) * finest.km,
}));

const zooms = [5, 6, 8, 10, 12, 16, 20, 25, 30, 40, 50, 60, 75, 90, 110, 130, 150, 180, 210, 250, 300];
const screens = [
  { name: "Samsung A16 portrait", width: 360, height: 800 },
  { name: "Chromebook", width: 1280, height: 800 },
];

function visibleTiles(level, view, screen) {
  const halfWidth = view.kmAcross / 2;
  const halfHeight = halfWidth * (screen.height / screen.width);
  const left = view.x - halfWidth;
  const right = view.x + halfWidth;
  const top = view.y - halfHeight;
  const bottom = view.y + halfHeight;

  const columns = Math.ceil(MAP_WIDTH_KM / level.km);
  const rows = Math.ceil(MAP_HEIGHT_KM / level.km);
  const firstColumn = Math.max(0, Math.floor(left / level.km));
  const lastColumn = Math.min(columns - 1, Math.floor(right / level.km));
  const firstRow = Math.max(0, Math.floor(top / level.km));
  const lastRow = Math.min(rows - 1, Math.floor(bottom / level.km));

  const found = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const tile = level.tiles.get(`${column}_${row}`);
      if (!tile) continue;
      found.push({
        key: `${level.z}/${column}_${row}`,
        x: column,
        y: row,
        points: tile[2],
        distance: Math.hypot(
          (column + 0.5) * level.km - view.x,
          (row + 0.5) * level.km - view.y,
        ),
      });
    }
  }
  found.sort((a, b) => a.distance - b.distance);
  return found;
}

/** The same level choice and point cap as the browser client. */
function plan(view, screen) {
  const desired =
    levels.find((level) => level.km <= view.kmAcross * settings.view.tileLevelPickFactor) ??
    levels[levels.length - 1];
  const desiredIndex = levels.indexOf(desired);

  let level = desired;
  for (let index = desiredIndex; index >= 0; index -= 1) {
    const candidate = levels[index];
    const points = visibleTiles(candidate, view, screen).reduce(
      (total, tile) => total + tile.points * 2,
      0,
    );
    if (points <= settings.view.maxDrawnPoints) {
      level = candidate;
      break;
    }
  }

  let accountedPoints = 0;
  const selected = [];
  for (const tile of visibleTiles(level, view, screen)) {
    const cost = tile.points * 2;
    if (accountedPoints + cost > settings.view.maxDrawnPoints) continue;
    accountedPoints += cost;
    selected.push(tile);
  }

  return { level, selected, accountedPoints };
}

function readTile(key) {
  const file = path.join(tileRoot, `${key}.json`);
  const data = JSON.parse(readFileSync(file, "utf8"));
  const fillPoints = data.fill.reduce((total, ring) => total + ring.length / 2, 0);
  const coastPoints = data.coast.reduce((total, line) => total + line.length / 2, 0);
  return { fillPoints, coastPoints, bytes: statSync(file).size };
}

let worst = null;

for (const screen of screens) {
  for (const zoom of zooms) {
    for (const centre of centres) {
      const view = { x: centre.x, y: centre.y, kmAcross: zoom };
      const chosen = plan(view, screen);
      if (!worst || chosen.accountedPoints > worst.accountedPoints) {
        worst = {
          screen,
          zoom,
          view,
          level: chosen.level.z,
          selected: chosen.selected,
          accountedPoints: chosen.accountedPoints,
        };
      }
    }
  }
}

const files = worst.selected.map((tile) => readTile(tile.key));
const actualPoints = files.reduce(
  (total, tile) => total + tile.fillPoints + tile.coastPoints * 2,
  0,
);
const tileBytes = files.reduce((total, tile) => total + tile.bytes, 0);
const latLon = mapToLonLat(worst.view.x, worst.view.y);

console.log(
  JSON.stringify(
    {
      screens: screens.map((screen) => `${screen.name} ${screen.width}x${screen.height}`),
      zoomsTested: zooms.length,
      cameraPositionsTested: centres.length,
      worst: {
        screen: `${worst.screen.name} ${worst.screen.width}x${worst.screen.height}`,
        kmAcross: worst.zoom,
        centreKm: {
          x: Number(worst.view.x.toFixed(1)),
          y: Number(worst.view.y.toFixed(1)),
        },
        centreLatLon: {
          lon: Number(latLon.lonDeg.toFixed(2)),
          lat: Number(latLon.latDeg.toFixed(2)),
        },
        tileLevel: worst.level,
        tiles: worst.selected.length,
        accountedPoints: worst.accountedPoints,
        actualDrawnPoints: Math.round(actualPoints),
        tileBytes,
        pointCap: settings.view.maxDrawnPoints,
        underCap: actualPoints <= settings.view.maxDrawnPoints,
      },
      note: "Geometry points and tile bytes, not GPU frame time; no browser is available here.",
    },
    null,
    2,
  ),
);
