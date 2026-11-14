// One pure layout engine for every screen in Armada's 1805.
//
// Existing HTML keeps its ids, but the client applies the rectangles from this
// file and nothing else positions a top-level UI element. The plan is also the
// input to the render-plan tests, so the five review viewports can be checked
// without a browser.

import type { LayoutIssue } from "./layoutAudit.js";

export type LayoutPreference = "auto" | "phone" | "desktop";
export type LayoutMode = "desktop" | "phonePortrait" | "phoneLandscape";

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type LayoutGroup =
  | "chrome"
  | "dock"
  | "toolbar"
  | "mapOverlay"
  | "notice"
  | "sheet"
  | "screen"
  | "panel";

export type LayoutPanelId =
  | "ship"
  | "damage"
  | "target"
  | "fleet"
  | "log"
  | "ports"
  | "port"
  | "trade"
  | "shipyard"
  | "hire"
  | "knownPorts";

export type LayoutModalId =
  | "board"
  | "crew"
  | "captured"
  | "loot"
  | "privateer"
  | "escort"
  | "resign"
  | "surrender"
  | "victory"
  | "eliminated"
  | "orderMenu"
  | "heading"
  | "shipAction";

export interface LayoutState {
  /** A normal frame with no selected target and no open panel. */
  idle?: boolean;
  ownShipSelected?: boolean;
  inCombat?: boolean;
  enemySelected?: boolean;
  surrenderOffered?: boolean;
  enemyPortSelected?: boolean;
  ownPortSelected?: boolean;
  fireShipSelected?: boolean;
  towAvailable?: boolean;
  chartOpen?: boolean;
  trailsOpen?: boolean;
  menuOpen?: boolean;
  developerOpen?: boolean;
  ordersOpen?: boolean;
  shipSheetOpen?: boolean;
  battleLogOpen?: boolean;
  dockCollapsed?: boolean;
  dockPanel?: LayoutPanelId;
  noticeCount?: number;
  battleLogUnread?: number;
  modal?: LayoutModalId | null;
  /** Screen-space anchor for the selected enemy's map chip. */
  enemyChip?: { x: number; y: number } | null;
}

export interface LayoutElement {
  id: string;
  label: string;
  group: LayoutGroup;
  rect: ScreenRect;
  z: number;
  visible: boolean;
  interactive: boolean;
  /** Only the compass and scale bar are exempt from overlap checks. */
  mapOverlay: boolean;
  /** An element inside this one is allowed to overlap it. */
  parent?: string;
  /** Panels scroll their body; clipping their overflow is intentional. */
  scrollable: boolean;
  contentHeight: number;
  disabled: boolean;
  reason?: string;
}

export interface ScreenLayoutPlan {
  mode: LayoutMode;
  width: number;
  height: number;
  elements: LayoutElement[];
  mapArea: ScreenRect;
  /** Stable request for a full runtime audit after applying this plan. */
  audit: () => LayoutIssue[];
}

