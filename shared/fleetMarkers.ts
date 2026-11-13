// Far-zoom fleet grouping: ships of one fleet closer than the threshold on
// screen become one marker with a count. Different fleets never merge.

export interface FleetMarkerShip {
  id: string;
  fleetId: string | null;
  x: number;
  y: number;
}

export interface FleetMarkerGroup {
  fleetId: string;
  ids: string[];
  x: number;
  y: number;
  count: number;
}

export interface FleetMarkerPlan {
  groups: FleetMarkerGroup[];
  groupedIds: Set<string>;
}

export const FLEET_MARKER_GROUP_PX = 14;

export function groupFleetMarkers(
  ships: readonly FleetMarkerShip[],
  pxPerKm: number,
  thresholdPx = FLEET_MARKER_GROUP_PX,
): FleetMarkerPlan {
  const groups: FleetMarkerGroup[] = [];
  const groupedIds = new Set<string>();
  if (!Number.isFinite(pxPerKm) || pxPerKm <= 0) return { groups, groupedIds };
  const thresholdKm = thresholdPx / pxPerKm;
  const thresholdSq = thresholdKm * thresholdKm;
  const visited = new Set<string>();

  for (const start of ships) {
    if (!start.fleetId || visited.has(start.id)) continue;
    const component: FleetMarkerShip[] = [];
    const queue = [start];
    visited.add(start.id);
    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      for (const other of ships) {
        if (other.fleetId !== start.fleetId || visited.has(other.id)) continue;
        const dx = other.x - current.x;
        const dy = other.y - current.y;
        if (dx * dx + dy * dy > thresholdSq) continue;
        visited.add(other.id);
        queue.push(other);
      }
    }
    if (component.length < 2) continue;
    let x = 0;
    let y = 0;
    const ids: string[] = [];
    for (const ship of component) {
      x += ship.x;
      y += ship.y;
      ids.push(ship.id);
      groupedIds.add(ship.id);
    }
    groups.push({
      fleetId: start.fleetId,
      ids,
      x: x / component.length,
      y: y / component.length,
      count: component.length,
    });
  }
  return { groups, groupedIds };
}
