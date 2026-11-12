// The fleet order data model and its pure state transitions.
//
// Every order has a progress record. The server owns the clock; this module
// only decides what is complete and what a follower should steer for.

import { normalizeDegrees } from "./sailing.js";
import { settings } from "./settings.js";
import type { MapPoint } from "./map.js";

export type FleetOrder =
  | { type: "goTo"; x: number; y: number }
  | { type: "sailToPort"; portId: string }
  | { type: "hold" }
  | { type: "heading"; headingDeg: number; distanceKm: number }
  | { type: "follow"; shipId: string }
  | { type: "escort"; shipId: string }
  | { type: "patrol"; a: MapPoint; b: MapPoint }
  | { type: "rendezvous"; point: MapPoint; memberIds: string[] }
  | { type: "engage"; shipId: string; objective: "sink" | "capture" }
  | { type: "returnToPort" }
  | { type: "queue"; orders: FleetOrder[] };

export type OrderStatus = "pending" | "active" | "complete" | "failed";

export interface OrderProgress {
  order: FleetOrder;
  status: OrderStatus;
  /** Heading orders only: distance still to run. */
  remainingKm: number;
  /** Patrol orders only: zero means sailing to A, one means sailing to B. */
  patrolLeg: 0 | 1;
  /** Follow and escort only: since when the target was last seen. */
  targetMissingSinceGameMs: number;
  /** Rendezvous only. */
  arrivedShipIds: string[];
  message: string | null;
}

export type OrderEvent =
  | { kind: "arrived" }
  | { kind: "moved"; distanceKm: number }
  | { kind: "targetSeen"; gameMs: number }
  | { kind: "targetDocked" }
  | { kind: "targetLost"; gameMs: number }
  | { kind: "tick"; gameMs: number }
  | { kind: "memberArrived"; shipId: string }
  | { kind: "landAhead" }
  | { kind: "failed"; message: string };

export const ORDER_LABELS: Record<FleetOrder["type"], string> = {
  goTo: "Go to point",
  sailToPort: "Sail to port",
  hold: "Hold position",
  heading: "Heading and distance",
  follow: "Follow ship",
  escort: "Escort ship",
  patrol: "Patrol",
  rendezvous: "Rendezvous",
  engage: "Engage ship",
  returnToPort: "Return to nearest port",
  queue: "Queue",
};

export function orderLabel(order: FleetOrder): string {
  return ORDER_LABELS[order.type];
}

/** Compass degrees to a map point exactly that far away. */
export function headingTarget(
  from: MapPoint,
  headingDeg: number,
  distanceKm: number,
): MapPoint {
  const heading = normalizeDegrees(headingDeg) * (Math.PI / 180);
  return {
    x: from.x + Math.sin(heading) * distanceKm,
    y: from.y - Math.cos(heading) * distanceKm,
  };
}

export function initialOrderProgress(order: FleetOrder): OrderProgress {
  return {
    order,
    status: order.type === "queue" ? "pending" : "active",
    remainingKm: order.type === "heading" ? order.distanceKm : 0,
    patrolLeg: 0,
    targetMissingSinceGameMs: 0,
    arrivedShipIds: [],
    message: null,
  };
}

function withStatus(
  progress: OrderProgress,
  status: OrderStatus,
  message: string | null = progress.message,
): OrderProgress {
  return { ...progress, status, message };
}

