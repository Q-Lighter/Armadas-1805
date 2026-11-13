// Own-ship journeys: start, keep while docked, end on loss, trail caps and
// private incremental updates. No browser and no other player's data.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { findPortByName } from "@naval/shared/ports";
import { isSeaAt } from "@naval/shared/land";
import {
  addPlayer,
  applyOrder,
  applyPortOrder,
  clearPlayerTrails,
  createWorld,
  endPlayerJourney,
  stepWorld,
  undock,
  visibleStateFor,
} from "@naval/shared/world";
import { recordJourneys, simplifyTrail, startJourney, trailIdsForMode } from "@naval/shared/journey";

const TICK = settings.time.sailingTimeScale / settings.server.tickHz;

function near(point: { x: number; y: number }, km: number): { x: number; y: number } {
  for (let ray = 0; ray < 72; ray += 1) {
    const angle = (ray / 72) * Math.PI * 2;
    const candidate = {
      x: point.x + Math.sin(angle) * km,
      y: point.y - Math.cos(angle) * km,
    };
    if (isSeaAt(candidate.x, candidate.y)) return candidate;
  }
  throw new Error("no nearby sea");
}

function dockedShip(label: string) {
  const port = findPortByName("Montego Bay")!;
  const world = createWorld(`test-journey-${label}`);
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  const sea = near(port.anchorage, 1);
  ship.x = sea.x;
  ship.y = sea.y;
  world.charts.get("alpha")!.foundPorts.add(port.id);
  assert.equal(applyPortOrder(world, "alpha", port.id), true);
  assert.equal(ship.dockedPortId, port.id);
  return { world, ship, port };
}

test("a journey starts at undock and docking keeps it", () => {
  const { world, ship, port } = dockedShip("undock");
  assert.equal(undock(world, "alpha"), true);
  const journey = world.owners.get("alpha")!.journeys.get(ship.id)!;
  assert.ok(journey);
  assert.equal(journey.trail.length, 1);
  // Docking does not end the record.
  ship.dockedPortId = port.id;
  ship.x = port.anchorage.x;
  ship.y = port.anchorage.y;
  recordJourneys(world);
  assert.ok(world.owners.get("alpha")!.journeys.has(ship.id));
  assert.equal(visibleStateFor(world, "alpha").fleet[0]!.journey?.distanceKm, 0);
});

test("a first order at sea starts a journey and moves add trail points", () => {
  const world = createWorld("test-journey-order");
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  ship.fleetId = null;
  ship.order = null;
  ship.route = null;
  const start = { x: 1_693.8, y: 442.4 };
  ship.x = start.x;
  ship.y = start.y;
  ship.headingRad = 315 * Math.PI / 180;
  assert.equal(applyOrder(world, "alpha", start.x + 10, start.y), true);
  const owner = world.owners.get("alpha")!;
  assert.ok(owner.journeys.has(ship.id));
  for (let tick = 0; tick < 80; tick += 1) stepWorld(world, TICK, 315);
  const journey = owner.journeys.get(ship.id)!;
  assert.ok(journey.distanceKm > 0.5);
  assert.ok(journey.trail.length > 1);
});

test("sinking, capture or abandonment ends the trail and leaves an X", () => {
  const world = createWorld("test-journey-loss");
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  const startX = ship.x;
  startJourney(world, "alpha", ship);
  ship.x += 4;
  recordJourneys(world);
  const owner = world.owners.get("alpha")!;
  assert.ok(owner.journeys.has(ship.id));
  ship.abandoned = true;
  recordJourneys(world);
  assert.equal(owner.journeys.has(ship.id), false);
  assert.equal(owner.lostMarks.length, 1);
  assert.ok(owner.lostMarks[0]!.x > startX);
});

