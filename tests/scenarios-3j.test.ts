// 3J-b: the scenario launcher, its repeatable set-ups, scoreboard and report.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { PLACED_PORTS } from "@naval/shared/ports";
import {
  addPlayer,
  createWorld,
  endTestScenario,
  rateTestScenario,
  scenarioStatusFor,
  sessionReportFor,
  shipsForOwner,
  stepWorld,
} from "@naval/shared/world";
import { SCENARIOS, scenarioLauncherLayout, startTestScenario } from "@naval/shared/scenarios";
import { gameClockAt } from "@naval/shared/time";

function room(code = "test-scenario") {
  const world = createWorld(code, { npcs: true });
  addPlayer(world, "alpha", "frigate", 20_000, "British");
  return world;
}

function start(world: ReturnType<typeof createWorld>, id: string) {
  const result = startTestScenario(world, "alpha", id);
  assert.equal(result.error, null, id);
  assert.ok(result.status, id);
  assert.equal(result.world.kind, "test");
  return result;
}

test("3J-b every one of the 17 scenarios builds in a test room", () => {
  assert.equal(SCENARIOS.length, 17);
  const ids = new Set(SCENARIOS.map((scenario) => scenario.id));
  assert.equal(ids.size, 17);
  for (const definition of SCENARIOS) {
    const world = room();
    const result = start(world, definition.id);
    assert.equal(result.status?.id, definition.id);
    assert.equal(result.status?.seed, definition.seed);
    assert.equal(result.status?.outcome, "ongoing");
    assert.equal(result.status?.ended, false);
    assert.ok((result.status?.myShips ?? 0) > 0, `${definition.id} has my ships`);
    assert.equal(result.world.testScenario?.name, definition.name);
  }
});

test("3J-b the four duels are the right class 600 m apart", () => {
  const cases: Array<[string, string]> = [
    ["raider-duel", "raider"],
    ["frigate-duel", "frigate"],
    ["line-duel", "line"],
    ["flagship-duel", "flagship"],
  ];
  for (const [id, classId] of cases) {
    const result = start(room(), id);
    const own = shipsForOwner(result.world, "alpha");
    const enemy = result.world.botFleets.get("TEST-ENEMY") ?? [];
    assert.equal(own.length, 1, id);
    assert.equal(enemy.length, 1, id);
    assert.equal(own[0]?.classId, classId, id);
    assert.equal(enemy[0]?.classId, classId, id);
    assert.equal(enemy[0]?.dummyBehaviour, "fights");
    const distance = Math.hypot(own[0]!.x - enemy[0]!.x, own[0]!.y - enemy[0]!.y);
    assert.ok(distance >= 0.58 && distance <= 0.62, `${id} distance ${distance}`);
  }
});

test("3J-b 3 v 3 and 10 v 10 build the exact fleets", () => {
  const three = start(room(), "three-v-three");
  assert.deepEqual(shipsForOwner(three.world, "alpha").map((ship) => ship.classId),
    ["frigate", "frigate", "frigate"]);
  assert.deepEqual((three.world.botFleets.get("TEST-ENEMY") ?? []).map((ship) => ship.classId),
    ["frigate", "frigate", "frigate"]);

  const ten = start(room(), "ten-v-ten");
  const mine = shipsForOwner(ten.world, "alpha").map((ship) => ship.classId);
  assert.equal(mine.filter((id) => id === "frigate").length, 5);
  assert.equal(mine.filter((id) => id === "line").length, 3);
  assert.equal(mine.filter((id) => id === "escort").length, 2);
  assert.equal(ten.world.botFleets.get("TEST-ENEMY")?.length, 10);
});

test("3J-b ports get a dummy owner, the right size and a 30 s hold", () => {
  const small = start(room(), "small-port");
  const smallPort = [...small.world.portBattles.entries()].find(([, state]) => state.ownerId === "TEST-ENEMY");
  assert.ok(smallPort);
  assert.equal(small.world.captureHoldRealSeconds, 30);
  assert.equal(PLACED_PORTS.find((port) => port.id === smallPort[0])?.size, "S");
  assert.equal(shipsForOwner(small.world, "alpha")[0]?.classId, "flagship");

  const large = start(room(), "large-port");
  const largePort = [...large.world.portBattles.entries()].find(([, state]) => state.ownerId === "TEST-ENEMY");
  assert.ok(largePort);
  assert.equal(large.world.captureHoldRealSeconds, 30);
  assert.equal(PLACED_PORTS.find((port) => port.id === largePort[0])?.size, "L");
  assert.deepEqual(shipsForOwner(large.world, "alpha").map((ship) => ship.classId),
    ["line", "line", "line", "line"]);
});

