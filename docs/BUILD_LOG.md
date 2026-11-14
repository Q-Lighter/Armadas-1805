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

## Session 2F-a: drawing audit

**Date:** 2026-11-04
**Branch:** main

### What was asked

Verify the drawing itself, not only the stored data: find the long stray ink
line and the rectangles that do not follow a coast; share the exact draw
commands between Pixi and tests; audit stitches, boundary misses, block-border
fills, whole-block sea fills, sea cells and winding; run real map areas; add a
TEMP-DEBUG suspect count and a magenta highlight toggle.

### Root causes, with evidence

- **Stray line.** `scripts/build-chart-blocks.mjs` `clipLine()` walked
  `points[(i + 1) % points.length]` over open coast chains. It therefore joined
  the last point of every chain to the first with one straight segment. Block
  `45_3` contained exactly the bogus two-point line
  `[1146.497,100] -> [1125,91.336]`; the same pattern appeared in `46_4`,
  `5_6` and `56_6`. The loop now stops at the last real segment.
- **Rectangles from tile overlap.** Source fill rings still carried their
  128 km tile-clipping edge and only then were clipped to 25 km blocks. That
  produced 15,033 fill rings with a block-border edge, 5,223 whole-square rings
  and 84 whole-square rings where the 1 km lookup was not all land (for example
  `34_3` 618/625 and `17_12` 483/625). Fills are now clipped to the source tile
  core first. The 84 whole-square rings are replaced by the lookup's 1 km land
  cells, so the area stays right and no 25 km rectangle is drawn.
- **Winding.** 549 source rings were clockwise. They are now all normalised to
  one winding; Pixi and the audit receive the same commands.
- No evidence was found for stale Graphics objects: both live and chart paths
  clear before painting, so that was not a root cause here.

### Audit counts

The audit is over `buildBlockCommands()` / `buildChartCommands()`, the same
functions the Pixi renderer calls. Before counts are over the raw committed
blocks; after counts are over the regenerated blocks and commands. The audit
splits long straight coast segments before drawing, so a remaining `stitch` is
a real 6 km+ jump in the command list, not a source simplification artefact.

| Flag | Before | After |
| --- | ---: | ---: |
| Coast segments | 56,759 | 54,345 |
| Stitches over 6 km | 2,759 | 0 |
| Stroke points away from 1.5 km boundary | 303 | 0 |
| Fill rings | 15,335 | 17,573 |
| Rings with a block-border edge | 15,033 | 17,134 |
| Whole-block fills on non-land blocks | 84 | 0 |
| Sea cells inside fills | 4,615 | 1,115 rings carry rounding sea cells |
| Clockwise rings | 549 | 0 |

After-fix area counts (`fills / strokes / stitches / away / whole-block /
winding`):

- Montego Bay and western Jamaica: 8 / 20 / 0 / 0 / 0 / 0.
- Kingston and the south Jamaica coast: 8 / 22 / 0 / 0 / 0 / 0.
- Windward Passage: 23 / 66 / 0 / 0 / 0 / 0.
- Mosquito Coast near Bluefields: 24 / 30 / 0 / 0 / 0 / 0.
- Whole Caribbean dev view: 17,573 / 11,988 / 0 / 0 / 0 / 0.

### What was built

- `shared/chartPaint.ts`: pure fill/stroke command building, winding and
  long-segment normalisation, bounds filtering, suspect finding and the drawing
  audit. Pixi and the tests both call it.
- The ship view and the cached chart now paint those commands instead of
  reading `block.fill` and `block.coast` directly.
- TEMP-DEBUG appends `suspicious segments: N` and has a `Highlight suspects`
  button. Suspect strokes and fill outlines are magenta at 6 px. Both are
  test/dev-room only.

### Checks

- `npm test`: **170/170 passing**, including six new chart-paint tests.
- `npm run build`: passing.
- Browser/WebGL: unavailable, so the live page, magenta overlay and screenshots
  have not been seen. No PNG canvas dependency was installed; the audit is
  geometry-only.

### Broken or unfinished

- The audit still reports 52 exposed border fill edges and 1,115 fill rings
  with a few lookup-sea cells from 1 km raster rounding. These are small edge
  slivers, not the 25 km rectangles; the fog/discovery edge remains a visual
  risk that only a browser can confirm.
- `build-chart-blocks.mjs` still takes several minutes because it now checks
  every coast segment against the lookup.

## 2F-b: smoother, safer routes

- `shared/settings.ts` now prefers 8 km of clearance (with a 4 km hard fallback
  where a channel is narrower), applies a soft cost from 8 km to 20 km, uses a
  40 km re-plan look-ahead, and limits curve radius to 1.5 times the turning
  radius.
- A* penalises the clearance band instead of merely accepting land-free nodes;
  terminal ports and destinations keep their small approach allowance. Path
  simplification and reversal removal re-check the segment, not only its ends.
- Routes are rounded with circular fillets, checked against known land, and the
  resulting curve is sent to the client. Re-planning runs earlier when new land
  enters the 40 km look-ahead or the ship is within 8 km of known land. Tacking
  first chooses the leg pointing into the wider pocket of free water.
- The ship and chart draw a thin dotted route for every selected ship; original
  waypoints remain as small marks. Routes use discovered land only.

### Checks

- `npm test`: **174/174 passing**, including the new clearance, reversal, curve
  radius, tack-side and Windward Passage cases.
- `npm run build`: passing.
- A 500 km open-sea plan had a median 0.18 ms in this run; the full Windward
  Passage search took about 50 ms. The worst new-land re-plan test took about
  1.4 s.

### Broken or unfinished

- The planned clearance is enforced against sixteen sampled bearings and 1 km
  segment steps; very thin land features can still sit between those samples.
- Browser/WebGL is unavailable, so the dotted curve and waypoint marks have not
  been seen on screen.

## 2F-c: tap-to-sail toggle

- The top bar now has `Tap-to-sail: On / Off`, saved under
  `armadas.tapToSail`; a new player starts On. The button and its small wax-red
  mark show the active mode.
- Off means a quick sea tap only closes panels. Holding the sea starts a
  screen-space ring; it fills for 500 ms and sends one order only if the finger
  stays put. Moving or lifting early cancels it.
- `Move` appears while the mode is Off. Pressing it arms one order; the next
  sea tap sends that order and disarms the button. Group sea orders use the same
  gate, and ship selection and port taps are unchanged.
- Preference and tap decisions are pure functions in `shared/tapToSail.ts`; the
  client owns only the ring and DOM state.

### Checks

- `npm test`: **179/179 passing**, including five new tap-to-sail tests for the
  saved preference, quick tap, hold threshold and one-shot Move button.
- `npm run build`: passing.
- Browser/WebGL is unavailable: the ring animation and actual pointer gestures
  have not been watched on screen.

## 2F-d: sharp chart when zoomed in

- `shared/chartDetail.ts` is the pure detail planner. It switches to vector
  blocks below 300 km across, culls to intersecting blocks and discovered
  cells, orders blocks deterministically and caps the live graphics at the
  existing 300-block ceiling. Texture and vector plans return the same stored
  blocks and cells for a given view.
- The chart keeps its 2,048 px cached texture for far views. Below the
  threshold it draws a vector layer in screen space using the same dimmed
  palette as the ship view: discovered sea cells, then land fills and coast
  lines. A 40 km band cross-fades the two layers instead of popping.
- Only the chart is affected; ship-view styling and the existing chart cache
  are unchanged.

### Checks

- `npm test`: **183/183 passing**, including four new chart-detail tests for
  the threshold, viewport culling, identical stored contents across the switch
  and the graphics cap.
- `npm run build`: passing.
- Browser/WebGL is unavailable: the close-in vector look, the cross-fade and the
  chart on a real phone have not been seen.

## 2G-a: browser test harness

- Tried `puppeteer-core` with `@sparticuz/chromium`. The npm Chromium binary
  launched but stopped at missing `libnspr4.so` and `libnss3.so`; this image has
  no apt package list, so the headless route could not run. Both packages were
  removed again.
- Fell back to the requested runtime audit. Test and dev rooms measure the HUD,
  panels and interactive controls on load and resize, reporting outside,
  overlapping, clipped and sub-44 px targets. The count is in the TEMP-DEBUG
  line; the details are in a collapsed paper section.
- Removed the magenta suspect toggle and layer. The pure `suspicious segments`
  count remains in the TEMP-DEBUG line.

### Checks

- `npm test`: **188/188 passing**, including five new layout-audit tests.
- `npm run build`: passing.
- No browser screenshots were produced; the runtime audit has not yet been
  exercised in a real browser.

## 2G-b: alignment and routes

- Added `shared/camera.ts` as the single world-to-screen transform. The map,
  port markers, labels, ships, last-seen markers, target marker and route all
  now call it with the same live view state each frame; `layoutPortMarkers` uses
  it too instead of a second copy of the maths.
- The marker drift came from `refreshMap` deferring a zoom rebuild by up to
  120 ms while ports and ships immediately used the new scale. The map now
  rebuilds in the same frame as the zoom; chart texture/vector switching still
  changes detail but no longer changes marker coordinates.
- The server samples the smoothed route every 1.5 km (ceiling 200 points) and
  sends only the unsailed part. The client draws 3 px dots every 10 screen
  pixels along that curve for every selected ship, with no tack zigzags and no
  route culling.

### Checks

- `npm test`: **195/195 passing**, including shared-camera alignment at six
  zooms and pans, inverse taps, dot spacing along bends, the 200-point curve
  limit, a visible Jamaica bend and removal of sailed points.
- `npm run build`: passing.
- No browser is available: the mock-page alignment screenshots and live zoom
  gestures could not be run. Port-coast alignment is only covered indirectly by
  the shared-transform tests.

## 2G-c: responsive layout

- Rebuilt the HUD as three fixed regions. The top bar is one non-wrapping grid:
  money, game clock, Fleet count, Chart and a three-line Menu button. The bottom
  action bar is a four-column grid: Tap-to-sail, Move, Multi-select count and
  Follow, each at least 44 px.
- The Menu holds Known ports, S/M/L text size, Show borders and a collapsed
  Debug info section. The old floating TEMP-DEBUG line is now inside that
  section, so it cannot cover the HUD.