const INVENTORY: Array<{
  id: string;
  label: string;
  group: LayoutGroup;
  interactive?: boolean;
  mapOverlay?: boolean;
}> = [
  { id: "top-bar", label: "Top bar", group: "chrome" },
  { id: "money-panel", label: "Money", group: "chrome" },
  { id: "game-clock-panel", label: "Clock", group: "chrome" },
  { id: "wind-chip", label: "Wind", group: "chrome" },
  { id: "fleet-btn", label: "Fleet", group: "chrome", interactive: true },
  { id: "chart-btn", label: "Chart", group: "chrome", interactive: true },
  { id: "menu-btn", label: "Menu", group: "chrome", interactive: true },
  { id: "battle-log-btn", label: "Battle log", group: "chrome", interactive: true },
  { id: "dock-menu-btn", label: "Dock Menu", group: "dock", interactive: true },
  { id: "bottom-dock", label: "Dock", group: "dock" },
  { id: "orders-btn", label: "Orders", group: "dock", interactive: true },
  { id: "action-bar", label: "Sailing toolbar", group: "toolbar" },
  { id: "tap-btn", label: "Tap", group: "toolbar", interactive: true },
  { id: "move-btn", label: "Move", group: "toolbar", interactive: true },
  { id: "multi-btn", label: "Multi", group: "toolbar", interactive: true },
  { id: "follow-btn", label: "Follow", group: "toolbar", interactive: true },
  { id: "queue-btn", label: "Queue", group: "toolbar", interactive: true },
  { id: "group-bar", label: "Control groups", group: "toolbar" },
  { id: "battle-bar", label: "Battle orders", group: "toolbar" },
  { id: "ship-panel", label: "Ship", group: "panel" },
  { id: "target-card", label: "Target", group: "panel" },
  { id: "damage-panel", label: "Damage", group: "panel" },
  { id: "battle-log", label: "Battle log sheet", group: "panel" },
  { id: "fleet-panel", label: "Fleet panel", group: "panel" },
  { id: "port-panel", label: "Port", group: "panel" },
  { id: "known-ports-panel", label: "Ports", group: "panel" },
  { id: "trade-panel", label: "Trade", group: "panel" },
  { id: "shipyard-panel", label: "Shipyard", group: "panel" },
  { id: "hire-panel", label: "Hire", group: "panel" },
  { id: "dock", label: "Dock frame", group: "dock" },
  { id: "dock-tabs", label: "Dock tabs", group: "dock" },
  { id: "dock-tab-ship", label: "Dock Ship tab", group: "dock", interactive: true },
  { id: "dock-tab-fleet", label: "Dock Fleet tab", group: "dock", interactive: true },
  { id: "dock-tab-log", label: "Dock Log tab", group: "dock", interactive: true },
  { id: "dock-tab-ports", label: "Dock Ports tab", group: "dock", interactive: true },
  { id: "dock-collapse", label: "Dock collapse", group: "dock", interactive: true },
  { id: "menu-panel", label: "Menu", group: "sheet" },
  { id: "test-tools", label: "Developer", group: "sheet" },
  { id: "notice", label: "Notice 1", group: "notice" },
  { id: "notice-2", label: "Notice 2", group: "notice" },
  { id: "capture-strip", label: "Capture strip", group: "notice" },
  { id: "escort-strip", label: "Escort strip", group: "notice" },
  { id: "chart-trails", label: "Chart controls", group: "chrome" },
  { id: "map-compass", label: "Compass", group: "mapOverlay", mapOverlay: true },
  { id: "scale-bar", label: "Scale bar", group: "mapOverlay", mapOverlay: true },
  { id: "board-sheet", label: "Board sheet", group: "sheet" },
  { id: "crew-sheet", label: "Crew sheet", group: "sheet" },
  { id: "captured-sheet", label: "Captured crew sheet", group: "sheet" },
  { id: "loot-sheet", label: "Loot sheet", group: "sheet" },
  { id: "privateer-sheet", label: "Privateer sheet", group: "sheet" },
  { id: "escort-sheet", label: "Escort job sheet", group: "sheet" },
  { id: "surrender-sheet", label: "Surrender sheet", group: "sheet" },
  { id: "surrender-confirm", label: "Surrender confirm", group: "sheet" },
  { id: "resign-sheet", label: "Resign sheet", group: "sheet" },
  { id: "victory-screen", label: "Victory", group: "screen" },
  { id: "eliminated-screen", label: "Eliminated", group: "screen" },
  { id: "order-menu", label: "Orders sheet", group: "sheet" },
  { id: "heading-sheet", label: "Heading sheet", group: "sheet" },
  { id: "ship-action", label: "Ship actions", group: "sheet" },
  { id: "charting", label: "Charting", group: "notice" },
  { id: "version-notice", label: "Version notice", group: "notice" },
  { id: "client-error", label: "Client error", group: "notice" },
  { id: "quality-note", label: "Quality note", group: "notice" },
  { id: "enemy-chip", label: "Selected enemy", group: "notice" },
  { id: "orders-sheet", label: "Orders sheet body", group: "sheet" },
  { id: "layout-debug-layer", label: "Layout debug", group: "screen" },
];

export const UI_ELEMENTS = INVENTORY;