export function advanceOrderProgress(
  progress: OrderProgress,
  event: OrderEvent,
): OrderProgress {
  if (progress.status === "complete" || progress.status === "failed") return progress;
  const order = progress.order;

  if (event.kind === "failed") return withStatus(progress, "failed", event.message);
  if (event.kind === "landAhead") {
    return withStatus(progress, "complete", "Land ahead.");
  }

  if (event.kind === "moved" && order.type === "heading") {
    const remainingKm = Math.max(0, progress.remainingKm - Math.max(0, event.distanceKm));
    const next = { ...progress, remainingKm };
    return remainingKm <= 1e-6 ? withStatus(next, "complete") : next;
  }

  if (event.kind === "targetSeen" && (order.type === "follow" || order.type === "escort")) {
    return { ...progress, targetMissingSinceGameMs: 0 };
  }

  if (event.kind === "targetLost" && (order.type === "follow" || order.type === "escort")) {
    return {
      ...progress,
      targetMissingSinceGameMs: progress.targetMissingSinceGameMs || event.gameMs,
    };
  }

  if (event.kind === "targetDocked" && (order.type === "follow" || order.type === "escort")) {
    return withStatus(progress, "complete", "Target docked.");
  }

  if (event.kind === "tick" && (order.type === "follow" || order.type === "escort")) {
    if (progress.targetMissingSinceGameMs <= 0) return progress;
    const limit = settings.fleets.targetLostGameMinutes * 60 * 1000;
    if (event.gameMs - progress.targetMissingSinceGameMs >= limit) {
      return withStatus(progress, "complete", "Target lost from sight.");
    }
    return progress;
  }

  if (event.kind === "memberArrived" && order.type === "rendezvous") {
    const arrived = new Set(progress.arrivedShipIds);
    arrived.add(event.shipId);
    const next = { ...progress, arrivedShipIds: [...arrived] };
    return rendezvousComplete(order, arrived) ? withStatus(next, "complete") : next;
  }

  if (event.kind === "arrived") {
    // Hold is active until another order replaces it.
    if (order.type === "hold") return progress;
    if (order.type === "patrol") {
      return { ...progress, patrolLeg: progress.patrolLeg === 0 ? 1 : 0 };
    }
    if (order.type === "rendezvous") {
      return progress;
    }
    return withStatus(progress, "complete");
  }

  return progress;
}

export function rendezvousComplete(
  order: Extract<FleetOrder, { type: "rendezvous" }>,
  arrived: ReadonlySet<string>,
): boolean {
  return order.memberIds.length > 0 && order.memberIds.every((id) => arrived.has(id));
}

export function patrolTarget(order: Extract<FleetOrder, { type: "patrol" }>, leg: 0 | 1): MapPoint {
  return leg === 0 ? order.a : order.b;
}

export function fleetOrderTarget(order: FleetOrder): MapPoint | null {
  if (order.type === "goTo") return { x: order.x, y: order.y };
  if (order.type === "rendezvous") return order.point;
  if (order.type === "patrol") return order.a;
  return null;
}

/** Follow sits behind the target; escort sits out alongside it. */
export function followStation(
  target: MapPoint,
  targetHeadingRad: number,
  mode: "follow" | "escort",
): MapPoint {
  const distance = mode === "follow"
    ? settings.fleets.followDistanceKm
    : settings.fleets.escortDistanceKm;
  const forwardX = Math.sin(targetHeadingRad);
  const forwardY = -Math.cos(targetHeadingRad);
  if (mode === "follow") {
    return { x: target.x - forwardX * distance, y: target.y - forwardY * distance };
  }
  return { x: target.x + Math.cos(targetHeadingRad) * distance, y: target.y + Math.sin(targetHeadingRad) * distance };
}

/** A small deterministic spread for free-chase group orders. */
export function groupSpreadPoint(
  point: MapPoint,
  index: number,
  count: number,
  spreadKm: number = settings.sailing.groupSpreadKm,
): MapPoint {
  if (count <= 1 || index <= 0) return { ...point };
  const radius = spreadKm * Math.sqrt(index / (count - 1));
  const angle = index * 2.399963229728653;
  return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
}

/** Append an order while queueing is on; otherwise replace the queue. */
export function withQueuedOrder(
  current: readonly FleetOrder[],
  order: FleetOrder,
  queueing: boolean,
): FleetOrder[] {
  return queueing ? [...current, order] : [order];
}

export function hasActiveOrder(progress: OrderProgress | null): boolean {
  return progress !== null &&
    (progress.status === "active" || progress.status === "pending");
}

export function formatHeading(headingDeg: number): string {
  return `${String(Math.round(normalizeDegrees(headingDeg))).padStart(3, "0")}°`;
}
