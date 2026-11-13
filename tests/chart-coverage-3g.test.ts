// 3G Part A: a long real-loop voyage through a deliberately slow client.
// The client is allowed to coalesce state messages, but chart discovery must
// never be coalesced away. Reconnects must rebuild the whole record.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CHART_BLOCKS } from "@naval/shared/chart-blocks";
import {
  applyChartUpdate,
  chartContent,
  createChartMemory,
} from "@naval/shared/chart-memory";
import {
  blockIdForCell,
  chartCellKm,
  chartColumns,
  chartRows,
  revealCircle,
  type ChartBlock,
} from "@naval/shared/fog";
import { settings } from "@naval/shared/settings";
import { newestStateWithEvents } from "@naval/shared/state-delta";
import {
  addPlayer,
  applyOrder,
  createWorld,
  requestChartResume,
  stepWorld,
  visibleStateFor,
  type StateMessage,
  type World,
} from "@naval/shared/world";

const TICK_REAL_SECONDS = 1 / settings.server.tickHz;
const DT_GAME_SECONDS = settings.time.sailingTimeScale * TICK_REAL_SECONDS;
const BROADCAST_EVERY = Math.max(
  1,
  Math.round(settings.server.tickHz / settings.server.broadcastHz),
);
const CENTRE = { x: 800, y: 4_700 };
const RADIUS_KM = 230;
const LEGS = 8;

function octagonPoint(leg: number): { x: number; y: number } {
  const angle = (leg / LEGS) * Math.PI * 2;
  return {
    x: CENTRE.x + Math.cos(angle) * RADIUS_KM,
    y: CENTRE.y + Math.sin(angle) * RADIUS_KM,
  };
}

function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function expectedCells(path: Array<{ x: number; y: number }>): Set<number> {
  const expected = new Set<number>();
  const sight = settings.fog.sightRangeKm;
  // One sample every 250 m is much denser than the 5 km discovery grid.
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const samples = Math.max(1, Math.ceil(length / 0.25));
    for (let step = 0; step <= samples; step += 1) {
      const t = step / samples;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const firstColumn = Math.max(0, Math.floor((x - sight) / chartCellKm));
      const lastColumn = Math.min(chartColumns - 1, Math.floor((x + sight) / chartCellKm));
      const firstRow = Math.max(0, Math.floor((y - sight) / chartCellKm));
      const lastRow = Math.min(chartRows - 1, Math.floor((y + sight) / chartCellKm));
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const nearestX = Math.max(
            column * chartCellKm,
            Math.min(x, (column + 1) * chartCellKm),
          );
          const nearestY = Math.max(
            row * chartCellKm,
            Math.min(y, (row + 1) * chartCellKm),
          );
          if ((nearestX - x) ** 2 + (nearestY - y) ** 2 > sight * sight) continue;
          expected.add(row * chartColumns + column);
        }
      }
    }
  }
  return expected;
}

function expectedAvailableBlocks(cells: ReadonlySet<number>): Set<string> {
  const found = new Set<string>();
  for (const cell of cells) {
    const id = blockIdForCell(cell);
    if (CHART_BLOCKS.has(id)) found.add(id);
  }
  return found;
}

interface SlowClient {
  memory: ReturnType<typeof createChartMemory>;
  pending: StateMessage[];
  received: number;
  flushed: number;
  dropped: number;
}

function newClient(): SlowClient {
  return { memory: createChartMemory(), pending: [], received: 0, flushed: 0, dropped: 0 };
}

function receive(client: SlowClient, state: StateMessage): void {
  client.received += 1;
  client.pending.push(state);
  // A slow tab has an update queue too. It keeps the newest 20, as the real
  // client caps its pending state list at 30 messages.
  while (client.pending.length > 20) {
    client.pending.shift();
    client.dropped += 1;
  }
}

function flush(client: SlowClient): void {
  if (client.pending.length === 0) return;
  const newest = newestStateWithEvents(client.pending);
  client.pending = [];
  client.flushed += 1;
  if (!newest) return;
  applyChartUpdate(client.memory, newest.chart);
}

function clientState(world: World, playerId: string, allowed = settings.fog.maxBlocksPerMessage): StateMessage {
  return visibleStateFor(world, playerId, CHART_BLOCKS, allowed);
}