test("3J-b boarding, morale, night fire ships and NPC scenarios have their states", () => {
  const boarding = start(room(), "boarding");
  const enemy = boarding.world.botFleets.get("TEST-ENEMY")?.[0];
  assert.ok(enemy);
  assert.ok(enemy.crew <= Math.ceil(enemy.fullCrew * 0.31));
  assert.equal(shipsForOwner(boarding.world, "alpha")[0]?.autoBoard, true);

  const morale = start(room(), "surrender-run");
  const dummies = morale.world.botFleets.get("TEST-ENEMY") ?? [];
  assert.deepEqual(dummies.map((ship) => ship.dummyBehaviour), ["surrenders", "runs"]);

  for (const id of ["fire-night-fight", "fire-night-engage"]) {
    const night = start(room(), id);
    assert.equal(gameClockAt(night.world.gameMs).hour, 23);
    assert.equal(shipsForOwner(night.world, "alpha")[0]?.classId, "fireShip");
    const fleet = night.world.botFleets.get("TEST-ENEMY") ?? [];
    assert.equal(fleet.length, 5);
    assert.ok(fleet.every((ship) => ship.lightsOff === true));
    assert.ok(fleet.every((ship) => ship.hoveTo === true));
    assert.ok(fleet.every((ship) =>
      ship.stance === (id === "fire-night-engage" ? "engage" : "fightIfAttacked")));
  }

  const merchant = start(room(), "merchant");
  const trader = merchant.world.npcShips.find((ship) => ship.npcKind === "merchant");
  assert.ok(trader);
  const mine = shipsForOwner(merchant.world, "alpha")[0]!;
  const distance = Math.hypot(trader.x - mine.x, trader.y - mine.y);
  assert.ok(distance >= 2.8 && distance <= 4.2, `merchant distance ${distance}`);
  assert.ok(merchant.world.npcShips.some((ship) => ship.npcKind === "whaler"));

  const escort = start(room(), "escort");
  assert.ok(escort.world.players.get("alpha")?.dockedPortId);
  assert.ok((escort.world.owners.get("alpha")?.money ?? 0) >= 3_000);
  assert.ok(escort.world.npcShips.some((ship) => ship.npcKind === "privateer"));

  const privateers = start(room(), "privateers");
  assert.ok((privateers.world.owners.get("alpha")?.money ?? 0) >= 3_000);
  assert.equal(privateers.world.npcShips.filter((ship) => ship.npcKind === "privateer").length, 3);
});

test("3J-b coast scenario has a ship off a lee shore and one reversing", () => {
  const result = start(room(), "coast");
  const ships = shipsForOwner(result.world, "alpha");
  assert.equal(ships.length, 2);
  const lee = ships.find((ship) => ship.name === "Lee shore ship");
  const channel = ships.find((ship) => ship.name === "Channel ship");
  assert.ok(lee);
  assert.ok(channel);
  assert.equal(lee.order, null);
  assert.equal(channel.order?.type, "sailTo");
  assert.equal(result.world.windFromDeg, 270);
});

test("3J-b two-player scenario places each player and exposes the invite link", () => {
  const world = room();
  addPlayer(world, "beta", "frigate", 20_000, "French");
  const result = start(world, "two-player");
  const mine = shipsForOwner(result.world, "alpha");
  const theirs = shipsForOwner(result.world, "beta");
  assert.equal(mine[0]?.classId, "frigate");
  assert.equal(theirs[0]?.classId, "frigate");
  const distance = Math.hypot(mine[0]!.x - theirs[0]!.x, mine[0]!.y - theirs[0]!.y);
  assert.ok(distance >= 2.8 && distance <= 3.4, `two player distance ${distance}`);
  assert.deepEqual(result.status?.theirLosses, 0);
  assert.deepEqual(result.world.testScenario?.enemyOwners, ["beta"]);
  const html = readFileSync("client/index.html", "utf8");
  assert.match(html, /id="test-invite-link"/);
  assert.match(readFileSync("shared/scenarios.ts", "utf8"), /Two-player duel/);
});