- The selected-ship panel is a compact strip above the action bar on phones,
  showing name, speed, heading, crew and provisions. Tapping it expands a
  full-height paper sheet. Tablets and desktops use a collapsible side panel no
  wider than 320 px.
- Fleet, port, shipyard, trade, crew, Known ports and Menu become full-screen
  sheets on phones, with sticky headings and sticky trade/naming footers. The
  root font size now carries S/M/L, and landscape phone layouts use shorter
  bars and scrolling sheets.

### Checks

- `npm test`: **195/195 passing**; `npm run build`: passing.
- Browser and DOM layout measurement are still unavailable here. The runtime
  audit (2G-a) is wired to report overlaps, clipping, off-screen boxes and
  sub-44 px targets in test/dev rooms, but its viewport table has not been
  produced and the layout has not been visually checked.

## 2G-d: smooth discovered areas

- `shared/discoveredOutline.ts` traces the boundary of the discovered-cell
  union, closes its loops, applies two rounds of Chaikin smoothing and returns
  outer rings and holes in map kilometres. The ship view and chart fill that
  wash instead of drawing five-kilometre cell rectangles. Reconstruction is
  throttled to 200 ms and only follows chart revisions; a fully explored room
  is just a rectangle, and live sight circles are unchanged.
- The fixed 2,048 px whole-world chart texture is no longer used for the chart.
  A settled chart is rendered from stored blocks into a view-sized texture,
  capped by the screen times device pixel ratio and 2,048 px. During a pan or
  zoom the previous texture is transformed from its old camera; after 200 ms the
  visible blocks are re-rendered into the new view texture. Blocks smaller than
  a pixel are skipped and the 300-graphic block cap is retained.

### Checks

- `npm test`: **199/199 passing**, including five outline tests (smooth
  staircase, rounded rectangle, cell-centre containment), the existing
  chart-content and graphics-cap tests, and a view-texture cap test.
- `npm run build`: passing.
- No browser is available: the zoom screenshots, edge smoothness and frame rate
  have not been measured on screen.

## 3A-a: fleet and formation rules

- Added `shared/fleets.ts`: fleets are capped at 12 ships, command passes to
  the next member when the leader is lost or detached, and a ship can only be
  assigned to one fleet. Line ahead follows the leader's breadcrumbs; line
  abreast, wedge, convoy and free chase use the same 185 m default and 60 m
  minimum gap. The upwind guard switches a formation to line ahead.
- Added `shared/fleetOrders.ts`: order data for go-to, port, hold, heading and
  distance, follow, escort, patrol, rendezvous, return to port and queues,
  with pure progress and completion rules. Added the four stances and numbered
  control groups in `shared/stances.ts` and `shared/fleets.ts`.
- Every ship now carries its stance, fleet id and detached flag. New ships
  default to Fight only if attacked.

### Checks

- `npm test`: **222/222 passing**, including 23 new fleet and order tests.
- `npm run build`: checked with the 3A-b build; shared TypeScript compiles.

## 3A-b: fleets, orders and test helper

- The world now stores player fleets, their leader and members, detached ships,
  stances, control groups, fleet commands, direct special orders and recent
  leader paths. `visibleStateFor` includes only the receiving player's fleets
  and groups; foreign ships still carry only navy and class.
- Fleet orders are executed by the leader while followers steer to formation
  slots with the 15% station speed cap. The existing route planner remains the
  leader's path; followers use the normal sailing and coast rules. Direct
  orders detach a member, a new fleet order brings detached members back, and
  disbanding clears membership.
- Order geometry is sent for my ships: heading lines, patrol paths, follow and
  escort lines, rendezvous points, queued waypoints and the existing planned
  curves. The test/dev `&fleet=frigate:4,trade:3,line:1` helper spawns fully
  crewed and stocked ships near the start, unfleeted and inside the 30-ship
  cap.

### Checks

- `npm test`: **230/230 passing**, including fleet creation/disband, leader
  change, detach/rejoin, formation movement, direct heading/follow, helper
  limits and cross-player privacy.
- `npm run build`: passing.
- `npm run benchmark:fleets`: 8 players, 96 ships, 100 steps: **5.54 ms per
  world step**, 1.38 ms per update, 52,725 bytes average update. This is a
  local Node proxy, not Cloudflare CPU time.

### Still to do after B

- The Fleet panel and order controls are Part C. The server commands are in
  place, but the browser UI is not yet wired to them.

## 3A-c: fleet screens and controls

- The Fleet panel now lists saved fleets before loose ships. Each fleet card has
  an editable name, marked leader, member states, Rejoin on detached members,
  five formation presets with small icons, the four stances, and Hold, Heading,
  Patrol, Rendezvous, Return to port, Change leader, Detach ship and Disband.
- Selecting works by tap, double-tap for a whole fleet, the multi-select toggle
  with a drag selection box, rings and a selected count. Control groups 1-9
  can be saved from the selected ships and selected from the small group row or
  with the number keys.
- Long-press and right-click open the orders menu. On phones it is a bottom
  sheet; on desktop it opens at the pointer. Sail here is first, followed by
  heading/distance, patrol, rendezvous, return and hold. The heading sheet has
  a dial, numeric heading and distance, and a live dotted preview. Tap-to-sail
  Off now opens this menu on hold instead of sending an order; Move still arms
  one tap.
- The map draws dotted geometry for planned routes, heading, patrol, follow,
  escort, rendezvous and queued waypoints, with queue numbers, for every
  selected ship or fleet. Formation ships keep the existing true hull scale at
  close zoom.
- Added browser-free render plans and tests for the five viewports, order menu
  contents, selection box, fleet-first ordering, member state text and number
  keys (`shared/fleetUi.ts`, `tests/fleet-ui.test.ts`).

### Checks

- `npm test`: **236/236 passing**.
- `npm run build`: passing.
- `npm run benchmark:fleets`: 8 players, 96 ships, 100 steps: **6.39 ms per
  world step**, 1.60 ms per update, 52,725 bytes average update. This is a
  local Node proxy, not Cloudflare CPU time; the earlier Part B run measured
  5.54 ms, so this is run-to-run variance rather than a code change.
- `npm run ui-test` is not available in this project (`Missing script:
  "ui-test"`), and there is no working headless Chromium in this image. The
  responsive sheets, 44 px targets, dial dragging, long-press behaviour and
  dotted lines have therefore not been checked in a browser or screenshotted.
  The render-plan tests cover the viewport breakpoints and menu contents, not
  rendered pixels.


## 3B-a: gunnery and damage rules

- Corrected all 24 ship records to the supplied combat table, including the
  line ships' single light gun and the class totals that follow from it. The
  broadside pounds remain the truth; `gunPounds` scales the 14/7/3 gun weights
  until they add back to that number.
- Added `shared/combat.ts`: seeded firing and hit resolution, broadside/bow/
  stern arcs, range bands and the upwind bonus, ammunition and ammunition
  types, size damage modifiers, the six-area damage model, Sink/Capture area
  weights, sunken and crew-too-low states, repair costs and rates, the combat
  timer, drifting damage, and one sailing-performance function for damaged
  speed, turn and drift.
- `shared/settings.ts` now holds the Draft combat numbers. Neutral sea-state,
  crew-skill, crew-accuracy and morale multipliers are present at 1.0 for the
  later prompts.
- Added the "Combat and damage" rules summary to `RULES.md`.

### Checks

- `npm test`: **255/255 passing**, including the 24-ship table, edges of all
  three range bands, both area-weight distributions over 10,000 seeded hits,
  ammunition use, repair exhaustion and the low-crew stop.
- `npm run build`: passing.
- `node scripts/simulate-duels.mjs`: 100 seeded duels at 450 m, beam-on, Sink
  orders: raider **1.75 real minutes** (target about 1), frigate **2.84**
  (2-3), line **3.23** (3-5), flagship **4.10** (6-10). The frigate and line
  are inside their targets. The raider and flagship are outside; the agreed
  hull points, broadside weights, hit chances and battle clock leave no Draft
  number that moves those two in opposite directions without changing an
  agreed value. I did not change an AGREED number to hide this.

## 3B-b: shooting, damage and repairs on the server

- Added the minimal "Engage ship" order with a Sink or Capture objective. An
  engaged ship closes to a 250 m station, circles at a slower station speed so
  it can actually hold the range, and fires whenever a gun group bears. A
  fleet engage starts one engagement per member and suspends formation; a new
  fleet order clears the engagements and re-forms the fleet.
- The combat loop runs only for engagements in range: reload on the battle
  clock (one game minute per real second), target bearing, ammunition use,
  damage and sinking. Two fixes came out of the first live runs: the firing
  result now applies to the target's damage rather than the shooter's, and the
  in-combat timer uses milliseconds consistently with Part A.
- Damage stays private on `visibleStateFor`: own ships carry the six
  percentages, points and capacities, ammunition in broadsides, reload state,
  combat/repair state and effective speed/turn. Foreign ships keep the compact
  nine-field public tuple. Combat events carry no damage numbers and are
  filtered by the same sight circles as ships.
- A sunken ship is removed from its fleet, the ship count and every engagement,
  and its owner gets a notice. A flagship only records a `flagshipLost` event
  and notice for 3E; nobody is eliminated.
- Added server-side repairs: the 30 second combat timer, most-damaged-first
  repair rates, material use and the drifting hull loss. The owner can toggle
  repairs, but the timer still blocks them.
- `&enemy=frigate:2,line:1` works only in test/dev rooms and spawns stationary,
  fully stored dummies of the other navy about 3 km away. The server accepts
  `{t:"repair",ship,enabled}`.

### Checks

- `npm test`: **265/265 passing** (10 new Part B tests).
- `npm run build`: passing.
- `npm run benchmark:battle`: 50 British against 50 French frigates, all
  engaged and inside 1 km, 100 world steps: **0.95-1.16 ms per world step**,
  9.5-11.6 ms per simulated second. The earlier 96-ship fleet benchmark measured
  6.39 ms per world step, so this is well under the earlier load-test level.
  This is a local Node proxy, not Cloudflare CPU time.
- `npm run ui-test` is still unavailable and there is no headless Chromium, so
  the server behaviour is tested through the shared world only.

### Still to do after B

- Part C: attack menu, damage sheet, firing and sinking visuals, battle log,
  notifications, port repair, range rings and responsive checks.

## 3B-c: damage screen, firing visuals and repairs

