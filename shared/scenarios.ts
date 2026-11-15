// 3J-b: repeatable playtest scenarios for test and dev rooms.
//
// The definitions are plain data so the client can render the launcher and
// the server can build the same ships. Every scenario resets the room through
// the existing resetTestRoom helper first, then uses test-only setup helpers.
// Removed before release.

import { isLandAt } from "./land.js";
import { MAP_HEIGHT_KM, MAP_WIDTH_KM } from "./map.js";
import { createShip, type Ship, type ShipClassId } from "./sailing.js";
import { fullStores } from "./trade.js";
import { createShipDamage } from "./combat.js";
import { PLACED_PORTS, type PlacedPort } from "./data/ports.js";
import { shipTypeFor } from "./data/ships.js";
import { NAVY_IDS, type NavyId } from "./navies.js";
import {
  beginScenarioTracking,
  isTestChannelAt,
  pushPlayerNotice,
  resetTestRoom,
  setTestPortOwner,
  setTestPortTier,
  setTestTimeOfDay,
  shipsForOwner,
  type ScenarioStatus,
  type World,
} from "./world.js";
import type { DummyBehaviour } from "./testSetup.js";

export interface ScenarioDefinition {
  id: string;
  name: string;
  seed: string;
  summary: string;
  /** 3J-b: the client switches the Performance panel on for this one. */
  performance?: boolean;
  /** 3J-b: this scenario is for two devices and shows the invite link. */
  twoPlayer?: boolean;
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  { id: "raider-duel", name: "1. Raider duel", seed: "duel-raider-1805", summary: "My raider vs a fighting dummy raider, 600 m apart." },
  { id: "frigate-duel", name: "2. Frigate duel", seed: "duel-frigate-1805", summary: "My frigate vs a fighting dummy frigate, 600 m apart." },
  { id: "line-duel", name: "3. Line ship duel", seed: "duel-line-1805", summary: "My line ship vs a fighting dummy line ship, 600 m apart." },
  { id: "flagship-duel", name: "4. Flagship duel", seed: "duel-flagship-1805", summary: "My flagship vs a fighting dummy flagship, 600 m apart." },
  { id: "three-v-three", name: "5. 3 v 3 frigates", seed: "fleet-3v3-1805", summary: "Three frigates in line ahead vs three fighting dummy frigates." },
  { id: "ten-v-ten", name: "6. 10 v 10", seed: "fleet-10v10-1805", summary: "Five frigates, three line ships and two escorts against ten dummies; Performance on.", performance: true },
  { id: "small-port", name: "7. Small port", seed: "port-small-1805", summary: "My flagship vs a dummy small port, 30 s capture hold." },
  { id: "large-port", name: "8. Large port", seed: "port-large-1805", summary: "Four line ships vs a dummy large port, shortened capture hold." },
  { id: "boarding", name: "9. Boarding", seed: "boarding-1805", summary: "An enemy frigate at 30% crew; use Capture and auto-boarding." },
  { id: "surrender-run", name: "10. Surrender and Run", seed: "morale-1805", summary: "One dummy surrenders at 30% hull, one runs at 50%." },
  { id: "fire-night-fight", name: "11. Fire ship, fight if attacked", seed: "fire-night-a-1805", summary: "Night fire-ship attack on an anchored fleet, lights off, fight only if attacked." },
  { id: "fire-night-engage", name: "12. Fire ship, engage anything", seed: "fire-night-b-1805", summary: "Night fire-ship attack on an anchored fleet, lights off, engage anything." },
  { id: "merchant", name: "13. Merchant and whalers", seed: "merchant-1805", summary: "A merchant 3 km away to loot, then a whaler group." },
  { id: "escort", name: "14. Escort contract", seed: "escort-1805", summary: "Docked at an NPC port with an escort job available." },
  { id: "privateers", name: "15. Privateers", seed: "privateers-1805", summary: "Docked at an NPC port with 3,000 pieces to hire privateers." },
  { id: "coast", name: "16. Coast and channel", seed: "coast-1805", summary: "A ship 4 km off a lee shore, and a ship in a 2 km channel told to reverse." },
  { id: "two-player", name: "17. Two-player duel", seed: "duel-two-device-1805", summary: "Invite a second device; two frigates 3 km apart, one per player.", twoPlayer: true },
];

/** 3J-b: the launcher's browser-free fit and scroll numbers. */
export interface ScenarioLauncherLayout {
  columns: 1 | 2;
  scroll: boolean;
  minTargetPx: number;
  listMaxHeightPx: number;
  panelMaxHeightShare: number;
}

