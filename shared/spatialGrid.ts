// A small uniform grid for "what is near this point?" queries. It avoids
// checking every ship against every other ship on large battle maps.

export interface GridPoint {
  x: number;
  y: number;
}

export class SpatialGrid<T extends GridPoint> {
  private readonly cells = new Map<string, T[]>();
  private readonly cellSizeKm: number;

  constructor(cellSizeKm = 0.25) {
    this.cellSizeKm = Math.max(0.001, cellSizeKm);
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSizeKm)}_${Math.floor(y / this.cellSizeKm)}`;
  }

  insert(value: T): void {
    const key = this.key(value.x, value.y);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(value);
  }

  /** Values whose centres are inside the square query radius. */
  query(x: number, y: number, radiusKm: number): T[] {
    const radius = Math.max(0, radiusKm);
    const minX = Math.floor((x - radius) / this.cellSizeKm);
    const maxX = Math.floor((x + radius) / this.cellSizeKm);
    const minY = Math.floor((y - radius) / this.cellSizeKm);
    const maxY = Math.floor((y + radius) / this.cellSizeKm);
    const found: T[] = [];
    const radiusSq = radius * radius;
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        const cell = this.cells.get(`${cellX}_${cellY}`);
        if (!cell) continue;
        for (const value of cell) {
          if ((value.x - x) ** 2 + (value.y - y) ** 2 <= radiusSq) found.push(value);
        }
      }
    }
    return found;
  }
}