- Long-press or right-click on a visible foreign ship now opens the attack
  menu with **Attack: Sink** and **Attack: Capture**. The chosen order goes to
  a single selected ship or to every selected fleet, using the 3B-b server
  order. Own ships keep their existing orders menu.
- Added the ship damage sheet for own ships: hull, sails, masts, rudder, guns
  and crew bars with percentages, ammunition in broadsides, reload progress,
  in-combat or can-repair state, effective and normal speed and turn, a short
  list of damaged areas, and the repair toggle. It opens from the Damage
  button, the Fleet panel, or a second tap on an already selected ship.
- Combat events now draw as paper effects: a grey smoke puff on the firing
  side, expanding splash rings on misses, a red-brown hit flash, and a growing
  dark cloud for a sinking ship. The server's fog filter decides which events
  arrive, and the effects are skipped outside a sight circle.
- A faint 1 km ring and two 30-degree beam arcs appear around each of my ships
  with an engage order.
- Added the private battle log. The server records short lines only for the
  receiving player's ships, the socket carries no other player's log, and the
  client repeats the "your" filter. The log is collapsible and becomes a slim
  list on phones.
- Added throttled notices: Battle begun, Ship under fire, Out of ammunition and
  Crew too low at most once per ship per real minute. Ship sunk keeps the
  existing notice and a tap on it centres the map on the sinking. The flagship
  lost record remains for 3E.
- Added port repair jobs. At a capturable port this player can use, stores
  repair at x4 using the ship's own materials; paying locals costs twice the
  posted materials value and repairs at x6 without using stock. The server
  sends the quote and charges exactly it. NPC ports refuse repairs, so a
  normal room with no owned port has no repair buttons; the logic and buttons
  are ready for port ownership.
- Added browser-free plans and tests in `shared/combat-ui.ts` and
  `tests/combat-ui.test.ts`, plus server tests for the private log, notice
  throttle and the port repair quote charge.

### Checks

- `npm test`: **273/273 passing** (8 new Part C tests).
- `npm run build`: passing.
- `npm run ui-test`: still unavailable (`Missing script: "ui-test"`), and this
  image has no working headless Chromium. The five viewport plans, 44 px
  target minimum, menu contents, log privacy, notice throttle, effect
  visibility and repair quote are covered without pixels.
- `npm run benchmark:battle`: unchanged by Part C; **0.95-1.16 ms per world
  step** for 50 against 50, under the earlier 96-ship fleet benchmark of
  6.39 ms.

### Not checked in a browser

- The damage sheet, attack menu, battle log, notices, smoke/splash/sinking
  effects and range rings were built and compiled, but not viewed at any
  viewport. No screenshot was possible. The browser-free plans cover layout
  limits and content, not rendered pixels or drag/long-press behaviour.
- No usable capturable port exists in a normal room until port ownership is
  built, so the port repair buttons were tested through the shared world and
  the damage sheet, not by clicking them in a normal game.

## 3C-a: two-device test setup and notification fixes

- **Actual missing-enemy cause:** the page read `&enemy=` but `connect()` built
  the `/ws` address from only `navy`, `start`, `ship`, `cash`, bots and fleet.
  The enemy option never reached `GameRoom`, so no dummy fleet was spawned. The
  room, port, fog and client navy filters were not the cause. A shared list now
  forwards every test option: `navy`, `start`, `ship`, `cash`, `hunger`,
  `enemy`, `enemynavy`, `dummy` and `fleet`.
- Added `&enemynavy=british|french|spanish|dutch`; the default is the first
  navy in the fixed order that differs from the spawning player. Enemy spawn
  points now prefer 3 km east and require water plus the 8 km route clearance,
  walking round the circle if the coast blocks it. Spawning is once per player
  id, so a refresh cannot duplicate it. The server sends the on-screen notice
  "Spawned 2 enemy frigates, about 3 km east."
- Added `&dummy=passive|fights|runs|surrenders` on dummy ships. Passive and
  fights are used now; runs and surrenders are consumed by 3C-b.
- Added the test-only Test tools panel from the Menu: spawn 1-6 enemies with
  type, navy and behaviour, remove all dummies, refill and repair my ships,
  and an invite link with a Copy button. The panel is labelled "Test tools -
  removed before release" and fits the phone layout with 44 px controls.
- Two devices can join a test room as two players. The second player at the
  same start port spawns 2-4 km from the first, facing them. A second request
  for the same navy gets the next navy in the order british, french, spanish,
  dutch, with a on-screen notice. Different navies are required to attack.
- Invite links keep the room, start port and ship type and switch the navy.
  No QR code was added: the project has no QR library and no new dependency
  was justified.
- Battle and under-fire notices now trigger on firing, whether the first
  volley hits or misses. The target also gets the first "Battle begun" notice,
  and all notices keep the one-per-ship-per-real-minute limit.

### Checks

- `npm test`: **280/280 passing**.
- `npm run build`: passing.
- Node tests cover the exact `test-13` Kingston address, two simulated
  players at 2-4 km, mutual visibility, a Sink attack damaging the other
  player, the missing-enemy forwarding, no duplicate spawn, navy choice,
  dummy parsing, invite links, and a first volley that misses completely.
- Browser layout was not checked: `npm run ui-test` is still missing and this
  image has no working headless Chromium. The Test tools panel is a render-plan
  and CSS layout, not a viewed screenshot.

## 3C-b: battle orders on the server

- Added the four battle orders as pure rules plus server actions in
  `shared/battleOrders.ts` and `shared/world.ts`: Capture and Sink keep the
  same target, reload and position and only change the aimed areas; Run sails
  away using normal sailing, follows the coast when land blocks the way,
  re-steers every 2 real seconds, fires bearing guns while running, and ends
  with "Escaped." after 60 real seconds out of every pursuer's sight (queued
  fleet orders then start). Surrender is per ship, cancellable before accept,
  and accepting moves ownership, navy, class, damage, cargo, ammunition and
  upgrades while removing fleet and control-group membership. A flagship
  surrender only records a `flagshipLost` event; no elimination.
- Fleet Capture, Sink and Run apply to every member; fleet Surrender is
  rejected. Accepting is refused outside 1 km, or when it would exceed 30
  ships, with the stated notices. Attackers' Engage orders end on accept.
- Stances have their first effect: fight-if-attacked answers its attacker,
  engage-anything scans 3 km, avoid-combat runs, stealth never starts or
  answers. Dummy `runs` and `surrenders` now work at their hull thresholds.
- Battle zones: a player who can see a ship within 1.5 km of an engaged enemy
  receives the world at 10 Hz; everyone else stays at 5 Hz. The client's
  existing interpolation smooths the 10 Hz updates. `settings.combat`
  contains the Draft numbers.

### Checks

- `npm test`: **297/297 passing**.
- `npm run build`: passing.
- `npm run benchmark:battle-zone`: 102 ships, 100 in a battle zone, two
  players watching; **1.52 ms per world step**, **480,981 bytes per player per
  second at 10 Hz** versus **233,457 bytes at 5 Hz** (2.06x), 500 combat
  events. The 3B 50-v-50 benchmark was 0.95-1.16 ms per step; the earlier
  96-ship load test was 6.39 ms per step. These are local Node proxies, not
  Cloudflare CPU time.
- Racing and layout were not checked in a browser; `npm run ui-test` is still
  missing and this image has no working headless Chromium.

## 3C-c: battle orders screens

- Added the battle bar for the selected ship or fleet, with Capture, Sink,
  Run and Surrender; the active objective is highlighted. Surrender asks
  "Surrender this ship?" first, is hidden for a fleet, and becomes "Take down
  flag" while the white flag is up. The same order buttons appear in the Fleet
  panel's ship cards and the ship Damage sheet.