const INVENTORY_BY_ID = new Map(INVENTORY.map((entry) => [entry.id, entry]));

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function rect(left: number, top: number, width: number, height: number): ScreenRect {
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

function right(r: ScreenRect): number {
  return r.left + r.width;
}

function bottom(r: ScreenRect): number {
  return r.top + r.height;
}

export function resolveLayoutMode(
  width: number,
  height: number,
  preference: LayoutPreference = "auto",
): LayoutMode {
  if (preference === "desktop") return "desktop";
  if (preference === "phone") {
    return width > height && height < 600 ? "phoneLandscape" : "phonePortrait";
  }
  if (width >= 700 && height >= 600) return "desktop";
  return height < 500 ? "phoneLandscape" : "phonePortrait";
}

function makeElement(
  id: string,
  r: ScreenRect,
  z: number,
  options: Partial<LayoutElement> = {},
): LayoutElement {
  const entry = INVENTORY_BY_ID.get(id);
  return {
    id,
    label: options.label ?? entry?.label ?? id,
    group: options.group ?? entry?.group ?? "panel",
    rect: r,
    z,
    visible: options.visible ?? true,
    interactive: options.interactive ?? entry?.interactive ?? false,
    mapOverlay: options.mapOverlay ?? entry?.mapOverlay ?? false,
    parent: options.parent,
    scrollable: options.scrollable ?? false,
    contentHeight: options.contentHeight ?? r.height,
    disabled: options.disabled ?? false,
    reason: options.reason,
  };
}

function placeChild(
  list: LayoutElement[],
  id: string,
  parent: string,
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
  options: Partial<LayoutElement> = {},
): void {
  list.push(makeElement(
    id,
    rect(x, y, width, height),
    z,
    { ...options, parent, interactive: options.interactive ?? true },
  ));
}

function add(
  list: LayoutElement[],
  id: string,
  r: ScreenRect,
  z: number,
  options: Partial<LayoutElement> = {},
): void {
  list.push(makeElement(id, r, z, options));
}

function tabs(
  list: LayoutElement[],
  parent: string,
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
  active: LayoutPanelId,
): void {
  const tabWidth = width / 4;
  const entries: Array<[string, LayoutPanelId, string]> = [
    ["dock-tab-ship", "ship", "Ship"],
    ["dock-tab-fleet", "fleet", "Fleet"],
    ["dock-tab-log", "log", "Log"],
    ["dock-tab-ports", "ports", "Ports"],
  ];
  entries.forEach(([id, panel, label], index) => {
    list.push(makeElement(id, rect(x + index * tabWidth, y, tabWidth, height), z, {
      label,
      parent,
      interactive: true,
      disabled: panel === active ? false : false,
    }));
  });
}

function addToolbarControls(
  elements: LayoutElement[],
  parent: string,
  x: number,
  y: number,
  step: number,
  z: number,
  state: LayoutState,
): void {
  const ids = ["tap-btn", "move-btn", "multi-btn", "follow-btn", "queue-btn"];
  ids.forEach((id, index) => {
    const isMove = id === "move-btn";
    const tapOn = state.idle !== true;
    placeChild(elements, id, parent, x + index * step, y, 44, 44, z, {
      disabled: isMove ? tapOn : false,
      reason: isMove && tapOn ? "Tap On is active: choose Move first" : undefined,
    });
  });
}

function desktop(
  width: number,
  height: number,
  state: LayoutState,
): { elements: LayoutElement[]; mapArea: ScreenRect } {
  const elements: LayoutElement[] = [];
  const topH = 52;
  const dockW = state.dockCollapsed ? 0 : 340;
  const dockX = width - dockW;
  const mapW = dockX;
  const mapArea = rect(0, topH, mapW, height - topH);
  const z = 10;

  add(elements, "top-bar", rect(0, 0, width, topH), z);
  placeChild(elements, "money-panel", "top-bar", 10, 4, 96, 44, z + 1, { interactive: false });
  placeChild(elements, "game-clock-panel", "top-bar", 114, 4, 148, 44, z + 1, { interactive: false });
  placeChild(elements, "wind-chip", "top-bar", 270, 4, 104, 44, z + 1, { interactive: false });
  placeChild(elements, "fleet-btn", "top-bar", 382, 4, 64, 44, z + 1);
  placeChild(elements, "chart-btn", "top-bar", 454, 4, 64, 44, z + 1);
  placeChild(elements, "menu-btn", "top-bar", 526, 4, 64, 44, z + 1);
  if (width >= 900) placeChild(elements, "battle-log-btn", "top-bar", 598, 4, 44, 44, z + 1);

  const toolbarW = 5 * 44 + 4 * 8;
  const toolbar = rect((mapW - toolbarW) / 2, height - 64, toolbarW, 52);
  if (!state.modal) {
    add(elements, "action-bar", toolbar, z);
    addToolbarControls(elements, "action-bar", toolbar.left, toolbar.top, 52, z + 1, state);
  }

  const contextVisible = state.inCombat === true || state.enemySelected === true ||
    state.surrenderOffered === true || state.fireShipSelected === true ||
    state.enemyPortSelected === true || state.ownPortSelected === true;
  if (contextVisible) {
    const bar = rect((mapW - Math.min(600, mapW - 24)) / 2, toolbar.top - 60, Math.min(600, mapW - 24), 52);
    add(elements, "battle-bar", bar, z + 2);
  }

  add(elements, "map-compass", rect(14, height - 82, 64, 64), 5, { mapOverlay: true });
  add(elements, "scale-bar", rect(14, height - 108, 120, 18), 5, { mapOverlay: true });

  if (!state.dockCollapsed && !state.menuOpen && !state.developerOpen) {
    add(elements, "dock", rect(dockX, topH, dockW, height - topH), 20);
    add(elements, "dock-tabs", rect(dockX, topH, dockW, 48), 21, { parent: "dock" });
    tabs(elements, "dock-tabs", dockX, topH, dockW, 44, 22, state.dockPanel ?? "ship");
    if (!state.modal) {
      add(elements, "dock-collapse", rect(dockX - 44, topH + 56, 44, 48), 23, {
        interactive: true,
        label: "Collapse dock",
      });
    }
    const body = rect(dockX + 8, topH + 52, dockW - 16, height - topH - 60);
    const panel = state.modal ? null : (state.dockPanel ?? "ship");
    const panelMap: Partial<Record<LayoutPanelId, string>> = {
      ship: "ship-panel",
      damage: "damage-panel",
      target: "target-card",
      fleet: "fleet-panel",
      log: "battle-log",
      ports: "known-ports-panel",
      port: "port-panel",
      trade: "trade-panel",
      shipyard: "shipyard-panel",
      hire: "hire-panel",
      knownPorts: "known-ports-panel",
    };
    const panelId = panel ? panelMap[panel] : undefined;
    if (panelId) {
      add(elements, panelId, body, 25, { parent: "dock", scrollable: true, contentHeight: body.height + 160 });
    }
  } else if (!state.menuOpen && !state.developerOpen) {
    add(elements, "dock-collapse", rect(width - 48, topH, 48, 48), 23, { interactive: true });
  }

  if (state.menuOpen) {
    const menu = rect(width - 420, topH + 8, 408, height - topH - 16);
    add(elements, "menu-panel", menu, 50, { scrollable: true, contentHeight: menu.height + 240 });
  }
  if (state.developerOpen) {
    const dev = rect(width - 420, topH + 8, 408, height - topH - 16);
    add(elements, "test-tools", dev, 50, { scrollable: true, contentHeight: dev.height + 520 });
  }
  if (state.chartOpen) {
    add(elements, "chart-trails", rect(12, topH + 8, 340, 44), 30);
  }

  const noticeCount = clamp(state.noticeCount ?? 0, 0, 2);
  if (noticeCount > 0) {
    add(elements, "notice", rect(12, state.chartOpen ? topH + 60 : topH + 8, 320, 38), 31, { interactive: false });
  }
  if (noticeCount > 1) {
    add(elements, "notice-2", rect(12, state.chartOpen ? topH + 104 : topH + 52, 320, 38), 31, { interactive: false });
  }
  if (state.enemyChip && state.enemySelected) {
    add(elements, "enemy-chip", rect(
      clamp(state.enemyChip.x + 16, 12, mapW - 150),
      clamp(state.enemyChip.y - 20, topH + 96, height - 120),
      138,
      36,
    ), 32, { interactive: false });
  }
  const modal = state.modal;
  if (modal) {
    const sheet = rect(
      Math.max(12, mapW / 2 - 260),
      topH + 20,
      Math.min(520, mapW - 24),
      height - topH - 40,
    );
    add(elements, modalElementId(modal), sheet, 60, { scrollable: true, contentHeight: sheet.height + 260 });
  }

  return { elements, mapArea };
}

function modalElementId(modal: LayoutModalId): string {
  if (modal === "victory") return "victory-screen";
  if (modal === "eliminated") return "eliminated-screen";
  if (modal === "surrender") return "surrender-confirm";
  if (modal === "orderMenu") return "order-menu";
  if (modal === "heading") return "heading-sheet";
  if (modal === "shipAction") return "ship-action";
  return `${modal}-sheet`;
}

function phonePortrait(
  width: number,
  height: number,
  state: LayoutState,
): { elements: LayoutElement[]; mapArea: ScreenRect } {
  const elements: LayoutElement[] = [];
  const topH = 48;
  const dockH = 56;
  const contextH = 44;
  const margin = 8;
  const mapArea = rect(0, topH, width, height - topH - dockH);
  const z = 10;

  if (state.menuOpen || state.developerOpen) {
    const sheet = rect(0, 0, width, height);
    add(elements, state.menuOpen ? "menu-panel" : "test-tools", sheet, 50, {
      scrollable: true,
      contentHeight: sheet.height + 360,
    });
    return { elements, mapArea };
  }

  add(elements, "top-bar", rect(0, 0, width, topH), z);
  placeChild(elements, "money-panel", "top-bar", 8, 2, 76, 44, z + 1, { interactive: false });
  placeChild(elements, "game-clock-panel", "top-bar", 90, 2, 112, 44, z + 1, { interactive: false });
  placeChild(elements, "menu-btn", "top-bar", width - 52, 2, 44, 44, z + 1);
  placeChild(elements, "battle-log-btn", "top-bar", width - 100, 2, 44, 44, z + 1);
  if (width >= 400) placeChild(elements, "wind-chip", "top-bar", 208, 2, 84, 44, z + 1, { interactive: false });

  // The four-button dock is fixed and never hidden by a battle state.
  add(elements, "bottom-dock", rect(0, height - dockH, width, dockH), 30);
  const dockButtons: Array<[string, string]> = [
    ["fleet-btn", "Fleet"],
    ["chart-btn", "Chart"],
    ["orders-btn", "Orders"],
    ["dock-menu-btn", "Menu"],
  ];
  dockButtons.forEach(([id, label], index) => {
    const buttonW = width / 4;
    elements.push(makeElement(id, rect(index * buttonW, height - dockH, buttonW, dockH), 31, {
      label,
      parent: "bottom-dock",
      interactive: true,
    }));
  });

  const contextVisible = state.inCombat === true || state.enemySelected === true ||
    state.surrenderOffered === true || state.fireShipSelected === true ||
    state.enemyPortSelected === true || state.ownPortSelected === true;
  const contextShown = contextVisible && !state.ordersOpen && !state.battleLogOpen &&
    !state.modal && !state.shipSheetOpen;
  if (contextShown) {
    add(elements, "battle-bar", rect(margin, height - dockH - contextH, width - margin * 2, contextH), 35);
  }

  if (!state.modal && !state.battleLogOpen && !state.ordersOpen) {
    add(elements, "ship-panel", rect(margin, topH + 6, width - margin * 2, 48), 20, {
      scrollable: false,
    });
  }

  if (state.chartOpen) {
    add(elements, "chart-trails", rect(margin, topH + 62, width - margin * 2, 44), 25);
  }
  if (state.chartOpen && !state.modal && !state.battleLogOpen && !state.ordersOpen) {
    add(elements, "known-ports-panel", rect(margin, topH + 114, width - margin * 2, 140), 20, {
      scrollable: true,
      contentHeight: 260,
    });
  }

  const noticeTop = state.chartOpen ? topH + 262 : topH + 62;
  const noticeCount = clamp(state.noticeCount ?? 0, 0, 2);
  if (noticeCount > 0 && !state.battleLogOpen && !state.ordersOpen && !state.modal) {
    add(elements, "notice", rect(margin, noticeTop, width - margin * 2, 34), 32, { interactive: false });
  }
  if (noticeCount > 1 && !state.battleLogOpen && !state.ordersOpen && !state.modal) {
    add(elements, "notice-2", rect(margin, noticeTop + 38, width - margin * 2, 34), 32, { interactive: false });
  }
  if (state.enemyChip && state.enemySelected && !state.modal) {
    add(elements, "enemy-chip", rect(
      clamp(state.enemyChip.x + 12, margin, width - 138 - margin),
      clamp(state.enemyChip.y - 18, noticeTop + (noticeCount > 0 ? 76 : 0), height - dockH - 100),
      130,
      36,
    ), 33, { interactive: false });
  }

  if (state.ordersOpen && !state.modal) {
    const sheet = rect(margin, height - dockH - 208, width - margin * 2, 208);
    add(elements, "orders-sheet", sheet, 45, { scrollable: true, contentHeight: 260 });
    add(elements, "group-bar", rect(sheet.left + 8, sheet.top + 8, sheet.width - 16, 44), 46, {
      parent: "orders-sheet", interactive: false,
    });
    add(elements, "action-bar", rect(sheet.left + 8, sheet.top + 60, sheet.width - 16, 52), 46, {
      parent: "orders-sheet",
    });
    addToolbarControls(elements, "action-bar", sheet.left + 8, sheet.top + 60, (sheet.width - 16) / 5, 47, state);
  }

  if (state.battleLogOpen && !state.modal) {
    const sheet = rect(margin, height - dockH - Math.min(300, height * 0.42), width - margin * 2, Math.min(300, height * 0.42));
    add(elements, "battle-log", sheet, 46, { scrollable: true, contentHeight: 520 });
  }

  if (state.shipSheetOpen && !state.modal && !state.battleLogOpen && !state.ordersOpen) {
    const sheetH = Math.min(360, height * 0.5);
    add(elements, "ship-panel", rect(margin, height - dockH - sheetH, width - margin * 2, sheetH), 45, {
      scrollable: true,
      contentHeight: sheetH + 280,
    });
  }

  const modal = state.modal;
  if (modal) {
    const available = height - topH - dockH - 16;
    const sheetH = Math.min(available, Math.max(240, available * 0.9));
    const sheet = rect(margin, height - dockH - 8 - sheetH, width - margin * 2, sheetH);
    add(elements, modalElementId(modal), sheet, 60, { scrollable: true, contentHeight: sheet.height + 340 });
  }

  const mapOverlayBottom = height - dockH - (contextShown ? contextH : 0);
  add(elements, "map-compass", rect(12, mapOverlayBottom - 64, 56, 56), 5, { mapOverlay: true });
  add(elements, "scale-bar", rect(76, mapOverlayBottom - 22, 100, 16), 5, { mapOverlay: true });

  return { elements, mapArea };
}

function phoneLandscape(
  width: number,
  height: number,
  state: LayoutState,
): { elements: LayoutElement[]; mapArea: ScreenRect } {
  const elements: LayoutElement[] = [];
  const topH = 40;
  const dockW = 56;
  const contextH = 44;
  const margin = 8;
  const mapArea = rect(dockW, topH, width - dockW, height - topH - contextH);
  const z = 10;

  if (state.menuOpen || state.developerOpen) {
    const sheet = rect(0, 0, width, height);
    add(elements, state.menuOpen ? "menu-panel" : "test-tools", sheet, 50, {
      scrollable: true,
      contentHeight: sheet.height + 360,
    });
    return { elements, mapArea };
  }

  add(elements, "top-bar", rect(0, 0, width, topH), z);
  placeChild(elements, "money-panel", "top-bar", 8, 0, 74, 44, z + 1, { interactive: false });
  placeChild(elements, "game-clock-panel", "top-bar", 88, 0, 112, 44, z + 1, { interactive: false });
  placeChild(elements, "wind-chip", "top-bar", 206, 0, 86, 44, z + 1, { interactive: false });
  placeChild(elements, "battle-log-btn", "top-bar", width - 96, 0, 44, 44, z + 1);
  placeChild(elements, "menu-btn", "top-bar", width - 52, 0, 44, 44, z + 1);

  add(elements, "bottom-dock", rect(0, topH + 8, dockW, height - topH - contextH - 8), 30);
  const dockButtons: Array<[string, string]> = [
    ["fleet-btn", "Fleet"],
    ["chart-btn", "Chart"],
    ["orders-btn", "Orders"],
    ["dock-menu-btn", "Menu"],
  ];
  dockButtons.forEach(([id, label], index) => {
    elements.push(makeElement(id, rect(6, topH + 16 + index * 52, 44, 44), 31, {
      label,
      parent: "bottom-dock",
      interactive: true,
    }));
  });

  const contextVisible = state.inCombat === true || state.enemySelected === true ||
    state.surrenderOffered === true || state.fireShipSelected === true ||
    state.enemyPortSelected === true || state.ownPortSelected === true;
  if (contextVisible && !state.ordersOpen && !state.modal) {
    add(elements, "battle-bar", rect(dockW, height - contextH, width - dockW, contextH), 35);
  }

  if (!state.modal && !state.ordersOpen) {
    add(elements, "ship-panel", rect(dockW + 8, topH + 6, 250, 44), 20);
  }
  if (state.chartOpen) {
    add(elements, "chart-trails", rect(dockW + 8, topH + 56, 330, 44), 25);
  }
  const noticeCount = clamp(state.noticeCount ?? 0, 0, 2);
  const noticeTop = topH + (state.chartOpen ? 108 : 58);
  if (noticeCount > 0 && !state.modal && !state.ordersOpen) {
    add(elements, "notice", rect(dockW + 8, noticeTop, Math.min(300, width - dockW - 16), 32), 32, { interactive: false });
  }
  if (noticeCount > 1 && !state.modal && !state.ordersOpen) {
    add(elements, "notice-2", rect(dockW + 8, noticeTop + 36, Math.min(300, width - dockW - 16), 32), 32, { interactive: false });
  }
  if (state.enemyChip && state.enemySelected && !state.modal) {
    add(elements, "enemy-chip", rect(
      clamp(state.enemyChip.x + 12, dockW + 8, width - 138),
      clamp(state.enemyChip.y - 18, noticeTop + (noticeCount > 0 ? 72 : 0), height - contextH - 44),
      130,
      36,
    ), 33, { interactive: false });
  }

  if (state.ordersOpen && !state.modal) {
    const sheet = rect(width / 2, topH + 8, width / 2, height - topH - 16);
    add(elements, "orders-sheet", sheet, 45, { scrollable: true, contentHeight: 320 });
    add(elements, "action-bar", rect(sheet.left + 8, sheet.top + 8, sheet.width - 16, 52), 46, { parent: "orders-sheet" });
    addToolbarControls(elements, "action-bar", sheet.left + 8, sheet.top + 8, (sheet.width - 16) / 5, 47, state);
    add(elements, "group-bar", rect(sheet.left + 8, sheet.top + 68, sheet.width - 16, 44), 46, { parent: "orders-sheet" });
  }
  if (state.battleLogOpen && !state.modal) {
    const sheet = rect(width / 2, topH + 8, width / 2, height - topH - 16);
    add(elements, "battle-log", sheet, 46, { scrollable: true, contentHeight: 420 });
  }

  const modal = state.modal;
  if (modal) {
    const sheet = rect(width / 2, topH + 8, width / 2 - 8, height - topH - 16);
    add(elements, modalElementId(modal), sheet, 60, { scrollable: true, contentHeight: sheet.height + 360 });
  }

  add(elements, "map-compass", rect(dockW + 8, height - contextH - 64, 56, 56), 5, { mapOverlay: true });
  add(elements, "scale-bar", rect(dockW + 70, height - contextH - 24, 100, 16), 5, { mapOverlay: true });

  return { elements, mapArea };
}

function isAncestor(ancestor: LayoutElement, child: LayoutElement, all: LayoutElement[]): boolean {
  let current: LayoutElement | undefined = child;
  while (current?.parent) {
    if (current.parent === ancestor.id) return true;
    current = all.find((element) => element.id === current?.parent);
  }
  return false;
}

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return Math.min(right(a), right(b)) > Math.max(a.left, b.left) + 1 &&
    Math.min(bottom(a), bottom(b)) > Math.max(a.top, b.top) + 1;
}

