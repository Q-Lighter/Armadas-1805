// 3K: one fixed-slot game shell. Every slot gets a rectangle from this pure
// module; the client applies those rectangles and the runtime audit measures
// the resulting DOM boxes with getBoundingClientRect().
//
// The old docks, toolbars and floating handles are gone. The map owns the
// whole screen; the slots sit over its corners and never move with the camera.

export interface SlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type GameSlotId =
  | "top-right-slot"
  | "ship-slot"
  | "bottom-left-slot"
  | "wordmark"
  | "armed-order"
  | "notice"
  | "notice-2";

export interface GameSlot {
  id: GameSlotId;
  rect: SlotRect;
}

export interface GameSlots {
  width: number;
  height: number;
  mode: "desktop" | "phonePortrait" | "phoneLandscape";
  mapArea: SlotRect;
  slots: GameSlot[];
}

export interface MeasuredSlot {
  id: string;
  rect: { left: number; top: number; right: number; bottom: number };
  interactive: boolean;
  contentHeight: number;
  clientHeight: number;
  scrollable: boolean;
  /** Nested buttons are checked for size but not against their slot. */
  nested?: boolean;
}

export interface SlotAuditIssue {
  kind: "outside" | "overlap" | "clipped" | "small-target";
  id: string;
  other?: string;
  detail: string;
}

export function resolveGameMode(
  width: number,
  height: number,
): GameSlots["mode"] {
  if (width >= 700 && height >= 520) return "desktop";
  return height < width ? "phoneLandscape" : "phonePortrait";
}

function box(left: number, top: number, width: number, height: number): SlotRect {
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

/**
 * Fixed rectangles for the five visible slots and the two toast rows.
 *
 * The top-right stack holds the date/money panel and its three buttons. The
 * slim ship strip is top-left. The compass and the Tools/Multi/Stance row are
 * bottom-left, and the non-interactive title mark is bottom-right.
 */

/** IDs removed with the 3K toolbar rebuild. Kept inert in the client so old
 * feature wiring can be retired without a blank-page crash. */
export const REMOVED_3K_IDS: ReadonlySet<string> = new Set([
  "attack-nearest-btn", "back-to-ship-btn", "bottom-dock", "chart-btn",
  "dock", "dock-collapse", "dock-menu-btn", "dock-tab-fleet", "dock-tab-log",
  "dock-tab-ports", "dock-tab-research", "dock-tab-ship", "dock-tabs",
  "fleet-btn", "fleet-count", "follow-btn", "group-bar", "move-btn",
  "orders-btn", "orders-list-btn", "orders-sheet", "queue-btn", "tap-btn",
  "tap-mode-label", "undo-chip", "undo-sail", "wind-chip", "wind-chip-label",
]);

export function fixedGameSlots(width: number, height: number): GameSlots {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const mode = resolveGameMode(w, h);
  const desktop = mode === "desktop";
  const margin = desktop ? 12 : 8;
  const gap = desktop ? 8 : 6;

  const topRightW = desktop
    ? Math.min(244, Math.round(w * 0.3))
    : Math.min(188, Math.round(w * 0.52));
  const statusH = desktop ? 64 : 52;
  const buttonH = 44;
  const topRightH = statusH + 3 * (buttonH + gap);
  const topRight = box(w - margin - topRightW, margin, topRightW, topRightH);

  const shipW = desktop
    ? Math.min(370, w - topRightW - 4 * margin)
    : Math.max(118, w - topRightW - 3 * margin);
  const shipH = desktop ? 62 : 48;
  const ship = box(margin, margin, shipW, shipH);

  const compass = desktop ? 68 : 58;
  const toolsW = desktop ? 106 : 84;
  const smallW = desktop ? 58 : 50;
  const bottomLeftH = compass;
  const bottomLeftW = Math.min(
    w - 2 * margin,
    compass + 3 * gap + toolsW + smallW * 2,
  );
  const bottomLeft = box(
    margin,
    h - margin - bottomLeftH,
    bottomLeftW,
    bottomLeftH,
  );

  const markW = desktop ? 112 : 70;
  const markH = desktop ? 42 : 28;
  const wordmark = box(w - margin - markW, h - margin - markH, markW, markH);

  const centreTop = desktop
    ? margin
    : Math.max(ship.top + ship.height, topRight.top + topRight.height) + gap;
  const centreSpace = desktop
    ? Math.max(240, w - shipW - topRightW - 6 * margin)
    : w - 2 * margin;
  const centreW = Math.min(520, centreSpace);
  const centreLeft = desktop
    ? Math.max(ship.left + ship.width + gap, (w - centreW) / 2)
    : (w - centreW) / 2;
  const armed = box(centreLeft, centreTop, centreW, 56);
  const toastTop = armed.top + armed.height + gap;
  const toastLeft = mode === "phoneLandscape"
    ? bottomLeft.left + bottomLeft.width + gap
    : centreLeft;
  const toastW = mode === "phoneLandscape"
    ? Math.max(0, Math.min(w - toastLeft - margin, wordmark.left - gap - toastLeft))
    : centreW;
  const notice = box(toastLeft, toastTop, toastW, 36);
  const notice2 = box(toastLeft, toastTop + 40, toastW, 36);

  return {
    width: w,
    height: h,
    mode,
    mapArea: box(0, 0, w, h),
    slots: [
      { id: "ship-slot", rect: ship },
      { id: "top-right-slot", rect: topRight },
      { id: "bottom-left-slot", rect: bottomLeft },
      { id: "wordmark", rect: wordmark },
      { id: "armed-order", rect: armed },
      { id: "notice", rect: notice },
      { id: "notice-2", rect: notice2 },
    ],
  };
}

function overlaps(a: MeasuredSlot["rect"], b: MeasuredSlot["rect"]): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
    Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
}