- Added the surrender offer sheet ("[class] of the [navy] has struck her
  flag"), class/navy detail, fleet count, Accept, Keep attacking and a Sail
  there button when no ship is within 1 km. Accept is disabled with the range
  or fleet-full reason. The sheet is private to visible foreign flags.
- White flags are drawn per visible surrendered ship and scale with zoom;
  running ships get a heading line and a small "Running" label. The client
  keeps its existing interpolation for the 10 Hz battle-zone updates. The
  Test tools panel remains available only in test/dev rooms and keeps its
  phone layout. Battle log filtering accepts the new "Your ... surrendered",
  "Your ... escaped" and "You accepted ..." lines.
- Duel tuning (Draft only): added a class damage-taken multiplier, raider
  x1.75 and flagship x0.55, with other classes x1. This moves the 100-run
  duel results to raider **1.03**, frigate **2.84**, line **3.23** and
  flagship **7.42** real minutes, inside all four agreed targets. No AGREED
  number was changed.

### Checks

- `npm test`: **303/303 passing**.
- `npm run build`: passing; `npx tsc -p client/tsconfig.json --noEmit`: passing.
- `npm run benchmark:battle-zone`: 1.52 ms per world step, 480,981 bytes
  per player per second at 10 Hz and 233,457 at 5 Hz for 100 ships in a
  battle zone with two players. Local Node proxy, not Cloudflare CPU time.
- `npm run ui-test`: still missing (`Missing script: "ui-test"`), and this
  image has no working headless Chromium. The battle-bar, surrender-sheet and
  five-viewport fit/scroll checks are render-plan tests only. The screens
  were built and compiled but not viewed or screenshotted, so overlap,
  scrolling and touch behaviour in a real browser remain unverified.

## 3C-fix: blank live page

- **Actual cause:** `client/main.ts` began with `element("damage-battle")`, but the 3C-c edit to `client/index.html` did not include that element in the built page. `start()` threw `Missing element #damage-battle` before `connect()`, so the browser never opened a WebSocket: the HUD stayed at its static defaults (money 0, Day 1 08:00, dashes) and the sea stayed blank. The Worker, GameRoom, visibleStateFor, battle-zone send and test-option forwarding were all healthy; a wrangler probe with the bare `room=test` address and with `room=test-30&start=Kingston&ship=frigate` received player, ship, wind, money and clock in the first state.
- Added the missing `#damage-battle` element. Added a page-level error banner and console reporter, a guarded `onState` callback, and `safeLayer` guards around the ship, chart, fog, sight, port, route, combat, wind, battle-bar and surrender draw work. One failed layer now reports instead of silently blanking the scene.
- Added regression tests that check every `element(...)` lookup exists exactly once in the HTML, join a bare test room, join a fresh room, and re-parse a real snapshot with the optional 3C fields removed.

### Checks

- `npm test`: **306/306 passing**.
- `npm run build`: passing; rebuilt `dist/index.html` contains `#damage-battle`.
- `npx tsc -p client/tsconfig.json --noEmit`: passing.
- `npm run test:server`: **SIMULATION PASSED**.
- Worker export and Durable Object migration remain `GameRoom` / `v1`; no server or wrangler change.
- No browser is available here: the rendered page, error banner and fixed sea view still need the user's screenshot.

## 3D-a: boarding, abandoned ships, fire and friendly-fire rules

- Added `shared/boarding.ts` with pure, seeded rules for crew transfer,
  abandoned ships and claims, boarding odds and casualties, auto-boarding,
  captured crew and prisoners, fire growth/fighting/spread/explosion,
  friendly fire and the 20 second sinking state.
- Added every 3D Draft number to `shared/settings.ts` and documented the new
  rules in the "Combat and damage" section of `RULES.md`. No AGREED number was
  changed. Later systems plug in through neutral quality, morale, health, sea
  state and empty-allies hooks.
- Added `tests/boarding.test.ts` for the limits, exemptions, odds, timers,
  casualties, choices, fire rates and friendly-fire cone.

### Checks

- `npm test`: **322/322 passing**.
- `npm run build`: passing.
- No browser is available; these are pure rule tests, with server and screens
  following in 3D-b and 3D-c.

## 3D-b: boarding, claims, fire and friendly fire on the server

- The authoritative world now handles crew transfer, claims, the Board
  approach and grapple, Auto-board, captured crew choices, prisoner handover,
  abandonment and decay, fire, explosion and blast, friendly fire and sinking.
- `visibleStateFor` exposes only public abandoned/burning/grappled/sinking
  flags. Crew, prisoner and fire-strength numbers stay in each owner's fleet
  details. Events follow the existing visible-spot filter.
- Test/dev joins accept `&abandoned=frigate:1,line:1` and `&enemycrew=30`.
  Server orders support Board (with a rounded-odds reply), cancel, Auto-board
  per ship and fleet, crew transfer, claim, captured-crew choice, prisoner
  handover and the three test tools.
- `scripts/benchmark-3d.mjs` measures 100 ships with 20 fires and 5 boardings.

### Checks

- `npm test`: **330/330 passing**.
- `npm run build`: passing.
- `npm run benchmark:3d`: 2.45 ms per world step, 445,446 bytes per player per
  second at 10 Hz (219,445 at 5 Hz), versus the 3C 1.52 ms / 480,981 bytes.
  Local Node proxy, not Cloudflare CPU time.
- Screens and the duel check remain for 3D-c. No browser is available here.

## 3D-c: boarding, crew, fire and abandoned ship screens

- Added the Board sheet with server-rounded odds and confirm/cancel, a boarding
  timer bar, the captured-crew sheet (Join, Kill, Take prisoners with the 120 s
  default), the crew-transfer sheet with Minimum/Half/Full and a Claim mode,
  the Auto-board toggle on ship and fleet cards, and port prisoner handover.
- Abandoned ships draw a cheap grey broken mast scaled by `crewUi`, keep the
  paper label, and open the transfer sheet from Claim. Burning ships get an
  orange status glow, smoke at night and a Fire row with strength and fighting
  state; sinking ships grey out and cannot be selected. New combat events feed
  the existing effect layer.
- `tests/crew-ui.test.ts` covers the 360x740, 412x915, 740x360, 768x1024 and
  1280x800 render plans, odd rounding, minimum claim crew, bounty total, and
  owner-only crew/prisoner details.

### Checks

- `npm test`: **338/338 passing**.
- `npm run build`: passing.
- `npm run test:server`: simulation passed (118 ticks, 63 updates, 1,888
  typical bytes).
- `npm run benchmark:3d` final: 1.86 ms per world step, 467,862 bytes per
  player per second at 10 Hz (230,090 at 5 Hz), versus 1.52 ms / 480,981 bytes
  in 3C and the earlier 6.39 ms load-test level.
- Duel check with fires: raider 1.00, frigate 2.71, line 3.03, flagship 6.41
  real minutes. The Draft fire hull/crew coefficients were tuned down to
  0.00035%/0.00025% per strength-second so fires do not shorten the AGREED
  duel bands. Without fires the same seeds give 1.03/2.84/3.23/7.42 minutes.
- No browser or headless Chromium is available: the sheets and map drawing
  were not visually inspected or touch-tested. Layout and state behaviour are
  covered only by the render-plan and server tests above.

## Session 3D-fix-a: real loop boarding and stand-and-fire

**Date:** 2026-11-13
**Branch:** main

### What was asked

Repair live boarding and firing without adding features: a real server-loop
harness, a fix for ships never firing, a tacking boarding approach with a slow
final 150 m, and stand-and-fire / Alongside fighting styles.

### What was built

- `tests/real-loop.test.ts`: seven real `stepWorld` scenarios (Sink and Capture
  in eight wind directions plus a 3 kn target, boarding in eight directions
  plus a 3 kn target, Board then Sink, a two-minute duel and two real players).
- Boarding now clears stale boarding flags when a new order arrives, only skips
  firing during an active fight, grapples immediately when already inside 60 m,
  approaches with the tacking route, slows inside 150 m, and reports "Cannot
  reach: in irons" / "Target is faster".
- Stand and fire and Alongside styles on ships and fleets, with hove-to
  stopping, a 15% pivot at rest and 450 m hysteresis. Fleets keep line-ahead and
  pass in parallel.

### Checks

- `npm test`: 347 passing.
- Duel simulation: 1.00 / 2.71 / 3.03 / 6.41 real minutes.

## Session 3D-fix-b: why-not-firing readout and state labels

**Date:** 2026-11-13
**Branch:** main

### What was asked

In test and dev rooms only, show the current order step and the first reason the
guns are silent, show Hove to / In irons / Sailing / Drifting, and replace the
"Hull repairs later" and "Broadsides later" placeholders.

### What was built

- `shared/combatReadout.ts` turns the real order, range, bearing, reload, crew,
  guns and ammunition state into one line for the ship panel and damage sheet.
  It is included in snapshots only outside normal rooms.
- Ship state labels now come from the movement state: Hove to, In irons,
  Drifting or Sailing.
- Ship stores show repair readiness and the remaining whole broadsides instead
  of placeholder text.
- Added readout and snapshot tests.

### Checks

- `npm test`: 348 passing.
- `npm run build`: passed.

## Session 3E-a: boarding approach, sail-away and cap fixes

**Date:** 2026-11-13
**Branch:** main

### What was asked

Rebuild boarding as a real intercept, close and alongside approach; find every
unexplained sail-away in normal combat; format crew, percentages, tonnes, knots
and money in one place; and allow more than 30 ships except when buying.

### What was built

- Boarding now steers to a predicted intercept recomputed every 2 real
  seconds, closes to a chosen abeam side at target speed + 1.5 kn, eases
  parallel alongside, and grapples only at 60 m or less with at most 3 kn
  relative speed and 30 degrees heading difference. It labels intercepting,
  tacking upwind, closing, alongside, turning back and boarding, recovers from
  overshoots with normal turns and tacks, and cancels visibly with "Cannot
  reach" or "Could not reach in time".
- Combat readout labels `closing`, `re-closing (target at N m)`, `tack upwind`,
  `hove to, pivoting`, `running`, `avoiding combat`, `line ahead`, `parallel
  pass` and the boarding steps. The target-lost timer uses real combat seconds.
- `shared/format.ts` now formats all crew, percentages, tonnes, knots and money.
  The ship panel, fleet cards, trades, sheets and notices use it.
- Surrender acceptance, boarding capture and claims are never refused for
  fleet size. Buying is still blocked at 30 with "Over the ship limit (31 of
  30): cannot buy ships".
- `tests/real-loop.test.ts` grew to eleven real-loop scenarios; stopped targets
  grapple in 8-26 s at 55-58 m with 9-30 degrees heading difference, and 3 kn
  targets in 10-11 s at 58-59 m. `tests/format.test.ts` covers awkward floats.

### Checks

- `npm test`: 354 passing.
- `npm run build`: passed.

## Session 3E-b: elimination, inheritance and victory

**Date:** 2026-11-13
**Branch:** main

### What was asked

Make each player's flagship loss final, credit the right victor, pass on the
eliminated player's property by the agreed table, let captains resign, and
end the game when one navy is left standing without building any Phase 4
feature.

### What was built

- `shared/elimination.ts` holds the pure rules: damage credit in a 600 real
  second window, team and friendly-fire exclusion, value-based distribution,
  equal money splits, teammate-first inheritance, navy standings and victory.
- Each ship carries `isFlagship`; test-room starting ships are flagships and
  test dummies are never players. Losing a flagship to sinking, explosion,
  boarding capture, accepted surrender, abandonment or resignation records an
  elimination with reason, public credit and private heir details.
- Inheritance gives a surviving teammate everything first, otherwise the
  credited player or alliance; with neither, remaining ships become
  abandoned and money is lost. Ships keep names, damage, cargo, ammunition
  and upgrades, leave fleets and control groups, hold position and take the
  default stance. More than 30 ships is allowed.
- Resign is a final order with any other real player or Nobody as recipient.
  Test and dev rooms also accept `&name=`, `&team=1`, and the "Sink my
  flagship", "Give me 3 spare ships" and "Reset room" helpers. Dummies and
  absent-player removal never eliminate anyone.
- A navy is eliminated when none of its players has a flagship. Victory is
  checked only in rooms with at least two navies. Game over freezes the
  world, blocks every order and publishes the winning navy, player list and
  simple stats. Test rooms can reset to a fresh world.
- Private state carries only the player's own elimination and stats; public
  notices carry the eliminated captain's name and navy only. Port and ally
  hooks are present and empty for Phase 4.

### Checks

- `npm test`: 370 passing, including the new pure and server elimination
  suites.
- `npm run build`: passed.

## Session 3E-c: resign, eliminated and victory screens

**Date:** 2026-11-13
**Branch:** main

### What was asked

Fit the new sheets into the existing layout without moving it: a flagship
marker, a final Resign flow, an eliminated screen, victory screen and the
missing danger notice. Keep 44 px targets and phone scrolling.

