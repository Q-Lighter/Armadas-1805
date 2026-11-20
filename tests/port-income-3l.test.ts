import assert from "node:assert/strict";
import { test } from "node:test";

import { settings } from "@naval/shared/settings";
import { PLACED_PORTS } from "@naval/shared/ports";
import { researchScreenView } from "@naval/shared/research-view";
import { researchStateForNavy } from "@naval/shared/world";
import {
  addPlayer,
  createWorld,
  portIncomeFor,
  portIncomeSnapshotFor,
  setTestPortOwner,
  stepWorld,
  takeNotice,
  updatePortIncome,
  type TradeRoute,
} from "@naval/shared/world";

function worldWithOwner(navy: "British" | "French" = "British") {
  const world = createWorld("test-income", { startMoney: 1_000 });
  addPlayer(world, "alpha", "frigate", 1_000, navy);
  return world;
}

function ownedPort(size: "S" | "M" | "L", playerId = "alpha") {
  const world = worldWithOwner();
  const port = PLACED_PORTS.find((entry) => !entry.npc && entry.size === size)!;
  setTestPortOwner(world, playerId, port.id, "me");
  return { world, port };
}

function addRoutes(world: ReturnType<typeof createWorld>, count: number, portId: string) {
  const owner = world.owners.get("alpha")!;
  for (let index = 0; index < count; index += 1) {
    owner.tradeRoutes.set(`route-${index}`, {
      id: `route-${index}`,
      shipId: `ship-${index}`,
      portA: "somewhere",
      portB: portId,
      good: "timber",
      tonnes: 10,
      limitMinutes: 30,
      phase: "toB",
      startedGameMs: 0,
      lateNotified: false,
      lastProfit: 0,
      cargoTonnes: 0,
      cargoCost: 0,
      pausedReason: null,
    } satisfies TradeRoute);
  }
}

test("AGREED base income for S, M and L with 0 to 5 routes, capped at 4", () => {
  for (const [size, base] of [["S", 400], ["M", 800], ["L", 1_200]] as const) {
    const { world, port } = ownedPort(size);
    for (let routes = 0; routes <= 5; routes += 1) {
      world.owners.get("alpha")!.tradeRoutes.clear();
      addRoutes(world, routes, port.id);
      const counted = Math.min(4, routes);
      assert.equal(portIncomeFor(world, port, "alpha"), base + Math.round(base * 0.15 * counted),
        `${size} with ${routes} routes`);
    }
  }
});

test("Market applies at each level", () => {
  const { world, port } = ownedPort("M");
  const state = researchStateForNavy(world, "British");
  const base = 800;
  for (const [level, value] of [0.10, 0.20, 0.30].entries()) {
    state.levels.set("market", level + 1);
    assert.equal(portIncomeFor(world, port, "alpha"), Math.round(base * (1 + value)));
  }
});

test("Jamaica station applies at Antilles ports at each level", () => {
  const world = worldWithOwner();
  const port = PLACED_PORTS.find((entry) => !entry.npc && entry.region === "Greater Antilles")!;
  setTestPortOwner(world, "alpha", port.id, "me");
  const state = researchStateForNavy(world, "British");
  const base = settings.ports.sizes[port.size].incomePer30Minutes;
  for (const [level, value] of [0.10, 0.20, 0.30].entries()) {
    state.levels.set("jamaicaStation", level + 1);
    assert.equal(portIncomeFor(world, port, "alpha"), Math.round(base * (1 + value)));
  }
});

test("Navigation Acts replaces the 15% route share at each level", () => {
  const { world, port } = ownedPort("M");
  addRoutes(world, 1, port.id);
  const state = researchStateForNavy(world, "British");
  for (const [level, value] of [0.18, 0.21, 0.25].entries()) {
    state.levels.set("navigationActs", level + 1);
    assert.equal(portIncomeFor(world, port, "alpha"), Math.round(800 * (1 + value)));
  }
});

test("income arrives every three game days in the world loop and sends one notice", () => {
  const { world, port } = ownedPort("S");
  const second = PLACED_PORTS.find((entry) => !entry.npc && entry.size === "S" && entry.id !== port.id)!;
  setTestPortOwner(world, "alpha", second.id, "me");
  updatePortIncome(world);
  const cycle = 3 * settings.time.hoursPerDay * 60 * 60;
  const before = world.owners.get("alpha")!.money;
  stepWorld(world, cycle);
  assert.equal(world.owners.get("alpha")!.money, before + 800);
  assert.match(takeNotice(world, "alpha") ?? "", /^Port income: 800 pieces from 2 ports\.$/);
  assert.ok(portIncomeSnapshotFor(world, "alpha")!.nextGameDays > 0);
  assert.equal(port.id.length > 0, true);
});

test("a captured port pays the captor, not the old owner, from the next payment", () => {
  const { world, port } = ownedPort("M");
  addPlayer(world, "beta", "frigate", 1_000, "French");
  const alphaBefore = world.owners.get("alpha")!.money;
  const betaBefore = world.owners.get("beta")!.money;
  setTestPortOwner(world, "beta", port.id, "me");
  updatePortIncome(world, true);
  assert.equal(world.owners.get("alpha")!.money, alphaBefore);
  assert.equal(world.owners.get("beta")!.money, betaBefore + 800);
});

test("the Research view no longer reports Market, Jamaica station or Navigation Acts as stored", () => {
  const levels = new Map([["market", 0], ["jamaicaStation", 0], ["navigationActs", 0]]);
  const view = researchScreenView({ navy: "British", points: 10_000, levels });
  for (const id of ["market", "jamaicaStation", "navigationActs"]) {
    const row = view.branches.flatMap((branch) => branch.rows).find((entry) => entry.id === id)!;
    assert.equal(row.hook, null, id);
  }
});
