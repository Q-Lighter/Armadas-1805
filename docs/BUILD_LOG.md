# Build log

One entry per session, newest last. Each entry records what was asked, what was
built, and anything broken or unfinished.

## Session 0A: project skeleton

**Date:** 2026-11-02
**Branch:** main

### What was asked

Set up the project only, with no game features: the `client/`, `server/`,
`shared/` and `docs/` folders; npm and TypeScript working from the repo root so
that `npm install` and `npm run build` succeed and produce a placeholder page
reading "Naval game: build 0A" in `dist/`; plus `RULES.md`, `shared/settings.ts`,
`README.md` and this build log.

### What was built

- Root npm workspaces project (`client`, `server`, `shared`) with TypeScript and
  esbuild as the only development dependencies.
- `shared/`: plain TypeScript with no browser or Node types available, so code
  here cannot depend on either. Exports the game name, the build tag and
  `settings`.
- `shared/settings.ts`: the single settings file, with empty groups for time,
  ships, ports, economy, combat and weather. No real numbers yet.
- `server/`: TypeScript package that imports the shared code and exposes a
  placeholder `serverStatus()`. No Cloudflare code yet.
- `client/`: the page shell, responsive placeholder styling and a small entry
  point that shows the build label from `shared/`.
- `scripts/build.mjs`: cleans old output, type checks and compiles shared and
  server, type checks the client, bundles the client and assembles `dist/`.
- `RULES.md`, `README.md`, `.gitignore` and this build log.
- Removed the old one-byte `index.html` at the repo root; the built page now
  lives only in `dist/`.

### Checks

- `npm install` succeeded.
- `npm run build` succeeded and produced `dist/index.html`, `dist/main.js`,
  `dist/styles.css` and a source map. The page text comes from
  `shared/BUILD_TAG`, so it reads "Naval game: build 0A".
- `node server/dist/index.js` runs the compiled server placeholder.

### Broken or unfinished

- No game features, no server runtime and no deployment yet. The server is a
  placeholder and does not listen on a port.
- There is no dev server or bundler watch mode; `npm run build` is the only
  command for now.
- The client is bundled with esbuild but not minified. That is fine for a
  skeleton and can be decided later.
- The settings groups are empty, so nothing reads them yet.

## Session 0B: Cloudflare deployment settings

**Date:** 2026-11-02
**Branch:** main

### What was asked

Prepare the project to deploy to Cloudflare as a static web page, with no game
features: a `wrangler.jsonc` that serves `dist/` as a static site; Wrangler as a
development dependency with an `npm run deploy` script; a placeholder page with
a large "Armada's 1805" heading and the line "Build 0B: deployment test" that
works on a phone; checks, a build-log entry and a commit.

### What was built

- `wrangler.jsonc`: Worker name `armadas-1805`, today's compatibility date, and
  `assets.directory` set to `./dist`. There is no server entry point, so
  Cloudflare only serves the built files.
- `wrangler` added as a root development dependency and an `npm run deploy`
  script that runs `wrangler deploy`.
- `shared/index.ts`: the game name is now "Armada's 1805", the build tag is
  "0B", and a `BUILD_NOTE` of "deployment test" supplies the second line. The
  page still reads all three from the shared code.
- `client/index.html`, `client/main.ts`, `client/styles.css`: large centred
  heading and a build line underneath, sized with `clamp()` so the text stays
  readable on a phone and the frame never grows wider than the screen.
- `README.md`: updated page text and a short deploy section.

### Checks

- `npm install` succeeded and installed Wrangler.
- `npm run build` succeeded and `dist/` contains `index.html`, `main.js` and
  `styles.css`, with the heading and build line in the page.
- `npx wrangler deploy --dry-run` validated `wrangler.jsonc` and listed the
  files that would be uploaded.

### Broken or unfinished

- Nothing has actually been deployed. Deploying needs a Cloudflare account and
  a one-time `npx wrangler login`, which cannot be done from this workspace.
- The page is still a placeholder: no game features, no server runtime.

## Session 1A-a: paper style foundation

**Date:** 2026-11-02
**Branch:** main

### What was asked

One shared paper-and-ink style for every screen, with a documented palette, a
seamless code-generated paper texture, self-hosted open-licence fonts, four
components (paper panel, inked button, wax-seal button, urgent alert), WCAG AA
body text, three remembered UI sizes and 44 px touch targets. Show it on the
page with "Armada's 1805" on a paper panel and one example of each component.

### What was built

- `client/paper.css`: the single style sheet. Palette tokens, paper grain as a
  percent-encoded SVG data URI (noise plus fibres, no image files), edge-only
  stains and fold lines on `.paper::before`, and every component.
- `client/fonts/`: IM Fell English and Source Sans 3 (400/600) as WOFF2, with
  both OFL licence files. The build copies them to `dist/fonts/`.
- `client/index.html` and `client/main.ts`: a style test page with the title on
  a paper panel, sample buttons and alert, and a small/medium/large size picker
  saved in `localStorage` under `armadas.uiSize`.
- `docs/STYLE.md` and a style rule in `RULES.md`.
- `npm run build` now copies `paper.css` and the fonts and no longer copies the
  old `client/styles.css`.

### Checks

- `npm run build` passed; `dist/` has `index.html`, `paper.css`, `main.js` and
  `fonts/` with all three WOFF2 files and both licences.
- Contrast on paper: ink 12.03:1, faded ink 6.47:1, urgent red 5.64:1; cream on
  wax red 7.41:1. All pass WCAG AA for normal text.
- The style sheet contains no `#000` or `#fff`.

### Broken or unfinished

- No browser is available in this workspace, so the page was checked by build
  inspection, not visually. Phone and desktop layout have not been seen on a
  real screen yet.
- Menus look the same day and night because there is deliberately no dark theme;
  the only menu styling so far is the `.menu` list used by later screens.
- UI size choice is stored in `localStorage`; with storage blocked the page
  falls back to medium.

## Session 1A-b: sailing rules and tests

**Date:** 2026-11-02
**Branch:** main

### What was asked

Plain-TypeScript sailing rules in `shared/sailing.ts`, the three placeholder
ships and a constant north-west wind in `shared/settings.ts`, gradual turning,
automatic tacking for upwind orders that must always stop at the target, and
automated tests for the no-sail angle, turn rate, downwind and upwind trips for
all three ships, and determinism.

### What was built

- `shared/settings.ts`: the three ships (cruise/top speed in knots, closest
  angle to the wind, minutes for a 90 degree turn), a constant 12-knot
  north-west wind, the speed curve key values, the 4 km arrival radius, the
  2.5 km tacking half-width and order limits.
- `shared/sailing.ts`: ship state (position, heading, speed, order), angle to
  the wind, a smooth speed curve, turn rate from the settings, and the sail-to
  order. Upwind orders zigzag across the wind line through the target; tacks
  start early enough to keep the zigzag inside its half-width.
- Arrival is checked before every turn. The zigzag half-width (2.5 km) is kept
  below the arrival radius (4 km), so crossing the target's wind line always
  ends inside the radius. A ship can never circle short of an upwind target.
- `tests/sailing.test.ts`, `tests/tsconfig.json` and `scripts/test.mjs`:
  `npm test` compiles shared and the tests, then runs Node's test runner.
- `shared/package.json` exports `@naval/shared/sailing`.

### Checks

- `npm test`: 7 tests, all passing. They cover the no-sail angle, a 90 degree
turn against the settings, downwind arrival and stop, upwind tacking/arrival
and stop for all three ships (both at a fine step and at the 14.4 game-second
server tick), determinism over 5,000 steps, and refused orders.
- `npm run build` still passes.

### Broken or unfinished

- The wind is a constant north-west placeholder; weather comes later.
- `topKnots` is stored but not used yet, because only cruise speed is modelled.
- The 4 km arrival radius is deliberately larger than the 5 km-wide zigzag. It
  may want tuning once ships are visible on screen.
- No client or server uses these rules yet; that is Part C.

## Session 1A-c: server, two devices, sailing

**Date:** 2026-11-02
**Branch:** main

### What was asked

A Cloudflare Worker plus a `GameRoom` Durable Object that runs the real 10 Hz
world and sends 5 updates a second; room codes from `?room=`; a remembered
player id; server-checked sail-to orders; all outgoing world data through
`visibleStateFor`; a compact message format; a PixiJS client with smoothed
ships, tap orders, a target marker, pan, 5-300 km zoom, follow, and a paper
HUD with speed, heading, wind arrow and compass rose; and simulated-client
testing.

