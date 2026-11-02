// Test runner. It builds the shared code and the tests with TypeScript, then
// runs the compiled tests on Node's own test runner.
//
// Run it from the repo root with: npm test

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(tsc, ["-p", "shared/tsconfig.json"]);
run(tsc, ["-p", "tests/tsconfig.json"]);
run(process.execPath, ["--test", "tests/dist"]);
