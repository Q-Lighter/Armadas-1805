# Armadas 1805

A browser-based 1805 naval strategy game. This repository is currently a
project skeleton: it has no game features yet, only the folder structure,
tooling and rules that later work builds on.

## Requirements

- Node.js 20 or newer (npm comes with it)
- No accounts, keys or paid services are needed to build or run the project.

## Build

From the repository root:

```sh
npm install
npm run build
```

The build type checks everything, bundles the browser page and writes it to
`dist/`. Open `dist/index.html` in a browser to see the placeholder page, which
should read **Naval game: build 0A**.

## Folders

| Folder    | Contents                                                                 |
| --------- | ------------------------------------------------------------------------ |
| `client/` | The game as shown in the browser (TypeScript).                            |
| `server/` | The game server (TypeScript, will run on Cloudflare later).               |
| `shared/` | Game rules and data used by both. Plain TypeScript that runs anywhere.    |
| `docs/`   | Notes, including the build log.                                           |
| `scripts/`| Build tooling.                                                            |

## Documentation

- [RULES.md](RULES.md): the project rules, read at the start of every session.
- [docs/BUILD_LOG.md](docs/BUILD_LOG.md): a short entry for each session.