### What was built

- `shared/world.ts`: the world, player ships placed in the start area,
  `applyOrder`, `stepWorld`, and `visibleStateFor` as the only function that
  turns world state into client data. It currently returns every ship.
- `server/src/gameRoom.ts`: one Durable Object per room. It accepts the
  WebSocket, starts a 10 Hz `setInterval` world loop, broadcasts every second
tick, and applies only orders that pass the shared checks. Bad JSON and bad
  coordinates are ignored.
- `server/src/worker.ts`: sends `/ws` to the room's Durable Object (after
  checking the room code) and serves `dist/` through the `ASSETS` binding.
- `wrangler.jsonc`: Worker entry `server/dist/worker.js`, `GAME_ROOM` binding,
  a `v1` SQLite-backed migration and the `dist/` assets binding.
- `client/main.ts`: PixiJS draw loop, plain blue-green sea, navy hulls with a
  wax-red ring on your own ship, interpolation between 5 Hz updates, tap to
  order, marker, drag pan, pinch/wheel zoom, follow toggle and reconnect.
- `client/index.html` and `client/paper.css`: the game screen and its HUD,
  using the one shared paper style and the three remembered UI sizes.
- `scripts/simulate-clients.mjs` and `npm run test:server`.
- `tests/world.test.ts`: start placement, returning ids, compact state,
  order checking, world stepping and mutual visibility.
- Removed the old `server/index.ts` placeholder.

### Checks

- `npm test`: 13 tests, all passing.
- `npm run build`: passing. The client bundle is about 1.65 MB unminified.
- `npx wrangler deploy --dry-run`: passing, with the Worker, `GameRoom`
  binding and asset binding recognised.
- `npm run test:server` (local workerd): passed. Two clients in `simtest` saw
  both ships and moved 3.2 km and 2.64 km; a third client in `otherroom` saw only
its own ship. 118 ticks in about 12 seconds; 63 updates to one client; normal
update 128 bytes, smallest 88, largest 130. Junk and out-of-range orders did
not drop the socket, and the two clients stayed within one tick.
- Local asset serving checked with curl: `/`, `/main.js`, `/paper.css` and a
  font all returned 200 with the right content types; `/main.js` is served in
  full.
- `grep` confirms the only `socket.send` call serialises
  `visibleStateFor(...)`; no other code sends world data.

### Broken or unfinished

- Nothing was deployed. The Cloudflare account builds from `main`; this
  workspace has no account login. The dry run is not a deployment.
- There is no browser in this workspace, so the PixiJS view, pinch/drag input
  and the phone/Chromebook layouts were not seen on screen. They are checked
  only by type checking, bundling and HTTP serving.
- Room state is in memory. A Durable Object eviction or restart resets the
  world; neither storage nor hibernation is used yet. The 10 Hz loop uses
  `setInterval`, not alarms.
- The server steps a fixed 14.4 game seconds per tick and ignores real timing
  drift.
- Hidden information does not exist yet, so `visibleStateFor` returns every
  ship. That is the one place to change when it does.
- `topKnots` is still unused, and the wind is still the constant placeholder.
- The client says so on screen if WebGL cannot start; this was not tested on a
  device without WebGL.

## Session 1B-a: map data from Natural Earth

**Date:** 2026-11-02
**Branch:** main

### What was asked

The real chart, built only from Natural Earth 1:10m land through the
`world-atlas` npm package: a `shared/map.ts` frame projection, a conversion
script producing drawing tiles and a compact server land lookup, all named
islands checked, credits and map documentation, and tests for the projection
and known land/sea points.

### What was built

- `shared/settings.ts`: the frame (longitude -100 to -28, latitude 24 to -78),
  half-scale factors (52.93 km per degree of longitude, 55.3 km per degree of
  latitude), tile levels, simplification tolerances and lookup limits.
- `shared/map.ts`: longitude/latitude to map kilometres and back, plus the
  frame size and bounds check. The chart is 3,810.96 by 5,640.6 map km.
- `scripts/build-map.ts` and `npm run build-map`: reads `land-10m.json`,
  projects and clips the coast, merges the empty invented-features list,
  simplifies each level, clips tiles without inking tile edges, and rasterises
  the server lookup.
- `client/public/tiles/`: 1,618 land tiles in five levels (2,048 km down to
  128 km), 3.07 MB in total. Largest tile 56,578 bytes; most complex 3,579
  points. `index.json` lists tiles and point counts.
- `shared/data/landMask.ts`: a 1 km land mask (3,811 x 5,641 cells), run-length
  encoded and base64 text. The generated file is 72,238 bytes, 45,687 bytes
  after gzip.
- `shared/land.ts`: constant-time `isLandAt`, decoding the mask once at load.
- `shared/data/inventedFeatures.ts`: an empty extension point for later
  invented land such as the Phantom's island.
- `CREDITS.md` and `docs/MAP.md`.
- `tests/map.test.ts`: frame size, projection round trip, frame bounds and
  known land/sea points (inland Amazon, central Jamaica, mid-Atlantic, the
  British start).

### Checks

- `npm run build-map`: passes. All checked islands are present in both the
  source data and the lookup: Cuba, Jamaica, Hispaniola, Puerto Rico,
  Trinidad, Guadeloupe, Martinique, Saint Lucia, Barbados, Galapagos,
  Falklands, Tierra del Fuego, Chiloe, Trindade and South Georgia. The British
  start at 13 N, 79.5 W is sea.
- `npm test`: 17 tests, all passing.
- `npm run build`: passing.

### Broken or unfinished

- No browser is available in this workspace. The tile data has not been drawn
  yet; that is Part C.
- The lookup is a 1 km raster, so its coast is accurate to about a kilometre.
  Shallow-water grounding still needs depth data and comes later.
- The generated tiles and lookup are committed. Rebuilding them needs the
  `world-atlas` and `topojson-client` development dependencies, which are not
  needed by a normal build.

## Session 1B-b: coast and world edge

**Date:** 2026-11-02
**Branch:** main

### What was asked

Load the land lookup in the server, stop ships at the coast and cancel the
order, check the whole path between ticks, add a hard chart edge with its own
message, move the start area to 13 N, 79.5 W, and test Jamaica, the edge and an
upwind order along a coast.

### What was built

- `shared/world.ts`: the world now owns a per-player notice queue. After every
  step it checks the full line the ship travelled, sampled every 0.25 km, and
  stops at the last water point before land or just inside the chart edge. The
  order is cleared, speed is set to zero and a short notice is queued:
  "Your ship stopped at the coast." or "Edge of the charted world."
- `shared/settings.ts`: start area at 13 N, 79.5 W, a 6 km radius, a 1.5 km
  minimum separation, and the path sample and stop margins.
- `shared/world.ts` start placement: ships are placed around the British start
  and a second new player is walked around the circle until at least 1.5 km
  away.
- `server/src/gameRoom.ts`: after the normal `visibleStateFor` update, sends any
  waiting notice as a separate `{ "t": "n", "text": ... }` message.
- `client/main.ts`: camera starts over the new British start.
- `scripts/simulate-clients.mjs`: orders are now relative to each ship, because
  the old absolute coordinates sat outside the 400 km order limit.
- `tests/coast.test.ts`: Jamaica coast, a single enormous step that would jump
  the island, the chart edge, an upwind arrival alongside Jamaica, start
  separation and no drift without an order.
- `tests/world.test.ts`: start placement and order checks updated for the new
  start area.

### Checks

- `npm test`: 23 tests, all passing.
- `npm run build`: passing.
- `npm run test:server`: passing. Two clients near the new start moved 3.16 km
  and 2.64 km and stayed in sync; the other room saw only its own ship. A
  normal update is now 136 bytes.

### Broken or unfinished

- The notice is sent by the server but the paper notice that displays it is
  part of Part C.
- There is no order queue yet, so clearing queued orders means clearing the
  ship's single current order.
- The coast stop uses the 1 km lookup, so it can be up to about a kilometre
  from the drawn coast. Shallow-water grounding still needs depth data.

## Session 1B-c: real map on screen

**Date:** 2026-11-02
**Branch:** main

### What was asked

