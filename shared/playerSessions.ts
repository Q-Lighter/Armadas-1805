// Who is connected to a room, and what happens after a disconnect.
//
// The newest socket for an id wins. A second tab therefore takes over the
// ship, and the old page is told to stop rather than reconnecting in a loop.

import type { RoomKind } from "./fog.js";

/** Close code understood by the client as "another tab has this ship". */
export const TAKEN_OVER_CLOSE_CODE = 4001;

export interface ClosableSocket {
  close(code?: number, reason?: string): void;
}

export class PlayerSessions<T extends ClosableSocket> {
  private readonly sockets = new Map<string, T>();

  /** Make this socket the one live connection for the id. */
  add(playerId: string, socket: T): T | undefined {
    const previous = this.sockets.get(playerId);
    this.sockets.set(playerId, socket);
    if (previous && previous !== socket) {
      try {
        previous.close(TAKEN_OVER_CLOSE_CODE, "another tab");
      } catch {
        // The old socket may already be closing.
      }
    }
    return previous;
  }

  /** Remove a socket only when it is still the current one. */
  remove(playerId: string, socket: T): boolean {
    if (this.sockets.get(playerId) !== socket) return false;
    this.sockets.delete(playerId);
    return true;
  }

  get(playerId: string): T | undefined {
    return this.sockets.get(playerId);
  }

  entries(): IterableIterator<[string, T]> {
    return this.sockets.entries();
  }

  get size(): number {
    return this.sockets.size;
  }
}

export interface CleanupTimers {
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}

/**
 * Remove disconnected players after a delay, but only in test and dev rooms.
 * A reconnect cancels the pending removal. Normal rooms never schedule one:
 * their ships stay in the world.
 */
export class GhostCleanup {
  private readonly timers = new Map<string, unknown>();
  private readonly timersApi: CleanupTimers;
  private readonly kind: () => RoomKind;
  private readonly delayMs: () => number;
  private readonly remove: (playerId: string) => void;

  constructor(
    kind: () => RoomKind,
    delayMs: () => number,
    remove: (playerId: string) => void,
    timers: CleanupTimers,
  ) {
    this.kind = kind;
    this.delayMs = delayMs;
    this.remove = remove;
    this.timersApi = timers;
  }

  disconnected(playerId: string): void {
    this.reconnected(playerId);
    const kind = this.kind();
    if (kind !== "test" && kind !== "dev") return;

    const handle = this.timersApi.schedule(() => {
      this.timers.delete(playerId);
      this.remove(playerId);
    }, Math.max(0, this.delayMs()));
    this.timers.set(playerId, handle);
  }

  reconnected(playerId: string): void {
    const handle = this.timers.get(playerId);
    if (handle === undefined) return;
    this.timersApi.cancel(handle);
    this.timers.delete(playerId);
  }

  clear(): void {
    for (const handle of this.timers.values()) this.timersApi.cancel(handle);
    this.timers.clear();
  }

  get pending(): number {
    return this.timers.size;
  }
}
