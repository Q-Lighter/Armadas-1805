# The chart

The game is played on a flat chart of the western Atlantic and the Americas,
at half real-life scale. This keeps the whole theatre in one small file while
ships stay at real size, so land looks twice as large relative to a ship. That
is intended.

## The frame

The frame runs from longitude -100 to -28 and latitude 24 to -78. Map
coordinates are in kilometres:

```
x = (lon + 100) * 52.93      east
y = (24 - lat) * 55.3        south
```

The chart is therefore **3,810.96 km wide and 5,640.6 km tall**. The numbers
live in `shared/settings.ts` under `map`; `shared/map.ts` holds the projection
functions and the frame constants. Heading and world positions elsewhere in
the game use the same x-east, y-south convention.

## Source data

Only one source is used: **Natural Earth 1:10m land**, through the npm package
`world-atlas` (`land-10m.json`). Both are development dependencies. Natural
Earth is public domain; see [CREDITS.md](../CREDITS.md). Nothing is traced or
drawn by hand.

`npm run build-map` runs `scripts/build-map.ts`. It:

1. Reads `node_modules/world-atlas/land-10m.json` and decodes the TopoJSON.
2. Projects every ring into map kilometres and clips it to the frame with
   Sutherland-Hodgman clipping. Antarctica is cut at latitude -78; its northern
   peninsula still falls inside the frame.
3. Merges `shared/data/inventedFeatures.ts` (empty today) exactly like real
   land, so a later Phantom's island uses the same pipeline.
4. Simplifies the coast for each zoom level with Douglas-Peucker, then clips
   each tile. A tile that is still too large is simplified further on its own.
5. Writes the drawing tiles and the server land lookup.

To rebuild:

```sh
npm install
npm run build-map
```

The tile files and `shared/data/landMask.ts` are generated but committed, so a
normal `npm run build` and Cloudflare build do not need the build-map step.

## Drawing tiles

Tiles are square pieces of the chart, addressed by a level `z`, a column and a
row. Only tiles that contain land are written. Level 0 is coarsest:

| Level | Tile size | Coast tolerance | Tiles |
| ----- | --------- | --------------- | ----- |
| 0     | 2,048 km  | 6 km            | 6     |
| 1     | 1,024 km  | 3 km            | 24    |
| 2     | 512 km    | 1 km            | 89    |
| 3     | 256 km    | 0.25 km         | 323   |
| 4     | 128 km    | 0.01 km         | 1,176 |

The finished set is **1,618 tile files, 3.07 MB**, with the largest tile at
**56,578 bytes** and the most complex at **3,579 points**. That is below the
5,000-file, 20 MB and 60 KB-per-tile limits.

Each tile is JSON with absolute map coordinates and two lists:

```json
{ "z": 4, "x": 8, "y": 2, "km": 128,
  "fill":  [[x, y, x, y, ...]],
  "coast": [[x, y, x, y, ...]] }
```

`fill` holds closed land rings for the paper wash. `coast` holds open lines
for ink, clipped so that no line is drawn along a tile boundary. Neighbouring
tiles overlap slightly, which hides seams in the fill and keeps the coast
continuous. Coordinates are rounded to 10 metres so the closest zoom still
looks smooth.

The source tiles stay under `map-data/tiles/`. The server's private chart
blocks are generated into `shared/data/chartBlocks.ts` and bundled only into
the Worker; the browser receives a block only after discovering its ground.

Each 25 km chart block is clipped to its exact square, so the land fill does
not carry a rectangle edge into a neighbour. Degenerate rings are removed and
coast ink is kept only where the 1 km land lookup actually has a land/sea
boundary. The client draws blocks sorted by id and paints the dim discovered
sea once with one alpha mask, not as one translucent rectangle per 5 km cell.
The tests in `tests/chart-geometry.test.ts` rebuild land from the blocks and
compare it with the lookup over 12,000 samples.

## Server land lookup

`shared/data/landMask.ts` contains a **one-bit-per-cell** land mask over the
whole frame, at 1 km cells: 3,811 × 5,641 cells, or 2,687,232 bytes unpacked.
The bits are run-length encoded as alternating sea/land lengths, then written
as base64 text. The generated file is **72,238 bytes**, and **45,687 bytes**
after gzip, well under the 1 MB limit. `shared/land.ts` decodes it once when
the module loads.

`isLandAt(xKm, yKm)` is a constant-time array lookup. A point is classified by
the cell that contains it, so the answer is accurate to about one kilometre of
the true Natural Earth coast.

## Islands checked

The build checks these against the source data and against the server lookup:
Cuba, Jamaica, Hispaniola, Puerto Rico, Trinidad, Guadeloupe, Martinique,
Saint Lucia, Barbados, the Galapagos, the Falkland Islands, Tierra del Fuego,
Chiloe, Trindade and South Georgia. **All were present in both.** (Guadeloupe
and Trindade are small; their check points must be on the island itself, not
in the channel beside it.)

The British start at 13 N, 79.5 W is sea in the lookup, as it should be.

## Drawing on screen

The client fetches `client/public/tiles/index.json` once, then chooses a tile
level whose tiles are no larger than twice the view. Over the 5–300 km zoom
range that is normally level 2, 3 or 4, so a screen never loads the coarse
whole-map levels. Only tiles that exist (those with land) and overlap the view
are fetched, and their JSON is cached. A small `Charting…` paper scrap shows
while visible tiles are on the way.

Tiles are drawn with the map's muted sea behind them: a `#efe3c8` land wash,
a 1.5 px `#2a1c10` coast line, and a 7 px lighter `#b79b6b` water line that
peeks out on the sea side. Coast lines are drawn as gentle quadratic curves
through the tile points so close zoom looks hand-inked rather than blocky.
Panning shifts the already-built layer; a zoom rebuilds it at most about every
120 ms, which keeps pinch gestures responsive. The whole frame has a hard cap
of 30,000 chart points; if a view would exceed it, the client drops the
furthest tiles rather than drawing an unbounded frame.

The old drawing tile pipeline remains the source for the private chart blocks;
the browser does not fetch the level pyramid. A test/dev-only `Show borders`
toggle draws 25 km block outlines and 5 km cell lines for screenshots.

### Measured worst view

`npm run measure-map` checks 1,176 camera positions at 21 zoom levels on both a
360 × 800 phone screen and a 1280 × 800 Chromebook screen, using the same level
choice and point cap as the client. The worst view found was 180 km across,
centred near 72.2 W, 46.6 S over the Chilean coast: 6 tiles, 171,423 tile
bytes, 21,634 points charged against the cap, and **16,292 points actually
drawn**. That is comfortably below 30,000.

This is a geometry and download measurement, not a frame rate. No browser is
available in this workspace, so real GPU frame times on a Samsung A16 or a
Chromebook have not been measured.

## Known limits

- Grounding in shallow water is not modelled. A ship stops at the coast line;
  depth data and shoals come with a later phase.
- The lookup is a 1 km raster. Very small islets that cover less than a cell
  may be missing from it, even if they appear in the drawing. Landfall is
  resolved to the cell edge, so a ship can stop up to about a kilometre from
  the drawn coast.
- Drawing tiles are simplified at distance. Close to the coast the client
  smooths the ink line, but the underlying Natural Earth vertices are visible
  at the closest zoom.
- Antarctica is present only north of latitude -78, because that is where the
  chart frame ends.
- There is no fog of war and no whole-map overview yet.
- Real-device frame rate, touch pinch and WebGL rendering were not seen in a
  browser in this workspace; only the point budget and the served assets were
  checked.
