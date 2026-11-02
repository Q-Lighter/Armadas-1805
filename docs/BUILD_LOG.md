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
