// Part C: 3D screen plans and five-viewport fit.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  abandonedMarkerSize,
  boardSheet,
  boardingProgress,
  capturedCrewSheet,
  crewQuickAmounts,
  crewSheetLayout,
  crewTransferSheet,
  fireRow,
  prisonerHandoverRow,
  visibleCrewEffects,
} from "@naval/shared/crew-ui";

const VIEWPORTS: Array<[number, number]> = [
  [360, 740],
  [412, 915],
  [740, 360],
  [768, 1024],
  [1280, 800],
];

test("every 3D sheet fits the five review viewports without overlap", () => {
  for (const [width, height] of VIEWPORTS) {
    const layout = crewSheetLayout(width, height);
    assert.equal(layout.minTargetPx, 44);
    assert.ok(layout.contentWidth > 0);
    assert.ok(layout.maxHeight > 0);
    assert.ok(layout.contentWidth <= width);
    assert.ok(layout.maxHeight <= height);
    assert.equal(layout.margin * 2 + layout.contentWidth, width);
    assert.ok(layout.columns === 1 || layout.columns === 2);
    assert.equal(layout.scrolls, true);
  }
});

test("the Board sheet shows odds rounded to 5 percent", () => {
  const sheet = boardSheet({ targetName: "Superb", targetClass: "French line", chance: 0.62 });
  assert.equal(sheet.oddsText, "Odds: about 60%");
  assert.equal(sheet.canBoard, true);
  assert.equal(boardSheet({ targetName: "X", targetClass: "frigate", chance: null }).canBoard, false);
});

test("crew transfer quick buttons keep the donor at 10% and receiver at full", () => {
  const quick = crewQuickAmounts(100, 0, 230);
  assert.equal(quick.find((item) => item.id === "minimum")?.amount, 23);
  assert.equal(quick.find((item) => item.id === "half")?.amount, 45);
  assert.equal(quick.find((item) => item.id === "full")?.amount, 90);
  const claim = crewTransferSheet({
    donorName: "A",
    receiverName: "Prize",
    donorCrew: 100,
    receiverCrew: 0,
    receiverFullCrew: 230,
    claim: true,
  });
  assert.match(claim.hint, /23/);
});

test("captured crew sheet shows the limit, overflow and 120 second default", () => {
  const sheet = capturedCrewSheet({ captured: 100, fullCrew: 230 });
  assert.equal(sheet.limit, 46);
  assert.match(sheet.overflowRule, /46/);
  assert.match(sheet.defaultText, /120s/);
  assert.match(sheet.prisonerLabel, /46/);
});

test("the port panel shows the prisoner bounty total", () => {
  const row = prisonerHandoverRow(40);
  assert.equal(row.shown, true);
  assert.equal(row.total, 800);
  assert.equal(prisonerHandoverRow(0).shown, false);
});

test("fire and boarding rows use public-only values", () => {
  assert.equal(fireRow(true, 74).status, "Fighting fire");
  assert.equal(fireRow(false, 0).shown, false);
  const progress = boardingProgress(0.5, 45);
  assert.equal(progress.label, "Boarding · 45s");
  assert.equal(progress.progress, 0.5);
});

test("abandoned markers stay cheap and within a small pixel range", () => {
  const sizes = [5, 60, 300].map(abandonedMarkerSize);
  assert.ok(sizes.every((size) => size >= 8 && size <= 22));
  assert.ok(sizes[0]! > sizes[2]!);
});

test("crew effects draw only for visible ships", () => {
  const own = [{ x: 0, y: 0 }];
  const visible = visibleCrewEffects(
    [{ x: 1, y: 1 }, { x: 40, y: 40 }],
    own,
  );
  assert.equal(visible.length, 1);
});
