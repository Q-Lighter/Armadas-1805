import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { flagshipPennantVisible } from "@naval/shared/flagship-marker";

test("the map pennant is off by default and only ever draws my flagship", () => {
  assert.equal(settings.flagshipMarker.pennantDefaultVisible, false);
  assert.equal(flagshipPennantVisible(true, true), false);
  assert.equal(flagshipPennantVisible(true, true, true), true);
  assert.equal(flagshipPennantVisible(true, false, true), false);
  assert.equal(flagshipPennantVisible(false, true, true), false);
});