### What was built

- A small wax-red flag marks the player's flagship in the ship panel, in the
  Fleet panel's leader and member rows, and above the hull on the map. It is
  drawn only for the player's own flagship.
- Menu now has Resign. Its confirm sheet lists the teammate first, every other
  active player with navy, and Nobody; nothing can be sent until a recipient
  is chosen, and the warning says the choice is final.
- The eliminated screen names the flagship and reason, the credited captains
  and navies, where the remaining ships and money went, and the player's own
  simple stats. Orders are blocked on the server; the map stays frozen.
- The victory screen names the winning navy and players, each flagship, how
  each captain left, and a scrollable simple-stats table for everyone. Close
  stays on the frozen map; Reset room appears only in test and dev rooms.
- A flagship at or under 30% hull, on fire or being boarded now raises "Your
  flagship is in danger", at most once a minute through the existing notice
  cooldown.
- The resign, eliminated and victory sheets scroll within the existing
  layout at 360x740, 412x915, 740x360, 768x1024 and 1280x800, keep 44 px
  actions and do not overlap the old panels.

### Checks

- `npm test`: 378 passing, including seven new status-screen and privacy
  tests plus a resignation-with-teammate regression test.
- `npm run build`: passed.
- No browser or headless Chromium is available in this environment, so the
  sheets were compiled and layout-tested as data but not visually inspected.


## Session 3E-fix: restore the disappeared ships

**Date:** 2026-11-13
**Branch:** main

### What was asked

Find why the live map stopped drawing every ship after the 3E commits, prove
it without a browser, fix the real cause without reverting the 3E work, and
add safety nets and visible test helpers.

### What was built

- The root cause was in `dbf314d` (3E-c): adding the flagship pennant replaced
  the existing `fleetLayer.addChild(...)` call and never reattached the new
  child list. Ships were still received, created and animated, but no ship
  graphic was in the Pixi display list. The fix is additive: the hull, ring,
  white flag, flagship pennant, running ink/label and status ink/label are all
  added to `fleetLayer` again. The pennant remains an extra mark on a drawn
  ship, not a replacement for it.
- The render-plan regression now builds a real client state with my
  flagship, a friendly ship and an enemy ship, then prints planned, visible
  and drawn counts plus each marker's screen position, size and viewport
  status for 5 km, 50 km and 200 km views at 1920x1080 and 360x740. It also
  checks that the ship layer is above the live sea and fog, and records
  surrendered, abandoned and burning ships.
- Draw layers now go through the shared `runDrawLayer` guard. A thrown layer
  reports its name and error into the existing readable client banner and
  console, and the next layer still runs. A regression test proves a thrown
  flagship layer leaves the other ships intact.
- Test and dev rooms show `Ships drawn: N (my ships M, other ships K)` in
  Test tools. The count only includes hulls whose Pixi parent is `fleetLayer`,
  so this exact bug would read zero. `&layoutdebug=1` now turns on the
  existing border outlines.
- The stopped-ship label is corrected: stopped at rest or by an order reads
  "Hove to", into the wind with no way on reads "In irons", no sails or
  rudder reads "Drifting", and "Sailing" is only used with way on.

### Checks

- Draw-plan at `73007ff`: 3 planned / 3 drawn at every zoom and viewport.
- Draw-plan on HEAD before the fix: 3 planned / 0 drawn (`attached=false`).
- Draw-plan after the fix: 3 planned / 3 drawn at 5, 50 and 200 km on both
  1920x1080 and 360x740; all markers are in the viewport with 10x23 px
  (friendly) or 8.5x19.6 px (enemy) bounds.
- `npm test`: 382 passing, 0 failing.
- `npm run build`: passed.
- No browser or headless Chromium is available in this environment, so the
  map was not visually inspected; the draw plan and source attachment were
  checked instead.

## Session 3E-perf-a: performance panel and network

**Date:** 2026-11-13
**Branch:** main

### What was built

- Test/dev performance readout in the existing Test tools panel, also opened by
  `&perf=1`: FPS, average/worst frame time over 5 s, objects, live effects,
  DOM updates/s, ping, inbound bytes/messages/s, snapshot age, queued messages,
  server world-step average and render resolution/quality.
- A 10 v 10 benchmark beside the 100-ship one, both measuring world-step time,
  full-state bytes, delta bytes, message rate and combat events.
- State streaming now sends one full JSON state, then compact binary deltas
  from `visibleStateFor`. Positions are whole metres relative to a per-player
  origin, headings 0.1 degree and speeds 0.1 knot; fleet details refresh twice
  a second instead of being rebuilt on every tick.
- Slow clients are skipped once their send buffer passes the 64 KB draft limit
  and receive one fresh full state when it drains. The client coalesces
  snapshots, applies only the newest and merges all events; orders carry an id
  and stay "Sending..." until the server acknowledges them, with a 2 s ping.
- The battle-zone rate keeps 10 updates a second near the selected ship or
  camera centre and 5 a second elsewhere. Fire events are capped at two per
  ship per second upstream in `visibleStateFor`.
- Neighbour scans use a spatial grid for visibility, fire spread and friendly
  fire, plus an id index for ship lookups. The per-ship fleet payload is only
  rebuilt on the 0.5 s detail ticks.

### Checks

- `npm test`: 388 passing, 0 failing.
- `npm run build`: passed.
- 10 v 10, before: 0.40 ms/world step, 615,728 bytes/player/s, 10 messages/s.
  After: 0.24 ms/world step, 53,635 delta bytes/player/s, 10 messages/s.
- 100 ships, before: 1.84 ms/world step, 489,236 bytes/player/s at 10 Hz
  (238,591 at 5 Hz). After: 1.25 ms/world step, 45,160 delta bytes/player/s
  at 10 Hz (22,855 at 5 Hz).
- No browser or headless Chromium is available in this environment, so the
  panel was checked structurally (DOM ids, build and tests), not visually.

## Session 3E-perf-b: drawing cost and quality governor

**Date:** 2026-11-13
**Branch:** main

### What was built

- Ship display lists are pooled and reused instead of destroyed on every
  disappear. Status ink is rebuilt only when a flag or the abandoned-marker
  zoom bucket changes, not on every animation frame.
- Combat effects are capped at 150, the oldest and any off-screen effects are
  dropped, and effect drawing stays in one batched graphics object. Route ink
  is skipped when neither its data nor the camera moved, and route dots thin
  out when quality is reduced. The chart already redraws only on data or pose
  changes.
- DOM work is throttled: the selected-ship readout at 2/s, the Fleet card and
  battle log at 4/s. The Fleet panel is only rebuilt when its content key
  changes.
- New quality governor, Auto by default: after 3 s of frames over 40 ms it
  drops smoke/splash, then wind streaks, then route detail, then fire glow, and
  only then render resolution; 10 s of good frames restores one step at a
  time. Menu Quality offers Auto, High and Low. A small "Reduced effects for
  speed" note appears while reduced.
- Same-fleet ships closer than 14 screen pixels are drawn as one paper marker
  with `xN`; the individual hulls and selection rings are hidden until they
  separate or the camera zooms in. The marker has its own ring when a member is
  selected.

### Checks

- `npm test`: 393 passing, 0 failing.
- `npm run build`: passed.
- Pure render-network tests cover governor order and recovery, grouping count,
  different-fleet isolation, the 150-effect/off-screen cap and independent DOM
  throttles.
- No browser or headless Chromium is available, so the governor, grouping and
  pooled display list were not visually inspected; the build and pure tests
  were run.

## Session 3E-perf-c: formations and ship separation

**Date:** 2026-11-13
**Branch:** main

### What was built

- A real-loop formation harness (real sailing, wind 315, 20 km with one 90
  degree turn) covering line ahead, line abreast, wedge, convoy and free chase.
  Before the fix every formed preset showed 1/10 in station, slot errors around
  3.9 km and pairs as close as 32 m; they had bunched instead of forming.
- Actual causes found and fixed: the fleet order was deleted as soon as the
  leader reached its 4 km destination radius, leaving followers stopped short;
  station orders inherited that 4 km arrival radius; `chooseTackSide` forced a
  tack in open water so followers on the wrong tack sailed away instead of
  tacking; the fleet pace used current speed (zero at the start), and every
  follower was allowed 15% more than the fleet pace, so some overran their
  slots. Formation slots were also matched to member order, not leader-first
  order, so a flagship that was not first in the fleet list could give another
  ship the leader's slot.
- Formations now use leader-first slot order, an 80 m station arrival radius,
  an assembly pace while followers are out of station, and an ahead/lateral
  speed cap. A fleet order is not completed until all active members are in
  station. The upwind line-ahead fallback and engaged line-ahead path remain.
- Separation applies to every ship: steer away inside 80 m, slow to 4 kn inside
  60 m, and hard-push to a 41 m floor. The spatial grid supplies neighbours and
  only near pairs are corrected after the first push, so the floor is cheap.
  Boarding approaches get a final floor check; live grapples keep their 45-60 m
  spacing.
- Fleet cards show "In station X of Y" with reasons (waiting for slower ship,
  tacking, blocked by land, out of position, detached, docked, needs crew).
  Double-tap and the new Select fleet action issue a fleet order and do not
  detach members.
- At far zoom (station gaps under 14 px) a thin dotted link follows formation
  order and a light hull outlines the fleet. Choosing a formation shows faint
  slot markers around the leader for 3 seconds.

### Real-loop table after the fixes

| formation | 30 s | 60 s | 120 s | largest error at 120 s | closest pair at 120 s |
| --- | --- | --- | --- | --- | --- |
| line ahead | 10/10 | 10/10 | 10/10 | 265 m | 71 m |
| line abreast | 10/10 | 10/10 | 10/10 | 296 m | 59 m |
| wedge | 9/10 | 9/10 | 10/10 | 288 m | 87 m |
| convoy | 8/10 | 10/10 | 10/10 | 283 m | 114 m |
| free chase | 10/10 | 10/10 | 10/10 | 0 m | 137 m |

The 10 v 10 real battle kept a 40.0 m closest pair over 900 steps. Every preset
reached at least 8/10 in station at 120 s; no pair came within 40 m at any step.

### Checks

