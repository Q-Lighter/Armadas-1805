# Armada's 1805

A browser-based 1805 naval strategy game. This build draws the real chart of
the western Atlantic and the Americas from Natural Earth, with coastline and
chart-edge rules, sailing with automatic tacking, and live server rooms where
two or more players sail together. There is no combat, economy or weather yet.

## Requirements

- Node.js 20 or newer (npm comes with it)
- No accounts, keys or paid services are needed to build, test or run locally.

## Build

From the repository root:

```sh
npm install
npm run build
```

The build type checks everything, bundles the browser client and writes the
site to `dist/`. JavaScript and CSS names include a content hash, and an open
page checks `version.json` for a newer build. Private chart blocks are bundled
into the Worker, not the public page.

The chart tiles and server land lookup are committed, so a normal build needs
no map tooling. To rebuild them from Natural Earth:

```sh
npm run build-map
```

This needs the `world-atlas` and `topojson-client` development dependencies.
See [docs/MAP.md](docs/MAP.md) for the frame, tile levels and land lookup.

## Play locally

The page needs the Worker beside it for multiplayer, so run the local
Cloudflare server rather than opening `dist/index.html` directly:

```sh
npm run build
npx wrangler dev
```

Then open <http://localhost:8787/?room=test-1>. The room code can be any
letters, numbers, dashes or underscores; everyone using the same code shares a
world. A code starting `test` gets the fast frigate and an offshore start; a
code starting `dev-` also starts fully explored. Other codes are normal rooms.

Controls:

- Tap or click the sea to order your ship to sail there.
- Drag to pan; pinch or scroll to zoom. The ship view covers 4–65 km across the
  shorter screen side; **Chart** opens the whole paper down to 25 km.
- **Follow my ship** keeps the camera on your flagship.
- **S / M / L** set the UI size; the choice is remembered.

Your ship has a 25 km daylight sight circle. Remembered ground is dim, unseen
ground is stained paper, and live wind streaks cross the screen. A coast or
chart-edge order ends with a short paper notice that fades after a few seconds.
Test and dev rooms also show a small TEMP-DEBUG fog readout.

A player id is made on first visit and kept in the browser, so refreshing keeps
the same ship. Two tabs share that id; use two devices or two browser profiles
to sail as two players.

## Test

```sh
npm test
```

This compiles the shared code and runs 35 tests for the map projection and land
lookup, sailing, the world, coast and edge rules, fog, the chart data and the
fog-view helpers on Node's test runner.

```sh
npm run test:server
```

This builds the site, starts a local `wrangler dev` (workerd), connects two
simulated WebSocket clients to one room and a third to another room, sails
both ships and checks they stay in sync. It also prints the size of a normal
world update. It needs no Cloudflare account.

```sh
npm run build && npm run measure-map
```

This reports the worst chart view found across the land tiles at 21 zoom
levels on a phone-shaped and a Chromebook-shaped screen. It measures geometry
points and tile bytes, not GPU frame time.

## Deploy

Cloudflare builds this project from `main`: it runs the build and deploys the
Worker in `server/dist/worker.js`, the `GameRoom` Durable Object and the static
files in `dist/`. The private chart blocks travel in the Worker bundle. For a
manual deploy, log in once with `npx wrangler login` (a free Cloudflare
account, no card needed), then:

```sh
npm run build
npm run deploy
```

`wrangler.jsonc` holds the Worker name, the Durable Object binding and
migration, and the static assets settings. Free plans use SQLite-backed
Durable Objects.

## Folders

| Folder               | Contents                                                        |
| -------------------- | --------------------------------------------------------------- |
| `client/`            | The game as shown in the browser (PixiJS and TypeScript).       |
| `map-data/`          | Private source tiles used to generate chart blocks.              |
| `server/`            | The Cloudflare Worker and the `GameRoom` Durable Object.        |
| `shared/`            | Game rules, world, map projection and land lookup.              |
| `docs/`              | Build log, style guide and map notes.                           |
| `scripts/`           | Build, map build, measurement, test and simulation tooling.     |
| `tests/`             | Automated tests (compiled before running).                      |

## Documentation

- [RULES.md](RULES.md): the project rules, read at the start of every session.
- [docs/STYLE.md](docs/STYLE.md): the paper-and-ink style guide.
- [docs/MAP.md](docs/MAP.md): the chart frame, Natural Earth data and tile build.
- [docs/BUILD_LOG.md](docs/BUILD_LOG.md): a short entry for each session.
- [CREDITS.md](CREDITS.md): map data and font credits.
