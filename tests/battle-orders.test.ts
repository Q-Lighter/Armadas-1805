// Part 3C-b: pure battle-order rules.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isInBattleZone,
  objectiveForOrder,
  runEscaped,
  runHeadingAway,
  stanceBattleOrder,
  surrenderAcceptProblem,
} from "@naval/shared/battle-orders";
import { settings } from "@naval/shared/settings";

test("capture and sink map to engagement objectives and run is not one", () => {
  assert.equal(objectiveForOrder("capture"), "capture");
  assert.equal(objectiveForOrder("sink"), "sink");
  assert.equal(objectiveForOrder("run"), null);
  assert.equal(objectiveForOrder("surrender"), null);
});

test("running heads away from the nearest enemy, weighted by distance", () => {
  const awayEast = runHeadingAway({ x: 0, y: 0 }, [{ x: 1, y: 0 }]);
  assert.ok(awayEast !== null);
  assert.ok(Math.abs(awayEast! - (-Math.PI / 2)) < 0.01);
  const mixed = runHeadingAway({ x: 0, y: 0 }, [{ x: 1, y: 0 }, { x: -5, y: 0 }]);
  assert.ok(mixed !== null);
  assert.ok(mixed! < 0, "the close eastern enemy dominates the far western one");
  assert.equal(runHeadingAway({ x: 0, y: 0 }, []), null);
});

test("a run escapes only after the full out-of-sight time", () => {
  const start = 1_000;
  assert.equal(runEscaped(null, start), false);
  assert.equal(runEscaped(start, start + settings.combat.runEscapeSeconds * 1_000 - 1), false);
  assert.equal(runEscaped(start, start + settings.combat.runEscapeSeconds * 1_000), true);
});

test("surrender acceptance explains range and fleet limits", () => {
  assert.equal(surrenderAcceptProblem({ fleetCount: 3, nearestShipKm: 0.8 }), null);
  assert.match(
    surrenderAcceptProblem({ fleetCount: 3, nearestShipKm: 1.1 })!,
    /within 1 km/,
  );
  assert.equal(surrenderAcceptProblem({ fleetCount: 30, nearestShipKm: 0.2 }), null);
});

test("stances choose fight, run or no automatic battle order", () => {
  assert.equal(stanceBattleOrder("engage"), "sink");
  assert.equal(stanceBattleOrder("fightIfAttacked"), "sink");
  assert.equal(stanceBattleOrder("avoid"), "run");
  assert.equal(stanceBattleOrder("stealth"), null);
  assert.equal(isInBattleZone({ x: 0, y: 0 }, [{ x: 1.4, y: 0 }]), true);
  assert.equal(isInBattleZone({ x: 0, y: 0 }, [{ x: 1.6, y: 0 }]), false);
});
