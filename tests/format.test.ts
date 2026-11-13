import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCrew,
  formatKnots,
  formatMoney,
  formatPercent,
  formatTonnes,
  formatWhole,
} from "@naval/shared/format";

test("awkward floats become whole crew and whole percentages", () => {
  assert.equal(formatCrew(262.8009982951695, 284), "93% (263/284)");
  assert.equal(formatCrew(10.4, 284.2), "4% (10/284)");
  assert.equal(formatCrew(0.6, 0), "0% (1/0)");
  assert.equal(formatPercent(92.5), "93%");
  assert.equal(formatWhole(1234.6), "1,235");
});

test("tonnes, knots and money have one shared display", () => {
  assert.equal(formatTonnes(2.25), "2.3");
  assert.equal(formatTonnes(2), "2");
  assert.equal(formatKnots(7.249), "7.2 kn");
  assert.equal(formatMoney(1234.9), "1,234");
});