- `npm test`: 396 passing, 0 failing.
- `npm run build`: passed.
- 10 v 10: 0.24 ms/world step, 605,063 full-state bytes/player/s, 54,009 delta
  bytes/player/s, 10 messages/s.
- 100 ships: 1.47 ms/world step, 488,860 full-state bytes/player/s and 33,224
  delta bytes/player/s at 10 Hz (239,069 / 16,864 at 5 Hz), 10 messages/s.
- No browser or headless Chromium is available, so the dotted formation link,
  outline, slot markers and Fleet-card readout were checked structurally and by
  build/tests, not visually.

## Session 3E-sail-a: shorter, smarter tacking

**Date:** 2026-11-13
**Branch:** main

### Measured first

Real world loop, wind 315, frigate, stopped point target, 10/30/100 km and
0/15/30/45/60/90 degree bearings off the wind. The old rule used a fixed 2.5 km
zigzag around the wind line. The worst cases:

| case | time | made good / own speed | tack-side changes | longest leg | sideways |
| --- | --- | --- | --- | --- | --- |
| 30 km dead upwind | 6.96 h | 0.470 | 10 | 5.7 km | 2.5 km |
| 30 km +15 deg | 6.53 h | 0.487 | 8 | 11.6 km | 8.5 km |
| 30 km +30 deg | 5.84 h | 0.536 | 6 | 19.9 km | 10.5 km |
| 100 km +45 deg | 23.54 h | 0.660 | 88 | 82.9 km | 24.2 km |

Every case arrived, but the wide zigzags and repeated tacks made a beat much
slower than the ship's own speed. The 100 km +45 case spent most of its time
crossing its own track.

### Changes

- A corridor around the straight start-to-target line: half-width 8% of the
  remaining distance, clamped to 0.8-6 km. The ship holds the tack until the
  edge, with a 15% progress margin before an early change and a 60 game-second
  cooldown. It commits to crossing the corridor after an edge tack, which stops
  the old bang-bang oscillation.
- Inside 3 km the ship commits to the single best tack; if the bearing clears
  the no-go angle by 5 degrees it steers straight. A target closer than 15
  degrees to dead upwind still uses both tacks because one tack cannot fetch it.
- Every hull's closest-to-wind angle is 9 degrees smaller at runtime. Frigate:
  62 -> 53 degrees. Other classes: 55-82 -> 46-73 degrees.
- A tack turns at 6 degrees per game second for at most 20 game seconds, then
  returns to the normal turn rate. The measured frigate tack took 18 game
  seconds.
- Close combat and boarding keep the old tight tacking rule; formation station
  keeping uses the corridor but not the single-tack final approach. The upwind
  line-ahead fallback is unchanged.

### After

| case | time | made good / own speed | turns | longest leg | sideways |
| --- | --- | --- | --- | --- | --- |
| 10 km dead upwind | 1.24 h | 0.612 | 6 | 2.0 km | 1.4 km |
| 30 km dead upwind | 5.06 h | 0.602 | 16 (8 complete tacks) | 3.7 km | 2.3 km |
| 100 km dead upwind | 21.24 h | 0.602 | 15 | 70.5 km | 5.6 km |
| 30 km +15 deg | 4.91 h | 0.619 | 14 | 6.2 km | 3.8 km |
| 30 km +30 deg | 4.32 h | 0.701 | 9 | 8.9 km | 3.6 km |
| 30 km +45 deg | 3.50 h | 0.868 | 4 | 21.3 km | 3.0 km |
| 100 km +45 deg | 14.48 h | 0.864 | 18 | 79.5 km | 4.9 km |
| coast west Jamaica | 8.53 h | 0.678 | 14 | 21.0 km | 6.3 km |

These are the final numbers after the Part B final-approach and 0.8 km floor
tuning. The 30 km dead-upwind run meets 60% made good and stays inside the
2.4 km corridor. Every table case finishes in under twice its ideal-tack time. The
exact 0/5/10/20 degree upwind targets all arrive. The coast route uses the
planner's clearance waypoints without adding a sideways zigzag.

### Checks

- `npm test`: 399 passing, 0 failing.
- `npm run build`: passed.
- Tack manoeuvre test: 18 game seconds from tack-side change to the new course.


## 3E-sail-b: real predicted routes

- Added a server-side ghost prediction in `shared/prediction.ts`. It copies the
  ship and runs the real `stepShip` steering, speed curve, corridor, tacking,
  coast checks and arrival slow-down in 2 game-second steps, for up to 60 game
  minutes or the rest of the route. The path is capped at 300 points and is
  sent only in the owner's fleet snapshots.
- The world caches predictions by ship and refreshes the selected ship first,
  then other routed ships, at most one ghost per tick. A cached path is reused
  until the route changes, the wind moves more than 10 degrees, or 20 game
  seconds pass.
- Routed ships now keep their literal destination in `order` and steer with a
  pure-pursuit look-ahead point. The client draws the predicted path with a
  Catmull-Rom screen spline, retaining the 2G dotted style; straight heading
  orders stay straight.
- Predicted versus actual over a 5 km leg: 15.0 m in a reaching run and 18.6 m
  on a tacking run (limits 50 m / 150 m). Predicted paths had 206 and 212
  points. A warm ghost computation took 0.63 ms for 422 two-second steps, under
  the 2 ms budget.
- Also fixed the final-approach tack to keep the current side (removing one
  late turn) and raised the corridor floor to 0.8 km, giving 16 turns (8
  complete tacks) on the 30 km dead-upwind run.

### Checks

- `npm test`: passed (406 tests including the new prediction and spline tests).
- `npm run build`: passed.


## 3E-sail-c: journey trails on the chart

- Journeys live in `OwnerState`, so they survive a socket refresh or reconnect.
  A journey starts on undock or on the first order at sea, keeps running while
  docked, and ends only when the ship is lost, captured, abandoned, manually
  stopped, or all trails are cleared.
- Every 1 km (or 30 game seconds when slower) adds a trail point. The cap is
  3,000 points per journey; when full, every other point in the older half is
  dropped. Lost ships leave an X at their last point; manually stopped journeys
  leave no X.
- A full update carries a simplified trail of at most 300 points for my ships
  only. Later updates carry at most 20 new points per ship; they never resend
  the whole path. Full trails take 3,895 bytes for 283 points in the test; the
  incremental sample was 50 bytes.
- The Chart has Selected (default), All and None trail filters, a Clear all
  trails button, dark-brown dotted trails drawn above the chart ground and
  below ships, and X marks for losses. The ship card and Damage panel show
  `Journey: N km, N.N game days` with an End journey button. Tap targets are
  44 px.
- Fog is unchanged: trails are built from the player's own owner state, and
  only own ships are sent.

### Checks

- `npm test`: passed (413 tests including the journey, cap, privacy, reconnect
  and chart-filter tests).
- `npm run build`: passed.


## 3E-sail-d: flagship marker setting

- The map pennant from 3E-c is now off by default. Menu has a remembered
  "Show flagship pennant on the map" toggle. When on it is drawn at 60% size
  and only over the player's own flagship.
- The "Flagship" tags in the ship panel, Fleet panel and selection list are
  unchanged, so the flagship is still identifiable with the map marker off.

### Checks

- `npm test`: passed (414 tests, including the opt-in/default marker test).
- `npm run build`: passed.


## 3F-a: full route dots, route setting, chart holes

- The predicted line now runs to the ordered goal with no 60-minute cap. It
  uses the real `stepShip` ghost, 2-second steps for the first 60 game minutes
  and 10-second steps after that, and sends at most 400 points with more detail
  near the ship. A job advances for at most 2 ms per tick; the old line stays
  visible until the replacement is ready. An unreachable goal shows "No route
  to that point." instead of a truncated line.
- Only each player's primary selected ship is computed and drawn. A selected
  formation member resolves to its leader, so a fleet gets one line. Menu has
  a remembered "Show route line" toggle (default On); off clears the line and
  tells the server to stop computing and sending it.
- Route invalidation: order change, 5 degrees of wind, 15% wind speed, 10%
  speed/turn-rate damage change, 150 m off the line, or the 15-second fallback.
  Test rooms have wind direction and speed controls.
- The white chart circles were undiscovered cells inside explored sea. Sight
  discovery tested only a cell's centre, so a diagonal course could leave a
  cell untouched while all its neighbours were discovered; the smoothed
  outline then punched that cell out as cream paper. Discovery now accepts any
  overlap with the sight circle and fills one-cell enclosed holes. Test/dev
  `&chartdebug=1` colors undiscovered cells red, discovered cells green, and
  labels the 1 km cell size in the debug line.
- Fog checks cover straight legs every 5 degrees at normal and 144x speed.

### Checks

- `npm test`: passed (419 tests).
- `npm run build`: passed.


## 3F-b: port defence, capture and fortification rules

- Added `shared/portBattle.ts` with pure, seeded rules for port health, guns,
  battery fire, aggressor memory, repair, fortification builds, capture ranges
  and the 300-second hold, docked-ship capture and the elimination hook.
- AGREED numbers are in `settings.ports.battle`: 0/10/10, 10/12/8 and 40/20/10
  guns, 2,000/5,000/12,000 health, 1.2 km range, 15/20/30 km capture ranges,
  300 seconds, +20% guns / +30% health / +100 m range per tier, and 1/2/3 day
  builds. Build costs use the port's stock: 60+20, 150+50, 300+100 at medium
  size.
- Draft battery reload was tuned from 3.0 to 1.0 game minutes after the balance
  simulation: one line ship now loses to a large port, three line ships silence
  it with about 20% hull loss, and four with about 11%.
- `RULES.md` has a new "Ports in battle" section. `scripts/balance-ports.mjs`
  plays the requested stand-and-fire cases at 600 m.

### Checks

- `npm test`: passed (432 tests).
- `npm run build`: passed.


## 3F-c: ports in the server world

- The room now keeps port battle state (owner, health, tier, build, aggressors,
  capture hold, stock) in memory; nothing is saved. `portOwners` follows the
  battle owner so the existing shipyard and docking checks stay coherent.
- The world step runs builds, repair, ship fire at ports, battery fire, the
  aggressor memory, the capture hold and docked-ship capture/push-out. Ships
  ordered to Attack port close to 600 m and stand and fire. Fleet orders apply
  the same order to each member. Docking at another player's port is refused.
