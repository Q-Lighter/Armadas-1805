import assert from "node:assert/strict";
import { test } from "node:test";

import { researchScreenView } from "@naval/shared/research-view";
import { researchTreeFor } from "@naval/shared/research-data";
import { NAVY_IDS } from "@naval/shared/navies";

test("every navy shows all 31 upgrades in the five shared and one unique branch", () => {
  for (const navy of NAVY_IDS) {
    assert.equal(researchTreeFor(navy).length, 31, navy);
    const view = researchScreenView({ navy, points: 0, levels: new Map() });
    assert.deepEqual(view.branches.map((branch) => branch.id), ["A", "B", "C", "D", "E", "unique"]);
    assert.equal(view.branches.reduce((sum, branch) => sum + branch.rows.length, 0), 31);
    assert.equal(view.branches.find((branch) => branch.id === "unique")?.rows.length, 6);
  }
});

test("research state, pips and costs come from the existing rules", () => {
  const navy = NAVY_IDS[0]!;
  const locked = researchScreenView({ navy, points: 0, levels: new Map() });
  assert.equal(locked.branches[0]!.rows[0]!.state, "locked");
  assert.equal(locked.branches[0]!.rows[0]!.disabled, true);
  const bought = researchScreenView({
    navy,
    points: 100,
    levels: new Map([[locked.branches[0]!.rows[0]!.id, 1]]),
  });
  const row = bought.branches[0]!.rows[0]!;
  assert.equal(row.level, 1);
  assert.equal(row.state, "available");
  assert.equal(row.pips.filter(Boolean).length, 1);
  assert.equal(row.nextLevel, 2);
});