Draw the real chart from the tiles: load only tiles near the view at the right
detail, show a charting indicator, keep drawing cheap on a phone and a
Chromebook with a point cap, use a light land wash with a dark ink coast and a
lighter water line outside it, smooth the coast, show the coast/edge messages
as fading paper notices, and keep pan, tap-to-sail and the 5-300 km zoom.

### What was built

- `client/main.ts`: loads `tiles/index.json`, chooses a level whose tiles are
  no larger than twice the view, fetches only visible land tiles, and caches
  their JSON. Tiles are built in screen coordinates so panning shifts one
  layer and zooming rebuilds it at most every 120 ms.
- Chart drawing: `#efe3c8` land wash, a 1.5 px `#2a1c10` coast line, a 7 px
  lighter `#b79b6b` line outside it, and quadratic smoothing through the coast
  points. The sea stays `#7c948a`.
- A 30,000-point per-frame cap. The client also lowers the level if a view
  would exceed it, and drops the furthest tiles as a last resort.
- `client/index.html` and `client/paper.css`: the `Charting…` scrap and the
  fading `.chart-notice` paper message, with a phone placement above the ship
  panel.
- `client/main.ts` handles the server's `{ "t": "n", "text": ... }` notices.
- `scripts/build.mjs`: copies `client/public/` (the tiles and index) into
  `dist/`.
- `scripts/measure-map.mjs` and `npm run measure-map`: the worst-view geometry
  measurement, using the same level choice and cap as the client.
- `tests/tiles.test.ts`: manifest/file integrity, per-tile size, total file and
  byte limits, and a sample tile shape.
- Corrected the world to the chart's y-south convention. Sailing movement,
  target bearings, tacking, start placement, the client camera and the
  simulation now all use y growing south; before this the map and ships would
  have been mirrored against each other.
- `README.md`, `docs/MAP.md` and `docs/STYLE.md` updated.

### Checks

- `npm test`: 25 tests, all passing.
- `npm run build`: passing.
- `npx wrangler deploy --dry-run`: passing. 1,634 asset files; Worker upload
  93.00 KiB, 53.10 KiB gzipped.
- `npm run test:server`: passing. Alpha moved 2.72 km, beta moved 4.86 km, the
  rooms stayed separate, and a normal update was 137 bytes.
- Static check through a local workerd server: `/`, `/main.js`, `/paper.css`,
  `/tiles/index.json`, `/tiles/4/8_2.json` and a font all returned 200 with the
  right content types.
- `npm run measure-map`: the worst view found was 180 km across over southern
  Chile on a 360 x 800 phone screen. It loaded 6 tiles (171,423 bytes) and drew
  16,292 chart points (21,634 charged against the cap), below 30,000.

### Broken or unfinished

- No browser is available in this workspace. The chart, ink coast, charting
  scrap, notice fading, touch pan/pinch and WebGL rendering were not seen on a
  screen. Real frame rates on a Samsung A16 and a Chromebook are unmeasured;
  the 16,292 points and 171 KB are geometry and download measurements.
- No deployment was made. The dry run validates the Worker and asset bundle
  only; Cloudflare builds from `main`.
- The map layer is screen-space and rebuilds on zoom. A slow pinch may briefly
  show the previous zoom's chart until the next rebuild.
- Coast stops use the 1 km lookup, so a ship can stop up to about a kilometre
  from the drawn coast. Shallow-water grounding still needs depth data.
- There is still no fog of war or whole-map overview, and there is no order
  queue.
- The largest tile is 56,578 bytes, close to the 60 KB per-tile target. New
  coast detail should raise the budget or split that tile.

## Session 1B-debug: temporary whole-map view

**Date:** 2026-11-02
**Branch:** main

### What was asked

A temporary client-only debug view enabled only by `debug=1` in the address:
zoom out to the whole chart, return to the ship, show pointer latitude and
longitude, draw the world border and a labelled 10-degree grid, keep normal
zoom limits unchanged, mark everything TEMP-DEBUG, and add a removal rule and
this build-log entry.

### What was built

- `client/main.ts`: `DEBUG_VIEW` is true only when the query string has
  `debug=1`. In debug, the camera may zoom out to the whole map (the fit is
  `max(3,811 km, 5,641 km × screen aspect)` plus a small margin). Normal play
  still clamps at the existing 300 km, and the minimum stays 5 km.
- Far-out debug views force the coarsest tile level (level 0).
- A hidden `.debug-panel` paper panel appears only in debug. It has **Whole
  map** and **My ship** buttons and a live latitude/longitude readout updated
  from pointer movement.
- A debug-only layer draws a thin ink border around the chart and a faint
  10-degree longitude/latitude grid with Pixi text labels. It moves with the
  map when panning and is rebuilt with the chart on zoom.
- `client/index.html` and `client/paper.css`: the panel markup, paper styling
  and phone spacing.
- `RULES.md`: the TEMP-DEBUG removal rule.
- Every debug block is marked with a `TEMP-DEBUG` comment. The server, network
  messages and normal camera path are untouched.

### Checks

- `npm test`: 25 tests, all passing.
- `npm run build`: passing. The client bundle is about 1.7 MB unminified.
- Normal-path static check: the built page contains the debug panel with the
  `hidden` attribute, `DEBUG_VIEW` is false without `debug=1`, the debug layer
  starts invisible and the normal camera maximum still returns
  `settings.view.maxKmAcross` (300 km).
- Whole-map fit check: 3,887 km across on a 360 × 800 phone and 9,205 km on a
  1280 × 800 Chromebook. Both show the whole 3,811 × 5,641 km chart inside the
  screen.
- The debug URL was not opened in a browser; this workspace has no browser.

### Broken or unfinished

- The debug view, grid labels, pointer readout, buttons, pinch, scroll and drag
  were not seen on a real screen. Normal-view behaviour was checked by code
  inspection and the built page, not interactively.
- The debug panel may overlap the chart on very short landscape phone screens;
  this is unmeasured.
- No server or deployment changes were made.

## Session 1C-a: coast, test ships, and one coast outline

**Date:** 2026-11-02
**Branch:** main

### What was asked

Fix ships sticking at a coast, give test/dev rooms the British frigate, and
draw the land wash, ink coast and water line from one smoothed outline.

### What was built

- `shared/world.ts`: a coast collision now keeps a seaward order alive. The
  ship is placed about 1 km offshore, its heading is still allowed to turn,
  and it holds a clear-water escape heading until it is away from land. An
  order whose straight path crosses land still stops with the coast notice.
- `shared/sailing.ts`: a stationary ship no longer flips tacks before it has
  steerageway, which stopped the old upwind zigzag from oscillating at zero
  speed. The world step accepts an optional wind direction for tests.
- `shared/world.ts`: `shipClassForRoom` returns a frigate for room codes
  starting `test` or `dev-`, and the flagship for every other room. Real ship
  numbers are unchanged.
- `client/main.ts`: the fill is traced from the same quadratic-smoothed
  outline as the ink and water lines. Artificial tile-clipped edges remain
  straight so neighbouring pieces overlap cleanly.
- `shared/settings.ts`: open-water clearance, tack awareness, offshore probes
  and tile overlap are settings.
- Tests: 27 pass, including the new eight-wind coast escape and room-class
  checks.

### Checks

- `npm test`: 27/27 passing.
- `npm run build`: passing.
- The new coast test puts a ship against western Jamaica, facing the shore,
  and orders it 10 km back out to sea under winds from all eight directions.
  It verifies the ship never ends aground, moves clear, and does not lose the
  seaward order to a coast collision.

### Broken or unfinished

- No browser is available. The smoothed fill and coast were checked by type
  checking and code inspection, not visually at Venezuela, a Caribbean island
  or Tierra del Fuego.
- The coast escape is deliberately simple: a sea target whose straight route
  crosses land still cancels the order. A future routing pass can sail around
  headlands.

## Session 1C-b: server fog and chart data

**Date:** 2026-11-02
**Branch:** main

### What was asked

Per-player discovered ground, live sight filtering, last-seen markers, private
chart geometry, test/debug room starts, and compact updates.

### What was built

- `shared/fog.ts`: a 5 km discovery bitset per player, circle reveal, 25 km
  block queues, and room kinds. Dev rooms start fully explored.
