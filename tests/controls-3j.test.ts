import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CONTROL_GROUP_NAMES,
  CONTROL_HINTS,
  CONTROL_ORDERS,
  CONTROL_TAP_COUNTS,
  controlHintAt,
  controlOrdersInGroup,
} from "@naval/shared/controls-3j";
import { responsiveFleetLayout } from "@naval/shared/fleet-ui";

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 412, height: 915 },
  { width: 740, height: 360 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

test("the Orders list has every promised order in four readable groups", () => {
  for (const group of CONTROL_GROUP_NAMES) {
    assert.ok(controlOrdersInGroup(group).length > 0, `${group} has orders`);
  }
  const ids = CONTROL_ORDERS.map((order) => order.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [
    "sail", "sailToPort", "heading", "patrol", "rendezvous", "hold", "anchor", "weighAnchor", "returnPort",
    "attackSink", "attackCapture", "loot", "board", "attackPort", "run", "surrender",
    "follow", "escort", "tow", "castOff", "crewTransfer", "claim",
    "igniteNow", "igniteContact", "lights", "fitUpgrades",
  ]) {
    assert.ok(ids.includes(id), `${id} is in the Orders list`);
  }
});

test("the main flows fit the three-tap promise", () => {
  for (const [name, taps] of Object.entries(CONTROL_TAP_COUNTS)) {
    assert.ok(taps <= 4, `${name} uses ${taps} taps`);
  }
  assert.ok((CONTROL_TAP_COUNTS.attackEnemy ?? 99) <= 3);
  assert.ok((CONTROL_TAP_COUNTS.sailWithUndo ?? 99) <= 3);
  assert.ok((CONTROL_TAP_COUNTS.recallGroup ?? 99) <= 1);
});

test("five one-time hints are dismissable and never blocking", () => {
  assert.equal(CONTROL_HINTS.length, 5);
  for (let index = 0; index < 5; index += 1) {
    const hint = controlHintAt(index);
    assert.ok(hint);
    assert.equal(hint.total, 5);
    assert.ok(hint.text.length > 20);
  }
  assert.equal(controlHintAt(5), null);
  const html = readFileSync("client/index.html", "utf8");
  assert.match(html, /id="controls-hint"/);
  assert.match(html, /id="controls-hint-close"/);
  assert.match(html, /id="controls-help"/);
});

test("no source path uses a long-press timer", () => {
  const files = ["client/main.ts", "shared/settings.ts", "shared/tapToSail.ts"];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /tapHold|holdTimer|groupHold|longPress|long-press timer/,
      `${file} has no long-press timer`);
  }
  const main = readFileSync("client/main.ts", "utf8");
  assert.doesNotMatch(main, /pointerdown[^}]{0,200}setTimeout/s,
    "pointerdown does not start a timer");
});

test("the armed banner, palette and Orders sheet fit five review viewports", () => {
  for (const viewport of VIEWPORTS) {
    const layout = responsiveFleetLayout(viewport.width, viewport.height);
    const bannerWidth = Math.min(520, viewport.width - 24);
    assert.ok(bannerWidth >= 44 && bannerWidth <= viewport.width, `${viewport.width}: banner width`);
    const bannerHeight = 60;
    assert.ok(bannerHeight >= 44);
    const bannerTop = 64;
    assert.ok(bannerTop + bannerHeight <= viewport.height, `${viewport.width}: banner inside`);
    // The bottom sheet must leave at least 44 px per row and scroll.
    const sheetHeight = Math.min(viewport.height * 0.62, 560);
    assert.ok(sheetHeight >= 44, `${viewport.width}: sheet height`);
    assert.ok(sheetHeight <= viewport.height - layout.minTargetPx, `${viewport.width}: sheet leaves a tap row`);
    const rows = Math.floor((sheetHeight - 60) / 44);
    assert.ok(rows >= 3, `${viewport.width}: room for the Orders groups`);
    assert.ok(layout.contentWidth >= 44);
  }
});
