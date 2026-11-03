// Part B: navies, port discovery and docking. Everything here runs against the
// authoritative shared world, without a browser or a socket.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { isSeaAt } from "@naval/shared/land";
import { shipSpecFor } from "@naval/shared/sailing";
import { NAVY_IDS, parseNavy, type NavyId } from "@naval/shared/navies";
import { findPortByName } from "@naval/shared/ports";
import {
  PORT_FULL_NOTICE,
  addPlayer,
  applyOrder,
  applyPortOrder,
  createWorld,
  stepWorld,
  takeNotice,
  undock,
  visibleStateFor,
} from "@naval/shared/world";

const DEG = Math.PI / 180;

function pointNear(point: { x: number; y: number }, distanceKm: number) {
  for (let ray = 0; ray < 72; ray += 1) {
    const angle = (ray / 72) * Math.PI * 2;
    const candidate = {
      x: point.x + Math.sin(angle) * distanceKm,
      y: point.y - Math.cos(angle) * distanceKm,
    };
    if (isSeaAt(candidate.x, candidate.y)) return candidate;
  }
  throw new Error(`no sea ${distanceKm} km from ${point.x},${point.y}`);
}

function markFound(world: ReturnType<typeof createWorld>, playerId: string, portId: string): void {
  world.charts.get(playerId)!.foundPorts.add(portId);
}

test("the four navies have their real starts, colours and flagship speeds", () => {
  assert.deepEqual(NAVY_IDS, ["British", "Dutch", "Spanish", "French"]);
  assert.equal(parseNavy("british"), "British");
  assert.equal(parseNavy("DUTCH"), "Dutch");
  assert.equal(parseNavy("spanish"), "Spanish");
  assert.equal(parseNavy("french"), "French");
  assert.equal(parseNavy("swedish"), null);

  const expected: Record<NavyId, { lon: number; lat: number; knots: number; color: string }> = {
    British: { lon: -79.5, lat: 13, knots: 6, color: "#9b2d2d" },
    Dutch: { lon: -45, lat: 3, knots: 5.5, color: "#d9822b" },
    Spanish: { lon: -50, lat: -37.5, knots: 5.5, color: "#c9a227" },
    French: { lon: -84, lat: -10, knots: 6.5, color: "#2f4f8f" },
  };

  for (const navy of NAVY_IDS) {
    const config = settings.navies[navy];
    assert.equal(config.start.lonDeg, expected[navy].lon);
    assert.equal(config.start.latDeg, expected[navy].lat);
    assert.equal(config.flagshipCruiseKnots, expected[navy].knots);
    assert.equal(config.hullColor, expected[navy].color);

    const world = createWorld("main", { navy });
    const ship = addPlayer(world, `player-${navy}`);
    assert.equal(world.navy, "British", "normal rooms use British for now");
    assert.equal(ship.navy, "British");
    assert.equal(ship.classId, "flagship");

    const testWorld = createWorld("test-navy", { navy });
    const testShip = addPlayer(testWorld, `tester-${navy}`);
    assert.equal(testWorld.navy, navy);
    assert.equal(testShip.navy, navy);
    assert.equal(testShip.classId, "frigate");
    assert.equal(shipSpecFor(testShip).cruiseKnots, 9, "frigates keep their own table");

    const flagship = { classId: "flagship" as const, navy };
    assert.equal(shipSpecFor(flagship).cruiseKnots, config.flagshipCruiseKnots);
  }
});

test("test rooms start about 40 km by sea from the navy's first NPC port", () => {
  const firstPorts: Record<NavyId, string> = {
    British: "Montego Bay",
    Dutch: "Belem",
    Spanish: "Maldonado",
    French: "Paita",
  };

  for (const navy of NAVY_IDS) {
    const world = createWorld("test-start", { navy });
    const ship = addPlayer(world, `start-${navy}`);
    assert.equal(world.startPort?.name, firstPorts[navy]);
    assert.equal(isSeaAt(ship.x, ship.y), true, `${navy} start is sea`);
    const port = findPortByName(firstPorts[navy])!;
    const distance = Math.hypot(ship.x - port.anchorage.x, ship.y - port.anchorage.y);
    assert.ok(distance >= 34 && distance <= 46, `${navy} start was ${distance.toFixed(1)} km`);
  }
});

test("the start port option works in test and dev rooms, including any found port", () => {
  for (const room of ["test-anywhere", "dev-anywhere"]) {
    for (const name of ["Havana", "Callao", "Cape Town"]) {
      if (name === "Cape Town") {
        assert.equal(findPortByName(name), null);
        continue;
      }
      const port = findPortByName(name)!;
      const world = createWorld(room, {
        navy: "French",
        startPort: port,
      });
      const ship = addPlayer(world, `somewhere-${room}-${name}`);
      assert.equal(world.startPort?.id, port.id);
      const distance = Math.hypot(ship.x - port.anchorage.x, ship.y - port.anchorage.y);
      assert.ok(distance >= 34 && distance <= 46, `${name} start was ${distance.toFixed(1)} km`);
      assert.equal(isSeaAt(ship.x, ship.y), true);
    }
  }
});