export function scenarioLauncherLayout(width: number, height: number): ScenarioLauncherLayout {
  const columns = width < 640 ? 1 : 2;
  return {
    columns,
    scroll: true,
    minTargetPx: 44,
    listMaxHeightPx: Math.max(160, Math.round(height * 0.28)),
    panelMaxHeightShare: 0.9,
  };
}

export interface ScenarioSetupResult {
  world: World;
  status: ScenarioStatus | null;
  error: string | null;
}

interface Placement {
  classId: ShipClassId;
  x: number;
  y: number;
  headingRad: number;
  name?: string;
  crewShare?: number;
}

function otherNavy(navy: NavyId): NavyId {
  return NAVY_IDS.find((candidate) => candidate !== navy) ?? "French";
}

function waterPointNear(
  anchor: { x: number; y: number },
  distanceKm: number,
  startBearing = Math.PI / 2,
): { x: number; y: number; bearingRad: number } {
  for (let attempt = 0; attempt < 72; attempt += 1) {
    const angle = startBearing + attempt * (Math.PI / 36);
    const x = anchor.x + Math.sin(angle) * distanceKm;
    const y = anchor.y - Math.cos(angle) * distanceKm;
    if (x < 1 || y < 1 || x > MAP_WIDTH_KM - 1 || y > MAP_HEIGHT_KM - 1) continue;
    if (isLandAt(x, y)) continue;
    if (isLandAt(x + 0.2, y) || isLandAt(x - 0.2, y)) continue;
    if (isLandAt(x, y + 0.2) || isLandAt(x, y - 0.2)) continue;
    return { x, y, bearingRad: angle };
  }
  return { x: anchor.x + distanceKm, y: anchor.y, bearingRad: Math.PI / 2 };
}

function replacePlayerFleet(
  world: World,
  playerId: string,
  placements: Placement[],
): Ship[] {
  const record = world.playerRecords.get(playerId);
  if (!record || placements.length === 0) return [];
  const ships: Ship[] = [];
  for (const [index, place] of placements.entries()) {
    const ship = createShip(
      `ship-${world.nextShipId++}`,
      place.classId,
      place.x,
      place.y,
      place.headingRad,
      record.navy,
      place.name ?? `Scenario ${index + 1}`,
    );
    const crew = Math.max(1, Math.round(ship.fullCrew * (place.crewShare ?? 1)));
    ship.crew = crew;
    ship.damage = createShipDamage(shipTypeFor(record.navy, place.classId), crew);
    ship.stores = fullStores(shipTypeFor(record.navy, place.classId));
    ship.isFlagship = index === 0;
    ship.autoAnchor = false;
    ships.push(ship);
  }
  const first = ships[0]!;
  world.fleets.set(playerId, ships);
  world.players.set(playerId, first);
  record.flagshipId = first.id;
  const owner = world.owners.get(playerId);
  if (owner) owner.selectedShipId = first.id;
  return ships;
}

function replaceEnemyFleet(
  world: World,
  playerId: string,
  placements: Placement[],
  dummy: DummyBehaviour,
): Ship[] {
  const player = shipsForOwner(world, playerId)[0];
  if (!player) return [];
  const navy = otherNavy(player.navy);
  const ships: Ship[] = [];
  for (const [index, place] of placements.entries()) {
    const ship = createShip(
      `enemy-${world.nextShipId++}`,
      place.classId,
      place.x,
      place.y,
      place.headingRad,
      navy,
      place.name ?? `Dummy ${index + 1}`,
    );
    const crew = Math.max(1, Math.round(ship.fullCrew * (place.crewShare ?? 1)));
    ship.crew = crew;
    ship.damage = createShipDamage(shipTypeFor(navy, place.classId), crew);
    ship.stores = fullStores(shipTypeFor(navy, place.classId));
    ship.dummyBehaviour = dummy;
    ship.autoAnchor = false;
    ships.push(ship);
  }
  world.botFleets.set("TEST-ENEMY", ships);
  return ships;
}

function lineAhead(
  anchor: { x: number; y: number },
  bearingRad: number,
  classes: ShipClassId[],
  gapKm = 0.18,
): Placement[] {
  return classes.map((classId, index) => ({
    classId,
    x: anchor.x + Math.sin(bearingRad) * gapKm * index,
    y: anchor.y - Math.cos(bearingRad) * gapKm * index,
    headingRad: bearingRad,
  }));
}

