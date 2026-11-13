import assert from "node:assert/strict";
import { test } from "node:test";

import { firingReadout, sailingStateLabel } from "@naval/shared/combat-readout";

test("the firing readout shows the order, step and the first real blocker", () => {
  assert.equal(
    firingReadout({ order: "sink", phase: "closing", distanceM: 1840, hasTarget: true, ammunitionBroadsides: 10 }),
    "Order: Sink. Step: closing (distance 1840 m). Not firing: out of range.",
  );
  assert.equal(
    firingReadout({
      order: "capture", phase: "hove", distanceM: 250, bearingOffBeamDeg: 47,
      hasTarget: true, gunsBear: false, ammunitionBroadsides: 10,
    }),
    "Order: Capture. Step: hove to, pivoting (bearing 47 degrees off beam). Not firing: out of arc.",
  );
  assert.equal(
    firingReadout({
      order: "sink", phase: "in range", distanceM: 250,
      hasTarget: true, reloadSeconds: 2.1, ammunitionBroadsides: 10,
    }),
    "Order: Sink. Step: in range (distance 250 m). Not firing: reloading (3 s).",
  );
  assert.equal(
    firingReadout({
      order: "board", phase: "grappled", distanceM: 55, hasTarget: true,
    }),
    "Order: Board. Step: grappled. Not firing: grappled.",
  );
  assert.equal(
    firingReadout({
      order: "sink", phase: "in range", distanceM: 250,
      hasTarget: true, ammunitionBroadsides: 0,
    }),
    "Order: Sink. Step: in range (distance 250 m). Not firing: no ammunition.",
  );
  assert.equal(
    firingReadout({
      order: "sink", phase: "in range", distanceM: 250,
      hasTarget: true, crewTooLow: true, ammunitionBroadsides: 10,
    }),
    "Order: Sink. Step: in range (distance 250 m). Not firing: crew too low.",
  );
  assert.equal(
    firingReadout({
      order: "sink", phase: "in range", distanceM: 250,
      hasTarget: true, gunsPercent: 0, ammunitionBroadsides: 10,
    }),
    "Order: Sink. Step: in range (distance 250 m). Not firing: guns 0%.",
  );
  assert.equal(
    firingReadout({
      order: "sink", phase: "in range", distanceM: 250,
      hasTarget: true, ammunitionBroadsides: 10,
    }),
    "Order: Sink. Step: in range (distance 250 m). Guns ready.",
  );
});

test("state labels distinguish hove to, in irons, drifting and sailing", () => {
  assert.equal(sailingStateLabel({
    hoveTo: true, hasOrder: true, speedKnots: 0,
    effectiveSailPercent: 0, driftSpeedKnots: 1,
  }), "Hove to");
  assert.equal(sailingStateLabel({
    hasOrder: true, headingIntoWind: true, speedKnots: 0,
    effectiveSailPercent: 100, driftSpeedKnots: 0,
  }), "In irons");
  assert.equal(sailingStateLabel({
    hasOrder: false, speedKnots: 0, effectiveSailPercent: 100, driftSpeedKnots: 0,
  }), "Hove to");
  assert.equal(sailingStateLabel({
    speedKnots: 4, effectiveSailPercent: 0, driftSpeedKnots: 1,
  }), "Drifting");
  assert.equal(sailingStateLabel({
    speedKnots: 0, effectiveSailPercent: 100, driftSpeedKnots: 0, hasRudder: false,
  }), "Drifting");
  assert.equal(sailingStateLabel({
    hasOrder: true, speedKnots: 5, effectiveSailPercent: 100, driftSpeedKnots: 0,
  }), "Sailing");
});
