// 3F Part B: the pure port defence, repair, capture, fortification and
// elimination rules. No world/server code is needed here.

import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import {
  activeAggressors,
  buildTimeGameMs,
  canDockAtPort,
  captureRangeKm,
  captureStatus,
  damagePort,
  eliminatePorts,
  firePortBatteries,
  hitChanceAt,
  newPortBattle,
  portAttackProblem,
  portBatteryRangeKm,
  portBuildCost,
  portCondition,
  portGunPounds,
  portGuns,
  portMaxHealth,
  portValue,
  repairPort,
  resolveDockedShips,
  setPortCentreHook,
  startPortBuild,
  tickPortBuild,
  tickPortCapture,
  type ArmedShip,
  type CaptureContext,
  type PortBattlePort,
} from "@naval/shared/port-battle";

const S: PortBattlePort = { id: "s", name: "Small", size: "S", npc: false };
const M: PortBattlePort = { id: "m", name: "Medium", size: "M", npc: false };
const L: PortBattlePort = { id: "l", name: "Large", size: "L", npc: false };
const B = settings.ports.battle;

function rng(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function ship(ownerId: string, x: number, y: number, extra: Partial<ArmedShip> = {}): ArmedShip {
  return {
    id: `${ownerId}-${x}-${y}`,
    ownerId,
    x,
    y,
    guns: 38,
    ammunition: 20,
    crewShare: 1,
    ...extra,
  };
}

const day: CaptureContext = { paused: false, gameHour: 12 };

test("AGREED defences and tier bonuses", () => {
  assert.equal(portMaxHealth("S", 0), 2_000);
  assert.equal(portMaxHealth("M", 0), 5_000);
  assert.equal(portMaxHealth("L", 0), 12_000);
  assert.deepEqual(portGuns("S", 0), { heavy: 0, medium: 10, light: 10 });
  assert.deepEqual(portGuns("M", 0), { heavy: 10, medium: 12, light: 8 });
  assert.deepEqual(portGuns("L", 0), { heavy: 40, medium: 20, light: 10 });
  assert.equal(portGunPounds("S", 0), 100);
  assert.equal(portGunPounds("M", 0), 248);
  assert.equal(portGunPounds("L", 0), 730);
  assert.equal(portBatteryRangeKm("S", 0), 1.2);
  assert.equal(portMaxHealth("S", 3), 2_000 * (1 + 0.3 * 3));
  assert.deepEqual(portGuns("S", 3), { heavy: 0, medium: 16, light: 16 });
  assert.ok(Math.abs(portBatteryRangeKm("S", 3) - 1.5) < 1e-9);
});

test("NPC ports are neutral ground and docked ships are sheltered", () => {
  const npc = { ...S, npc: true };
  const state = newPortBattle(npc);
  assert.equal(portAttackProblem(npc, state, "alpha"), "Neutral ground");
  setPortCentreHook(() => ({ x: 0, y: 0 }));
  damagePort(state, npc, "alpha", 10, 0);
  const shots = firePortBatteries(
    state,
    npc,
    [ship("alpha", 0.5, 0, { dockedPortId: npc.id })],
    1,
    rng(),
  );
  assert.equal(shots.length, 0);
});

test("a port fires only at aggressors and never at its owner or friends", () => {
  setPortCentreHook(() => ({ x: 0, y: 0 }));
  const state = newPortBattle(S);
  state.ownerId = "owner";
  assert.equal(firePortBatteries(state, S, [ship("enemy", 0.4, 0)], 1, rng()).length, 0);
  damagePort(state, S, "enemy", 1, 10);
  const shots = firePortBatteries(
    state,
    S,
    [ship("owner", 0.4, 0), ship("friend", 0.4, 0), ship("enemy", 0.4, 0)],
    11,
    rng(2),
    (a, b) => a === b || (a === "owner" && b === "friend"),
  );
  assert.ok(shots.length > 0);
  assert.ok(shots.every((shot) => shot.ownerId === "enemy"));
  assert.deepEqual(activeAggressors(state, 10 + B.aggressorRealSeconds), []);
});

test("hit bands include the Draft 6 percent band and no long-range fire", () => {
  assert.equal(hitChanceAt(0.2), 0.5);
  assert.equal(hitChanceAt(0.5), 0.3);
  assert.equal(hitChanceAt(0.9), 0.12);
  assert.equal(hitChanceAt(1.1), 0.06);
  assert.equal(hitChanceAt(1.3), 0);
});

test("fortification build lock, cost, time and health rise", () => {
  const state = newPortBattle(S);
  state.ownerId = "alpha";
  state.stock = { timber: 1_000, repairMaterials: 1_000 };
  assert.equal(startPortBuild(S, state, "alpha", 0, false), "Needs research");
  assert.equal(startPortBuild(S, state, "alpha", 0, true), null);
  assert.deepEqual(portBuildCost(S, 1), { timber: 30, repairMaterials: 10 });
  assert.equal(state.stock.timber, 970);
  assert.equal(startPortBuild(S, state, "alpha", 0, true), "Build already running");
  assert.equal(buildTimeGameMs(2), 2 * 24 * 3600 * 1000);
  assert.equal(tickPortBuild(state, S, buildTimeGameMs(1) - 1), false);
  assert.equal(tickPortBuild(state, S, buildTimeGameMs(1)), true);
  assert.equal(state.tier, 1);
  assert.equal(state.health, portMaxHealth("S", 1));
  assert.deepEqual(portBuildCost(L, 3), { timber: 600, repairMaterials: 200 });
});

test("repair waits 120 seconds, then uses the owner and material rates", () => {
  const state = newPortBattle(S);
  state.health = 1_000;
  damagePort(state, S, "enemy", 1, 1_000);
  assert.equal(repairPort(S, state, 3_600, 1_010).healed, 0);
  const unowned = repairPort(S, state, 3_600, 1_000 + B.repairBlockRealSeconds);
  assert.ok(unowned.healed > 0 && unowned.healed <= 2_000 * 0.005 + 1e-9);
  state.ownerId = "alpha";
  state.health = 1_000;
  state.stock.repairMaterials = 20;
  const owned = repairPort(S, state, 3_600, 2_000);
  assert.ok(owned.healed > unowned.healed);
  assert.ok(owned.materialsUsed > 0);
  assert.ok(state.stock.repairMaterials < 20);
});

test("capture ranges halve at night and in mist, quarter in fog, and stack", () => {
  const state = newPortBattle(S);
  assert.equal(captureRangeKm(S, state.tier, { gameHour: 12 }), 15);
  assert.equal(captureRangeKm(S, state.tier, { gameHour: 22 }), 7.5);
  assert.equal(captureRangeKm(S, state.tier, { gameHour: 12, mist: true }), 7.5);
  assert.equal(captureRangeKm(S, state.tier, { gameHour: 12, thickFog: true }), 3.75);
  assert.equal(captureRangeKm(S, state.tier, { gameHour: 22, mist: true }), 3.75);
  assert.equal(captureRangeKm(S, state.tier, { gameHour: 12, weatherMultiplier: 2 }), 30);
});

test("only armed ships count, and two enemy sides block a capture", () => {
  setPortCentreHook(() => ({ x: 0, y: 0 }));
  const state = newPortBattle(S);
  state.health = 0;
  const unarmed = ship("alpha", 1, 0, { guns: 0 });
  assert.equal(captureStatus(S, state, [unarmed], day).sides.length, 0);
  const two = captureStatus(S, state, [ship("alpha", 1, 0), ship("beta", 2, 0)], day);
  assert.equal(two.reason, "Two sides in range");
  const owner = captureStatus(S, state, [ship("alpha", 1, 0)], { ...day, sameSide: (a, b) => a === b });
  assert.equal(owner.sideId, "alpha");
});

test("owner ships block capture, and the 300 second hold pauses and resets", () => {
  setPortCentreHook(() => ({ x: 0, y: 0 }));
  const state = newPortBattle(S);
  state.ownerId = "owner";
  state.health = 0;
  const blocked = captureStatus(S, state, [ship("owner", 1, 0), ship("alpha", 2, 0)], day);
  assert.equal(blocked.reason, "Port owner's ships in range");

  state.ownerId = null;
  let status = tickPortCapture(S, state, [ship("alpha", 1, 0)], day, 299);
  assert.equal(status.capturedBy, null);
  assert.equal(status.seconds, 299);
  status = tickPortCapture(S, state, [ship("alpha", 1, 0)], { ...day, paused: true }, 10);
  assert.equal(status.seconds, 299);
  status = tickPortCapture(S, state, [ship("alpha", 1, 0)], day, 1);
  assert.equal(status.capturedBy, "alpha");
  assert.equal(state.ownerId, "alpha");
  assert.equal(state.health, portMaxHealth("S", 0) * 0.25);
  assert.equal(state.upgradesUnlockedFor, "alpha");
});

test("capture progress resets when the capturer leaves or the port heals", () => {
  setPortCentreHook(() => ({ x: 0, y: 0 }));
  const state = newPortBattle(S);
  state.health = 0;
  tickPortCapture(S, state, [ship("alpha", 1, 0)], day, 200);
  state.health = 1;
  const healed = tickPortCapture(S, state, [ship("alpha", 1, 0)], day, 1);
  assert.equal(healed.reason, "Batteries still firing");
  assert.equal(state.capture, null);
  state.health = 0;
  tickPortCapture(S, state, [ship("alpha", 1, 0)], day, 50);
  const left = tickPortCapture(S, state, [], day, 50);
  assert.equal(left.reason, "No capturing ships");
  assert.equal(state.capture, null);
});

test("docked ships are captured unless they fight or are flagships", () => {
  const result = resolveDockedShips([
    { id: "trade", ownerId: "old", fightBack: false, flagship: false },
    { id: "fighter", ownerId: "old", fightBack: true, flagship: false },
    { id: "flag", ownerId: "old", fightBack: false, flagship: true },
  ], "new");
  assert.deepEqual(result.captured.map((entry) => entry.id), ["trade"]);
  assert.deepEqual(result.pushedOut.map((entry) => entry.id), ["fighter", "flag"]);
  assert.equal(canDockAtPort(newPortBattle(S), "anyone"), true);
  const owned = newPortBattle(S);
  owned.ownerId = "alpha";
  assert.equal(canDockAtPort(owned, "alpha"), true);
  assert.equal(canDockAtPort(owned, "beta"), false);
});

test("port values and elimination split by value, or go unowned", () => {
  const state = newPortBattle(S);
  state.tier = 2;
  assert.equal(portValue(S, state.tier), 3_000 * 1.5);
  const assignments = eliminatePorts(
    [{ port: S, state }, { port: M, state: newPortBattle(M) }],
    null,
    ["a", "b"],
  );
  assert.equal(assignments.length, 2);
  assert.ok(assignments.some((entry) => entry.ownerId === "a"));
  assert.ok(assignments.some((entry) => entry.ownerId === "b"));
  assert.deepEqual(eliminatePorts([{ port: S, state }], null, []), [{ portId: "s", ownerId: null }]);
  assert.deepEqual(eliminatePorts([{ port: S, state }], "mate", []), [{ portId: "s", ownerId: "mate" }]);
});

test("port conditions and attack permissions", () => {
  const state = newPortBattle(S);
  assert.equal(portCondition(state, S), "Healthy");
  state.health = 1_200;
  assert.equal(portCondition(state, S), "Damaged");
  state.health = 500;
  assert.equal(portCondition(state, S), "Heavily damaged");
  state.health = 0;
  assert.equal(portCondition(state, S), "Silenced");
  state.ownerId = "alpha";
  assert.equal(portAttackProblem(S, state, "alpha"), "That is your own port");
  assert.equal(portAttackProblem(S, state, "mate", (a, b) => a === b || (a === "alpha" && b === "mate")), "That is a friendly port");
  assert.equal(portAttackProblem(S, state, "beta"), null);
});
