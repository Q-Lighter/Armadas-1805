// A small start/stop switch for a room's world timer.
//
// The server owns the real timer; this class only decides whether one exists.
// It is plain TypeScript with an injected timer, so tests can run it without a
// browser, Node or a Durable Object.

/** The two timer functions the room needs. */
export interface TimerApi {
  every(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}

export class RoomLoop {
  private handle: unknown | null = null;

  constructor(
    private readonly onTick: () => void,
    private readonly intervalMs: number,
    private readonly timers: TimerApi,
  ) {}

  /** True while a timer is running. */
  get running(): boolean {
    return this.handle !== null;
  }

  /**
   * Start exactly one timer. A second call from another connection, or from a
   * message, does nothing.
   */
  start(): void {
    if (this.handle !== null) return;
    this.handle = this.timers.every(this.onTick, this.intervalMs);
  }

  /** Stop the timer. No world update happens after this returns. */
  stop(): void {
    if (this.handle === null) return;
    this.timers.cancel(this.handle);
    this.handle = null;
  }
}
