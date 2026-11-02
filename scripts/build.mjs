// Root build. It type checks the shared code and the server, type checks the
// client, bundles the browser page, and puts the finished page in dist/.
//
// JavaScript and CSS get a content-hashed name. The page and version.json are
// always fetched fresh, so a browser can never mix an old bundle with new HTML.
//
// Run it from the repo root with: npm run build

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const tsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");

/** Run a command from the repo root and stop the build if it fails. */
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${path.basename(command)} ${args.join(" ")}`);
  }
}

/** A short content fingerprint, stable for identical bytes. */
function fingerprint(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 10);
}

/** The commit this build came from, or an explicit override. */
function buildCommit() {
  if (process.env.BUILD_COMMIT) return process.env.BUILD_COMMIT.slice(0, 40);
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

async function build() {
  // Start from a clean slate so stale files never end up in the output.
  for (const folder of [dist, "client/dist", "server/dist", "shared/dist"]) {
    await rm(path.join(root, folder), { recursive: true, force: true });
  }

  // Shared first: the client and server read its built types.
  run(tsc, ["-p", "shared/tsconfig.json"]);
  run(tsc, ["-p", "server/tsconfig.json"]);
  run(tsc, ["-p", "client/tsconfig.json"]);

  await esbuild.build({
    entryPoints: [path.join(root, "client/main.ts")],
    bundle: true,
    format: "iife",
    target: "es2022",
    outfile: path.join(root, "client/dist/main.js"),
    sourcemap: true,
    logLevel: "info",
  });

  const js = await readFile(path.join(root, "client/dist/main.js"));
  const css = await readFile(path.join(root, "client/paper.css"));
  const jsName = `main.${fingerprint(js)}.js`;
  const cssName = `paper.${fingerprint(css)}.css`;

  let html = await readFile(path.join(root, "client/index.html"), "utf8");
  html = html
    .replaceAll("./main.js", `./${jsName}`)
    .replaceAll("./paper.css", `./${cssName}`);

  // The id changes whenever the shipped bytes or the source commit change.
  const commit = buildCommit();
  const versionId = fingerprint(
    Buffer.concat([Buffer.from(commit), js, css, Buffer.from(html)]),
  );
  html = html
    .replaceAll("__BUILD_ID__", versionId)
    .replaceAll("__BUILD_COMMIT__", commit);

  await mkdir(dist, { recursive: true });
  await cp(path.join(root, "client/fonts"), path.join(dist, "fonts"), { recursive: true });
  await writeFile(path.join(dist, jsName), js);
  await writeFile(path.join(dist, cssName), css);
  await writeFile(path.join(dist, "index.html"), html);
  await writeFile(
    path.join(dist, "version.json"),
    `${JSON.stringify({ id: versionId, commit })}\n`,
  );

  // A restored workspace can bring back files deleted at the start of the
  // build. Sweep the final folder too, so only this build's files are served.
  const keep = new Set(["index.html", "version.json", "fonts", jsName, cssName]);
  for (const entry of await readdir(dist)) {
    if (!keep.has(entry)) await rm(path.join(dist, entry), { recursive: true, force: true });
  }

  console.log(`\nBuild OK -> dist/index.html (${commit}, ${versionId})`);
}

build().catch((error) => {
  console.error(`\nBuild failed: ${error.message}`);
  process.exit(1);
});