test("the 3000 point cap thins the older half and the send path stays at 300", () => {
  const world = createWorld("test-journey-cap");
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  ship.fleetId = null;
  startJourney(world, "alpha", ship);
  const owner = world.owners.get("alpha")!;
  const journey = owner.journeys.get(ship.id)!;
  journey.trail = Array.from({ length: settings.journey.maxTrailPoints }, (_, index) => ({
    x: 1_600 + index * 0.01,
    y: 400,
  }));
  ship.x = 1_600 + 40;
  ship.y = 400;
  recordJourneys(world);
  assert.ok(journey.trail.length <= settings.journey.maxTrailPoints);
  assert.ok(journey.trail.length < settings.journey.maxTrailPoints, "the old half was thinned");
  assert.ok(simplifyTrail(journey.trail).length <= settings.journey.maxSentPoints);

  const full = visibleStateFor(world, "alpha");
  const row = full.fleet.find((entry) => entry.id === ship.id)!;
  assert.ok(row.trail && row.trail.length <= settings.journey.maxSentPoints);
  assert.equal(full.trailAdds, undefined);
  console.log(`TRAIL SIZES full ${JSON.stringify(row.trail).length} bytes for ${row.trail!.length} points`);
  assert.ok(JSON.stringify(row.trail).length < 6_000);

  journey.trail.push({ x: ship.x, y: ship.y + 1 });
  const incremental = visibleStateFor(world, "alpha", undefined, 10, false);
  assert.ok((incremental.trailAdds?.[ship.id]?.length ?? 0) <= settings.journey.maxTrailUpdatePoints);
});

test("manual stop clears the trail, all clear works, and reconnect resends the path", () => {
  const world = createWorld("test-journey-stop");
  const ship = addPlayer(world, "alpha", "frigate", 50_000, "British");
  startJourney(world, "alpha", ship);
  ship.x += 2;
  recordJourneys(world);
  assert.ok(world.owners.get("alpha")!.journeys.has(ship.id));
  assert.equal(endPlayerJourney(world, "alpha", ship.id), true);
  assert.equal(world.owners.get("alpha")!.journeys.has(ship.id), false);
  assert.equal(visibleStateFor(world, "alpha").fleet[0]!.trail, null);
  assert.equal(visibleStateFor(world, "alpha").fleet[0]!.journey, null);

  startJourney(world, "alpha", ship);
  ship.y += 2;
  recordJourneys(world);
  assert.equal(clearPlayerTrails(world, "alpha"), 1);
  assert.equal(world.owners.get("alpha")!.journeys.size, 0);

  startJourney(world, "alpha", ship);
  ship.x += 3;
  recordJourneys(world);
  world.trailSent.delete("alpha");
  const reconnected = visibleStateFor(world, "alpha");
  assert.ok(reconnected.fleet[0]!.trail && reconnected.fleet[0]!.trail!.length > 0);
});

test("journeys and trail updates contain only my ships", () => {
  const world = createWorld("test-journey-private");
  const mine = addPlayer(world, "alpha", "frigate", 50_000, "British");
  const other = addPlayer(world, "beta", "frigate", 50_000, "French");
  startJourney(world, "alpha", mine);
  startJourney(world, "beta", other);
  mine.x += 2;
  other.x += 2;
  recordJourneys(world);
  const full = visibleStateFor(world, "alpha", undefined, 10, true);
  assert.equal(full.fleet.some((row) => row.id === other.id), false);
  assert.equal(full.lostMarks, undefined);
  mine.x += 2;
  other.x += 2;
  recordJourneys(world);
  const incremental = visibleStateFor(world, "alpha", undefined, 10, false);
  assert.deepEqual(Object.keys(incremental.trailAdds ?? {}), [mine.id]);
  console.log(`TRAIL SIZES increment ${JSON.stringify(incremental.trailAdds ?? {}).length} bytes`);
  assert.ok(JSON.stringify(incremental.trailAdds ?? {}).length < 2_000);
});

test("the Chart trail control defaults to selected and filters own ships", () => {
  assert.equal(settings.journey.defaultChartTrail, "selected");
  assert.deepEqual(trailIdsForMode("selected", ["a", "b", "c"], ["c", "a"]), ["c", "a"]);
  assert.deepEqual(trailIdsForMode("all", ["a", "b"], ["a"]), ["a", "b"]);
  assert.deepEqual(trailIdsForMode("none", ["a"], ["a"]), []);
  assert.deepEqual(trailIdsForMode("selected", ["a"], ["foreign"]), []);
});
