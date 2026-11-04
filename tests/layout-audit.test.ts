// Runtime layout audit fallback. These use plain measured rectangles.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  auditLayout,
  layoutIssueSummary,
  type LayoutAuditElement,
} from "@naval/shared/layout-audit";

function element(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  overrides: Partial<LayoutAuditElement> = {},
): LayoutAuditElement {
  return {
    id,
    group: "top",
    rect: { left, top, right: left + width, bottom: top + height },
    interactive: false,
    scrollWidth: width,
    clientWidth: width,
    scrollHeight: height,
    clientHeight: height,
    ...overrides,
  };
}

test("the layout audit reports an element outside the viewport", () => {
  const issues = auditLayout([element("edge", 350, 10, 44, 44)], { width: 360, height: 740 }, 44);
  assert.equal(issues.filter((issue) => issue.kind === "outside").length, 1);
});

test("the layout audit reports overlapping siblings in one group", () => {
  const issues = auditLayout(
    [element("a", 10, 10, 44, 44), element("b", 40, 10, 44, 44)],
    { width: 360, height: 740 },
    44,
  );
  assert.equal(issues.some((issue) => issue.kind === "overlap"), true);
});

test("different groups may be near each other without an overlap report", () => {
  const issues = auditLayout(
    [
      element("top", 10, 10, 44, 44, { group: "top" }),
      element("ship", 10, 20, 44, 44, { group: "ship" }),
    ],
    { width: 360, height: 740 },
    44,
  );
  assert.equal(issues.some((issue) => issue.kind === "overlap"), false);
});

test("the layout audit reports small targets and clipped text", () => {
  const issues = auditLayout(
    [
      element("small", 10, 10, 30, 30, { interactive: true }),
      element("clip", 100, 10, 80, 44, { scrollWidth: 140 }),
    ],
    { width: 360, height: 740 },
    44,
  );
  assert.equal(issues.some((issue) => issue.kind === "small-target"), true);
  assert.equal(issues.some((issue) => issue.kind === "clipped"), true);
});

test("a clean frame and its summary read cleanly", () => {
  const issues = auditLayout([element("ok", 10, 10, 44, 44, { interactive: true })], { width: 360, height: 740 }, 44);
  assert.deepEqual(issues, []);
  assert.equal(layoutIssueSummary(issues), "Layout audit: clean");
});
