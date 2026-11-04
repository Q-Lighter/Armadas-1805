// Integration tests: a player's order uses the shared route planner, and the
// resulting waypoints are private to that player's own fleet snapshots.

import assert from "node:assert/strict";
import { test } from "node:test";

import { isLandAt } from "@naval/shared/land";
import { lonLatToMap } from "@naval/shared/map";
import { findPortByName } from "@naval/shared/ports";
import { ROUTE_LAND } from "@naval/shared/route";
import type { ShipRoute } from "@naval/shared/sailing";
import {
  addPlayer,
  applyOrder,
  applyPortOrder,
  createWorld,
  takeNotice,
  visibleStateFor,
} from "@naval/shared/world";

const KINGSTON = { x: 1228.266, y: 336.491 };
const MONTEGO_BAY = { x: 1164.681, y: 304.31 };

function chartEverything(world: ReturnType<typeof createWorld>, playerId: string): void {
  world.charts.get(playerId)!.bits.fill(0xff);
}

test("a sail-to order installs a clear planned route on the selected ship", () => {
  const world = createWorld("test-route");
  const ship = addPlayer(world, "alpha");
  ship.x = KINGSTON.x;
  ship.y = KINGSTON.y;
  ship.order = null;
  ship.route = null;
  chartEverything(world, "alpha");

  assert.equal(applyOrder(world, "alpha", MONTEGO_BAY.x, MONTEGO_BAY.y), true);
  const route = ship.route as ShipRoute | null;
  assert.ok(route, "the selected ship has a route");
  assert.equal(route.kind, "point");
  assert.ok(route.waypoints.length > 1, "the route detours around Jamaica");
  assert.equal(route.waypoints.every((point) => !isLandAt(point.x, point.y)), true);

  const state = visibleStateFor(world, "alpha");
  const own = state.fleet.find((row) => row.id === ship.id)!;
  assert.equal(own.route?.length, route.waypoints.length);
  assert.deepEqual(own.route?.[0], [
    Number(route.waypoints[0]!.x.toFixed(2)),
    Number(route.waypoints[0]!.y.toFixed(2)),
  ]);
});

test("route waypoints are sent only in the owner's fleet snapshot", () => {
  const world = createWorld("test-route");
  const alpha = addPlayer(world, "alpha");
  addPlayer(world, "beta");
  alpha.x = KINGSTON.x;
  alpha.y = KINGSTON.y;
  chartEverything(world, "alpha");
  assert.equal(applyOrder(world, "alpha", MONTEGO_BAY.x, MONTEGO_BAY.y), true);

  const alphaState = visibleStateFor(world, "alpha");
  const betaState = visibleStateFor(world, "beta");
  assert.ok(alphaState.fleet.find((row) => row.id === alpha.id)?.route?.length);
  assert.equal(betaState.fleet.every((row) => row.route === null), true);
});

test("a sail-to-port order plans a route to the anchorage", () => {
  const port = findPortByName("Montego Bay")!;
  const world = createWorld("test-route");
  const ship = addPlayer(world, "alpha");
  ship.x = KINGSTON.x;
  ship.y = KINGSTON.y;
  ship.order = null;
  ship.route = null;
  chartEverything(world, "alpha");
  world.charts.get("alpha")!.foundPorts.add(port.id);

  assert.equal(applyPortOrder(world, "alpha", port.id), true);
  assert.equal(ship.portOrderId, port.id);
  const route = ship.route as ShipRoute | null;
  assert.ok(route, "a port route exists");
  assert.equal(route.kind, "port");
  assert.equal(route.portId, port.id);
  const last = route.waypoints[route.waypoints.length - 1]!;
  assert.ok(Math.hypot(last.x - port.anchorage.x, last.y - port.anchorage.y) < 4);
});

test("a known land destination is refused with the route message", () => {
  const world = createWorld("test-route");
  const ship = addPlayer(world, "alpha");
  ship.x = KINGSTON.x;
  ship.y = KINGSTON.y;
  ship.order = null;
  ship.route = null;
  chartEverything(world, "alpha");

  const land = lonLatToMap(-77.3, 18.1);
  assert.equal(applyOrder(world, "alpha", land.x, land.y), false);
  assert.equal(ship.order, null);
  assert.equal(ship.route, null);
  assert.equal(takeNotice(world, "alpha"), ROUTE_LAND);
});
