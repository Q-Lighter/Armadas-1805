// Server integration test with simulated clients.
//
// It starts `wrangler dev` locally (workerd), connects two real WebSocket
// clients to one room, sails both ships, and checks that the room keeps them
// in sync. It also measures the size of a normal world update.
//
// Run it with: npm run test:server
// It needs `npm run build` first, because the Worker serves dist/.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SIM_PORT ?? 8791);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wrangler = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);

let logs = "";
let serverProcess = null;
let alpha = null;
let beta = null;
let gamma = null;

function startServer() {
  serverProcess = spawn(
    wrangler,
    ["dev", "--port", String(port), "--ip", "127.0.0.1", "--inspector-port", "9231"],
    {
      cwd: root,
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverProcess.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  serverProcess.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`wrangler dev exited early.\n${logs}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error(`server did not start in 60s.\n${logs}`);
}

/** Connect a client and remember every state it receives. */
function connect(player, room = "simtest") {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws?room=${encodeURIComponent(room)}&player=${player}`,
    );
    const queue = [];
    const waiters = [];
    const sizes = [];
    let last = null;

    socket.on("message", (data) => {
      const text = data.toString();
      sizes.push(Buffer.byteLength(text, "utf8"));

      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (message.t !== "s") return;

      const entry = { message, size: Buffer.byteLength(text, "utf8") };
      last = entry;
      if (waiters.length > 0) waiters.shift()(entry);
      else queue.push(entry);
    });

    socket.on("open", () => {
      resolve({
        socket,
        sizes,
        get last() {
          return last;
        },
        next(timeoutMs = 8000) {
          if (queue.length > 0) return Promise.resolve(queue.shift());
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`no update for ${player}`)), timeoutMs);
            waiters.push((entry) => {
              clearTimeout(timer);
              res(entry);
            });
          });
        },
      });
    });
    socket.on("error", reject);
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

try {
  startServer();
  await waitForServer();

  // A room code with a slash is refused before any socket is opened.
  const badRoom = await fetch(`http://127.0.0.1:${port}/ws?room=bad%2Froom`);
  if (badRoom.status !== 400) {
    throw new Error(`bad room code should be 400, got ${badRoom.status}`);
  }

  alpha = await connect("alpha");
  beta = await connect("beta");
  gamma = await connect("gamma", "otherroom");

  // Wait for a broadcast after both have joined: the very first snapshot for
  // alpha was sent before beta existed.
  await sleep(700);
  const alphaStart = alpha.last;
  const betaStart = beta.last;
  const gammaStart = gamma.last;
  if (!alphaStart || !betaStart || !gammaStart) {
    throw new Error("clients did not receive a world update");
  }

  if (alphaStart.message.ships.length !== 2 || betaStart.message.ships.length !== 2) {
    throw new Error("both players should see two ships");
  }
  if (gammaStart.message.ships.length !== 1) {
    throw new Error("another room must not see the first room's ships");
  }

  const startTick = alphaStart.message.tick;
  const alphaShip = alphaStart.message.ships.find((ship) => ship[0] === "alpha");
  const betaShip = betaStart.message.ships.find((ship) => ship[0] === "beta");
  if (!alphaShip || !betaShip) throw new Error("missing own ship in the first update");

  const alphaX = alphaShip[2];
  const betaY = betaShip[3];

  // Orders are relative to each ship's real starting berth near Jamaica.
  alpha.socket.send(JSON.stringify({ t: "o", x: alphaX + 20, y: alphaShip[3] }));
  beta.socket.send(JSON.stringify({ t: "o", x: betaShip[2], y: betaY + 20 }));

  // Junk orders must be ignored without dropping the connection.
  alpha.socket.send(JSON.stringify({ t: "o", x: "east", y: 4 }));
  alpha.socket.send(JSON.stringify({ t: "o", x: 999999, y: 0 }));
  alpha.socket.send("not json");

  // Ships start facing the middle of the start area, so give them time to
  // turn onto their new courses before checking that they moved.
  await sleep(12000);

  const alphaEnd = alpha.last;
  const betaEnd = beta.last;
  if (!alphaEnd || !betaEnd) throw new Error("clients stopped receiving updates");

  const alphaEndX = alphaEnd.message.ships.find((ship) => ship[0] === "alpha")?.[2];
  const betaEndY = betaEnd.message.ships.find((ship) => ship[0] === "beta")?.[3];

  if (!(alphaEnd.message.tick > startTick)) throw new Error("world tick did not advance");
  if (!(alphaEndX > alphaX + 0.05)) throw new Error("alpha did not sail east");
  if (!(betaEndY > betaY + 0.05)) throw new Error("beta did not sail south");
  if (alpha.socket.readyState !== WebSocket.OPEN) throw new Error("junk orders dropped the socket");
  if (Math.abs(alphaEnd.message.tick - betaEnd.message.tick) > 1) {
    throw new Error("the two players are out of sync");
  }

  const updateSizes = alpha.sizes;
  const summary = {
    rooms: { simtest: 2, otherroom: 1 },
    ticksAdvanced: alphaEnd.message.tick - startTick,
    alphaMovedKm: Number((alphaEndX - alphaX).toFixed(2)),
    betaMovedKm: Number((betaEndY - betaY).toFixed(2)),
    updatesReceived: updateSizes.length,
    typicalUpdateBytes: median(updateSizes),
    smallestUpdateBytes: Math.min(...updateSizes),
    largestUpdateBytes: Math.max(...updateSizes),
    stateExample: JSON.stringify(alphaEnd.message),
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log("SIMULATION PASSED");
} catch (error) {
  console.error("SIMULATION FAILED");
  console.error(error);
  if (logs) console.error("--- wrangler log (tail) ---\n" + logs.slice(-4000));
  process.exitCode = 1;
} finally {
  for (const client of [alpha, beta, gamma]) {
    try {
      client?.socket.close();
    } catch {
      // Already closed.
    }
  }

  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise((resolve) => serverProcess.once("exit", () => resolve(true))),
      sleep(5000).then(() => false),
    ]);
    if (!exited) serverProcess.kill("SIGKILL");
  }
}