- `shared/world.ts`: `createWorld(roomCode)` records the room kind; test rooms
  start 30 km off the nearest coast to the British start, with a frigate.
  `visibleStateFor` now returns only own and in-sight ships, last-seen markers
  (class, navy, position, game-time age) and newly discovered chart data.
- `server/src/chartBlocks.ts`: 10,440 private 25 km blocks generated from the
  fine coastline (3.9 MB TypeScript; largest block 537 points / 8,798 bytes).
  It is bundled into the Worker, not `dist/`.
- `server/src/gameRoom.ts`: creates each room with its code and attaches at
  most eight block geometries per state message.
- Map drawing tiles moved to `map-data/tiles` and are no longer copied to
  public hosting.
- `docs/FOG.md`: one-page approach note.
- Tests: 32 pass, covering sight in/out, fading markers, dev-all, independent
  charts, block release only after discovery, and test-room frigates.

### Checks

- `npm test`: 32/32 passing.
- `npm run build`: passing; `dist/` contains no tile or block geometry.
- Chart blocks are only included through `visibleStateFor`; the normal state
  contains only the player's own and in-sight ships.
- The generated block bundle is a proxy for deployment; Wrangler bundle limits
  have not been tested on a real Cloudflare account.

### Broken or unfinished

- The browser client still expects the old public tiles and is replaced in
  Part C. Until then, the page's chart will not load.
- No browser or Cloudflare deployment was available. Message sizes were not
  measured over a live socket yet.

## Session 1C-c: fog view on the live page

**Date:** 2026-11-02
**Branch:** main

### What was asked

Finish the missing ship view for prompt 1C. The test room was showing no fog:
the expected 25 km live circle on paper, dimmed discovered ground and a live
wind-streak layer. Check the room, server, block and client path, add a
test/dev TEMP-DEBUG readout, test, build, commit and push.

### What was broken

The server was already sending `k`, discovered cells and private chart blocks.
The browser client ignored all three, still fetched `./tiles/index.json` and
tile JSON files that Part B had removed from public hosting, and drew no fog.
The room type reached the Worker and `visibleStateFor`, but not the screen.

### What was built

- `client/main.ts` now consumes `state.chart.cells`, `state.chart.blocks`,
  `state.k`, `state.l` and `state.ships` only. There are no tile fetches.
- Ship view: 4–65 km across the shorter screen side, dim remembered sea and
  land, opaque paper over undiscovered cells, a bright 25 km sight circle with
  a soft sea rim, last-seen markers, and animated wind streaks.
- Chart view: the whole paper down to 25 km, built from received blocks,
  cached with Pixi's `cacheAsTexture`, with ships, last-seen markers, tap orders
  and a scale ruler.
- A test/dev-only TEMP-DEBUG line shows room type, discovered cells, received
  map blocks and the sight radius. Normal rooms show nothing.
- Removed the `debug=1` whole-map panel and its grid/position controls. The
  chart is now a normal screen, not a debug option.
- `RULES.md` now says the remaining TEMP-DEBUG line must be removed before
  release. `docs/FOG.md` and `README.md` were updated for the block-based view.
- `shared/fogView.ts`: pure helpers for the debug line and paper-cover rule;
  `tests/fog-view.test.ts` covers them.

### Path check

A real local `wrangler dev` WebSocket to `test-1` returned:

- `k: "test"`, one frigate, 77 discovered cells, 3 private blocks, 3,057 bytes.
- The next state had 0 new cells, 0 new blocks and was 161 bytes.
- The built page was HTTP 200 and contained the chart and fog-debug controls;
  it contained no public tile path.

### Checks

- `npm test`: 35/35 passing.
- `npm run build`: passing.
- `grep` for `tiles/index.json`, `debug=1`, `charting` and `debug-panel` in the
  client/server/public page: no matches.

### Broken or unfinished

- No browser is available, so the paper cover, bright circle, dim ground,
  wind streaks, chart cache, pinch/drag and phone layout were not seen on a
  screen. They are reasoned from the draw order and checked by type/build.
- The map sheet is cached only in chart mode; panning more than about 1.5
  screens or zooming rebuilds it. Frame cost was not measured.
- Parts 1C-d (stress test) is still unfinished.

## Session 1D-b: cache safety and idle sleep

**Date:** 2026-11-02
**Branch:** main

### What was asked

Finish 1C status reporting, then make updates safe against stale browser files
and stop the room's world timer when nobody is connected.

### What was built

- `scripts/build.mjs` now writes `main.<content-hash>.js` and
  `paper.<content-hash>.css` and rewrites the page to those names. It also
  writes `version.json` with the build id and source commit, plus build metadata
  in the page. The page and version file are served with no-cache headers; the
  hashed files can be cached forever.
- The page checks `version.json` about once a minute and on returning to the
  tab. If the build changed, a paper notice says "A new version is available:
  tap to reload". It never reloads automatically.
- The TEMP-DEBUG line now includes the build commit.
- `shared/roomLoop.ts` owns the single world timer. The first connection starts
  it, the last disconnect stops it, and extra connections or messages cannot
  start another. Game time is frozen while empty and resumes without catching
  up.
- `docs/STRESS.md` records the idle behaviour and free-plan arithmetic:
  128 MB × 3,600 s ≈ 460.8 GB-s for one active room-hour.
- Tests: 37 pass, including the room timer lifecycle and frozen-time resume.

### Cache note

Private chart blocks are not fetched from URLs: `visibleStateFor` sends them
inline in WebSocket state, so a browser cannot cache a block separately from
the code. Moving them to URLs later would need the map data version in the path.
The entry page, version file and content-hashed bundle now make stale mixes
impossible through normal browser caching.

A real local workerd check then found that static assets were served before the
Worker, so the first version of these headers never reached the browser. The
follow-up commit `1194b0c` sets `assets.run_worker_first`. The same check now
returns `Cache-Control: no-cache, no-store, must-revalidate` for `/` and
`/version.json`; both hashed files return 200 and `/main.js` returns 404.

### Broken or unfinished

- No browser is available, so the reload notice and the hashed page were not
  seen or exercised interactively.
- A real Durable Object sleep/eviction was not observed locally. The timer stop
  is unit-tested; deliberate eviction is not.

## Session 1D-c: load test mode

**Date:** 2026-11-02
**Branch:** main

### What was asked

Add a temporary, dev-room-only computer fleet so the owner can run a live load
test, with real fake-player updates, loop metrics and a local benchmark.

### What was built

- `shared/bots.ts`: 1–300 British frigates split across eight fake owners, with
  sea-only spawns and destinations, normal sailing orders, and replacement
  destinations after arrival or a coast stop. About 10% start within 40 km of
  the first human; the rest are placed in the Caribbean and northern South
  America.
- Fake owners have their own charts and discover from every ship in their
  fleet. The shared visibility path now accepts multi-ship owners, but human
  players still have one ship and the same filtering as before.
- `/?room=dev-load&bots=100` passes the count through to the socket. Normal and
  test rooms ignore it; a dev room rejects counts outside 1–300.
- `server/src/gameRoom.ts` builds and measures eight full `visibleStateFor`
  updates at 5 Hz and discards them. `LoadMetrics` records real timer gaps and
  per-player bytes over ten seconds without measuring CPU from inside.
- Dev-room state carries the compact counters and the TEMP-DEBUG line shows
  ships, world updates/s, average/worst gap, bytes/s per player, and the
  client's received updates/s and worst receive gap.
- `RULES.md` records that the whole mode is temporary and dev-only.
- `scripts/benchmark-world.mjs` and `npm run benchmark:world`.

### Checks

- `npm test`: **45/45 passing**, including bot limits, sea-only spawn and
  destinations, owner split, proof that a fake update leaks no out-of-sight
  ship, and frozen/resumed room time.
- `npm run build`: passing.
- `npm run benchmark:world` (Node 26.13, rough local proxy): 25 ships 31.0 ms,
  50 ships 39.0 ms, 100 ships 88.7 ms and 200 ships 158.6 ms for ten simulated
  seconds including fake updates. Full table in `docs/STRESS.md`.

### Broken or unfinished

- The live browser load test was not run here, by instruction; there is no
  browser and the owner will run it on their own devices. Actual Cloudflare
  CPU, memory and live message sizes remain unmeasured.
- The local benchmark omits private chart-block geometry, so its update bytes
  are lower than a live room with new block data.
- There is still no saving, and Part 1D-d (the game clock) is next.

## Session 1D-d: game clock