- `visibleStateFor` adds `portBattle` rows for found ports only: navy colour,
  tier, condition, silenced and capture range are public; exact health, stock,
  build progress, guns and aggressors are owner-only; capture progress and the
  blocking reason go only to the owner and the capturing side.
- Test/dev helpers set a port's owner, health, tier, finish a build or fill its
  stock. `&capturehold=SECONDS` overrides the hold in test/dev rooms. A dummy
  owner is not a player and never triggers elimination.
- Elimination now assigns the eliminated player's ports to the teammate or
  victors, or makes them unowned when nobody defeated them.

### Checks

- `npm test`: passed (438 tests).
- `npm run build`: passed.
- `scripts/benchmark-ports.mjs`: 100 ships and 5 ports firing, mean 2.02 ms per
  world step (p50 1.48, p95 3.50). The earlier 100-ship/3D benchmark was 1.86
  ms per step, so ports add about 0.16 ms in this case.

## 3F-d: port screens

- Port markers now use the owner's navy ink and a tier shape: anchor for tier 0,
  a wooden palisade for tier 1, a stone wall for tier 2 and a star fortress for
  tier 3. Silenced ports get a small smoke mark. Port fire and hit events use
  the existing flash and splash effects.
- The port folio has a battle section. The owner sees exact health, battery
  strength, tier, build cost with the port's stock, build progress and a Build
  next tier button (Needs research in normal rooms). Other players see only the
  condition word, tier, capture range and Attack port. NPC ports show Neutral
  ground and cannot be attacked.
- Long-press or right-click a port now offers Attack port; the selected or last
  attacked port gets a faint capture-range ring. A capture strip shows the
  hold countdown or the blocking reason. Port hits now write private battle-log
  lines and capture notices name the captor.
- Port battle text and layout live in `shared/portView.ts`. The panel keeps its
  own scrolling band below the capture strip at every requested size.

### Checks

- `npm test`: passed (444 tests).
- `npm run build`: passed.
- No browser is available in this workspace, so the screens were not visually
  inspected. Layout, marker-discovery, owner-only health and capture-strip
  behaviour are covered by `tests/port-screens-3f.test.ts`.

## 3G-a: chart coverage fix

- Cause found: `newestStateWithEvents` coalesced queued state messages and kept
  only the newest `chart` update. On a slow tab or after a reconnect burst, all
  discovery cells and private blocks from the skipped states were lost. The
  server was sending them; the client threw them away.
- Chart updates are now applied as each message arrives, before states are
  coalesced, and `newestStateWithEvents` merges every queued chart update as a
  second guarantee. `&chartdebug=1` now prints "server cells N, client cells N,
  drawn blocks N, missing N".
- Added a 1,400 km real-loop voyage test over eight headings with a coalescing
  slow client and two reconnects. Before the fix it missed 703 of 2,859 sight
  cells; after the fix it passes and every discovered chart block is present.

### Checks

- `npm test`: passed (446 tests).
- `npm run build`: passed.
- No browser is available in this workspace, so the chart was not viewed.

## 3G-b: fire ships, towing and lights

- Added the fire ship as a seventh type in the ship table, generated once per
  navy from the raider row. It is not one of the 24 catalogue entries. The
  AGREED 500-piece price, one-day delivery, 4/6 knots, 400 hull, 15 km sight and
  2.5 m draught are in `shared/data/ships.ts` and `shared/settings.ts`; sight is
  stored in settings because sight is not yet a per-ship field. Its smaller
  crew, 60% raider turn rate, ignition range, 150-second give-up, tow reach and
  5 km night range are Draft settings. The research hook returns true only in
  test and dev rooms, and normal buy lists show "Needs research".
- Implemented Ignite now, Ignite on contact, Tow, Cast off and Lights on/off
  in `shared/world.ts`, with server orders and `&fireship=N`. Contact steering
  reuses the same predicted approach path as boarding; ignition consumes the
  ship and leaves a burning hulk that drifts after 20 seconds. Towing follows
  120 m behind, costs the tower 2 knots, breaks automatically in battle, and a
  towed fire ship refuses ignition. Lights use the existing visibility path:
  at night a lights-off enemy is visible only inside 5 km. Other players receive
  only the normal navy and class snapshot, never exact fire-ship data.
- Test helpers: anchored five-frigate fleet with stance choice and a time-of-day
  control, available only in test and dev rooms.

### Balance simulation

`node scripts/balance-fire-ship.mjs`, 100 seeded real-loop runs per stance,
night, lights off, one fire ship starting 4 km from five frigates hove to
60-100 m apart:

- Fight only if attacked: fire ship ignited 100%, at least one frigate caught
  fire in 78% of runs, mean 0.83 frigates alight.
- Engage anything: fire ship ignited 100%, at least one frigate caught fire in
  78% of runs, mean 0.78 frigates alight.

The proposed 85% and 15-25% targets were not met. The cause is existing hove-to
gunnery timing: frigates close to 250 m before training a broadside, so a
4-knot fire ship reaches its 100 m ignition range first. Changing the global
engage or pivot range would alter every battle, so it was reverted rather than
quietly tuning unrelated combat.

### Checks

- `npm test`: passed.
- `npm run build`: passed.
- No browser is available, so the simulation is the only balance evidence.

## 3G-c: fire ship and tow screens

- The shipyard shows Fire ship, 500 at every port that sells small ships. In a
  normal room the card is dimmed and its button reads Needs research.
- The scrolling ship card now has a fire-ship section: Ignite now (with a
  confirmation), Ignite on contact, Cancel contact attack, Cast off and a
  Lights on/off switch on every ship. A tower gets Tow fire ship only when one
  of the player's unlit fire ships is within 300 m. Tow and contact ignition
  use an in-card target step: tap the map target, see the target line and the
  Cancel button, then confirm. Selecting another ship resets the mode.
- The map draws an orange dotted target line for a contact attack and a thin
  dotted rope labelled "Towing X" for a tow. Fire ships get a small dark marker;
  burning ships keep the existing orange glow, smoke and ignition flash; ships
  with lights on get a gentle lantern glow at night.
- Test tools add an anchored five-frigate spawn with stance choice and a
  time-of-day control. They sit inside the existing scrolling Menu and all
  targets are at least 44 px.

### Checks

- `npm test`: passed (465 tests).
- `npm run build`: passed.
- No browser is available, so the screens were not visually inspected. The
  shared card/layout plan and the five review viewports are covered by
  `tests/fire-ship-ui-3g.test.ts`; the target-mode cancel path is exercised by
  the same action model, not by a real pointer.

## 3G-fix-a: order feedback, fire ship, tow and lights

- Every client order now carries an id and the server answers it with `ack`
  `{ ok, text }`. Rejections use the latest plain-English notice or a fallback
  reason. The client shows a short notice and keeps the last 40 order results and
  last 10 client errors behind Test tools -> Debug log (test and dev rooms).
- Fire ships no longer vanish at ignition. The cause was abandonment: ignition
  set the crew to zero, `updateAbandonment` moved the ship out of the owner fleet
  into `abandonedShips`, and `visibleStateFor` never sends abandoned ships.
  An ignited hulk now stays in the owner fleet until it sinks, and a 200-second
  burn override makes it sink at the end of the burn.
- The fire-ship card no longer hides actions when a condition is false. Ignite,
  Tow and Cast off stay visible, disabled with their reason. A lights line and
  lantern indicator are always shown.
- Fixed the client fleet parser, which was dropping `fireShipIgnited`,
  `fireShipMode`, `fireShipTargetId`, `towedBy`, `towingId` and `lightsOn`.
  That omission made contact mode, towing and lights appear to do nothing even
  when the server had accepted the order.
- Short sea-point orders (3 km or less) now use a 100 m arrival radius. Before,
  every point order used the 4 km port arrival radius, so tapping 0.5-1 km from
  an enemy fleet immediately "arrived" and the ship never moved. Long routes,
  formations and port arrivals keep the existing 4 km radius.
- Contact ignition stops the fire ship at its target so the hulk can pass fire
  instead of immediately drifting out of the 100 m spread range.
- Added `tests/harness/e2e.mjs` and a Pixi recording stub. It runs the real
  client bundle in jsdom, clicks real buttons, taps by world position through the
  real map handler, and talks over an in-memory socket to the real GameRoom. It
  covers Ignite now (state table, spread and sink), contact mode and cancel,
  Tow/Cast off with 100-update persistence and disabled reasons, lights with a
  second real client, alert-fleet sailing and Attack, and target-mode persistence
  over 100 updates. Run with `npm run test:e2e`.

### Checks

- `npm test`: passed (465 tests).
- `npm run build`: passed.
- `npm run test:e2e`: passed.
- No browser is available in this workspace, so nothing was visually inspected.
  The harness cannot dispatch real `PointerEvent`s; taps go through the client's
  real map-tap function instead. The second client shares one process and one
  GameRoom, not a separate device.

## 3G-fix-b: smooth sailing with many ships

### Server cost by commit

Node proxy, two players and 10/30/60/100 ships (half in a battle zone), median
of three seeded runs of 100 real-loop world steps. `ms` is world step time;
`KB/s` is encoded delta bytes per player per second at 10 Hz.

| Ships | 3F last | 3G-a | 3G-b | 3G-c | Part-A HEAD |
|---|---|---|---|---|---|
| 10 | 0.35 ms / 5.2 KB | 0.36 / 5.2 | 0.40 / 5.3 | 0.37 / 5.3 | 0.27 / 5.3 |
| 30 | 0.52 / 10.1 | 0.50 / 10.1 | 0.51 / 10.1 | 0.51 / 10.1 | 0.50 / 10.1 |
| 60 | 0.93 / 17.5 | 0.92 / 18.0 | 0.94 / 18.0 | 0.97 / 18.0 | 0.99 / 18.0 |
| 100 | 1.58 / 28.0 | 1.57 / 28.0 | 1.63 / 28.0 | 1.55 / 28.0 | 1.50 / 28.0 |

No commit produced a server-step or bandwidth jump. 3G-b is about 0.05 ms
slower at 100 ships and 47 bytes per player per second larger; that is the
fire/tow/lights bookkeeping, not the jank. The cause was client-side: every
snapshot replaced the draw target, and the old exponential easing chased it
(37% median / 77% p95 / 182% worst frame-step error against steady speed at
5 Hz with jitter and a dropped packet). The separation pass also turned hove-to
hulls by about 19 degrees in 60 seconds just because a neighbour was inside the
80 m avoid band.

