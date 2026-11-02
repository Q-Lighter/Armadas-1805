// Root build. It type checks the shared code and the server, type checks the
// client, bundles the browser page, and puts the finished page in dist/.
//
// Run it from the repo root with: npm run build

import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
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

  // Copy the page files into the top-level dist folder.
  await mkdir(dist, { recursive: true });
  await cp(path.join(root, "client/index.html"), path.join(dist, "index.html"));
  await cp(path.join(root, "client/styles.css"), path.join(dist, "styles.css"));
  await cp(path.join(root, "client/dist/main.js"), path.join(dist, "main.js"));

  console.log("\nBuild OK -> dist/index.html");
}

build().catch((error) => {
  console.error(`\nBuild failed: ${error.message}`);
  process.exit(1);
});