**Date:** 2026-11-02
**Branch:** main

### What was asked

Finish Phase 1 with a server-owned 144× game clock, a free-running moon phase,
a paper clock panel, and a gentle day/night wash that never hides the live
circle or touches the chart and paper HUD.

### What was built

- `shared/time.ts`: Day 1 starts at 08:00. One game day is 24 game hours and
  10 real minutes. Dawn and dusk blend smoothly for one game hour, and the moon
  repeats every 29.5 game days with a phase and illumination value. The moon is
  not used by any other game rule yet.
- `World.gameMs` is the integer clock authority. It advances by a fixed number
  of milliseconds per world update, freezes with the room, and cannot drift.
  `world.gameSeconds` is derived from it for last-seen ages.
- State messages carry a compact `g` game-millisecond value in the initial
  state and every update. The client predicts forward at 144× and settles onto
  each received value instead of jumping the display.
- The ship panel shows `Day N, HH:MM` with a sun or moon icon. The ship view
  gets a dark-blue night wash whose strength is a setting. It is drawn above
  the chart but below live circles, ships, markers and the paper HUD, so it
  stays readable at full night. Chart mode hides it completely.
- Sight range is unchanged; night range changes wait for ship stats.
- Settings cover the start hour, day length, daylight boundaries, twilight,
moon cycle and night-wash strength. The existing `sailingTimeScale` is reused.

### Checks

- `npm test`: **50/50 passing**, including day/night boundaries, smooth dawn
  and dusk, the 29.5-day moon cycle, no drift after 10,000 updates, and two
  clients receiving the same clock.
- `npm run build`: passing.
- `npm run test:server`: passing. Two clients advanced 118 ticks, stayed in
  sync and received `g` in normal state; the sample clock was 1,785,600 ms.
- Local `wrangler dev` header check: `/` and `/version.json` return
  `no-cache, no-store, must-revalidate`; hashed JS/CSS return 200; the old
  unhashed `main.js` returns 404.

### Broken or unfinished

- No browser is available, so the sun/moon swap, paper clock layout, night
  wash strength and transition smoothness were not seen on a screen.
- The real Cloudflare clock coarsening and a long overnight session were not
  observed.
- There is still no saving. The temporary bot mode and TEMP-DEBUG readout
  remain, as requested for this phase.

## Session 1E-a: player identity fix

**Date:** 2026-11-03
**Branch:** main

### What was asked

Stop a refresh creating a second ship, add a takeover notice for a second tab,
allow `?as=NAME` in test and dev rooms, remove test/dev ghosts after 120
seconds, and show the short player id in TEMP-DEBUG.

### Cause of the refresh bug

The client had only one place that made an id: `playerId()`. It read
`localStorage` and swallowed any read or write error, then generated a fresh
random id on that page load. The server was already matching an incoming id to
an existing player. In a browser context where `localStorage` is blocked or
partitioned, every refresh therefore sent a new id, the server correctly made a
new ship, and the old ship remained. There was no session-storage fallback, so
the identity could not survive even one reload in that context. I could not
reproduce the owner's browser storage policy in this workspace; the identity
code has no other path that changes an id on reload.

### What was built

- `shared/playerIdentity.ts`: one stable `armadas.playerId`, `localStorage`
  first and `sessionStorage` second. If both are blocked the id still works for
  the page and the player gets a paper warning. `?as=NAME` appends the name to
  the stored id only in test and dev rooms, with a strict length-safe format.
- `shared/playerSessions.ts`: the newest socket for an id takes over; the old
  socket is closed with code 4001 and the old page shows "This game is open in
  another tab" and stops reconnecting. The session map ignores the old socket's
  later close event, so it cannot remove the new connection.
- Test and dev rooms schedule removal of a disconnected player's ship, chart
  and notices after `settings.players.ghostRemoveAfterSeconds` (120). Reconnect
  cancels it; normal rooms never schedule it. The room loop still stops when
  the last socket leaves.
- TEMP-DEBUG now includes the short player id.
- Tests: 57 pass, including same-id refresh preserving position and chart,
  storage fallback, `?as=`, takeover, cleanup timing and normal-room retention.

### Broken or unfinished

- No browser is available, so the takeover notice and storage warning were not
  seen on screen. The server paths are unit-tested, not exercised in a browser.
- A Durable Object can be evicted before the 120-second timer fires; in that
  case its in-memory room is gone anyway. No persistent storage is used.
- Saving is still absent.

## Session 1E-b: bot count

**Date:** 2026-11-03
**Branch:** main

### What was asked

Make `bots=N` set the dev room's bot count on every join, not only when the
room was first created; add or remove ships, clamp 0–300, keep eight fake
owners and all previous load-test behaviour, and show bot and total ship
counts separately.

### What was built

- `server/src/gameRoom.ts` reads `bots=` on every connection. When present it
  calls `setBotCount`; when absent it leaves the count unchanged.
- `shared/bots.ts` now has `setBotCount`: it removes excess ships from the
  largest fake fleets, adds new ships to the smallest owners, and keeps ids
  unique. Zero empties the fleets. The count is clamped to 0–300; invalid text
  is still rejected.
- `LoadMetrics.snapshot` and the TEMP-DEBUG tuple carry bot ships as well as
  total ships. The line reads, for example, `50 bots · 76 ships total`.
- Tests: 58 pass, including 25→50→10→0→300 on later joins, the clamp and the
  dev-room guard.

### Broken or unfinished

- The bot-increase path runs inside the join request. Adding 300 ships at once
  was not timed separately from the earlier local benchmark.
- No browser load test was run here, by instruction.

## Session 1E-c: drawing fixes

**Date:** 2026-11-03
**Branch:** main

### What was asked

Fix the chart's rectangular land edges and block-edge ink, and the faint 5 km
grid in the dimmed ship view. Add browser-free tests using the real map data,
explain the causes, and add a test/dev-only border toggle for screenshots.

### Root causes found

- The private chart blocks were clipped to a rectangle **0.75 km larger than
the block**, for both land fill and coast. The clipped fill therefore had
straight block-rectangle sides, and the coast could keep segments running along
those sides. In the old data, 90 coast segments lay exactly on block borders and
224 fill rings were degenerate slivers. This produced rectangular pale shapes
and ink along block seams. Some coast also followed the chart frame, which made
the box at the map's top-left.
- Coast lines came from source-tile geometry and had no real boundary check.
  About 5.4% of old segments were more than 1 km from the 1 km land lookup; those
  are the straight-looking runs through land and redundant source-tile edges.
- The dim ship view painted every discovered 5 km cell as a separate translucent
  rectangle and extended each rectangle by 0.5 px. Adjacent translucent cells
  double-blended along their edges, producing the faint grid.
- Chart blocks were drawn in Map insertion (network arrival) order, so neighbours
  arriving in a different order could change overdraw at shared edges. There was
  no two-detail-level drawing path: the client only uses these blocks. The
  duplicate appearance came from overlapping block geometry and separate dim /
  live land layers.

### What was changed

- `scripts/build-chart-blocks.mjs` now clips fill and coast to the exact 25 km
  block, removes duplicate consecutive points and degenerate rings, rejects ink
  on block or chart edges, and keeps only segments within 1.2 km of the server
  land/sea lookup. The private table moved to `shared/data/chartBlocks.ts` so
  tests use exactly the committed data; `server/src/chartBlocks.ts` re-exports it.
- `shared/chartDraw.ts` sorts blocks by id. `client/main.ts` uses that order and
  clears/rebuilds the layers, so a block replaces its previous graphics and
  neighbour arrival order cannot change the result.
- `shared/fogPaint.ts` returns one screen-sized paper sheet and one sea alpha
  value with an opaque cell mask. The client draws that once per frame instead
  of one translucent rectangle per cell.
- TEMP-DEBUG `Show borders` button (test and dev rooms only): 25 km block
  outlines and 5 km cell lines. The button is hidden in normal rooms.
- Tests: **63 pass**. Geometry reports 35/12,000 land reconstruction mismatches
  (0.292%), 56,297 coast segments with **0 on block edges** and **0 away from a
  lookup boundary**, 15,335 fill rings with **0 degenerate** and **0 block-area
  mismatches**, deterministic block ordering/replacement, and a single-alpha
  mask with no overlapping mask cells.

### Broken or unfinished