/**
 * Compare measured DOM boxes. Slots compare with each other; nested controls
 * are only checked for size and clipping so a button inside its own panel is
 * not reported as an overlap.
 */
export function auditMeasuredSlots(
  slots: readonly MeasuredSlot[],
  viewport: { width: number; height: number },
  minTargetPx = 44,
): SlotAuditIssue[] {
  const issues: SlotAuditIssue[] = [];
  const visible = slots.filter(
    (slot) => slot.rect.right > slot.rect.left && slot.rect.bottom > slot.rect.top,
  );
  for (const slot of visible) {
    const r = slot.rect;
    if (r.left < -1 || r.top < -1 || r.right > viewport.width + 1 || r.bottom > viewport.height + 1) {
      issues.push({
        kind: "outside",
        id: slot.id,
        detail: `${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${viewport.width}x${viewport.height}`,
      });
    }
    if (slot.interactive && (r.right - r.left < minTargetPx || r.bottom - r.top < minTargetPx)) {
      issues.push({
        kind: "small-target",
        id: slot.id,
        detail: `${Math.round(r.right - r.left)}x${Math.round(r.bottom - r.top)}`,
      });
    }
    if (!slot.scrollable && slot.contentHeight > slot.clientHeight + 1) {
      issues.push({
        kind: "clipped",
        id: slot.id,
        detail: `${slot.contentHeight}px content in ${slot.clientHeight}px`,
      });
    }
  }
  for (let first = 0; first < visible.length; first += 1) {
    const a = visible[first]!;
    if (a.nested) continue;
    for (let second = first + 1; second < visible.length; second += 1) {
      const b = visible[second]!;
      if (b.nested || a.id === b.id) continue;
      if (!overlaps(a.rect, b.rect)) continue;
      issues.push({ kind: "overlap", id: a.id, other: b.id, detail: "boxes intersect" });
    }
  }
  return issues;
}

export function slotById(slots: GameSlots, id: GameSlotId): GameSlot | undefined {
  return slots.slots.find((slot) => slot.id === id);
}