test("a 1,400 km voyage keeps every sight-radius cell through a slow client and two reconnects", () => {
  const world = createWorld("test-3g-chart-coverage");
  const ship = addPlayer(world, "chart-voyager", "frigate", 50_000, "British");
  const owner = world.owners.get("chart-voyager")!;
  owner.routeLineEnabled = false;
  const start = octagonPoint(0);
  ship.x = start.x;
  ship.y = start.y;
  ship.headingRad = Math.PI / 2;
  ship.speedKnots = 0;
  ship.order = null;
  ship.route = null;
  ship.fleetId = null;
  // The test places the ship in open ocean after addPlayer's normal spawn.
  // Discover that new start circle, as the next server tick would.
  revealCircle(world.charts.get("chart-voyager")!, ship.x, ship.y);

  const client = newClient();
  const initial = clientState(world, "chart-voyager");
  receive(client, initial);
  flush(client);

  const path: Array<{ x: number; y: number }> = [{ x: ship.x, y: ship.y }];
  let leg = 1;
  let ticks = 0;
  let travelled = 0;
  let previous = { x: ship.x, y: ship.y };
  let reconnects = 0;
  const reconnectsAt = [0.25, 0.75];

  const target = octagonPoint(leg % LEGS);
  applyOrder(world, "chart-voyager", target.x, target.y, ship.id);

  while (travelled < 1_400 && ticks < 120_000) {
    stepWorld(world, DT_GAME_SECONDS);
    ticks += 1;
    const moved = Math.hypot(ship.x - previous.x, ship.y - previous.y);
    travelled += moved;
    previous = { x: ship.x, y: ship.y };
    path.push({ x: ship.x, y: ship.y });

    if (ticks % BROADCAST_EVERY === 0) {
      // The "slow client" is under backpressure: it still receives states but
      // its render loop coalesces them, as flushPendingState does.
      receive(client, clientState(world, "chart-voyager"));
      if (ticks % (BROADCAST_EVERY * 8) === 0) flush(client);
    }

    if (reconnects < reconnectsAt.length && travelled >= 1_400 * reconnectsAt[reconnects]!) {
      flush(client);
      requestChartResume(world, "chart-voyager");
      receive(client, clientState(world, "chart-voyager"));
      flush(client);
      reconnects += 1;
    }

    const waypoint = octagonPoint(leg % LEGS);
    if (Math.hypot(ship.x - waypoint.x, ship.y - waypoint.y) < 5) {
      leg += 1;
      const next = octagonPoint(leg % LEGS);
      applyOrder(world, "chart-voyager", next.x, next.y, ship.id);
    }
  }
  // One final broadcast covers the last few metres after the previous tick.
  receive(client, clientState(world, "chart-voyager"));
  flush(client);

  assert.ok(travelled >= 1_350, `only travelled ${Math.round(travelled)} km in ${ticks} ticks`);
  assert.ok(reconnects === 2, `expected two reconnects, got ${reconnects}`);

  const expected = expectedCells(path);
  const missing: number[] = [];
  for (const cell of expected) {
    if (!client.memory.discovered.has(cell)) missing.push(cell);
  }
  const missingDetail = missing.slice(0, 8).map((cell) => {
    const column = cell % chartColumns;
    const row = Math.floor(cell / chartColumns);
    return `${column},${row}`;
  });
  assert.equal(
    missing.length,
    0,
    `missing ${missing.length} of ${expected.size} sight cells (${missingDetail.join("; ")}); ` +
      `client received ${client.received}, flushed ${client.flushed}, dropped ${client.dropped}`,
  );

  const availableBlocks = expectedAvailableBlocks(client.memory.discovered);
  const content = chartContent(client.memory);
  const drawn = new Set(content.blocks.map((block: ChartBlock) => block.id));
  const missingBlocks = [...availableBlocks].filter((id) => !drawn.has(id));
  assert.deepEqual(missingBlocks, [], "chart blocks were capped or dropped");
  assert.equal(content.blocks.length, availableBlocks.size, "drawn chart blocks must equal discovered blocks");
  assert.ok(client.memory.discovered.size >= expected.size);
});