/** Audit the pure render plan; map overlays are the only overlap exception. */
export function auditScreenLayout(
  plan: ScreenLayoutPlan,
  minTargetPx = 44,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const visible = plan.elements.filter((element) =>
    element.visible && element.rect.width > 0 && element.rect.height > 0
  );
  for (const element of visible) {
    const r = element.rect;
    if (r.left < 0 || r.top < 0 || right(r) > plan.width || bottom(r) > plan.height) {
      issues.push({
        kind: "outside",
        id: element.id,
        detail: `${r.left},${r.top} to ${right(r)},${bottom(r)} in ${plan.width}x${plan.height}`,
      });
    }
    if (element.interactive && (r.width < minTargetPx || r.height < minTargetPx)) {
      issues.push({
        kind: "small-target",
        id: element.id,
        detail: `${r.width}x${r.height}`,
      });
    }
    if (element.scrollable === false && element.contentHeight > r.height + 1) {
      issues.push({
        kind: "clipped",
        id: element.id,
        detail: `${element.contentHeight}px content in ${r.height}px`,
      });
    }
  }
  for (let first = 0; first < visible.length; first += 1) {
    for (let second = first + 1; second < visible.length; second += 1) {
      const a = visible[first]!;
      const b = visible[second]!;
      if (a.id === b.id || a.mapOverlay || b.mapOverlay) continue;
      if (isAncestor(a, b, visible) || isAncestor(b, a, visible)) continue;
      if (!overlaps(a.rect, b.rect)) continue;
      issues.push({
        kind: "overlap",
        id: a.id,
        other: b.id,
        detail: "boxes intersect",
      });
    }
  }
  return issues;
}

