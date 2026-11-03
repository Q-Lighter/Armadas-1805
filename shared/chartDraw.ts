// Deterministic chart drawing order. Blocks arrive in network batches, but
// their order must never change the painted result.

import type { ChartBlock } from "./fog.js";

/** Blocks sorted by id, not by arrival or Map insertion order. */
export function orderedChartBlocks(
  blocks: ReadonlyMap<string, ChartBlock>,
): ChartBlock[] {
  return [...blocks.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
