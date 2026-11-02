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
