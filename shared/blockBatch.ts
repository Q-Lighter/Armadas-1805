// A small per-second budget for private chart blocks. Dev rooms start with the
// whole chart queued, so a state message may not carry the whole queue.

export class BlockSendBudget {
  private sentAt: number[] = [];

  constructor(
    readonly perSecond: number,
    readonly maxPerMessage: number,
  ) {}

  /** How many blocks may be sent in this message, without recording them. */
  take(now: number): number {
    this.sentAt = this.sentAt.filter((time) => now - time < 1_000);
    return Math.max(0, Math.min(this.maxPerMessage, this.perSecond - this.sentAt.length));
  }

  /** Record the blocks actually put in a state message. */
  note(count: number, now: number): void {
    for (let index = 0; index < count; index += 1) this.sentAt.push(now);
  }

  get sentInWindow(): number {
    return this.sentAt.length;
  }
}