function lineAbreast(
  anchor: { x: number; y: number },
  bearingRad: number,
  classes: ShipClassId[],
  gapKm = 0.22,
): Placement[] {
  const across = bearingRad + Math.PI / 2;
  return classes.map((classId, index) => ({
    classId,
    x: anchor.x + Math.sin(across) * gapKm * (index - (classes.length - 1) / 2),
    y: anchor.y - Math.cos(across) * gapKm * (index - (classes.length - 1) / 2),
    headingRad: bearingRad,
  }));
}

function nearestPort(anchor: { x: number; y: number }, size: "S" | "L"): PlacedPort | null {
  const ports = PLACED_PORTS.filter((port) => !port.npc && port.size === size);
  return ports.sort((a, b) =>
    Math.hypot(a.anchorage.x - anchor.x, a.anchorage.y - anchor.y) -
    Math.hypot(b.anchorage.x - anchor.x, b.anchorage.y - anchor.y),
  )[0] ?? null;
}

function findCoast(anchor: { x: number; y: number }): { x: number; y: number } | null {
  for (let radius = 3; radius <= 35; radius += 1) {
    for (let step = 0; step < 48; step += 1) {
      const angle = (step / 48) * Math.PI * 2;
      const x = anchor.x + Math.sin(angle) * radius;
      const y = anchor.y - Math.cos(angle) * radius;
      if (x < 3 || y < 3 || x > MAP_WIDTH_KM - 3 || y > MAP_HEIGHT_KM - 3) continue;
      if (isLandAt(x, y)) continue;
      // Land to the east makes this an east-facing lee shore in a westerly wind.
      if (isLandAt(x + 1.2, y) && !isLandAt(x - 3.5, y)) return { x, y };
    }
  }
  return null;
}

function findChannel(anchor: { x: number; y: number }): { x: number; y: number; headingRad: number } | null {
  for (let radius = 2; radius <= 45; radius += 1) {
    for (let step = 0; step < 64; step += 1) {
      const angle = (step / 64) * Math.PI * 2;
      const x = anchor.x + Math.sin(angle) * radius;
      const y = anchor.y - Math.cos(angle) * radius;
      if (x < 2 || y < 2 || x > MAP_WIDTH_KM - 2 || y > MAP_HEIGHT_KM - 2) continue;
      for (let heading = 0; heading < 4; heading += 1) {
        const headingRad = heading * Math.PI / 4;
        if (isTestChannelAt(x, y, headingRad)) return { x, y, headingRad };
      }
    }
  }
  return null;
}

