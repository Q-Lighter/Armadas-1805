// 3F Part D: port screens fit the existing paper layout, markers stay hidden
// until found, and other players' ports never expose exact health.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPortBattlePanelModel,
  captureStripText,
  layoutPortMarkers,
  portScreenLayout,
  type PortInfo,
} from "@naval/shared/port-view";

const SIZES: Array<[number, number]> = [
  [360, 740],
  [412, 915],
  [740, 360],
  [768, 1024],
  [1280, 800],
];

function port(extra: Partial<PortInfo> = {}): PortInfo {
  return {
    id: "p1",
    name: "Port One",
    size: "M",
    npc: false,
    x: 10,
    y: 10,
    region: "Channel",
    good: "timber",
    found: true,
    owner: "other",
    ownerNavy: "French",
    tier: 2,
    condition: "Damaged",
    silenced: false,
    rangeKm: 20,
    health: 3200,
    maxHealth: 5000,
    stock: { timber: 100, repairMaterials: 40 },
    nextCost: { timber: 150, repairMaterials: 50 },
    guns: { heavy: 10, medium: 12, light: 8 },
    capture: { seconds: 80, requiredSeconds: 300, sideId: "me", reason: null },
    ...extra,
  };
}

test("port panel, strip and 44 px targets fit every requested viewport", () => {
  for (const [width, height] of SIZES) {
    const layout = portScreenLayout(width, height);
    assert.equal(layout.width, width);
    assert.equal(layout.height, height);
    assert.equal(layout.minTargetPx, 44, `${width}x${height}`);
    assert.equal(layout.panelScrolls, true);
    assert.ok(layout.panelWidth <= width - 16, `${width}x${height} panel width`);
    assert.ok(layout.panelMaxHeight >= 96, `${width}x${height} panel height`);
    assert.ok(layout.panelMaxHeight <= height - 24, `${width}x${height} panel max`);
    assert.ok(layout.stripWidth <= width - 24, `${width}x${height} strip width`);
    assert.equal(layout.overlapsStrip, false, `${width}x${height} strip overlap`);
    assert.ok(layout.panelTopLimit >= layout.stripBottom);
  }
});

test("exact port health, stock and guns are owner-only", () => {
  const own = buildPortBattlePanelModel({
    port: port({ owner: "me", ownerNavy: "British" }),
    viewerId: "me",
    roomKind: "test",
    gameMs: 0,
  });
  assert.equal(own.ownerText, "Your port");
  assert.equal(own.healthText, "3200 / 5000");
  assert.equal(own.healthShare, 0.64);
  assert.match(own.batteryText, /10\/12\/8/);
  assert.equal(own.showBuild, true);
  assert.match(own.buildText, /150 timber/);
  assert.equal(own.attackText, null);

  const foreign = buildPortBattlePanelModel({
    port: port(),
    viewerId: "me",
    roomKind: "normal",
    gameMs: 0,
  });
  assert.equal(foreign.ownerText, "French port");
  assert.equal(foreign.healthText, null);
  assert.equal(foreign.healthShare, null);
  assert.equal(foreign.conditionText, "Damaged");
  assert.equal(foreign.attackText, "Attack port");
  assert.equal(foreign.showBuild, false);
  assert.doesNotMatch(foreign.batteryText, /10\/12\/8/);
});

test("NPC ports are neutral ground and normal rooms need research", () => {
  const npc = buildPortBattlePanelModel({
    port: port({ npc: true, owner: null, ownerNavy: null }),
    viewerId: "me",
    roomKind: "normal",
    gameMs: 0,
  });
  assert.equal(npc.attackText, null);
  assert.match(npc.ownerText, /Neutral ground|not attackable/);

  const own = buildPortBattlePanelModel({
    port: port({ owner: "me", ownerNavy: "British", stock: { timber: 500, repairMaterials: 500 } }),
    viewerId: "me",
    roomKind: "normal",
    gameMs: 0,
  });
  assert.equal(own.buildButtonText, "Needs research");
  assert.equal(own.buildDisabled, true);
  assert.equal(own.attackText, null);
});

test("capture strip shows the countdown, then the blocking reason", () => {
  assert.equal(
    captureStripText({ ports: [port()], selectedPortId: "p1", viewerId: "me" }),
    "Capturing Port One: 3:40 left",
  );
  assert.equal(
    captureStripText({
      ports: [port({ silenced: true, capture: { seconds: 0, requiredSeconds: 300, sideId: "me", reason: "Enemy ships in range" } })],
      selectedPortId: "p1",
      viewerId: "me",
    }),
    "Capture blocked at Port One: Enemy ships in range",
  );
  assert.equal(
    captureStripText({ ports: [port({ capture: undefined })], selectedPortId: "p1", viewerId: "me" }),
    null,
  );
});

test("port markers exist only for ports this player has discovered", () => {
  const view = { x: 10, y: 10, kmAcross: 40 };
  const sight = [{ x: 10, y: 10, radiusKm: 5 }];
  const found = layoutPortMarkers({
    width: 800,
    height: 600,
    view,
    ports: [port()],
    sight,
  });
  assert.equal(found.length, 1);
  const hidden = layoutPortMarkers({
    width: 800,
    height: 600,
    view,
    ports: [port({ found: false })],
    sight,
  });
  assert.equal(hidden.length, 0);
});
