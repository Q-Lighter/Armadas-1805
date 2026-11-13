// A tiny named throttle for non-canvas DOM work. Each named readout gets its
// own last-render time, so the ship panel, Fleet card and battle log do not
// rebuild on every world update.

export class DomThrottle {
  private last = new Map<string, number>();

  due(key: string, now: number, perSecond: number): boolean {
    const interval = 1_000 / Math.max(0.1, perSecond);
    const previous = this.last.get(key);
    if (previous !== undefined && now - previous < interval) return false;
    this.last.set(key, now);
    return true;
  }

  reset(key?: string): void {
    if (key === undefined) this.last.clear();
    else this.last.delete(key);
  }
}