export function buildScreenLayout(input: {
  width: number;
  height: number;
  preference?: LayoutPreference;
  state?: LayoutState;
}): ScreenLayoutPlan {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const mode = resolveLayoutMode(width, height, input.preference ?? "auto");
  const state = input.state ?? {};
  const built = mode === "desktop"
    ? desktop(width, height, state)
    : mode === "phonePortrait"
      ? phonePortrait(width, height, state)
      : phoneLandscape(width, height, state);
  // Every inventory entry exists in the plan. Hidden entries keep a zero box,
  // which makes the inventory stable across screens and states.
  const present = new Map(built.elements.map((element) => [element.id, element]));
  const elements = INVENTORY.map((entry) => present.get(entry.id) ?? makeElement(
    entry.id,
    rect(0, 0, 0, 0),
    0,
    { visible: false },
  ));
  // Keep any pre-surrender naming difference while still exposing the actual
  // DOM id used by the existing markup.
  const plan: ScreenLayoutPlan = {
    mode,
    width,
    height,
    elements,
    mapArea: built.mapArea,
    audit: () => [],
  };
  plan.audit = () => auditScreenLayout(plan);
  return plan;
}

export function layoutElement(plan: ScreenLayoutPlan, id: string): LayoutElement | undefined {
  return plan.elements.find((element) => element.id === id);
}

export function contextStripVisible(state: LayoutState): boolean {
  return state.inCombat === true || state.enemySelected === true ||
    state.surrenderOffered === true || state.fireShipSelected === true ||
    state.enemyPortSelected === true || state.ownPortSelected === true;
}
