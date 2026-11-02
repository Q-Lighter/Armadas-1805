// The single settings file. Every tuning number in the game belongs here.
//
// The design notes mark values that still need tuning as "Draft". When a Draft
// number is agreed, it goes into the matching group below, with a short comment
// saying what it does and why it has that value.
//
// Rules for this file:
// - Only numbers that a designer might want to change: times, speeds, costs,
//   ranges, rates, capacities.
// - Plain TypeScript only. No browser code, no server code.
// - The groups below start empty on purpose: no real numbers exist yet.

export const settings = {
  /** Turn length, order deadlines and other timing values. */
  time: {},

  /** Ship speeds, hull strength, crew, cargo and repair values. */
  ships: {},

  /** Port sizes, docking limits and repair facilities. */
  ports: {},

  /** Starting funds, upkeep, trade prices and prize money. */
  economy: {},

  /** Hit chances, damage, boarding and morale values. */
  combat: {},

  /** Wind strength, weather change chances and visibility. */
  weather: {},
} as const;

/** The shape of the whole settings file, for code that wants to pass it around. */
export type Settings = typeof settings;
