// Part C presentation rules, tested without Pixi or a browser.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  buildPortPanelModel,
  knownPortsNearest,
  layoutPortMarkers,
  type PortInfo,
} from "@naval/shared/port-view";
import { buildShipRenderPlan } from "@naval/shared/render-plan";

function port(id: string, size: PortInfo["size"], overrides: Partial<PortInfo> = {}): PortInfo {
  return {
    id,
    name: id,
    size,
    npc: false,
    x: 0,
    y: 0,
    region: "Greater Antilles",
    good: "sugar",
    found: true,
    ...overrides,
  };
}

function layout(
  ports: PortInfo[],
  kmAcross: number,
  sight: Array<{ x: number; y: number; radiusKm: number }> = [],
) {
  return layoutPortMarkers({
    width: 900,
    height: 700,
    view: { x: 0, y: 0, kmAcross },
    ports,
    sight,
  });
}

test("only found ports produce markers, and sight dims the ones outside", () => {
  const markers = layout(
    [
      port("found", "L", { x: 0, y: 0 }),
      port("hidden", "L", { x: 10, y: 0, found: false }),
      port("dim", "M", { x: 60, y: 0 }),
    ],
    100,
    [{ x: 0, y: 0, radiusKm: 25 }],
  );

  assert.deepEqual(markers.map((marker) => marker.id), ["found", "dim"]);
  assert.equal(markers[0]?.dimmed, false);
  assert.equal(markers[1]?.dimmed, true);

  const plan = buildShipRenderPlan({
    width: 900,
    height: 700,
    view: { x: 0, y: 0, kmAcross: 100 },
    blocks: [],
    all: false,
    discovered: new Set(),
    sight: [{ x: 0, y: 0, radiusKm: 25 }],
    ships: [],
    ports: [port("found", "L"), port("hidden", "L", { x: 10, found: false })],
  });
  assert.deepEqual(plan.ports.map((marker) => marker.id), ["found"]);
  assert.equal(plan.layers.find((layer) => layer.name === "ports")?.items, 1);
});

test("port labels follow the large, medium and small zoom rules", () => {
  const large = layout([port("large", "L")], 5_000)[0]!;
  const mediumFar = layout([port("medium-far", "M")], 5_000)[0]!;
  const mediumMid = layout([port("medium-mid", "M")], 100)[0]!;
  const smallMid = layout([port("small-mid", "S")], 100)[0]!;
  const smallClose = layout([port("small-close", "S")], 30)[0]!;

  assert.equal(large.labelVisible, true);
  assert.equal(mediumFar.labelVisible, false);
  assert.equal(mediumMid.labelVisible, true);
  assert.equal(smallMid.labelVisible, false);
  assert.equal(smallClose.labelVisible, true);
  for (const marker of [large, mediumMid, smallClose]) {
    assert.ok(marker.labelBounds, `${marker.id} needs label bounds`);
    assert.ok(marker.labelBounds.width > 0 && marker.labelBounds.height > 0);
  }
});

test("labels are shifted or hidden rather than overlapping", () => {
  const markers = layout(
    [
      port("one", "L", { x: 0, y: 0 }),
      port("two", "L", { x: 1, y: 0 }),
      port("three", "L", { x: 2, y: 0 }),
    ],
    40,
  );
  const boxes = markers
    .map((marker) => marker.labelBounds)
    .filter((box): box is NonNullable<typeof box> => box !== null);
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const one = boxes[a]!;
      const two = boxes[b]!;
      const overlap =
        one.x < two.x + two.width &&
        one.x + one.width > two.x &&
        one.y < two.y + two.height &&
        one.y + one.height > two.y;
      assert.equal(overlap, false, "labels must not overlap");
    }
  }
});

test("the port panel shows the right facts and buttons", () => {
  const base = port("port-havana", "L", {
    name: "Havana",
    npc: true,
    region: "Greater Antilles",
    good: "tobacco",
    freePlaces: 12,
  });

  const sailing = buildPortPanelModel({
    port: base,
    distanceKm: 18.6,
    dockedHere: false,
    hasShip: true,
  });
  assert.equal(sailing.title, "Havana");
  assert.equal(sailing.sizeLabel, "Large port");
  assert.equal(sailing.status, "Neutral port: anyone may dock");
  assert.equal(sailing.region, "Greater Antilles");
  assert.equal(sailing.good, "tobacco");
  assert.deepEqual(sailing.buttons, ["sail"]);
  assert.equal(sailing.freeText, null, "free places stay hidden when not docked");
  assert.equal(sailing.distanceText, "19 km from your ship");

  const docked = buildPortPanelModel({
    port: base,
    distanceKm: 0,
    dockedHere: true,
    hasShip: true,
  });
  assert.deepEqual(docked.buttons, ["undock"]);
  assert.equal(docked.freeText, `12 places free of ${settings.ports.sizes.L.dockingCapacity}`);

  const unowned = buildPortPanelModel({
    port: port("port-kingston", "M", { npc: false }),
    distanceKm: null,
    dockedHere: false,
    hasShip: false,
  });
  assert.equal(unowned.status, "Unclaimed");
  assert.deepEqual(unowned.buttons, []);
});

test("Known ports are nearest first", () => {
  const sorted = knownPortsNearest(
    [
      port("far", "S", { name: "Far", x: 200, y: 0 }),
      port("near", "S", { name: "Near", x: 20, y: 0 }),
      port("middle", "M", { name: "Middle", x: 80, y: 0 }),
    ],
    { x: 0, y: 0 },
  );
  assert.deepEqual(sorted.map((entry) => entry.name), ["Near", "Middle", "Far"]);
});