test("ports are hidden until a ship's sight circle reaches the anchorage", () => {
  const port = findPortByName("Montego Bay")!;
  const world = createWorld();
  const alpha = addPlayer(world, "alpha");
  addPlayer(world, "beta");

  const before = visibleStateFor(world, "alpha");
  assert.ok(!before.ports.some(([id]) => id === port.id), "unfound port was sent");
  assert.equal(world.charts.get("alpha")!.foundPorts.has(port.id), false);

  // Exactly at the 25 km edge counts as found.
  const edge = pointNear(port.anchorage, settings.fog.sightRangeKm);
  alpha.x = edge.x;
  alpha.y = edge.y;
  const atEdge = visibleStateFor(world, "alpha");
  assert.ok(atEdge.ports.some(([id, name]) => id === port.id && name === "Montego Bay"));
  assert.equal(world.charts.get("beta")!.foundPorts.has(port.id), false, "charts are private");

  // It stays known after the ship leaves, and the hidden ship is not leaked.
  alpha.x = port.anchorage.x + 100;
  alpha.y = port.anchorage.y;
  const later = visibleStateFor(world, "alpha");
  assert.ok(later.ports.some(([id]) => id === port.id));
  assert.ok(!later.ships.some(([id]) => id === "beta"));

  const dev = createWorld("dev-ports");
  addPlayer(dev, "alpha");
  assert.equal(visibleStateFor(dev, "alpha").ports.length, 89);
});

test("a sail-to-port order is refused until that port has been found", () => {
  const port = findPortByName("Havana")!;
  const world = createWorld("test-order");
  const ship = addPlayer(world, "alpha");
  const near = pointNear(port.anchorage, 1);
  ship.x = near.x;
  ship.y = near.y;

  assert.equal(applyPortOrder(world, "alpha", port.id), false);

  markFound(world, "alpha", port.id);
  assert.equal(applyPortOrder(world, "alpha", port.id), true);
  assert.equal(ship.dockedPortId, port.id);

  const state = visibleStateFor(world, "alpha");
  const snapshot = state.ports.find(([id]) => id === port.id)!;
  assert.equal(snapshot[2], port.size);
  assert.equal(snapshot[3], port.npc ? 1 : 0);
  assert.equal(snapshot[6], port.region);
  assert.equal(snapshot[7], port.good);
  assert.equal(
    snapshot[8],
    settings.ports.sizes.L.dockingCapacity - 1,
    "a large port reports its free places after my ship docks",
  );
});

test("docking fills a small port, queues the next ship and undocking frees a place", () => {
  const port = findPortByName("Montego Bay")!;
  assert.equal(port.size, "S");
  const world = createWorld();
  const players = ["one", "two", "three", "four", "five"];

  for (const id of players) {
    const ship = addPlayer(world, id);
    const near = pointNear(port.anchorage, 1);
    ship.x = near.x;
    ship.y = near.y;
    markFound(world, id, port.id);
    assert.equal(applyPortOrder(world, id, port.id), true);
  }

  const docked = players.slice(0, settings.ports.sizes.S.dockingCapacity);
  const waiting = players[settings.ports.sizes.S.dockingCapacity]!;
  for (const id of docked) {
    const ship = world.players.get(id)!;
    assert.equal(ship.dockedPortId, port.id);
    assert.equal(ship.waitingPortId, null);
    assert.equal(takeNotice(world, id), `Docked at ${port.name}.`);
  }

  const waitingShip = world.players.get(waiting)!;
  assert.equal(waitingShip.dockedPortId, null);
  assert.equal(waitingShip.waitingPortId, port.id);
  assert.equal(takeNotice(world, waiting), PORT_FULL_NOTICE);

  // A docked ship cannot sail, and the waiting ship gets the free place first.
  const first = world.players.get("one")!;
  assert.equal(applyOrder(world, "one", first.x + 10, first.y), false);
  assert.equal(applyPortOrder(world, "one", port.id), false);
  assert.equal(undock(world, "one"), true);
  assert.equal(takeNotice(world, "one"), `Undocked from ${port.name}.`);
  assert.equal(first.dockedPortId, null);

  // The retry is measured in real seconds, so run at least that much game time.
  for (let tick = 0; tick < 60; tick += 1) {
    stepWorld(world, settings.time.sailingTimeScale / settings.server.tickHz);
    if (waitingShip.dockedPortId) break;
  }
  assert.equal(waitingShip.dockedPortId, port.id);
  assert.equal(waitingShip.waitingPortId, null);
  assert.equal(takeNotice(world, waiting), `Docked at ${port.name}.`);

  // With a berth free, a docked ship's state carries the free-place count.
  const state = visibleStateFor(world, "two");
  const snapshot = state.ports.find(([id]) => id === port.id)!;
  assert.equal(snapshot[8], 0);

  // The undocked ship can sail again.
  assert.equal(applyOrder(world, "one", first.x + 10, first.y), true);
});