/** Build one scenario in a fresh test room. Normal rooms get the old world. */
export function startTestScenario(
  world: World,
  playerId: string,
  scenarioId: unknown,
): ScenarioSetupResult {
  const definition = SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (world.kind === "normal" || !definition) {
    return { world, status: null, error: "That scenario is not available." };
  }
  const fresh = resetTestRoom(world);
  const anchorShip = shipsForOwner(fresh, playerId)[0];
  if (!anchorShip) {
    return { world: fresh, status: null, error: "No ship to place." };
  }
  const anchor = { x: anchorShip.x, y: anchorShip.y };
  let enemyOwners: string[] = [];
  let objectivePortId: string | undefined;

  const duel = (classId: ShipClassId): void => {
    const east = waterPointNear(anchor, 0.6, Math.PI / 2);
    replacePlayerFleet(fresh, playerId, [{
      classId, x: anchor.x, y: anchor.y, headingRad: Math.PI / 2,
    }]);
    replaceEnemyFleet(fresh, playerId, [{
      classId, x: east.x, y: east.y, headingRad: -Math.PI / 2,
    }], "fights");
    enemyOwners = ["TEST-ENEMY"];
  };

  switch (definition.id) {
    case "raider-duel":
    case "frigate-duel":
    case "line-duel":
    case "flagship-duel": {
      const classId: ShipClassId = definition.id === "raider-duel"
        ? "raider"
        : definition.id === "line-duel"
          ? "line"
          : definition.id === "flagship-duel"
            ? "flagship"
            : "frigate";
      duel(classId);
      break;
    }
    case "three-v-three": {
      const east = waterPointNear(anchor, 1.2, Math.PI / 2);
      replacePlayerFleet(fresh, playerId, lineAhead(anchor, Math.PI / 2,
        ["frigate", "frigate", "frigate"]));
      replaceEnemyFleet(fresh, playerId, lineAhead(east, -Math.PI / 2,
        ["frigate", "frigate", "frigate"]), "fights");
      enemyOwners = ["TEST-ENEMY"];
      break;
    }
    case "ten-v-ten": {
      const east = waterPointNear(anchor, 2, Math.PI / 2);
      const mine: ShipClassId[] = [
        "frigate", "frigate", "frigate", "frigate", "frigate",
        "line", "line", "line", "escort", "escort",
      ];
      replacePlayerFleet(fresh, playerId, lineAhead(anchor, Math.PI / 2, mine, 0.22));
      replaceEnemyFleet(fresh, playerId, lineAhead(east, -Math.PI / 2, mine, 0.22), "fights");
      enemyOwners = ["TEST-ENEMY"];
      break;
    }
    case "small-port":
    case "large-port": {
      const large = definition.id === "large-port";
      const port = nearestPort(anchor, large ? "L" : "S");
      if (!port) return { world: fresh, status: null, error: "No port of that size." };
      const spot = waterPointNear(port.anchorage, 1.6);
      const classes: ShipClassId[] = large ? ["line", "line", "line", "line"] : ["flagship"];
      replacePlayerFleet(fresh, playerId, lineAbreast(spot, Math.atan2(
        port.anchorage.x - spot.x, -(port.anchorage.y - spot.y),
      ), classes, 0.25));
      setTestPortOwner(fresh, playerId, port.id, "TEST-ENEMY");
      setTestPortTier(fresh, port.id, large ? 3 : 1);
      fresh.captureHoldRealSeconds = 30;
      enemyOwners = [];
      objectivePortId = port.id;
      pushPlayerNotice(fresh, playerId, `${port.name} is the target. Capture hold is 30 s.`);
      break;
    }
    case "boarding": {
      const east = waterPointNear(anchor, 0.5, Math.PI / 2);
      const [own] = replacePlayerFleet(fresh, playerId, [{
        classId: "frigate", x: anchor.x, y: anchor.y, headingRad: Math.PI / 2,
      }]);
      if (own) own.autoBoard = true;
      replaceEnemyFleet(fresh, playerId, [{
        classId: "frigate", x: east.x, y: east.y, headingRad: -Math.PI / 2, crewShare: 0.3,
      }], "fights");
      enemyOwners = ["TEST-ENEMY"];
      break;
    }
    case "surrender-run": {
      const east = waterPointNear(anchor, 1.2, Math.PI / 2);
      replacePlayerFleet(fresh, playerId, [{
        classId: "frigate", x: anchor.x, y: anchor.y, headingRad: Math.PI / 2,
      }]);
      replaceEnemyFleet(fresh, playerId, [
        { classId: "frigate", x: east.x, y: east.y, headingRad: Math.PI, name: "Dummy that surrenders" },
        { classId: "frigate", x: east.x + 0.25, y: east.y - 0.25, headingRad: Math.PI, name: "Dummy that runs" },
      ], "fights");
      const enemy = fresh.botFleets.get("TEST-ENEMY") ?? [];
      if (enemy[0]) enemy[0].dummyBehaviour = "surrenders";
      if (enemy[1]) enemy[1].dummyBehaviour = "runs";
      enemyOwners = ["TEST-ENEMY"];
      break;
    }
    case "fire-night-fight":
    case "fire-night-engage": {
      const engage = definition.id === "fire-night-engage";
      setTestTimeOfDay(fresh, 23);
      const fleet = waterPointNear(anchor, 1.2, Math.PI / 2);
      const player = replacePlayerFleet(fresh, playerId, [{
        classId: "fireShip", x: anchor.x, y: anchor.y, headingRad: Math.PI / 2,
      }])[0];
      if (player) player.lightsOff = true;
      const enemies = replaceEnemyFleet(fresh, playerId, lineAbreast(fleet, Math.PI,
        ["frigate", "frigate", "frigate", "frigate", "frigate"], 0.12), "fights");
      for (const enemy of enemies) {
        enemy.hoveTo = true;
        enemy.speedKnots = 0;
        enemy.stance = engage ? "engage" : "fightIfAttacked";
        enemy.lightsOff = true;
      }
      enemyOwners = ["TEST-ENEMY"];
      break;
    }
    case "merchant": {
      replacePlayerFleet(fresh, playerId, [{
        classId: "frigate", x: anchor.x, y: anchor.y, headingRad: Math.PI / 2,
      }]);
      const merchant = fresh.npcShips.find((ship) => ship.npcKind === "merchant");
      const spot = waterPointNear(anchor, 3, Math.PI / 2);
      if (merchant) {
        merchant.x = spot.x;
        merchant.y = spot.y;
        merchant.order = null;
        merchant.route = null;
        merchant.npcDestinationPortId = null;
        merchant.autoAnchor = false;
      }
      const whalers = fresh.npcShips.filter((ship) => ship.npcKind === "whaler").slice(0, 3);
      const whalerSpot = waterPointNear(anchor, 4, Math.PI);
      const whalerGroup = whalers[0]?.npcGroupId;
      for (const [index, whaler] of whalers.entries()) {
        whaler.x = whalerSpot.x + index * 0.12;
        whaler.y = whalerSpot.y;
        whaler.order = null;
        whaler.route = null;
        whaler.npcDestinationPortId = null;
        whaler.autoAnchor = false;
        if (whalerGroup) whaler.npcGroupId = whalerGroup;
      }
      enemyOwners = [];
      break;
    }
    case "escort":
    case "privateers": {
      const port = PLACED_PORTS.find((candidate) => candidate.npc) ?? PLACED_PORTS[0];
      if (!port) return { world: fresh, status: null, error: "No NPC port." };
      const ship = replacePlayerFleet(fresh, playerId, [{
        classId: "frigate", x: port.anchorage.x, y: port.anchorage.y, headingRad: 0,
      }])[0];
      if (ship) {
        ship.dockedPortId = port.id;
        ship.speedKnots = 0;
        ship.order = null;
        ship.route = null;
      }
      const owner = fresh.owners.get(playerId);
      if (owner) owner.money = Math.max(owner.money, 3_000);
      const privateers = fresh.npcShips.filter((candidate) => candidate.npcKind === "privateer");
      const wanted = definition.id === "privateers" ? 3 : 1;
      for (let index = 0; index < Math.min(wanted, privateers.length); index += 1) {
        const privateer = privateers[index]!;
        const spot = waterPointNear(port.anchorage, 0.8 + index * 0.1);
        privateer.x = spot.x;
        privateer.y = spot.y;
        privateer.order = null;
        privateer.route = null;
        privateer.npcHiredBy = null;
        privateer.npcContractUntilGameMs = 0;
        privateer.npcDestinationPortId = null;
      }
      enemyOwners = [];
      pushPlayerNotice(fresh, playerId,
        definition.id === "escort"
          ? "Escort job available at the privateer alongside."
          : "3,000 pieces ready; three privateers are alongside.");
      break;
    }
    case "coast": {
      const coast = findCoast(anchor) ?? anchor;
      const channel = findChannel(anchor);
      fresh.windFromDeg = 270;
      const shoreward = waterPointNear(coast, 4, Math.PI * 1.5);
      const placements: Placement[] = [{
        classId: "frigate", x: shoreward.x, y: shoreward.y, headingRad: Math.PI, name: "Lee shore ship",
      }];
      if (channel) {
        const reverse = {
          x: channel.x + Math.sin(channel.headingRad + Math.PI) * 3,
          y: channel.y - Math.cos(channel.headingRad + Math.PI) * 3,
        };
        placements.push({
          classId: "frigate", x: channel.x, y: channel.y,
          headingRad: channel.headingRad, name: "Channel ship",
        });
        const ships = replacePlayerFleet(fresh, playerId, placements);
        const second = ships[1];
        if (second) {
          second.order = { type: "sailTo", x: reverse.x, y: reverse.y };
          second.autoAnchor = false;
        }
      } else {
        placements.push({
          classId: "frigate", x: anchor.x + 0.5, y: anchor.y, headingRad: Math.PI,
          name: "Channel ship",
        });
        replacePlayerFleet(fresh, playerId, placements);
      }
      for (const ship of shipsForOwner(fresh, playerId)) {
        ship.autoAnchor = false;
        ship.order = ship.name === "Lee shore ship" ? null : ship.order;
      }
      enemyOwners = [];
      pushPlayerNotice(fresh, playerId,
        channel ? "Lee shore 4 km off; channel ship told to reverse." : "Lee shore 4 km off; no channel found nearby.");
      break;
    }
    case "two-player": {
      const players = [...fresh.playerRecords.values()];
      const placement = players.map((record, index) => {
        const spot = index === 0
          ? anchor
          : waterPointNear(anchor, 3, Math.PI);
        return { record, spot, index };
      });
      for (const { record, spot, index } of placement) {
        replacePlayerFleet(fresh, record.id, [{
          classId: "frigate",
          x: spot.x,
          y: spot.y,
          headingRad: index === 0 ? Math.PI : 0,
        }]);
      }
      enemyOwners = players.filter((record) => record.id !== playerId).map((record) => record.id);
      break;
    }
  }

  const status = beginScenarioTracking(fresh, playerId, {
    id: definition.id,
    name: definition.name,
    seed: definition.seed,
    enemyOwners,
    objectivePortId,
  });
  return { world: fresh, status, error: null };
}
