# Armada's 1805

A browser-based 1805 naval strategy game. This build has the paper-and-ink
look, sailing rules with automatic tacking, and a live server room where two
or more players sail together. There is no combat, economy or weather yet.

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
site to `dist/`.

## Play locally

The page needs the Worker beside it for multiplayer, so run the local
Cloudflare server rather than opening `dist/index.html` directly:

```sh
npm run build
npx wrangler dev
```

Then open <http://localhost:8787/?room=test>. The room code can be any letters,
numbers, dashes or underscores; everyone using the same code shares a world.

Controls:

- Tap or click the sea to order your ship to sail there.
- Drag to pan; pinch or scroll to zoom between 5 km and 300 km across.
- **Follow my ship** keeps the camera on your flagship.
- **S / M / L** set the UI size; the choice is remembered.

A player id is made on first visit and kept in the browser, so refreshing keeps
the same ship. Two tabs share that id; use two devices or two browser profiles
to sail as two players.

## Test

```sh
npm test
```

This compiles the shared code and runs 13 tests for sailing and the world on
Node's test runner.

```sh
npm run test:server
```

This builds the site, starts a local `wrangler dev` (workerd), connects two
simulated WebSocket clients to one room and a third to another room, sails
both ships and checks they stay in sync. It also prints the size of a normal
world update. It needs no Cloudflare account.

## Deploy

Cloudflare builds this project from `main`: it runs the build and deploys the
Worker in `server/dist/worker.js`, the `GameRoom` Durable Object and the static
files in `dist/`. For a manual deploy, log in once with
`npx wrangler login` (a free Cloudflare account, no card needed), then:

```sh
npm run build
npm run deploy
```

`wrangler.jsonc` holds the Worker name, the Durable Object binding and
migration, and the static assets settings. Free plans use SQLite-backed
Durable Objects.

## Folders

| Folder     | Contents                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| `client/`  | The game as shown in the browser (PixiJS and TypeScript).                |
| `server/`  | The Cloudflare Worker and the `GameRoom` Durable Object.                 |
| `shared/`  | Game rules, world state and settings. Plain TypeScript that runs anywhere. |
| `docs/`    | Notes, including the build log and style guide.                          |
| `scripts/` | Build, test and simulation tooling.                                      |
| `tests/`   | Automated tests (compiled before running).                               |

## Documentation

- [RULES.md](RULES.md): the project rules, read at the start of every session.
- [docs/STYLE.md](docs/STYLE.md): the paper-and-ink style guide.
- [docs/BUILD_LOG.md](docs/BUILD_LOG.md): a short entry for each session.
