// The renderer and these tests share one pure command list. A stitched coast
// is therefore visible in a test without a browser, and a fill that covers sea
// cannot hide behind a midpoint-only geometry check.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CHART_BLOCKS } from "@naval/shared/chart-blocks";
import {
  auditChartCommands,
  buildBlockCommands,
  buildChartCommands,
  MAX_COAST_SEGMENT_KM,
  splitLongLine,
  type ChartCommands,
} from "@naval/shared/chart-paint";
import { isLandAt } from "@naval/shared/land";
import type { ChartBlock } from "@naval/shared/fog";

function block(
  id: string,
  x: number,
  y: number,
  fill: number[][] = [],
  coast: number[][] = [],
): ChartBlock {
  return { id, x, y, km: 25, fill, coast };
}

function inArea(block: ChartBlock, area: { minX: number; maxX: number; minY: number; maxY: number }): boolean {
  return (
    block.x + block.km >= area.minX &&
    block.x <= area.maxX &&
    block.y + block.km >= area.minY &&
    block.y <= area.maxY
  );
}

const areas = {
  "Montego Bay and western Jamaica": { minX: 1110, maxX: 1205, minY: 260, maxY: 350 },
  "Kingston and the south Jamaica coast": { minX: 1185, maxX: 1285, minY: 295, maxY: 390 },
  "the Windward Passage": { minX: 1220, maxX: 1345, minY: 170, maxY: 290 },
  "the Mosquito Coast near Bluefields": { minX: 810, maxX: 910, minY: 610, maxY: 730 },
};

test("a long source segment is split without changing its path", () => {
  const line = [0, 0, 13, 0, 13, 7];
  const split = splitLongLine(line);
  assert.deepEqual(split.slice(0, 2), [0, 0]);
  assert.deepEqual(split.slice(-2), [13, 7]);
  for (let i = 0; i + 3 < split.length; i += 2) {
    assert.ok(
      Math.hypot(split[i + 2]! - split[i]!, split[i + 3]! - split[i + 1]!) <= MAX_COAST_SEGMENT_KM + 1e-9,
    );
  }
});

test("the audit catches a stitch that the old midpoint-only check missed", () => {
  const stitched = block("0_0", 0, 0, [], [[2, 2, 12, 2]]);
  const commands: ChartCommands = {
    fills: [],
    strokes: [
      {
        kind: "stroke",
        blockId: stitched.id,
        line: stitched.coast[0]!,
        layer: "coast",
        widthPx: 1,
      },
    ],
  };
  const report = auditChartCommands(commands, {
    blocks: [stitched],
    isLandAt: () => true,
  });
  assert.equal(report.stitches, 1);
});

test("the audit catches a whole-block fill only when the lookup has sea", () => {
  const full = block("0_0", 0, 0, [[0, 0, 25, 0, 25, 25, 0, 25]]);
  const commands = buildBlockCommands(full, 1, 1);
  const landOnly = auditChartCommands(commands, {
    blocks: [full],
    isLandAt: () => true,
  });
  assert.equal(landOnly.fullBlockFills, 0);

  const withSea = auditChartCommands(commands, {
    blocks: [full],
    isLandAt: () => false,
  });
  assert.equal(withSea.fullBlockFills, 1);
});

test("the audit catches a fill with the wrong winding", () => {
  const wrong = block("0_0", 0, 0, [[0, 0, 0, 25, 25, 25, 25, 0]]);
  const commands = buildBlockCommands(wrong, 1, 1);
  // The command builder normalises winding; replace its ring with the raw
  // clockwise one to prove the audit itself still catches the defect.
  commands.fills[0]!.ring = wrong.fill[0]!;
  const report = auditChartCommands(commands, {
    blocks: [wrong],
    isLandAt: () => true,
  });
  assert.equal(report.wrongWinding, 1);
});

test("real chart areas have no drawn stitches, whole-block sea fills or wrong winding", () => {
  const allIds = new Set(CHART_BLOCKS.keys());
  for (const [name, area] of Object.entries(areas)) {
    const blocks = [...CHART_BLOCKS.values()].filter((candidate) => inArea(candidate, area));
    assert.ok(blocks.length > 0, `${name}: no blocks`);
    const commands = buildChartCommands(blocks, 7, 1.5);
    const report = auditChartCommands(commands, {
      blocks,
      isLandAt,
      presentBlockIds: allIds,
    });
    console.log(
      `${name}: ${report.fills} fills, ${report.strokes} strokes, ` +
        `${report.stitches} stitches, ${report.awayFromBoundary} away, ` +
        `${report.borderFillEdges} border fills, ${report.exposedBorderFillEdges} exposed, ` +
        `${report.fullBlockFills} whole-block, ${report.fillSeaRings} sea rings, ` +
        `${report.wrongWinding} winding`,
    );
    assert.equal(report.stitches, 0, `${name}: stitched coast`);
    assert.equal(report.fullBlockFills, 0, `${name}: whole-block sea fill`);
    assert.equal(report.wrongWinding, 0, `${name}: wrong winding`);
    assert.ok(
      report.awayFromBoundary <= 4,
      `${name}: ${report.awayFromBoundary} strokes away from the lookup boundary`,
    );
  }
});

test("the complete chart data passes the same drawing audit", () => {
  const blocks = [...CHART_BLOCKS.values()];
  const commands = buildChartCommands(blocks, 7, 1.5);
  const report = auditChartCommands(commands, {
    blocks,
    isLandAt,
    presentBlockIds: new Set(blocks.map((candidate) => candidate.id)),
  });
  console.log(
    `whole Caribbean: ${report.fills} fills, ${report.strokes} strokes, ` +
      `${report.stitches} stitches, ${report.awayFromBoundary} away, ` +
      `${report.borderFillEdges} border fills, ${report.exposedBorderFillEdges} exposed, ` +
      `${report.fullBlockFills} whole-block, ${report.fillSeaRings} sea rings, ` +
      `${report.wrongWinding} winding`,
  );
  assert.equal(report.stitches, 0);
  assert.equal(report.fullBlockFills, 0);
  assert.equal(report.wrongWinding, 0);
  assert.ok(report.awayFromBoundary <= 4);
});