- No browser is available, so the new paper/fill/mask layers, coast look, border
  toggle and phone layout were not seen on screen. There are no screenshots.
- The area test uses a 1 km lookup and allows 30 km² / 30% for small edge
  slivers; it is not a survey-grade comparison.
- The filtering of coast lines to the lookup boundary can remove a very small
  islet that the 1 km lookup does not contain.
- Saving is still absent.

## Session 1F-a: sea drawing

**Date:** 2026-11-03
**Branch:** main

### What was asked

Restore the missing blue-green sea in the ship view, make the dim and live
layers safe, add a browser-free render-plan test, cap live block graphics, and
cache the chart at no more than 2048 x 2048.

### Root cause

The two sea layers were clipped by Pixi geometry masks whose mask Graphics had
`renderable = false`. Pixi's stencil-mask pipe builds the mask by collecting the
mask container's renderables, so an unrenderable Graphics produces an empty
stencil. The result was a missing sea (and missing live land/ink) while the
dim land, ink, ships and weather still drew. The first render-plan test failed
on the old code because there was no render plan; the mask flag was then found
by reading the Pixi mask path against the client stage.

### What was built

- Removed the alpha/stencil mask from the remembered layer. Remembered sea and
  land are now opaque colours pre-mixed with paper; discovered 5 km cells are
  painted as opaque rectangles.
- Removed the old screen-sized wash and screen-sized cached layer. The chart is
  now a `RenderTexture` with its long side capped at 2,048 px, rebuilt only when
  new blocks arrive and no more than once a second.
- The live layer is full-colour sea and land, clipped by one renderable
  Graphics containing the sight circles. Its soft edge uses concentric ring
  strokes; no texture or filter is involved.
- Chart blocks are kept as per-block graphics. Only blocks intersecting the
  screen plus a margin are built, far-off graphics are destroyed, and the
  nearest 300 blocks are kept when a huge dev chart is loaded.
- Added `shared/renderPlan.ts` and `tests/render-plan.test.ts`. It builds the
  ship-view layer list for a test-room start and a dev room with real blocks,
  including visibility, alpha, bounds and sight-mask extents.

### Checks

- `npm test`: **65/65 passing**, including both render-plan scenarios.
- `npm run build`: passing.
- The test-room plan has a non-empty dim sea (80 cells), dim land/water/coast,
  live sea, live land/coast, ships and weather, in that order. The dev plan has
  a full-screen opaque dim sea under the live layers.

### Broken or unfinished

- No browser is available, so the reconstructed colours, mask rendering, chart
  texture orientation and per-block seams were not seen on screen.
- The dev start is open sea, so its in-view plan has no land/coast; the test
  asserts those layers at the test-room start instead.
- The chart cache is rebuilt from all received blocks; a very large dev chart
  may still take a noticeable moment on its once-per-second rebuild.

## Session 1F-b: graphics safety

**Date:** 2026-11-03
**Branch:** main

### What was asked

Handle WebGL context loss and restoration, cap device pixel ratio and texture
sizes, batch dev-room block delivery nearest-first, keep loaded rooms lazy, and
extend TEMP-DEBUG with frame rate, live block graphics, reset count and DPR.

### What was built

- `webglcontextlost` now calls `preventDefault()` and shows `Graphics reset`.
  `webglcontextrestored` recreates the chart texture and redraws the paper,
  blocks, sight circles, markers and borders from current state without a page
  reload. The chart texture is destroyed and rebuilt rather than holding a
  stale GPU texture.
- `GraphicsRecovery` counts losses in a rolling one-minute window. The third
  loss shows `Graphics keep failing. Tap to reload.`; that notice is persistent,
  keyboard-accessible and reloads only when tapped. Two losses still show the
  short reset notice.
- Device pixel ratio is capped by `settings.client.maxDevicePixelRatio` (2), and
  the chart texture is capped at 2,048 px on its long side.
- Dev-room chart blocks are ordered by squared distance from the player's ship,
  sent under a 40-block-per-second budget and at most 8 per state message. The
  client still only builds graphics for the screen plus margin, so receiving a
  dev chart does not create 1,900 live block graphics. The remembered sea also
  visits only the visible 5 km cell range, not every remembered cell.
- TEMP-DEBUG now includes FPS, live block graphics, graphics resets and the DPR
  actually used by the renderer.

### Checks

- `npm test`: **70/70 passing**, including nearest-first blocks, the 40/second
  budget, the live block cap and the three-loss recovery rule.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates,
  214-byte typical update).

### Broken or unfinished

- No browser is available, so the context-loss events and the actual restored
  Pixi stage were not fired or seen. The pure recovery rules and source paths
  were tested; the browser event path is not exercised.
- The chart texture's orientation, the opaque sea colours and the per-block
  graphics were not visually checked.
- The loaded-room performance claim is a structural improvement (no new block
  graphics off screen, no chart redraw without new data); it was not measured
  on a phone or Chromebook.

## Session 2B-a: port data

**Date:** 2026-11-03
**Branch:** main

### What was asked

Load the 97-port table, give each port its draft size values, place the 89
non-river anchorages in open sea off the real coast, keep the 8 river ports
pending, and extend test/dev ghost cleanup to 1,800 seconds.

### What was built

- Added `shared/data/ports.ts` with all 97 ports converted from lon/lat to map
  kilometres. There are 12 large, 24 medium and 61 small ports, 10 NPC ports
  and 8 river ports.
- Placed 89 anchorages (12 large, 22 medium, 55 small) in open water about 3 km
  from the real land lookup. Every anchorage was checked for sea and for a
  water route to the open ocean.
- The 8 river ports (`Mompos`, `Angostura`, `Santarem`, `Manaus`, `Santa Fe`,
  `Asuncion`, `Obidos`, `Paysandu`) keep `riverPending: true` and no anchorage.
- Added draft port settings for docking capacity, income, storage, crew and
  lookout range. Only docking capacity is used by this prompt.
- Raised test/dev disconnected-player cleanup from 120 to 1,800 seconds in
  `settings.players.ghostRemoveAfterSeconds`; normal rooms still remove nobody.

### Checks

- `npm test`: **72/72 passing**, including port counts, anchorage sea checks,
  3–6 km land distance, open-ocean connectivity and the 1,800-second cleanup.
- `npm run build`: passing.
- No port was moved more than 25 km from its listed position.

### Broken or unfinished

- No browser is available, so port locations and coastlines were checked against
  the land lookup, not viewed on screen.
- River ports remain data-only until rivers exist on the map.

## Session 2B-b: ports, navy starts and docking

**Date:** 2026-11-03
**Branch:** main

### What was asked

Add Navy selection for test/dev rooms, real navy starts and hull colours, private
port discovery, sail-to-port, docking capacity, waiting at anchor and undocking.

### What was built

- Added four navies in settings with their real start positions, flagship cruise
  speeds, draft hull colours and first NPC port. Normal rooms remain British.
- Test rooms accept `?navy=british|dutch|spanish|french` and start about 40 km
  from that navy's first NPC port. Test and dev rooms accept `&start=PORT NAME`
  for any placed port. Both must spawn in open sea.
- Every ship stores and sends its navy. Flagships use the British table with the
  selected navy's cruise speed; test/dev frigates keep the frigate table.
- Ports are world objects with no owner. A port is found when its anchorage is
  inside any of the player's 25 km sight circles. Found ports are private and
  persist in memory; dev rooms know all 89.
- Added `sailToPort` and `undock` messages. A port order uses the normal sailing
  path. Arrival fills a size-based berth or joins that port's waiting queue with
  "Port is full: waiting at anchor." Waiting ships retry oldest-first and dock
  when a place frees.
- Docked ships sit at the anchorage, cannot receive sail orders and report their
  docked port in state. The free-place count is sent only to a player whose ship
  is docked there.
- Added short paper notices for docking, waiting and undocking.

### Checks

- `npm test`: **78/78 passing**, including navy starts/speeds, hidden ports,
  edge-of-sight discovery, capacity 4 with 5 ships, waiting, undocking and
  unfound-port rejection.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates,
  265-byte typical update).

### Broken or unfinished

- No browser or socket-level browser test is available. The port panel and
  `&start` URL wiring were not exercised through a real page; the shared rules
  and state shape were tested.

## Session 2B-c: ports on screen

**Date:** 2026-11-03
**Branch:** main

### What was asked