### What changed

- Added `shared/renderMotion.ts`, a fixed-delay (150 ms) snapshot track. The
  client draws the position at `now - 150 ms`, interpolates between the two
  surrounding snapshots, continues on the last velocity for at most 400 ms
  across a dropped packet, and turns headings the short way round. The camera
  follows the same sampled own-ship position, so it cannot fight the ring.
- The server already uses a fixed 10 Hz world step; it was left fixed. The new
  Draft limit is `settings.server.maxWorldStepMs = 16`.
- Separation now steers only hulls that are under way. Stopped/hove-to ships are
  still protected by the hard 41 m push but no longer swing every tick.
- Tests: 5/10 Hz jitter + dropped-packet render plan for 1, 10 and 40 ships,
  short-way 359-to-1 heading, straight sea order with and without 40 ships,
  five hove-to ships at 60-100 m for 60 s, and a 100-ship step under 16 ms.

### After

- Client frame-step error: 0.0% median, 0.0% p95, 0.0% worst (from 37.3%/76.9%/
  182.2%).
- Hove-to heading swing in 60 s: 0.00 degrees (from 18.73 degrees); position
  drift stays 0 m.
- 100-ship world step after the change: 1.56 ms / 28,025 bytes per player per
  second (Part-A HEAD: 1.50 ms / 28,026).

### Checks

- `npm test`: passed (471 tests).
- `npm run build`: passed.
- `npm run test:e2e`: passed.
- The performance panel already exists behind `&perf=1`; it shows frame rate,
  frame time, ping, bytes/s, snapshot age, server step time and ships drawn.
- No browser is available in this workspace, so these are measured proxies, not
  a visual review. The harness cannot dispatch real `PointerEvent`s and the
  second client is a second jsdom page in the same process, not a second device.

## Session 3H-a: fire visuals, effect gallery, lights ring

**Date:** 2026-11-14
**Branch:** main

### What was asked

Make burning ships visible at close, mid and far zoom, add a test/dev effect
gallery, and draw a night lights-off spotting ring with a card lantern state.

### Cause of the invisible fire

The burning ink was built correctly, but each ship's `statusInk` stayed at its
local origin. It was attached directly to `fleetLayer`, so its coordinates were
read as world-screen `0,0`; the flames, glow and smoke were drawn at the
top-left of the chart rather than on the hull, and were clipped away in normal
views. The ink was also below hulls added later. A second, smaller error hid
the effect when the quality governor dropped `fireGlow`, even though fire is
important state rather than optional polish.

### What was built

- A dedicated `shipFxLayer` above every hull and a `shipLabelLayer` above the
  fire. Ignition flash, flame polygons, glow, smoke and the lights-off ring are
  painted in screen coordinates in that layer. Quality never removes fire.
- `shared/fireVisuals.ts`: browser-free close/mid/far fire plans, the 12-entry
  gallery sequence, six-second cycling and the night ring rule.
- Fire shape counts and opacity: 3-5 orange/red flame polygons at 1 km, an orange
  glow plus smoke at 5 km, and a 14 px pulsing dot at 50-200 km.
- Test/dev **Effect gallery** button: fire at three strengths, smoke, ignition,
  splash, hit flash, damage smoke, tow rope, white flag, lantern glow and
  flagship pennant, six seconds each with its name.
- Night **Seen within 5 km** dashed ring for any ship with lights off; own live
  sight circles are unchanged. The ship card lights row remains On/Off.
- Visible burning ships now carry their strength in state and the delta, and
  visible lights-off ships are identified at night. Neither exposes cargo.

### Checks

- `npm test`: **476/476 passing**, including fire plans at 1, 5, 50 and 200 km,
  alpha above 0.5, far dot at least 10 px, layer order and night-ring gating.
- `npm run build`: passed.
- `npm run test:e2e`: passed with the real client and real GameRoom.
- No browser is available, so the gallery, flame look and ring were not viewed
  on screen. The draw plans, real client display tree and jsdom harness were
  checked instead.

## Session 3H-b1: manoeuvres and steering

**Date:** 2026-11-14
**Branch:** main

### What was asked

Measure the old turning circles, make the helm depend on speed, and add
automatic tack, wear, box-haul, in-irons recovery, port warp and shortening sail,
plus working anchors.

### What was built

- `shared/manoeuvres.ts` is a pure decision/state module. It chooses a
  manoeuvre, advances the phase, reports a helm heading, speed share or explicit
  backed-sail/warp speed, and a UI label.
- Big course changes now tack through the wind or wear round. A confined
  lee-shore turn box-hauls, a stopped hull backs its sails, a missed stays falls
  into irons, and warping is port water only.
- `shared/sailing.ts` uses the historical 90-degree time divided by
  `settings.manoeuvres.cruiseTurnRateMultiplier = 3`; the rudder loses bite below
  steerage speed and at rest only the backed-sails pivot remains. Hampered or
  slow hulls wear round.
- Anchors: drop below 3 knots, hold position, swing slowly head to wind, refuse
  sailing orders, and take 20 real seconds to weigh. Anchor buttons are in the
  ship card and Orders menu; both targets are 44 px and the ship card scrolls.
- Wind shifts invalidate active manoeuvre predictions. Lee-shore and narrow
  channel context is detected on the server from discovered land. The helm uses
  the same context as the ghost and tests.
- Tow speeds are synchronised after formation and special orders, and a stopped
  towed pair gets one knot of steerage way instead of a zero speed limit.
- A short sea-point order now arrives at the mark instead of stopping at the old
  4 km radius; close approach is 100 m and the look-ahead end stop no longer
  overrides it. Final approach close to the destination uses the ordinary helm
  so the ship does not fight an automatic manoeuvre on the last 500 m.

### B1 measurement: turning circle at cruise

Simulated from each class's `turn90GameMinutes`, calm steering, at cruise speed.
"Old" divides the new rate by `cruiseTurnRateMultiplier` and therefore matches
the previous model. Radius is in metres; the last column is the class's
closest-to-wind angle.

```text
class      old lengths  new lengths  new radius m  closest-to-wind
flagship         15.72         5.24           314              61
line             15.01         5.00           275              59
frigate          15.72         5.24           236              53
escort           15.72         5.24           157              55
raider           13.36         4.45           111              46
trade            22.46         7.49           262              69
fireShip         10.48         3.49            87              46
```

The frigate circle is 5.24 ship lengths, inside the asked 4-6 range. The
one-second turns at 0 / 2 / 5 knots are 0.169 / 1.125 / 1.125 degrees, so way on
is what makes the rudder bite.

For the old-versus-new reversal check (north to south, wind 315), the old model
turned 180 degrees in 467 game seconds at any starting speed and finished at
1,729 s with 6.01 km net. The new model from rest goes through irons and a wear:
turn 399 s, finish 1,776 s, 6.59 km track. Starting at 2 or 5 knots it wears:
turn 191 s, finish 1,568 s, 6.46 km track. The new ship therefore takes longer
from rest because it first has to gain way, while a ship already under way
turns sooner.

### Checks

- `npm test`: **486/486 passing**.
- `npm run build`: passed.
- `npm run test:e2e`: passed with the real client and GameRoom.
- Temporary diagnostic edits were removed before the final runs.
- No browser is available in this workspace: no visual review, real touch
  events, second physical device or real Cloudflare frame timing were measured.
  The harness is jsdom with a Pixi stub, not rendered pixels.

## Session 3H-b2: coast safety, planner and recovery

**Date:** 2026-11-14
**Branch:** main

### What was asked

Add automatic coast safety, idle anchoring and stuck recovery, replace the
long-route planner with a kinematic one that stays inside its time budget, keep
fleet line ahead, and test the planner broadly.

### What was built

- Coast safety runs every two real seconds. It probes three kilometres along the
  ship's course, and 7.5 km on a lee shore (2.5x). An idle ship inside the probe
  anchors; a ship with an order turns seaward. Port anchorages are relaxed.
  Contact fire ships, tows, boarders, runners and engaged ships are exempt.
- An independent ship with no order anchors after 20 game minutes. This is
  separate from the manual anchor: a new order wakes an automatic anchor at
  once, including orders issued by a fire-ship contact or a fleet. A manually
  dropped anchor still needs the full 20 real seconds to weigh.
- Stuck recovery tracks the best distance to a routed goal. After 30 game
  minutes without 20 m of improvement it warns "no progress; trying a new tack"
  and clears the manoeuvre cooldowns. After 60 game minutes it clears the order
  and anchors. Ships still making way are never treated as stuck.
- The planner now uses the fine 2 km grid for routes up to 30 km and the 4 km
  grid beyond that. Long searches use a stronger weighted heuristic and skip
  the soft open-water cost, while keeping the hard four-kilometre clearance and
  exact land-crossing check. The smoothed curve is kept inside a five-kilometre
  corridor around the raw plan; if it strays, the raw plan is used instead. The
  one stored curve feeds the route dots, ghost path and live helm.
- Line ahead remains the fleet's default and its upwind fallback; followers use
  the leader's recorded track rather than a straight-line offset.

### Measurements

- 200 deterministic Caribbean scenarios: median **0.08 ms**, p95 **2.28 ms**.
  All 200 returned a navigable plan; no waypoint or segment crossed land.
- 100 local fine-grid routes around Jamaica: median **0.00 ms**.
- Kingston to Montego Bay (71 km, around Jamaica): median **1.02 ms** over 15
  warm runs. The old grid-only planner measured about 17 ms for the same plan
  on this VM before the changes; the earlier 2E log recorded 8.2 ms.
- The existing 100-ship world-step budget test still passes under the 16 ms
  limit; no new 100-ship timing was taken in this part.
- New b2 tests: 200 scenarios, bay turn-around, peninsula, lee-shore anchoring,
  idle auto-anchor, stuck warning/clear, eight-ship line ahead and 100 fine
  local routes.

### Checks

- `npm test`: **493/493 passing**.
- `npm run build`: passed.
- `npm run test:e2e`: passed with the real client and GameRoom.
- No browser is available in this workspace: no visual review, real touch
  events, separate physical device or real Cloudflare timing was measured. The
  harness uses jsdom and a Pixi stub, not rendered pixels.
