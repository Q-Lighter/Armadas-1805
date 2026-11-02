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