Draw found ports on the ship view and chart, with size-aware markers and labels,
a phone-friendly port panel, a nearest-first Known ports list, navy hull colours
and short docking notices.

### What was built

- Found ports now draw as inked rings with small anchors. Small, medium and large
  ports use different marker sizes. Ports inside a sight circle are full opacity;
  remembered ports outside it are dimmed.
- Labels use the period title font. Large ports label at every zoom, medium ports
  from `150 km` across, and small ports from `40 km`. A greedy layout shifts labels
  around the marker and hides one rather than allowing overlapping text.
- Tapping a port marker opens a paper panel with its name, size, NPC/unclaimed
  status, region, regional good, docking capacity, distance and free places when
  one of the player's ships is docked. The Sail and Undock buttons send the new
  server orders.
- The chart has a Known ports button. Its list is nearest first, and choosing an
  entry centres the chart on that port and opens the same panel.
- Hulls now use the navy colour from settings, while the player's own ship keeps
  its red ring. Docking, waiting and undocking notices use the existing paper
  notice element.
- The server now sends region and regional good with each found port so hidden
  port data never needs to be bundled into the browser.

### Checks

- `npm test`: **83/83 passing**, including found-only markers, sight dimming,
  zoom label rules, non-overlapping labels, panel buttons/free places, nearest
  port ordering and all earlier tests.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates).

### Broken or unfinished

- No browser is available, so the actual Pixi port markers, label collisions,
  panel layout on a phone, chart centring, hull colours and notices were not
  visually checked. Their screen coordinates and decisions are covered by the
  shared render/layout tests.
- Marker labels use an approximate text width for collision avoidance; the
  period font's real rasterised width may shift a label by a few pixels.

## Session 2C-a: ship data and rules

**Date:** 2026-11-03
**Branch:** main

### What was built

- Added `shared/data/ships.ts`: 24 period ships, six per navy, with guns, crew,
  speed, cargo, hull, wind, turn and draught values. Sailing now reads the
  selected navy's own ship record.
- Added the draft economy to settings: five buyable prices, one/two/three game
  day delivery by size, the test/dev delivery multiplier, the 30-ship cap,
  10% minimum crew, 5 per sailor, 25-minute pool refill and room start money.
- Added pure shipyard rules for port stock, price, delivery, sailing crew,
  hiring cost, pool refill, ship cap and permanent name checks.
- Added twenty suggested names for each navy.

### Checks

- `npm test`: **89/89 passing**, including all 24 records, gun totals, port
  stock, prices, delivery, crew rules, refill, cap and names.
- `npm run build`: passing.

### Broken or unfinished

- No buying, fleets or crew panels yet; those are Parts B and C.
- The catalogue's combat fields are stored but not used, as requested.

## Session 2C-b: money, buying, delivery, crews

**Date:** 2026-11-03
**Branch:** main

### What was built

- Players now have money, a ship list and a selected ship. The old first-ship
  map remains as a compatibility alias, while every sailing path uses the fleet.
- Orders carry an optional ship id and are refused when the ship belongs to
  someone else. A ship below 10% crew gives the notice `Needs crew.`
- Normal starts use the navy's flagship, fully crewed and with no money. Test
  rooms default to the navy's frigate and accept `ship=` and `cash=`; delivery
  runs at one tenth of normal time there.
- Shipyards exist only at found, usable, non-NPC ports. Normal rooms have no
  port ownership, so buying there says `You must own a port to buy ships here.`
  The empty `portOwners` map is the future ownership hook.
- Buying checks port stock, money and the 30-ship cap, takes the money at once
  and delivers an empty ship after game time. It docks or waits at the port.
- Crew is hired at docked ships, including NPC ports, from one shared pool per
  port. Pools refill continuously over 25 real minutes.
- Own fleet detail is private in the state message. Other players only receive
  the existing class/navy ship tuple, never names, crews or money.

### Checks

- `npm test`: **97/97 passing**, including all Part B purchase, delivery, cap,
  crew, refill and privacy tests.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates).

### Broken or unfinished

- No screen work yet: the client does not yet show money, the fleet, shipyard,
  naming step or crew panel, and its orders do not yet send a ship id.

## Session 2C-c: fleet, shipyard, crews

**Date:** 2026-11-03
**Branch:** main

### What was built

- Added the top-bar coin and money count, a Fleet button, and a selected-ship
  readout for name, type, crew and state.
- Added fleet selection on the sea and in the Fleet panel. The selected ship
  gets a thick red ring, other owned ships a thin one. Orders and Follow now use
  the selected ship. Tapping a fleet row centres it; delivery ships are disabled.
- Live sight and remembered-port dimming now use every owned ship's circle. The
  server already discovers fog from the whole fleet.
- The port panel gains Shipyard at a usable port and Hire crew whenever one of
  the player's ships is docked there.
- Added shipyard cards with every requested stat and the naming step: suggested
  name, random name, permanent-name warning, wax-seal confirmation, money and
  fleet count, plus the current port's delivery list.
- Added the crew panel with a slider, 10% / half / full shortcuts, sailor cost,
  shared pool remaining and per-ship confirmation.
- Port state now carries whether its shipyard is open to this player and its
  shared crew count. TEMP-DEBUG adds money and own-fleet count.
- Test/dev `ship=` and `cash=` values are passed through the page URL.

### Checks

- `npm test`: **102/102 passing**, including new fleet, shipyard and crew
  presentation tests and all earlier tests.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates).

### Broken or unfinished

- No browser or WebGL is available in this environment. The actual Pixi rings,
  marker selection, panel layout on a phone, naming controls, sliders, and the
  wax-seal flow were not visually or interactively checked.
- Starting ships in test and dev rooms are fully crewed, not only flagships;
  this keeps those rooms playable without first reaching a port.

## Session 2D-a: goods, stores and prices

**Date:** 2026-11-04
**Branch:** main

### What was built

- Added twelve goods: seven trade goods and five resources. Cargo carries the
  trade goods, timber and cloth together; provisions, ammunition and repair
  materials have their own stores.
- Added capacity formulas from stores days, complement, broadsides, broadside
  weight and hull points, plus empty and fully stocked store helpers.
- Added daily provisions use, starvation at 8% of the crew per game day, days
  left, and the cargo-hold speed multiplier wired into the sailing step.
- Added port production bundles, half-full port storage, NPC resource stock
  caps and refills, and regional/basic production rules.
- Added deterministic per-room price trends and port randoms, the producer
  discount, price lists and pure buy/sell/load/unload quotes.

### Checks

- `npm test`: **118/118 passing**, including all 24 ship capacity formulas,
  provisions endurance, starvation, full-hold speed, production, stock caps,
  seeded prices, bounds and trade limits.
- `npm run build`: passing.

### Broken or unfinished

- No world storage yet, no server commands and no trade screens. Those are
  Parts B and C.
- No browser is available; this part is pure data and rules only.

## Session 2D-b: server trading and stores

**Date:** 2026-11-04
**Branch:** main

### What was built

- Starting ships now carry full provisions, ammunition and repair materials.
  Bought and delivered hulls stay empty, and bots get a full larder without
  hunger simulation.
- Added shared port storage, full NPC resource stock, production every three
  game days, NPC refills and price shifts every sixty game days. All of it
  advances only while the room is occupied.
- Added server-checked buying at NPC ports, selling at NPC or usable ports,
  free loading and unloading against usable storage, and the resupply command.
- Added provisions consumption and starvation, the test/dev hunger multiplier,
  `&hunger=` on test/dev joins, and the starving flag in private ship state.
- Port snapshots now carry a filtered trade record: prices only for a docked or
  usable port, storage only for a usable port. Other players' stores are never
  sent; foreign ship tuples still carry only navy and class.

### Checks

- `npm test`: **137/137 passing**, including buying/selling/space/stock/money,
  storage limits, non-usable ports, production, NPC refill, starvation, hunger
  scaling, price shifts and privacy.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates,
  809-byte typical update).

### Broken or unfinished

- No trade screens yet; the client ignores the new trade and store fields until
  Part C.
- No browser is available, so none of the trading UI has been visually tested.

## Session 2D-c: trade and supplies screens

**Date:** 2026-11-04
**Branch:** main

### What was built

- Added four paper store bars to the selected-ship panel: provisions with days
  left, repair materials, ammunition and the cargo hold. Provision days turn
  red under ten days, and a starving crew shows a red warning.