test("3J-b the real loop steps a scenario without leftovers and reset starts clean", () => {
  const first = start(room(), "ten-v-ten");
  assert.equal(shipsForOwner(first.world, "alpha").length, 10);
  for (let tick = 0; tick < 20; tick += 1) stepWorld(first.world, 0.2);
  assert.equal(shipsForOwner(first.world, "alpha").length, 10);
  assert.equal(first.world.botFleets.get("TEST-ENEMY")?.length, 10);

  const second = start(first.world, "frigate-duel");
  assert.equal(shipsForOwner(second.world, "alpha").length, 1);
  assert.equal(second.world.botFleets.get("TEST-ENEMY")?.length, 1);
  assert.equal(second.world.testScenario?.id, "frigate-duel");
  assert.equal(second.world.fleets.get("alpha")?.filter((ship) => ship.classId === "line").length, 0);
});

test("3J-b scoreboard losses, result and rating reach the report", () => {
  const result = start(room(), "frigate-duel");
  const world = result.world;
  let status = scenarioStatusFor(world, "alpha");
  assert.ok(status);
  assert.equal(status.myLosses, 0);
  assert.equal(status.theirLosses, 0);

  world.botFleets.get("TEST-ENEMY")!.pop();
  status = scenarioStatusFor(world, "alpha")!;
  assert.equal(status.theirLosses, 1);
  assert.equal(status.outcome, "won");

  const ended = endTestScenario(world, "alpha");
  assert.ok(ended?.ended);
  assert.equal(rateTestScenario(world, "alpha", "good", "clean broadside"), true);
  assert.equal(rateTestScenario(world, "alpha", "bad", "late"), true);
  const report = sessionReportFor(world, "alpha", { buildId: "b", layout: "desktop" });
  assert.match(report, /SCENARIO RESULTS/);
  assert.match(report, /Frigate duel: won/);
  assert.match(report, /Seed: duel-frigate-1805/);
  assert.match(report, /rating: good/);
  assert.match(report, /clean broadside/);
  assert.match(report, /Active scenario: 2\. Frigate duel/);
});

test("3J-b a scenario rating needs an ended run, and normal rooms never launch", () => {
  const world = room();
  assert.equal(rateTestScenario(world, "alpha", "good", ""), false);
  const normal = createWorld("main");
  addPlayer(normal, "alpha", "frigate", 0, "British");
  const result = startTestScenario(normal, "alpha", "frigate-duel");
  assert.equal(result.status, null);
  assert.equal(result.error, "That scenario is not available.");
  assert.equal(normal.testScenario, undefined);
});

test("3J-b the launcher fits and scrolls at all five review viewports", () => {
  const viewports = [
    { width: 360, height: 740 },
    { width: 412, height: 915 },
    { width: 740, height: 360 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ];
  for (const viewport of viewports) {
    const plan = scenarioLauncherLayout(viewport.width, viewport.height);
    assert.equal(plan.scroll, true);
    assert.equal(plan.minTargetPx, 44);
    assert.ok(plan.listMaxHeightPx > 0);
    assert.ok(plan.panelMaxHeightShare > 0 && plan.panelMaxHeightShare <= 1);
    assert.ok(plan.columns >= 1 && plan.columns <= 2);
  }
  const html = readFileSync("client/index.html", "utf8");
  for (const id of [
    "scenario-list",
    "scenario-scoreboard",
    "scenario-name",
    "scenario-elapsed",
    "scenario-my-losses",
    "scenario-their-losses",
    "scenario-outcome",
    "scenario-end",
    "scenario-rating",
    "scenario-rating-note",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /Test tools, removed before release/);
  const css = readFileSync("client/paper.css", "utf8");
  assert.match(css, /\.scenario-list[\s\S]*?max-height: 280px[\s\S]*?overflow: auto/);
  assert.match(css, /\.scenario-list \.btn \{\s*min-height: 44px/);
  assert.match(css, /\.scenario-rating-buttons \.btn[\s\S]*?min-height: 44px/);
});