- Added days of provisions to every fleet row, with the same red low/starving
  warning.
- Added the Trade action to the port folio and a scrolling paper trade panel
  with BUY, SELL and STORAGE tabs.
- BUY lists the five resources with price, remaining NPC stock, large stepper
  buttons, Fill up and a live total cost. SELL lists carried cargo with price
  and total paid. STORAGE shows port against ship amounts with separate load
  and unload steppers and Fill up buttons.
- The panel shows money, free room in each store and the full price list, with
  the regional good marked cheap. Resupply all fills the three supply stores
  from the port and shows the server's taken/cost summary.
- Wired the filtered trade, NPC stock, private stores, capacities, provisions
  days and starving fields into the client, and passed the test/dev hunger
  multiplier to TEMP-DEBUG.
- Kept the paper style, large touch targets, wrapping steppers and scrolling
  phone layout.

### Checks

- `npm test`: **142/142 passing**, including new store-bar, fleet-provisions,
  buy/sell/storage-limit, price-book, port Trade-button and hunger-debug tests.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates,
  809-byte typical update).
- Static DOM check: every id the client looks up exists once in `index.html`.

### Broken or unfinished

- No browser is available, so the trade panel, phone layout, steppers, bars and
  paper notices have not been visually or interactively tested.
- No new game rules or Draft numbers were added in this part.

## Session 2E-a: chart repair

**Date:** 2026-11-04
**Branch:** main

### Root causes, with evidence

- **A new page received no chart history.** The old `takeChartUpdate` drained
  only cells and blocks discovered since the last message. `GameRoom` did not
  mark a new socket for a replay, so after refresh or reconnect the client got
  `cells: []` and `blocks: []` while the server still held the bits and
  `sentBlocks`. The new reconnect test failed against that path.
- **The chart never painted discovered open sea.** `rebuildChartCache` looped
  only over received land blocks and filled each whole block with sea colour.
  A discovered 5 km cell in open ocean has no land block, so the cell set was
  ignored and most of a voyage showed blank paper. The render-plan test now
  requires a sea layer from the discovered cells themselves.
- **The cache had no guaranteed recovery from an empty client.** Its rebuild
  was keyed on `chartRevision`, while the durable discovery record lived only
  in the page that was replaced. A refresh, a second tab taking over, or a lost
  page therefore also lost the data the texture would have been rebuilt from.
  Culling and the live-graphics cap were checked separately: they never fed the
  chart, but that was not enough protection without a durable store.
- Context loss rebuilt from the in-memory block map, but that map was empty
  after a reload because of the missing server replay. Stale block replacement
  was also checked and did not remove chart content.

### What was built

- Added a pure `shared/chartMemory.ts`: discovered cells and plain block
  geometry are stored separately from ship-view graphics, with deterministic
  content, render and repaint plans.
- Every new socket now receives an alternating zero/one run-length snapshot of
  the whole discovery bitset plus the blocks touched by those cells. Blocks
  arrive nearest-first within the existing per-second budget; the client shows
  `Charting…` until `remaining` reaches zero.
- The chart now paints a pale discovered-sea wash, then land, waterline and
  coast. Its 2,048 px texture starts with a paper base and repaints only dirty
  25 km blocks into the existing target. A throttled repaint keeps its dirty
  set and retries next frame; a context reset marks every stored block dirty.
- The chart keeps discovered ground when a later snapshot arrives, so cells
  never shrink; culling, the live-graphics cap and graphics resets cannot
  delete chart content.

### Checks

- `npm test`: **149/149 passing**, including long-voyage growth, culling and
  graphics-cap independence, interrupted reconnect, pure arrival-order
  equality, render-plan sea/land/coast and throttled-repaint recovery.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates,
  823-byte typical update).
- `git diff --check`: passing.

### Broken or unfinished

- No browser is available: the Pixi texture path, WebGL context-loss recovery,
  actual phone rendering and the `Charting…` scrap have not been seen.

## Session 2E-b: route planning

**Date:** 2026-11-04
**Branch:** main

### What was built

- Added pure `shared/route.ts`: weighted A* on the 2 km setting grid, eight-way
  moves, 3 km clearance from known land, a growing search box, a 20,000-node
  limit with a 4 km fallback, line-of-sight smoothing and a 50-waypoint cap.
- The planner receives a `knownLand` predicate and never reads the land lookup
  itself. The world passes only cells in the player's chart, plus all land in a
  dev room, so undiscovered ground stays optimistic open sea.
- Sail-to-point, sail-to-port and later group orders install a route and follow
  it one leg at a time through the existing sailing and tacking rules. A route
  pauses at no waypoint: the next leg starts in the same tick.
- Every tick checks the next 30 km for newly discovered land and re-plans from
  the ship's position. A coast stop also triggers a re-plan. Automatic plans
  are limited to four per player per real second and one per ship per five
  ticks. A partial route sails to the last known-safe point and reports
  `No known route. Explore further.`; a known land destination is refused with
  `That is land.`; a destination that becomes land re-plans to the nearest sea
  point and says so.
- Own fleet snapshots now carry the selected ship's waypoints only. The client
  draws a dotted ink line with small waypoint marks on both the ship view and
  the chart.
- Point orders outside the chart frame keep the old direct coast-edge behavior;
  the planner only plans inside the frame.

### Measurements

Measured with the Node test runner on this VM, nine runs each, full land known:

- 500 km open-sea order: **0.01 ms** median (direct line of sight, no search).
- Kingston to Montego Bay around Jamaica (71 km): **8.2 ms**, 724 nodes.
- Montego Bay to Port-au-Prince through the Windward Passage (297 km):
  **0.9 ms**, 156 nodes.
- Montego Bay to Belize across the Caribbean (543 km): **1.5 ms**, 280 nodes
  (the direct line happens to be clear).
- Campeche to Matanzas around western Cuba (563 km): **18.9 ms**, 3,949 nodes.
  This is above the 15 ms target for a long coastal detour; the open-sea and
  short-island cases are well inside it. The per-player plan budget prevents
  this cost from repeating every tick.

### Checks

- `npm test`: **163/163 passing**, including all new route cases and the earlier
  sailing, coast, port and chart suites.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`).
- `git diff --check`: passing.

### Broken or unfinished

- No browser is available, so the dotted route and waypoint marks have not been
  seen on screen.
- A long coastal detour can exceed the 15 ms target; 18.9 ms was measured for
  the 563 km Campeche–Matanzas case. The fallback grid and node cap bound the
  worst case.
- Bots still use their simple direct orders, as requested.

## Session 2E-c: controls

**Date:** 2026-11-04
**Branch:** main

### What was built

- A sail-to-point or sail-to-port order now undocks a docked ship first. Invalid
  orders are checked before the ship leaves the quay; an unfound port leaves a
  docked ship where it is.
- Tapping one of my docked ships, or the marker of a port holding one, opens a
  small action sheet with `Undock` and `Port menu`. The ship panel also shows an
  `Undock` button while the selected ship is docked.
- The Fleet panel has tick boxes, `Select all`, `Clear` and `Undock selected`.
  A `Multi-select` toolbar toggle lets several ships be picked by tapping them
  on the map; selected ships carry the heavier ring and the toggle shows the
  count. Group point orders are spread by the new 1.2 km `groupSpreadKm`
  setting, and every ship receives its own route plan. Group port orders and
  group undock use the same selection.
- A neutral port now shows `Neutral port: no ships for sale here. Capturable
  ports sell ships.` instead of a shipyard button. The shipyard test now also
  proves Matanzas sells raiders and escort brigs but not frigates, and that an
  NPC port sells nothing.
- Phone layout rules cover the action sheet, Fleet tools and tick boxes. The
  paper style, fog rules and earlier panels are unchanged.

### Checks

- `npm test`: **164/164 passing**, including the new auto-undock/port-order case
  and the Matanzas escort assertion.
- `npm run build`: passing.
- `npm run test:server`: passing (`SIMULATION PASSED`, 118 ticks, 63 updates,
  850-byte typical update).
- `git diff --check`: passing.

### Broken or unfinished

- No browser is available: the action sheet, on-screen multi-select, group
  rings/count and phone layout have not been seen or tapped.
- Group spread is deliberately small; a point within 1.2 km of known land can
  still produce an offset that the server refuses as land.
